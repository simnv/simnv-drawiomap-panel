import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { FieldConfigSource, PanelData, PanelProps } from '@grafana/data';
import { CodeEditor, useTheme2, type Monaco, type MonacoEditor } from '@grafana/ui';
import type { BindResultV4 } from '../../binding/bindV4';
import { bindContextFor } from '../../binding/context';
import { snapshotV4 } from '../../binding/rowData';
import { check, rangeOf, toYaml } from '../../options/ConfigYamlEditor';
import { readYaml } from '../../options/yamlConfig';
import { indexSeries } from '../../query/seriesIndex';
import { fitCells, type ViewBox } from '../../render/zoom';
import { useBoundDiagram } from '../../stage/useBoundDiagram';
import { useStage } from '../../stage/useStage';
import { withDefaults, type Options, type PatchMap } from '../../types';
import { chartUsesV4 } from '../../visuals/ChartLayer';
import { cellsForPath, type CellSet } from '../split/cellsForPath';
import { registerCompletion, type CompletionSource } from '../split/completion';
import { reportCounts } from '../split/reportCounts';
import { pathAt, readDraft } from '../split/yamlPath';
import { DiagramStage, type StageSelection } from './DiagramStage';
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
}

/** The editor waits this long after the last cursor move (spec 5.3). */
export const CURSOR_WAIT_MS = 150;
/** The margin around the highlighted cells when the stage zooms to them, as a share of the larger side of the diagram. */
const FIT_MARGIN = 0.03;
const MARKER_OWNER = 'drawiomap-split-editor';
const NO_CELLS: CellSet = { cells: [], lighter: [], badges: new Map() };
const noSelect = () => {};

/** The refIds of the panel targets; without a request, the refIds of the loaded frames. */
function refIdsOf(data: PanelData): string[] {
  const refIds = data.request ? data.request.targets.map((t) => t.refId) : data.series.map((f) => f.refId);
  return [...new Set(refIds.filter((refId): refId is string => !!refId))];
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
export function SplitEditor({ options, data, timeZone, fieldConfig, replaceVariables }: SplitEditorProps) {
  const theme = useTheme2();
  const opts = withDefaults(options);
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
  const marks = useMemo(() => check(text).marks, [text]);
  const yamlEntries = useMemo(() => readDraft(text).entries, [text]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const stage = useStage(stageRef, opts.diagram?.svg, opts.diagram?.hash);
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
    xml: opts.diagram?.xml,
    config: draft,
    data,
    bindContext,
  });
  const shown = useMemo((): BindResultV4 => ({ ...bound, patches }), [bound, patches]);
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
  const selection = useMemo(
    (): StageSelection => ({ selected: [], affected: [], highlight: lit.cells, lighter: lit.lighter }),
    [lit.cells, lit.lighter]
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

  return (
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
          onSelect={noSelect}
          chartLayer={chartLayer}
          hash={opts.diagram?.hash}
          linkWidth={opts.linkWidth}
          badges={entryCells ? undefined : lit.badges}
          view={view}
          setView={setView}
        />
      }
      below={<MatchReport entries={entries} counts={counts} onPick={onPick} />}
    />
  );
}

export interface BindingsPopupProps extends SplitEditorProps {
  /** Close the popup and drop the draft. */
  onClose: () => void;
}

const OVERLAY_ID = 'bindings-popup';

/** The bindings popup: the split editor in a modal, with the Esc ownership of `usePopupKeys`. */
export function BindingsPopup({ onClose, ...props }: BindingsPopupProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useOverlay(OVERLAY_ID);
  const esc = usePopupKeys({ id: OVERLAY_ID, dialogRef: bodyRef, enabled: true, onEscape: onClose });
  return (
    <PluginDialog title="Edit bindings" onDismiss={onClose} overlayId={OVERLAY_ID}>
      <div ref={bodyRef} className={styles.body} data-testid="dmap-bindings-popup" {...esc}>
        <SplitEditor {...props} />
      </div>
    </PluginDialog>
  );
}

const styles = {
  body: css({ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }),
  code: css({ height: '100%' }),
};
