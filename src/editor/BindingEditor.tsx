import React, {
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, PanelData } from '@grafana/data';
import { Alert, Button, IconButton, useStyles2, useTheme2 } from '@grafana/ui';
import { cellIdentityDiagnostics, cellScope } from '../adapter/portograph';
import { bindPlan, widgetDiagnostics } from '../binding/engine';
import { resolvePatterns } from '../binding/patterns';
import { cellMatches } from '../binding/select';
import { useStage } from '../components/useStage';
import { cardContextFor } from '../binding/context';
import { extractSeries } from '../binding/series';
import { buildConfiguredCard } from '../interact/cardModel';
import { validateConfig, type DiagramConfigV2, type NamedQuery } from '../model/config';
import { PanelQueryContext } from '../query/panel';
import type { QuerySnapshot } from '../query/types';
import { buildCellIndex, cellMetas, mountSvg } from '../render/svgStage';
import { sanitizeSvg } from '../render/sanitize';
import type { BindContext, CellSelector, Diagram } from '../types';
import { fnv1a } from '../util/hash';
import { useBindingSnapshots } from '../visuals/useBindingSnapshots';
import { buildBindingsList, problemsOf, type BindingsList, type PatternRow, type ProblemEntry } from './bindingsModel';
import { commitDraft, createDraft, draftPatternIndex, isDirty } from './draft';
import { draftQueryService } from './draftContext';
import { DrawioModal } from './DrawioModal';
import { createHistory, reduceHistory } from './history';
import { previewPattern, type PatternPreview } from './patternPreview';
import { createPreviewResolver, previewSnapshot, statusDeadlines, usePreviewTime, type QueryPreview } from './preview';
import { DiagramStage } from './popup/DiagramStage';
import { InspectorPane, type InspectorSelection } from './popup/InspectorPane';
import type { QueryUser } from './popup/QueryPane';
import { ListPane } from './popup/ListPane';
import { PopupLayout, type PopupTab } from './popup/PopupLayout';
import type { PopupTarget } from './popup/popupBus';
import type { BaseRevision } from './revision';

/** The panel data points that a binding preview asks for; the panel card asks for the same number. */
const MAX_DATA_POINTS = 264;
const NO_RESULTS: QueryPreview[] = [];

export interface BindingEditorProps {
  /** The saved config that the draft starts from. */
  config: DiagramConfigV2;
  /** The saved diagram that the draft starts from. */
  diagram?: Diagram;
  /** The pinned revision of the saved options when the draft started (or after the last Apply). */
  base: BaseRevision;
  /** The saved options changed since `base`: Apply waits for a choice. */
  conflict?: boolean;
  data: PanelData;
  timeZone: string;
  bindContext: BindContext;
  /** Namespace of the query consumers, for example `popup:3`. */
  owner: string;
  /** What to select when the editor opens. */
  initial?: PopupTarget;
  /** Number of legacy rules of a panel that has no V2 config; the list points to the Rules editor. */
  legacyRules?: number;
  onDirtyChange?: (dirty: boolean) => void;
  /** Write the draft to the panel options. */
  onApply: (config: DiagramConfigV2, diagram?: Diagram) => void;
  /** Close the popup. The popup asks first when the draft has changes. */
  onRequestClose: () => void;
  /** Drop the draft and start again from the saved options. */
  onReload?: () => void;
  /** The popup reads the undo and redo of the draft here, for its key handler. */
  onControls?: (controls: HistoryControls | null) => void;
}

/** The undo and redo of the draft, for a key handler outside the editor. */
export interface HistoryControls {
  undo: () => void;
  redo: () => void;
}

type Selection = InspectorSelection;

