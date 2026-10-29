import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { FieldConfigSource, PanelData, PanelProps } from '@grafana/data';
import { Alert, Button, CodeEditor, ConfirmModal, useTheme2, type Monaco, type MonacoEditor } from '@grafana/ui';
import { isMap, isNode, isScalar, type Document } from 'yaml';
import type { BindResultV4 } from '../../binding/bindV4';
import { bindContextFor } from '../../binding/context';
import { edgeEnds, type EndContext } from '../../binding/edgeEnds';
import { snapshotV4 } from '../../binding/rowData';
import { check, rangeOf, toYaml } from '../../options/ConfigYamlEditor';
import { readYaml } from '../../options/yamlConfig';
import { configUpdate } from '../../options/storedConfig';
import { indexSeries } from '../../query/seriesIndex';
import { fitCells, type ViewBox } from '../../render/zoom';
import { useBoundDiagram } from '../../stage/useBoundDiagram';
import { useStage } from '../../stage/useStage';
import { withDefaults, type Diagram, type Options, type PatchMap } from '../../types';
import { chartUsesV4 } from '../../visuals/ChartLayer';
import { setCellAttrs } from '../setCellAttrs';
import { history, pushVersion, redo, undo } from '../history';
import { baseRevision, hasConflict } from '../revision';
import { cellsForPath, type CellSet } from '../split/cellsForPath';
import { classNamesOf, registerCompletion, type CompletionSource } from '../split/completion';
import { reportCounts } from '../split/reportCounts';
import { pathAt, readDraft } from '../split/yamlPath';
import { DiagramStage, type StageSelection } from './DiagramStage';
import { InspectorV4, type CellWrite } from './InspectorV4';
import { MatchReport, type ReportPick } from './MatchReport';
import { PluginDialog } from './PluginDialog';
import { PopupLayout } from './PopupLayout';
import { useOverlay } from './overlayStack';
import { usePopupKeys } from './usePopupKeys';

export interface SplitEditorProps {
  /** The saved options of the panel. The code box starts with `options.config`; later changes do not reset it. */
  options: Options;
  /** The data of the panel: the popup runs no query (spec 5.1). */
  data: PanelData;
  timeZone: string;
  fieldConfig: FieldConfigSource;
  replaceVariables: PanelProps['replaceVariables'];
  onOptionsChange?: PanelProps<Options>['onOptionsChange'];
  /** When set, show the editor in a dialog and confirm before dropping a dirty draft. */
  onClose?: () => void;
}

/** The editor waits this long after the last cursor move (spec 5.3). */
export const CURSOR_WAIT_MS = 150;
/** The margin around the highlighted cells when the stage zooms to them, as a share of the larger side of the diagram. */
const FIT_MARGIN = 0.03;
const MARKER_OWNER = 'drawiomap-split-editor';
const NO_CELLS: CellSet = { cells: [], lighter: [], badges: new Map() };

/** The refIds of the panel targets; without a request, the refIds of the loaded frames. */
function refIdsOf(data: PanelData): string[] {
  const refIds = data.request ? data.request.targets.map((t) => t.refId) : data.series.map((f) => f.refId);
  return [...new Set(refIds.filter((refId): refId is string => !!refId))];
}

/** The start of the key at a path of plain keys, or undefined when the text has no such key. */
function keyStart(doc: Document, parts: string[]): number | undefined {
  let node: unknown = doc.contents;
  let start: number | undefined;
  for (const part of parts) {
    const pair = isMap(node) ? node.items.find((p) => isScalar(p.key) && String(p.key.value) === part) : undefined;
    if (!pair || !isNode(pair.key) || !pair.key.range) {
      return undefined;
    }
    start = pair.key.range[0];
    node = pair.value;
  }
  return start;
}

/**
 * The YAML place of a clicked cell (spec 5.4): `overrides.<id>` when it exists, else `classes.<bind>`, else the end of
 * the last line of `classes`.
 */
function cellPlace(text: string, id: string, bind: string | undefined): number | undefined {
  const doc = readDraft(text).doc;
  const place = keyStart(doc, ['overrides', id]) ?? (bind === undefined ? undefined : keyStart(doc, ['classes', bind]));
  if (place !== undefined) {
    return place;
  }
  const classes = isMap(doc.contents) ? doc.contents.get('classes', true) : undefined;
  if (!isNode(classes) || !classes.range) {
    return undefined;
  }
  let end = classes.range[1];
  while (end > 0 && /\s/.test(text[end - 1])) {
    end--;
  }
  return end;
}

/** Monaco and its editor: they exist only after the code box mounts (spec 5.2). */
interface Instance {
  editor: MonacoEditor;
  monaco: Monaco;
}

/**
 * The split editor (spec 5.1): the YAML code box on the left, the live diagram on the right, the match report below.
 * Each edit parses the YAML. When it parses, the diagram binds the draft with the result per class, as view mode does;
 * when it does not parse, the diagram keeps the last valid draft and the markers show the errors. A cursor move, after
 * 150 ms, lights the cells of the YAML path under the cursor and zooms to them (spec 5.3). A click on a report entry
 * moves the cursor to its path and lights its cells.
 */
export function SplitEditor({
  options,
  data,
  timeZone,
  fieldConfig,
  replaceVariables,
  onOptionsChange,
  onClose,
}: SplitEditorProps) {
  const theme = useTheme2();
  const opts = withDefaults(options);
  /** The diagram with the writes of the inspector (spec 5.5). The writes go into the draw.io XML and the SVG (D19). */
  const [versions, setVersions] = useState(() => history<Diagram | undefined>(opts.diagram));
  const diagram = versions.present;
  const [base, setBase] = useState(() => baseRevision(options));
  const [savedText, setSavedText] = useState(() => toYaml(options.config));
  const [savedDiagram, setSavedDiagram] = useState(options.diagram);
  const [text, setText] = useState(() => toYaml(options.config));
  /** The value of the last text that parsed. */
  const [draft, setDraft] = useState<unknown>(options.config);
  const textRef = useRef(text);
  const onEdit = useCallback((next: string) => {
    if (next === textRef.current) {
      return;
    }
    textRef.current = next;
    setText(next);
    const read = readYaml(next);
    if (read.ok) {
      setDraft(read.value);
    }
  }, []);
  const checked = useMemo(() => check(text), [text]);
  const marks = checked.marks;
  const yamlEntries = useMemo(() => readDraft(text).entries, [text]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const stage = useStage(stageRef, diagram?.svg, diagram?.hash);
  const { min, max } = opts.linkWidth;
  const bindContext = useMemo(
    () =>
      bindContextFor({
        theme,
        fieldThresholds: fieldConfig.defaults.thresholds,
        replaceVariables,
        timeZone,
        linkWidth: { min, max },
      }),
    [theme, fieldConfig.defaults.thresholds, replaceVariables, timeZone, min, max]
  );
  const { validated, bound, patches, cardContext } = useBoundDiagram({
    index: stage.index,
    xml: diagram?.xml,
    config: draft,
    data,
    bindContext,
  });
  const shown = useMemo((): BindResultV4 => ({ ...bound, patches }), [bound, patches]);
  // The edge ends of the inspector (spec 3.8.1): once per diagram, not per open of the inspector.
  const ends = useMemo((): EndContext => {
    const found = edgeEnds(diagram?.xml, stage.index);
    return { index: stage.index, ends: found.ends, parents: found.parents };
  }, [diagram?.xml, stage.index]);
  const chartLayer = useMemo(
    () => ({ charts: chartUsesV4(bound), bound: shown, ctx: cardContext }),
    [bound, shown, cardContext]
  );
  const entries = useMemo(() => [...yamlEntries, ...bound.report], [yamlEntries, bound.report]);
  const counts = useMemo(() => reportCounts(bound, validated.classes), [bound, validated.classes]);

  // The highlight: the cells of the path under the cursor, or the cells of the report entry of the last click.
  const [cursorPath, setCursorPath] = useState<string | null>(null);
  const [entryCells, setEntryCells] = useState<string[] | null>(null);
  const pathCells = useMemo(
    () => (cursorPath ? cellsForPath(cursorPath, bound, validated.classes) : NO_CELLS),
    [cursorPath, bound, validated.classes]
  );
  const lit = entryCells ? { ...NO_CELLS, cells: entryCells } : pathCells;
  // The selected cells of the inspector (spec 5.4, 5.5). The last one is the primary cell.
  const [selected, setSelected] = useState<string[]>([]);
  const selection = useMemo(
    (): StageSelection => ({
      selected,
      primary: selected[selected.length - 1],
      affected: [],
      highlight: lit.cells,
      lighter: lit.lighter,
    }),
    [selected, lit.cells, lit.lighter]
  );

  // The stage zooms to the highlighted cells when the set changes (spec 5.3).
  const [view, setView] = useState<ViewBox | null>(null);
  const fitIds = useMemo(() => [...lit.cells, ...lit.lighter], [lit.cells, lit.lighter]);
  const fitKey = fitIds.join('\n');
  const lastFit = useRef('');
  useEffect(() => {
    if (fitKey === lastFit.current) {
      return;
    }
    lastFit.current = fitKey;
    const base = stage.base;
    if (fitIds.length && base) {
      // The boxes of the cells come from the layout of the external SVG DOM, so the view is set after the render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView(fitCells(stage.index, fitIds, base, Math.max(base.w, base.h) * FIT_MARGIN));
    }
  }, [fitKey, fitIds, stage.index, stage.base]);

  // The completion provider reads the latest sources (spec 5.6): the draft, the targets, the cells and the frames.
  const source = useMemo(
    (): CompletionSource => ({
      pathAt: (value, offset) => pathAt(readDraft(value).doc, value, offset),
      draft,
      refIds: refIdsOf(data),
      cells: [...stage.index.values()].map((entry) => entry.meta),
      series: (refId) => {
        const snapshot = snapshotV4(data, refId);
        return snapshot.state === 'ready' ? indexSeries(snapshot.frames, refId).series : [];
      },
    }),
    [draft, data, stage.index]
  );
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const [instance, setInstance] = useState<Instance>();
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onEditorDidMount = useCallback((editor: MonacoEditor, monaco: Monaco) => setInstance({ editor, monaco }), []);
  useEffect(() => {
    const model = instance?.editor.getModel();
    if (!instance || !model) {
      return;
    }
    const completion = registerCompletion(instance.monaco, model.id, () => sourceRef.current);
    const cursor = instance.editor.onDidChangeCursorPosition((event) => {
      clearTimeout(cursorTimer.current);
      // A move of the editor itself (a report click) keeps the highlight of that click.
      if (event.source === 'api') {
        return;
      }
      cursorTimer.current = setTimeout(() => {
        const value = model.getValue();
        setEntryCells(null);
        setCursorPath(pathAt(readDraft(value).doc, value, model.getOffsetAt(event.position)));
      }, CURSOR_WAIT_MS);
    });
    return () => {
      clearTimeout(cursorTimer.current);
      cursor.dispose();
      completion.dispose();
    };
  }, [instance]);

  useEffect(() => {
    const model = instance?.editor.getModel();
    if (!instance || !model) {
      return;
    }
    const severity = instance.monaco.MarkerSeverity;
    instance.monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      marks.map(({ blocks, ...mark }) => ({ ...mark, severity: blocks ? severity.Error : severity.Warning }))
    );
  }, [instance, marks]);

  /** A click in the report: the cursor goes to the YAML place, and the highlight follows the pick. */
  const onPick = useCallback(
    (pick: ReportPick) => {
      clearTimeout(cursorTimer.current);
      const editor = instance?.editor;
      const model = editor?.getModel();
      const line = pick.kind === 'entry' ? pick.line : undefined;
      if (editor && model && (pick.path || line)) {
        const position = line
          ? { lineNumber: line, column: 1 }
          : model.getPositionAt(rangeOf(readDraft(textRef.current).doc, pick.path!)[0]);
        editor.setPosition(position);
        editor.revealLineInCenter(position.lineNumber);
        editor.focus();
      }
      if (pick.kind === 'path') {
        setEntryCells(null);
        setCursorPath(pick.path);
      } else if (pick.cells.length) {
        setEntryCells(pick.cells);
      }
    },
    [instance]
  );

  /** A click on a cell selects it and moves the cursor to its class (spec 5.4). Shift adds it or takes it out. */
  const onSelect = useCallback(
    (id: string, { shift }: { shift: boolean }) => {
      if (shift) {
        setSelected((old) => (old.includes(id) ? old.filter((other) => other !== id) : [...old, id]));
        return;
      }
      setSelected([id]);
      const editor = instance?.editor;
      const model = editor?.getModel();
      const offset = cellPlace(textRef.current, id, stage.index.get(id)?.meta.attrs.bind);
      if (editor && model && offset !== undefined) {
        clearTimeout(cursorTimer.current);
        const position = model.getPositionAt(offset);
        editor.setPosition(position);
        editor.revealLineInCenter(position.lineNumber);
      }
    },
    [instance, stage.index]
  );
  const onBox = useCallback(
    (ids: string[]) => setSelected((old) => [...old, ...ids.filter((id) => !old.includes(id))]),
    []
  );

  const [writeError, setWriteError] = useState<string>();
  const onWrite = useCallback(
    (cells: CellWrite[]) => {
      if (!diagram) {
        return;
      }
      try {
        const next = setCellAttrs(diagram, cells);
        setVersions((old) => pushVersion(old, next));
        setWriteError(undefined);
      } catch (error) {
        setWriteError(error instanceof Error ? error.message : String(error));
      }
    },
    [diagram]
  );
  const onCloseInspector = useCallback(() => {
    setSelected([]);
    setWriteError(undefined);
  }, []);
  const classNames = useMemo(() => classNamesOf(draft), [draft]);

  const conflict = hasConflict(base, options);
  const dirty = text !== savedText || diagram !== savedDiagram;
  const [discard, setDiscard] = useState(false);
  const requestClose = useCallback(() => {
    if (dirty) {
      setDiscard(true);
    } else {
      onClose?.();
    }
  }, [dirty, onClose]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const keys = usePopupKeys({
    id: OVERLAY_ID,
    dialogRef: bodyRef,
    enabled: !!onClose && !discard,
    onEscape: requestClose,
    onUndo: () => setVersions(undo),
    onRedo: () => setVersions(redo),
  });
  const reload = () => {
    const nextText = toYaml(options.config);
    clearTimeout(cursorTimer.current);
    textRef.current = nextText;
    setText(nextText);
    setDraft(options.config);
    setSavedText(nextText);
    setSavedDiagram(options.diagram);
    setVersions(history(options.diagram));
    setBase(baseRevision(options));
    setSelected([]);
    setCursorPath(null);
    setEntryCells(null);
    setWriteError(undefined);
    setView(null);
    lastFit.current = '';
  };
  const apply = () => {
    if (!onOptionsChange || conflict || !('json' in checked)) {
      return;
    }
    const next = { ...options, config: checked.json, diagram };
    onOptionsChange({ ...next, config: configUpdate(options.config, checked.json) });
    setBase(baseRevision(next));
    setSavedText(text);
    setSavedDiagram(diagram);
  };

  const layout = (
    <PopupLayout
      code={
        <CodeEditor
          value={text}
          language="yaml"
          height="100%"
          containerStyles={styles.code}
          showLineNumbers
          showMiniMap={false}
          onChange={onEdit}
          onEditorDidMount={onEditorDidMount}
        />
      }
      stage={
        <DiagramStage
          stage={stage}
          stageRef={stageRef}
          patches={patches as PatchMap}
          selection={selection}
          onSelect={onSelect}
          onBox={onBox}
          chartLayer={chartLayer}
          hash={diagram?.hash}
          linkWidth={opts.linkWidth}
          badges={entryCells ? undefined : lit.badges}
          view={view}
          setView={setView}
        />
      }
      below={
        <div className={styles.below}>
          <div className={styles.report}>
            <MatchReport entries={entries} counts={counts} onPick={onPick} />
          </div>
          {selected.length ? (
            <div className={styles.inspector}>
              <InspectorV4
                cellIds={selected}
                index={stage.index}
                ends={ends}
                bound={bound}
                validated={validated}
                classNames={classNames}
                generated={options.build !== undefined}
                error={writeError}
                onWrite={onWrite}
                onClose={onCloseInspector}
              />
            </div>
          ) : null}
        </div>
      }
    />
  );
  const body = (
    <div ref={bodyRef} className={styles.body} data-testid={onClose ? 'dmap-bindings-popup' : undefined} {...keys}>
      {conflict && (
        <Alert title="The saved panel changed" severity="warning">
          <Button variant="secondary" onClick={reload}>
            Reload
          </Button>
          <Button variant="secondary" onClick={() => setBase(baseRevision(options))}>
            Keep my draft
          </Button>
        </Alert>
      )}
      <div className={styles.layout}>{layout}</div>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={!versions.past.length} onClick={() => setVersions(undo)}>
          Undo
        </Button>
        <Button variant="secondary" disabled={!versions.future.length} onClick={() => setVersions(redo)}>
          Redo
        </Button>
        <Button disabled={!onOptionsChange || conflict || !('json' in checked)} onClick={apply}>
          Apply
        </Button>
      </div>
      <ConfirmModal
        isOpen={discard}
        title="Discard changes?"
        body="The draft has changes that are not saved."
        confirmText="Discard"
        dismissText="Cancel"
        onConfirm={() => {
          setDiscard(false);
          onClose?.();
        }}
        onDismiss={() => setDiscard(false)}
      />
    </div>
  );
  return onClose ? (
    <PluginDialog title="Edit bindings" onDismiss={requestClose} overlayId={OVERLAY_ID}>
      {body}
    </PluginDialog>
  ) : (
    body
  );
}

export interface BindingsPopupProps extends SplitEditorProps {
  onOptionsChange: PanelProps<Options>['onOptionsChange'];
  /** Close the popup and drop the draft. */
  onClose: () => void;
}

const OVERLAY_ID = 'bindings-popup';

/** The bindings popup: the split editor in a modal, with the Esc ownership of `usePopupKeys`. */
export function BindingsPopup(props: BindingsPopupProps) {
  useOverlay(OVERLAY_ID);
  return <SplitEditor {...props} />;
}

const styles = {
  body: css({ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }),
  layout: css({ flex: 1, minHeight: 0 }),
  actions: css({ display: 'flex', gap: 8, padding: 8 }),
  code: css({ height: '100%' }),
  // The report and the inspector scroll on their own. A narrow pane puts the inspector below the report.
  below: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gridAutoRows: 'minmax(0, 1fr)',
    height: '100%',
  }),
  report: css({ minWidth: 0, overflow: 'auto' }),
  inspector: css({ minWidth: 0, overflow: 'auto' }),
};