/** The bindings editor: one draft, the three panes and the draft actions. */
export function BindingEditor({
  config,
  diagram,
  conflict = false,
  data,
  timeZone,
  bindContext,
  owner,
  initial,
  legacyRules,
  onDirtyChange,
  onApply,
  onRequestClose,
  onReload,
  onControls,
}: BindingEditorProps) {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const [history, dispatch] = useReducer(reduceHistory, undefined, () => createHistory(createDraft(config, diagram)));
  const draft = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  const dirty = isDirty(draft);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const stage = useStage(stageRef, draft.diagram?.svg, draft.diagram?.hash);
  const cells = stage.index;
  const metas = useMemo(() => cellMetas(cells), [cells]);

  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [filter, setFilter] = useState({ text: '', problemsOnly: false });
  const [highlight, setHighlight] = useState<string[]>([]);
  // The cells that the proposed selector of the multi-selection matches too, and the selected ones it misses.
  const [marks, setMarks] = useState<{ extra: string[]; missed: string[] }>({ extra: [], missed: [] });
  const showMarks = useCallback(
    (extra: string[], missed: string[]) =>
      setMarks((old) =>
        old.extra.join('\u0000') === extra.join('\u0000') && old.missed.join('\u0000') === missed.join('\u0000')
          ? old
          : { extra, missed }
      ),
    []
  );
  // The visible pane in tab mode. A selection opens the inspector.
  const [tab, setTab] = useState<PopupTab>('list');
  const [geometryOpen, setGeometryOpen] = useState(false);
  const [geometryError, setGeometryError] = useState('');
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [previewEpoch, setPreviewEpoch] = useState(0);
  // The datasource query editors keep their own text (Monaco does not follow its value). Discard remounts them.
  const [resetEpoch, setResetEpoch] = useState(0);
  const [queryId, setQueryId] = useState(config.queries[0]?.id);
  const [queryError, setQueryError] = useState('');
  const [previewState, setPreviewState] = useState<{ key: object; snapshot: QuerySnapshot }>();
  const [previewAction, setPreviewAction] = useState<'query' | 'pattern'>('query');
  const release = useRef<() => void>();

  // The draft default datasource applies to every query consumer of the popup, and to none of the panel.
  const saved = useContext(PanelQueryContext);
  const service = useMemo(
    () => draftQueryService(saved, draft.config.defaultDatasource),
    [saved, draft.config.defaultDatasource]
  );
  const context = service?.context;

  const query = draft.config.queries.find((q) => q.id === queryId);
  const previewKey = useMemo(
    () => ({
      query,
      context,
      cellId: draft.cellId,
      config: draft.config,
      scope: draft.scope,
      patternId: draft.patternId,
      patternIndex: draft.patternIndex,
      cells,
      previewEpoch,
    }),
    [query, context, draft.cellId, draft.config, draft.scope, draft.patternId, draft.patternIndex, cells, previewEpoch]
  );
  if (previewState && previewState.key !== previewKey) {
    setPreviewState(undefined);
  }
  // The query is gone (deleted, or an undo removed it): the pane closes.
  if (selection.kind === 'query' && !query) {
    setSelection({ kind: 'none' });
  }
  // Text that the user typed into the query pane and did not import never reaches the draft: it stops blocking
  // Apply when the pane closes (state adjustment during render).
  if (selection.kind !== 'query' && queryError) {
    setQueryError('');
  }
  const snapshot: QuerySnapshot = previewState?.key === previewKey ? previewState.snapshot : { state: 'idle' };
  const setSnapshot = (next: QuerySnapshot) => setPreviewState({ key: previewKey, snapshot: next });
  // Release obsolete demand of the explicit preview on edit or unmount.
  useEffect(
    () => () => {
      const stop = release.current;
      release.current = undefined;
      stop?.();
    },
    [previewKey]
  );

  const plan = useMemo(() => resolvePatterns(metas, draft.config), [metas, draft.config]);
  // The exact pattern of the draft, by index: duplicate pattern IDs must not widen the scope to another pattern.
  const editedPattern = draft.config.patterns[draftPatternIndex(draft)];
  const affected =
    draft.scope === 'pattern'
      ? editedPattern
        ? metas.filter((c) => cellMatches(editedPattern.select, c)).map((c) => c.id)
        : []
      : draft.cellId
        ? [draft.cellId]
        : [];

  const [patternState, setPatternState] = useState<{ key: object; value: PatternPreview }>();
  const patternRelease = useRef<() => void>();
  const patternKey = useMemo(
    () => ({
      config: draft.config,
      scope: draft.scope,
      patternId: draft.patternId,
      patternIndex: draft.patternIndex,
      cells,
      context,
      previewEpoch,
    }),
    [draft.config, draft.scope, draft.patternId, draft.patternIndex, cells, context, previewEpoch]
  );
  if (patternState && patternState.key !== patternKey) {
    setPatternState(undefined);
  }
  const patternResults = patternState?.key === patternKey ? patternState.value.previews : NO_RESULTS;
  useEffect(() => {
    return () => {
      const stop = patternRelease.current;
      patternRelease.current = undefined;
      stop?.();
    };
  }, [patternKey]);

  // The chart results of the popup: the binding snapshots reuse them (one request for equal demands).
  const chartOwner = useMemo(
    () => ({ plan, root: stage.root, context, controller: service?.controller }),
    [plan, stage.root, context, service?.controller]
  );
  const [chartResults, setChartResults] = useState<{ owner: object; values: Record<string, QueryPreview> }>();
  if (chartResults && chartResults.owner !== chartOwner) {
    setChartResults(undefined);
  }
  const onChartPrepared = useCallback(
    (id: string, preview?: QueryPreview) => {
      setChartResults((previous) => {
        const values = previous?.owner === chartOwner ? { ...previous.values } : {};
        if (preview) {
          values[id] = preview;
        } else {
          if (previous?.owner !== chartOwner || !values[id]) {
            return previous;
          }
          delete values[id];
        }
        return { owner: chartOwner, values };
      });
    },
    [chartOwner]
  );
  const chartSnapshots = useMemo(
    () => Object.values(chartResults?.owner === chartOwner ? chartResults.values : {}),
    [chartResults, chartOwner]
  );
  const bindingSnapshots = useBindingSnapshots(
    plan,
    draft.config,
    service,
    draft.cellId,
    MAX_DATA_POINTS,
    chartSnapshots,
    owner
  );
  const prepared = useMemo(() => [...bindingSnapshots, ...chartSnapshots], [bindingSnapshots, chartSnapshots]);

  const localPreview: QueryPreview | undefined = useMemo(
    () =>
      query && context && previewState?.key === previewKey
        ? { query, cellId: draft.cellId, context, snapshot: previewState.snapshot }
        : undefined,
    [query, context, previewState, previewKey, draft.cellId]
  );
  const generation = context?.generation;
  const format = useMemo(() => ({ theme, timeZone, generation }), [theme, timeZone, generation]);
  const reportResults = useMemo(() => {
    const explicit = localPreview ? [localPreview] : [];
    return previewAction === 'query' ? [...explicit, ...patternResults] : [...patternResults, ...explicit];
  }, [localPreview, previewAction, patternResults]);
  const savedResolve = useMemo(
    () => createPreviewResolver(plan, draft.config, data, undefined, format, prepared),
    [data, plan, draft.config, format, prepared]
  );
  // The inspector reports the requested outcome, including pending and failed requests.
  // Resolve each candidate separately so display's terminal-result ranking cannot skip it.
  const resolve: typeof savedResolve = useMemo(() => {
    const reportResolvers = reportResults.map((result) => ({
      result,
      resolve: createPreviewResolver(plan, draft.config, data, undefined, format, [result]),
    }));
    return (cellId, binding) => {
      for (const entry of reportResolvers) {
        // A batch outcome belongs to its requested scope, even for an unparameterized query.
        if (patternResults.includes(entry.result) && entry.result.cellId !== cellId) {
          continue;
        }
        const model = entry.resolve(cellId, binding);
        if (model.state !== 'idle') {
          return model;
        }
      }
      return savedResolve(cellId, binding);
    };
  }, [savedResolve, data, reportResults, plan, draft.config, format, patternResults]);
  const nowMs = usePreviewTime(
    data,
    generation,
    previewState?.snapshot,
    [...patternResults, ...prepared].map((result) => result.snapshot),
    statusDeadlines(plan, resolve)
  );
  const bound = useMemo(() => bindPlan(plan, resolve, bindContext, nowMs), [plan, resolve, bindContext, nowMs]);
  const cardPatch = draft.cellId ? bound.patches.get(draft.cellId) : undefined;
  // The context of the hover card, once per data update: the series come from the live panel data.
  const series = useMemo(() => extractSeries(data.series), [data.series]);
  const cardContext = useMemo(
    () =>
      cardContextFor({
        series,
        theme,
        timeZone,
        replaceVariables: bindContext.replaceVariables,
        fieldThresholds: bindContext.fieldThresholds,
      }),
    [series, theme, timeZone, bindContext.replaceVariables, bindContext.fieldThresholds]
  );
  // Built from the preview inputs only: a highlight or a selection change must not rebuild the card.
  const hoverPreview = useMemo(
    () =>
      (localPreview || patternResults.length > 0) && cardPatch
        ? buildConfiguredCard(cardPatch, resolve, cardContext)
        : undefined,
    [localPreview, patternResults, cardPatch, resolve, cardContext]
  );
  const metricDiagnostics = [...bound.diagnostics, ...(hoverPreview?.diagnostics ?? [])];
  const diagnostics = [...draft.diagnostics, ...validateConfig(draft.config).diagnostics, ...plan.diagnostics];
  const matchPreviews = affected.map((cellId) => {
    const bindings = [
      ...(plan.cells[cellId]?.bindings ?? []),
      ...plan.widgets.filter((entry) => entry.anchorCellId === cellId).map((entry) => entry.widget.binding),
    ];
    const models = bindings.map((binding) => ({ binding, model: resolve(cellId, binding) }));
    const failures = models.flatMap(({ binding, model }) =>
      model.state === 'empty'
        ? [`No metric matches query ${binding.queryId}.`]
        : model.state === 'error' || model.state === 'unsupported'
          ? [`Query ${binding.queryId}: ${model.message}`]
          : []
    );
    const unvalidated = models.some(({ model }) => model.state === 'idle' || model.state === 'loading');
    return {
      cellId,
      state: failures.length ? 'failed' : unvalidated ? 'unvalidated' : 'resolved',
      failures,
      unvalidated,
    };
  });
  const incompletePreview = matchPreviews.some((match) => match.state !== 'resolved');
  const hasMetricErrors = metricDiagnostics.some((d) =>
    ['ambiguous-metric', 'unsupported-metric', 'unresolved-metadata', 'invalid-url'].includes(d.code)
  );

  // The list shows every diagnostic that the editor knows, plus the hover card ones of all cells.
  // The deferred value keeps typing in a field responsive while the list catches up.
  const listInput = useMemo(
    () => ({ config: draft.config, draftDiagnostics: draft.diagnostics, plan, bound, resolve }),
    [draft.config, draft.diagnostics, plan, bound, resolve]
  );
  const deferred = useDeferredValue(listInput);
  const listDiagnostics = useMemo(() => {
    const cards = Array.from(deferred.bound.patches.values()).flatMap(
      (patch) => buildConfiguredCard(patch, deferred.resolve, cardContext).diagnostics
    );
    return [
      ...deferred.draftDiagnostics,
      ...validateConfig(deferred.config).diagnostics,
      ...deferred.bound.diagnostics,
      ...widgetDiagnostics(deferred.plan, deferred.resolve),
      ...cards,
    ];
  }, [deferred, cardContext]);
  const bindingsList = useMemo(
    () => buildBindingsList(deferred.config, metas, listDiagnostics),
    [deferred.config, metas, listDiagnostics]
  );

  // ---- selection ----
  // The cells of the selection that the diagram still has. A cell that a geometry save removed leaves it.
  const selectedIds =
    selection.kind === 'many'
      ? selection.cellIds.filter((id) => cells.has(id))
      : selection.kind === 'cell' && draft.cellId
        ? [draft.cellId]
        : [];
  if (selection.kind === 'many' && selectedIds.length !== selection.cellIds.length) {
    if (selectedIds.length >= 2) {
      setSelection({ kind: 'many', cellIds: selectedIds });
    } else {
      setSelection(selectedIds.length === 1 ? { kind: 'cell' } : { kind: 'none' });
      if (selectedIds.length === 1) {
        dispatch({ type: 'select', cellId: selectedIds[0] });
      }
    }
  }
  const openCell = (cellId: string) => {
    dispatch({ type: 'select', cellId });
    setSelectionVersion((v) => v + 1);
    setSelection({ kind: 'cell' });
    setTab('inspector');
  };
  // A pattern is edited through one of its cells, in the pattern scope.
  /** Replace the selection by these cells; the last one is the primary cell of the draft. */
  const pickCells = (ids: string[]) => {
    if (ids.length === 0) {
      setSelection({ kind: 'none' });
      return;
    }
    dispatch({ type: 'select', cellId: ids[ids.length - 1] });
    setSelectionVersion((v) => v + 1);
    setSelection(ids.length === 1 ? { kind: 'cell' } : { kind: 'many', cellIds: ids });
    setTab('inspector');
  };
  // Shift + click toggles a cell in the selection. A plain click replaces it.
  const toggleCell = (cellId: string) =>
    pickCells(selectedIds.includes(cellId) ? selectedIds.filter((id) => id !== cellId) : [...selectedIds, cellId]);
  // A box select adds the cells under the band to the selection (the band starts with Shift).
  const addCells = (ids: string[]) => {
    const fresh = ids.filter((id) => !selectedIds.includes(id));
    if (fresh.length) {
      pickCells([...selectedIds, ...fresh]);
    }
  };
  // A new pattern from the selection: one step in the history. The pattern opens in the pattern scope.
  const createPatternFrom = (select: CellSelector) => {
    let n = 1;
    while (draft.config.patterns.some((p) => p.id === `pattern-${n}`)) {
      n++;
    }
    const id = `pattern-${n}`;
    const first = metas.find((cell) => cellMatches(select, cell))?.id ?? selectedIds[selectedIds.length - 1];
    dispatch({
      type: 'batch',
      actions: [
        { type: 'pattern', pattern: { id, name: `Pattern ${n}`, select, display: {} } },
        { type: 'select', cellId: first },
        { type: 'scope', scope: 'pattern', patternId: id, patternIndex: draft.config.patterns.length },
      ],
    });
    setSelectionVersion((v) => v + 1);
    setSelection({ kind: 'cell' });
    setTab('inspector');
    setMarks({ extra: [], missed: [] });
  };
  const openPattern = (row: { patternId: string; index: number; matched: string[] }) => {
    const cellId = row.matched[0] ?? cells.keys().next().value;
    if (cellId === undefined) {
      return;
    }
    dispatch({ type: 'select', cellId });
    dispatch({ type: 'scope', scope: 'pattern', patternId: row.patternId, patternIndex: row.index });
    setSelectionVersion((v) => v + 1);
    setSelection({ kind: 'cell' });
    setTab('inspector');
    setHighlight([]);
  };
  const openQuery = (id: string) => {
    setQueryId(id);
    setQueryError('');
    setSelection({ kind: 'query', queryId: id });
    setTab('inspector');
  };
  const openProblem = (entry: ProblemEntry) => {
    const row = entry.row;
    if (!row) {
      return;
    }
    if (row.kind === 'pattern') {
      openPattern(row);
    } else if (row.kind === 'override') {
      if (row.exists) {
        openCell(row.cellId);
      }
    } else if (row.kind === 'widget') {
      if (row.exists) {
        openCell(row.anchorCellId);
      }
    } else {
      openQuery(row.queryId);
    }
  };
  const showHighlight = useCallback(
    (ids: string[]) =>
      setHighlight((old) => (old.length === ids.length && old.every((id, i) => id === ids[i]) ? old : ids)),
    []
  );

  // The first render selects what the popup was opened for (state adjustment during render).
  const [opened, setOpened] = useState(false);
  if (!opened) {
    setOpened(true);
    if (initial?.kind === 'cell' && cells.has(initial.cellId)) {
      openCell(initial.cellId);
    } else if (initial?.kind === 'query' && draft.config.queries.some((q) => q.id === initial.queryId)) {
      openQuery(initial.queryId);
    } else if (initial?.kind === 'problem') {
      setFilter({ text: '', problemsOnly: true });
      const entry = problemsOf(bindingsList).find((e) => e.problem.path === initial.path);
      if (entry) {
        openProblem(entry);
      }
    }
  }

  const selectedKey = useMemo(() => {
    if (selection.kind === 'query') {
      return bindingsList.queries.find((row) => row.queryId === selection.queryId)?.key;
    }
    if (selection.kind !== 'cell' || !draft.cellId) {
      return undefined;
    }
    if (draft.scope === 'pattern') {
      return bindingsList.patterns[draftPatternIndex(draft)]?.key;
    }
    return bindingsList.overrides.find((row) => row.cellId === draft.cellId)?.key ?? `cell:${draft.cellId}`;
  }, [selection, draft, bindingsList]);

  const selected = draft.cellId ? cells.get(draft.cellId) : undefined;
  const override = draft.config.overrides.find((o) => o.cellId === draft.cellId);
  // Invalid drafts still expose their raw fields for correction. Validation blocks Apply.
  const inspected = draft.cellId
    ? (plan.cells[draft.cellId] ??
      (selected
        ? {
            cellId: selected.meta.id,
            scope: cellScope(selected.meta),
            display: override?.display ?? {},
            patternIds: draft.config.patterns.filter((p) => cellMatches(p.select, selected.meta)).map((p) => p.id),
            overridden: !!override,
            bindings: [],
          }
        : undefined))
    : undefined;
  const fields = Array.from(
    new Set(
      (snapshot.state === 'ready' ? snapshot.frames : data.series).flatMap((frame) =>
        frame.fields.map((field) => field.name)
      )
    )
  );

  // ---- list actions ----
  const addQuery = () => {
    let n = 1;
    while (draft.config.queries.some((q) => q.id === `query-${n}`)) {
      n++;
    }
    const id = `query-${n}`;
    dispatch({
      type: 'query',
      query: { id, name: `Query ${n}`, source: { kind: 'datasource', target: { refId: `DM${n}` }, parameters: {} } },
    });
    openQuery(id);
  };
  const addPanelQuery = () => {
    const target = data.request?.targets[0];
    let n = 1;
    while (draft.config.queries.some((q) => q.id === `panel-${n}`)) {
      n++;
    }
    const id = `panel-${n}`;
    dispatch({
      type: 'query',
      query: {
        id,
        name: `Panel query ${target?.refId ?? 'A'}`,
        source: { kind: 'panel', refId: target?.refId ?? 'A' },
      },
    });
    openQuery(id);
  };
  const previewQuery = (selectedQuery: NamedQuery) => {
    release.current?.();
    setPreviewAction('query');
    const controller = service?.controller;
    if (!controller || !context) {
      setSnapshot({ state: 'error', message: 'Query service is not ready.' });
      return;
    }
    if (diagnostics.length || queryError) {
      setSnapshot({ state: 'error', message: 'Fix binding diagnostics before preview.' });
      return;
    }
    const existing = previewSnapshot(
      selectedQuery,
      draft.config,
      data,
      draft.cellId ?? '',
      undefined,
      prepared,
      context.generation,
      'reuse'
    );
    if (existing.state === 'ready' || existing.state === 'empty') {
      setSnapshot(existing);
      return;
    }
    release.current = controller.watch(
      {
        consumerId: `${owner}:binding-editor-preview`,
        query: selectedQuery,
        scope: draft.cellId ? (plan.cells[draft.cellId]?.scope ?? { cell: {} }) : { cell: {} },
        context,
        maxDataPoints: 160,
      },
      setSnapshot
    );
  };
  const runPatternPreview = () => {
    patternRelease.current?.();
    if (!service?.controller || !context) {
      return;
    }
    setPreviewAction('pattern');
    patternRelease.current = previewPattern(
      service.controller,
      plan,
      draft.config,
      affected,
      context,
      (value) => setPatternState({ key: patternKey, value }),
      undefined,
      [...prepared, ...(localPreview ? [localPreview] : [])]
    );
  };

  // ---- draft actions ----
  // The datasource query editors keep their own text: a remount shows the text of the restored draft.
  // A step through the history changes the draft under the local state: the query editors show the restored text, and
  // a validity message of the old draft must not block Apply. A key press with nothing to undo changes none of it.
  const available = useRef({ undo: false, redo: false });
  useLayoutEffect(() => {
    available.current = { undo: canUndo, redo: canRedo };
  });
  const step = useCallback((type: 'undo' | 'redo') => {
    dispatch({ type });
    if (available.current[type]) {
      setResetEpoch((value) => value + 1);
      setQueryError('');
      setGeometryError('');
    }
  }, []);
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);
  useEffect(() => {
    onControls?.({ undo, redo });
    return () => onControls?.(null);
  }, [onControls, undo, redo]);
  // "Discard" restores the saved bindings in the open popup. "Cancel" closes it; the owner asks when the
  // draft has changes.
  const resetToSaved = () => {
    dispatch({ type: 'reset' });
    setGeometryError('');
    setQueryError('');
    setPreviewEpoch((value) => value + 1);
    setResetEpoch((value) => value + 1);
  };
  const apply = (close: boolean) => {
    setPreviewEpoch((value) => value + 1);
    onApply(commitDraft(draft), draft.diagram);
    dispatch({ type: 'applied' });
    if (close) {
      // The draft is clean now. The popup must not ask before it closes.
      onDirtyChange?.(false);
      onRequestClose();
    }
  };
  // "Keep editing" folds the conflict alert. Apply stays blocked until the user overwrites or reloads.
  const [conflictFolded, setConflictFolded] = useState(false);
  if (!conflict && conflictFolded) {
    setConflictFolded(false);
  }
  const blocked = !!diagnostics.length || !!queryError || !!geometryError || hasMetricErrors || conflict;

  const chartLayer = context
    ? {
        plan,
        queries: draft.config.queries,
        controller: service?.controller,
        context,
        replaceVariables: bindContext.replaceVariables,
        onPrepared: onChartPrepared,
      }
    : undefined;

  return (
    <div className={styles.root} data-testid="dmap-bindings-editor">
      <div className={styles.actions} role="toolbar" aria-label="Binding draft actions">
        <IconButton
          name="arrow-left"
          size="lg"
          tooltip="Undo"
          aria-label="Undo"
          aria-keyshortcuts="Control+Z Meta+Z"
          disabled={!canUndo}
          onClick={undo}
        />
        <IconButton
          name="arrow-right"
          size="lg"
          tooltip="Redo"
          aria-label="Redo"
          aria-keyshortcuts="Control+Shift+Z Control+Y Meta+Shift+Z"
          disabled={!canRedo}
          onClick={redo}
        />
        {dirty && (
          <span className={styles.dirty} role="status">
            Unsaved changes
          </span>
        )}
        <div className={styles.toolbarEnd}>
          {draft.diagram && (
            <Button variant="secondary" size="sm" icon="edit" onClick={() => setGeometryOpen(true)}>
              Edit geometry in draw.io
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onRequestClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            fill="outline"
            size="sm"
            disabled={!dirty && !geometryError && !queryError}
            onClick={resetToSaved}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            size="sm"
            aria-label="Apply bindings"
            disabled={blocked}
            onClick={() => apply(false)}
          >
            Apply
          </Button>
          <Button variant="primary" size="sm" disabled={blocked} onClick={() => apply(true)}>
            Apply and close
          </Button>
        </div>
      </div>
      {conflict && conflictFolded && (
        <div className={styles.actions} role="status">
          <span className={styles.dirty}>The saved bindings changed. Apply is blocked.</span>
          <Button variant="secondary" size="sm" onClick={() => setConflictFolded(false)}>
            Resolve
          </Button>
        </div>
      )}
      {conflict && !conflictFolded && (
        <Alert title="The saved bindings changed while you edited" severity="warning">
          <div className={styles.conflict}>
            Another editor saved this panel after you opened it. Choose what to do with your draft.
            <div className={styles.actions}>
              <Button
                variant="destructive"
                size="sm"
                disabled={!!diagnostics.length || !!queryError || !!geometryError || hasMetricErrors}
                onClick={() => apply(false)}
              >
                Overwrite
              </Button>
              <Button variant="secondary" size="sm" onClick={onReload}>
                Reload saved
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConflictFolded(true)}>
                Keep editing
              </Button>
            </div>
          </div>
        </Alert>
      )}
      <div className={styles.layout}>
        <PopupLayout
          activeTab={tab}
          onTabChange={setTab}
          wideInspector={selection.kind === 'query'}
          list={
            <ListPane
              list={bindingsList}
              cells={metas}
              config={draft.config}
              filter={filter}
              onFilterChange={setFilter}
              legacyRules={legacyRules}
              selectedKey={selectedKey}
              onSelectPattern={(row: PatternRow) => openPattern(row)}
              onSelectCell={openCell}
              onSelectQuery={openQuery}
              onSelectProblem={openProblem}
              onDeleteOverride={(cellId) => dispatch({ type: 'remove-override', cellId })}
              onDeleteWidget={(id) => dispatch({ type: 'remove-widget', id })}
              onHighlight={showHighlight}
              onAddQuery={addQuery}
              onAddPanelQuery={addPanelQuery}
              onDefaultDatasource={(uid) =>
                dispatch({ type: 'default-datasource', datasource: uid ? { uid } : undefined })
              }
              onImport={(document, resolution) =>
                dispatch({ type: 'import-patterns', document, resolution, cellIds: Array.from(cells.keys()) })
              }
            />
          }
          stage={
            <DiagramStage
              stage={stage}
              stageRef={stageRef}
              patches={bound.patches}
              selection={{
                selected: selectedIds,
                primary: selectedIds.length ? selectedIds[selectedIds.length - 1] : undefined,
                extra: selection.kind === 'many' ? marks.extra : undefined,
                missed: selection.kind === 'many' ? marks.missed : undefined,
                affected: selection.kind === 'cell' ? affected : [],
                highlight,
              }}
              onSelect={(cellId, { shift }) => (shift ? toggleCell(cellId) : openCell(cellId))}
              onBox={addCells}
              chartLayer={chartLayer}
              owner={owner}
              hash={draft.diagram?.hash}
            />
          }
          inspector={
            <InspectorPane
              selection={selection}
              many={
                selection.kind === 'many'
                  ? {
                      cellIds: selectedIds,
                      cells: metas,
                      selectionVersion,
                      onMarks: showMarks,
                      onCreatePattern: createPatternFrom,
                      plan,
                      config: draft.config,
                      fields,
                      dispatch,
                    }
                  : undefined
              }
              card={{
                patch: cardPatch,
                resolve,
                cardContext,
                timeRange: data.timeRange,
                timeZone,
              }}
              cell={{
                draft,
                dispatch,
                cells,
                plan,
                inspected,
                affected,
                selectionVersion,
                fields,
                chartEligible: selected?.shape?.localName === 'rect',
                geometryError,
                diagnostics,
                metric: {
                  matches: matchPreviews,
                  diagnostics: metricDiagnostics,
                  incomplete: incompletePreview,
                  hover: hoverPreview,
                },
                patternPreview: {
                  enabled: !!service?.controller && !!context && !diagnostics.length && !queryError,
                  onRun: runPatternPreview,
                  progress:
                    patternState?.key === patternKey
                      ? {
                          done: patternResults.filter(({ snapshot: s }) => s.state !== 'idle' && s.state !== 'loading')
                            .length,
                          total: patternResults.length,
                        }
                      : undefined,
                },
              }}
              query={
                query && context
                  ? {
                      query,
                      epoch: resetEpoch,
                      context,
                      data,
                      timeZone,
                      uses: bindingsList.queries.find((row) => row.queryId === query.id)?.uses ?? 0,
                      usedBy: usersOfQuery(bindingsList, query.id, { openPattern, openCell }),
                      onDelete: () => dispatch({ type: 'remove-query', id: query.id }),
                      snapshot,
                      fields,
                      queryError,
                      onValidity: setQueryError,
                      onChange: (next) => dispatch({ type: 'query', query: next }),
                      onPreview: () => previewQuery(query),
                    }
                  : undefined
              }
            />
          }
        />
      </div>
      {geometryOpen && draft.diagram && (
        <DrawioModal
          xml={draft.diagram.xml}
          title="Diagram geometry"
          mode="edit"
          isDark={theme.isDark}
          onClose={() => setGeometryOpen(false)}
          onSave={(result) => {
            try {
              const index = buildCellIndex(mountSvg(document.createElement('div'), sanitizeSvg(result.svg).svg));
              const problems = cellIdentityDiagnostics(cellMetas(index));
              if (problems.length) {
                throw new Error(problems.map((d) => d.message).join('\n'));
              }
              dispatch({
                type: 'diagram',
                diagram: { ...result, hash: fnv1a(result.svg + result.xml), updatedAt: new Date().toISOString() },
              });
              setGeometryError('');
            } catch (e) {
              setGeometryError((e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}

/** The patterns, overrides and charts that use a query, as buttons that select the user. */
function usersOfQuery(
  list: BindingsList,
  queryId: string,
  open: { openPattern: (row: PatternRow) => void; openCell: (cellId: string) => void }
): QueryUser[] {
  return [
    ...list.patterns
      .filter((row) => row.queryIds.includes(queryId))
      .map((row) => ({ key: row.key, label: `Pattern ${row.name}`, open: () => open.openPattern(row) })),
    ...list.overrides
      .filter((row) => row.queryIds.includes(queryId))
      .map((row) => ({ key: row.key, label: `Override ${row.cellId}`, open: () => open.openCell(row.cellId) })),
    ...list.widgets
      .filter((row) => row.queryId === queryId)
      .map((row) => ({ key: row.key, label: `Chart ${row.label}`, open: () => open.openCell(row.anchorCellId) })),
  ];
}

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }),
  layout: css({ flex: '1 1 auto', minHeight: 0, display: 'flex' }),
  actions: css({
    flex: 'none',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0, 0, 1),
  }),
  // The end group sits at the right of the top row; on a narrow screen it wraps below the undo buttons and stays right.
  toolbarEnd: css({
    marginLeft: 'auto',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  dirty: css({ color: theme.colors.warning.text, fontSize: theme.typography.bodySmall.fontSize }),
  conflict: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
});
