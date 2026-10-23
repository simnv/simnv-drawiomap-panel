import React, { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { getDisplayProcessor, type PanelData } from '@grafana/data';
import { useTheme2, useStyles2, Alert, Button, Select, Tab, TabsBar } from '@grafana/ui';
import { resolvePatterns } from '../binding/patterns';
import { cellAt } from '../interact/hit';
import { validateConfig, type DiagramConfigV2 } from '../model/config';
import { buildCellIndex, cellMetas, mountSvg } from '../render/svgStage';
import type { BindContext, CellIndex, Diagram } from '../types';
import { BindingInspector } from './BindingInspector';
import { commitDraft, createDraft, draftPatternIndex, reduceDraft } from './draft';
import { QueryEditor } from './QueryEditor';
import { PanelQueryContext } from '../query/panel';
import type { QuerySnapshot } from '../query/types';
import { TextField } from './BindingFields';
import { cellIdentityDiagnostics, cellScope } from '../adapter/portograph';
import { cellMatches } from '../binding/select';
import { bindPlan, widgetDiagnostics } from '../binding/engine';
import { buildConfiguredCard } from '../interact/cardModel';
import { createPreviewResolver, previewSnapshot, statusDeadlines, usePreviewTime, type QueryPreview } from './preview';
import { previewPattern, type PatternPreview } from './patternPreview';
import { PatternTransfer } from './PatternTransfer';
import { DrawioModal } from './DrawioModal';
import { clearOwnedAttrs, setOwnedAttrs } from '../render/cellAttrs';
import { sanitizeSvg } from '../render/sanitize';
import { fnv1a } from '../util/hash';
import { EditorField, EditorSection, getEditorStyles } from './EditorLayout';
import { BindingsList } from './BindingsList';
import { buildBindingsList } from './bindingsModel';
const NO_RESULTS: QueryPreview[] = [];
export interface BindingEditorProps {
  config: DiagramConfigV2;
  cells: CellIndex;
  onSave: (config: DiagramConfigV2, diagram?: Diagram) => void;
  onPreview?: (config: DiagramConfigV2) => void;
  children?: React.ReactNode;
  data?: PanelData;
  inspectorWidth?: number;
  onQueryPreview?: (preview?: QueryPreview) => void;
  onPatternPreview?: (preview?: PatternPreview) => void;
  prepared?: QueryPreview[];
  bindContext?: BindContext;
  diagram?: Diagram;
  onDiagramPreview?: (diagram: Diagram) => void;
  /** Number of legacy rules of a panel that has no V2 config; the list points to the Rules editor. */
  legacyRules?: number;
}
export function BindingEditor({
  config,
  cells,
  onSave,
  onPreview,
  children,
  data,
  inspectorWidth = 320,
  onQueryPreview,
  onPatternPreview,
  prepared = NO_RESULTS,
  bindContext,
  diagram,
  onDiagramPreview,
  legacyRules,
}: BindingEditorProps) {
  const theme = useTheme2();
  const styles = useStyles2(getEditorStyles);
  const elementOptions = useMemo(() => Array.from(cells.keys(), (id) => ({ label: id, value: id })), [cells]);
  const [draft, dispatch] = useReducer(reduceDraft, config, createDraft);
  const [savedDiagram, setSavedDiagram] = useState(diagram);
  const [draftDiagram, setDraftDiagram] = useState(diagram);
  const [tab, setTab] = useState<'element' | 'all'>('element');
  const [highlight, setHighlight] = useState<string[]>([]);
  const [geometryOpen, setGeometryOpen] = useState(false);
  const [geometryError, setGeometryError] = useState('');
  const reset = () => {
    dispatch({ type: 'reset' });
    setDraftDiagram(savedDiagram);
    if (savedDiagram) {
      onDiagramPreview?.(savedDiagram);
    }
    setGeometryError('');
    setQueryError('');
    setPreviewEpoch((value) => value + 1);
  };
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const service = useContext(PanelQueryContext);
  const [queryId, setQueryId] = useState(config.queries[0]?.id);
  const [queryError, setQueryError] = useState('');
  const [previewState, setPreviewState] = useState<{ key: object; snapshot: QuerySnapshot }>();
  const [previewAction, setPreviewAction] = useState<'query' | 'pattern'>('query');
  const release = useRef<() => void>();
  const query = draft.config.queries.find((q) => q.id === queryId);
  const context = service?.context;
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
  const snapshot: QuerySnapshot = previewState?.key === previewKey ? previewState.snapshot : { state: 'idle' };
  const setSnapshot = (snapshot: QuerySnapshot) => {
    setPreviewState({ key: previewKey, snapshot });
    if (query && context) {
      onQueryPreview?.({
        query,
        cellId: draft.cellId,
        context: { ...context, defaultDatasource: draft.config.defaultDatasource },
        snapshot,
      });
    }
  };
  // Tag results by selection before effects run, and release obsolete demand on edit or unmount.
  useEffect(
    () => () => {
      const stop = release.current;
      release.current = undefined;
      stop?.();
      onQueryPreview?.(undefined);
    },
    [previewKey, onQueryPreview]
  );
  const metas = useMemo(() => cellMetas(cells), [cells]);
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
      onPatternPreview?.(undefined);
    };
  }, [patternKey, onPatternPreview]);
  const select = (cellId: string) => {
    dispatch({ type: 'select', cellId });
    setSelectionVersion((v) => v + 1);
  };
  // A list row opens the Element tab. A pattern is edited through one of its cells, in the pattern scope.
  const showHighlight = useCallback(
    (ids: string[]) =>
      setHighlight((old) => (old.length === ids.length && old.every((id, i) => id === ids[i]) ? old : ids)),
    []
  );
  const openCell = (cellId: string) => {
    select(cellId);
    setTab('element');
  };
  const openPattern = (row: { patternId: string; index: number; matched: string[] }) => {
    const cellId = row.matched[0] ?? cells.keys().next().value;
    if (cellId === undefined) {
      return;
    }
    dispatch({ type: 'select', cellId });
    dispatch({ type: 'scope', scope: 'pattern', patternId: row.patternId, patternIndex: row.index });
    setSelectionVersion((v) => v + 1);
    setTab('element');
    setHighlight([]);
  };
  useEffect(() => {
    onPreview?.(draft.config);
  }, [draft.config, onPreview]);
  const affectedKey = JSON.stringify(affected);
  // The editor layer of the cell attributes: a data refresh of the panel (the applier layer) does not touch it.
  useEffect(() => {
    for (const [id, cell] of cells) {
      setOwnedAttrs(cell.group, 'editor', {
        tabindex: '0',
        role: 'button',
        'aria-label': `${id} diagram element`,
        'data-dmap-selected': id === draft.cellId ? 'true' : 'false',
        'data-dmap-affected': affected.includes(id) ? 'true' : 'false',
        'data-dmap-highlight': highlight.includes(id) ? 'true' : 'false',
      });
    }
    return () => cells.forEach((cell) => clearOwnedAttrs(cell.group, 'editor'));
    // affectedKey represents the complete list without an unstable array dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, draft.cellId, affectedKey, highlight]);
  const diagnostics = [...draft.diagnostics, ...validateConfig(draft.config).diagnostics, ...plan.diagnostics];
  // The resolver and the bound result depend on their real inputs only, so a highlight or a tab change reuses them.
  const defaultDatasource = draft.config.defaultDatasource;
  const localPreview: QueryPreview | undefined = useMemo(
    () =>
      query && context && previewState?.key === previewKey
        ? {
            query,
            cellId: draft.cellId,
            context: { ...context, defaultDatasource },
            snapshot: previewState.snapshot,
          }
        : undefined,
    [query, context, previewState, previewKey, draft.cellId, defaultDatasource]
  );
  const timeZone = context?.timeZone;
  const generation = context?.generation;
  const format = useMemo(() => ({ theme, timeZone, generation }), [theme, timeZone, generation]);
  const reportResults = useMemo(() => {
    const explicit = localPreview ? [localPreview] : [];
    return previewAction === 'query' ? [...explicit, ...patternResults] : [...patternResults, ...explicit];
  }, [localPreview, previewAction, patternResults]);
  const savedResolve = useMemo(
    () => (data ? createPreviewResolver(plan, draft.config, data, undefined, format, prepared) : undefined),
    [data, plan, draft.config, format, prepared]
  );
  // The inspector reports the requested outcome, including pending and failed requests.
  // Resolve each candidate separately so display's terminal-result ranking cannot skip it.
  const resolve: typeof savedResolve = useMemo(() => {
    if (!savedResolve || !data) {
      return undefined;
    }
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
    context?.generation,
    previewState?.snapshot,
    patternResults.map((result) => result.snapshot),
    resolve ? statusDeadlines(plan, resolve) : []
  );
  const formatting: BindContext = useMemo(
    () =>
      bindContext ?? {
        theme,
        replaceVariables: (text) => text,
        linkWidth: { min: 2, max: 10 },
        display: (series, value) =>
          (series.field.display ?? getDisplayProcessor({ field: series.field, theme }))(value),
      },
    [bindContext, theme]
  );
  const bound = useMemo(
    () => (resolve ? bindPlan(plan, resolve, formatting, nowMs) : undefined),
    [plan, resolve, formatting, nowMs]
  );
  const cardPatch = draft.cellId ? bound?.patches.get(draft.cellId) : undefined;
  // Built from the preview inputs only: a highlight or a tab change must not rebuild the card.
  const hoverPreview = useMemo(
    () =>
      (localPreview || patternResults.length > 0) && cardPatch && resolve
        ? buildConfiguredCard(cardPatch, resolve, { ...formatting, series: [] })
        : undefined,
    [localPreview, patternResults, cardPatch, resolve, formatting]
  );
  const metricDiagnostics = [...(bound?.diagnostics ?? []), ...(hoverPreview?.diagnostics ?? [])];
  const matchPreviews = affected.map((cellId) => {
    const bindings = [
      ...(plan.cells[cellId]?.bindings ?? []),
      ...plan.widgets.filter((entry) => entry.anchorCellId === cellId).map((entry) => entry.widget.binding),
    ];
    const models = resolve ? bindings.map((binding) => ({ binding, model: resolve(cellId, binding) })) : [];
    const failures = models.flatMap(({ binding, model }) =>
      model.state === 'empty'
        ? [`No metric matches query ${binding.queryId}.`]
        : model.state === 'error' || model.state === 'unsupported'
          ? [`Query ${binding.queryId}: ${model.message}`]
          : []
    );
    const unvalidated =
      (!resolve && bindings.length > 0) ||
      models.some(({ model }) => model.state === 'idle' || model.state === 'loading');
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
  // Every diagnostic that the editor already knows, plus the hover card ones of all cells. Only the open tab pays for it.
  const listDiagnostics = useMemo(() => {
    if (tab !== 'all') {
      return [];
    }
    const cards =
      bound && resolve
        ? Array.from(bound.patches.values()).flatMap(
            (patch) => buildConfiguredCard(patch, resolve, { ...formatting, series: [] }).diagnostics
          )
        : [];
    return [
      ...draft.diagnostics,
      ...validateConfig(draft.config).diagnostics,
      ...(bound?.diagnostics ?? plan.diagnostics),
      ...(resolve ? widgetDiagnostics(plan, resolve) : []),
      ...cards,
    ];
  }, [tab, draft.config, draft.diagnostics, plan, bound, resolve, formatting]);
  const bindingsList = useMemo(
    () => (tab === 'all' ? buildBindingsList(draft.config, metas, listDiagnostics) : undefined),
    [tab, draft.config, metas, listDiagnostics]
  );
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
      (snapshot.state === 'ready' ? snapshot.frames : (data?.series ?? [])).flatMap((frame) =>
        frame.fields.map((field) => field.name)
      )
    )
  );
  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', display: 'flex' }}
      onClick={(e) => {
        const cell = cellAt(e.target, cells);
        if (cell) {
          select(cell.meta.id);
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') {
          return;
        }
        const cell = cellAt(e.target, cells);
        if (cell) {
          e.preventDefault();
          select(cell.meta.id);
        }
      }}
    >
      <style>
        {
          '[data-dmap-affected="true"] { outline: 2px dashed currentColor; } [data-dmap-selected="true"] { outline: 3px solid currentColor; } [data-dmap-highlight="true"] { outline: 3px dotted currentColor; }'
        }
      </style>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <aside aria-label="Diagram binding inspector" className={styles.inspector} style={{ width: inspectorWidth }}>
        <div className={styles.header}>
          <h3>Diagram bindings</h3>
          <EditorField label="Diagram element" noMargin>
            <Select
              aria-label="Diagram element"
              placeholder="Search elements"
              options={elementOptions}
              value={draft.cellId ?? null}
              onChange={(option) => option.value && select(option.value)}
              isSearchable
              menuShouldPortal
              maxMenuHeight={240}
              noOptionsMessage="No matching elements"
            />
          </EditorField>
          <TabsBar className={styles.tabs}>
            <Tab
              label="Element"
              active={tab === 'element'}
              onChangeTab={() => {
                setTab('element');
                setHighlight([]);
              }}
            />
            <Tab
              label="All bindings"
              counter={draft.config.patterns.length + draft.config.overrides.length + draft.config.widgets.length}
              active={tab === 'all'}
              onChangeTab={() => setTab('all')}
            />
          </TabsBar>
        </div>
        {bindingsList && (
          <div className={styles.body} role="region" aria-label="All bindings list">
            <BindingsList
              list={bindingsList}
              legacyRules={config.patterns.length || config.overrides.length || config.widgets.length ? 0 : legacyRules}
              onSelectCell={openCell}
              onSelectPattern={openPattern}
              onDeleteOverride={(cellId) => dispatch({ type: 'remove-override', cellId })}
              onDeleteWidget={(id) => dispatch({ type: 'remove-widget', id })}
              onHighlight={showHighlight}
            />
          </div>
        )}
        <div className={styles.body} role="region" aria-label="Binding editor fields" hidden={tab !== 'element'}>
          {draftDiagram && (
            <Button variant="secondary" size="sm" onClick={() => setGeometryOpen(true)}>
              Edit geometry in draw.io
            </Button>
          )}
          {geometryOpen && draftDiagram && (
            <DrawioModal
              xml={draftDiagram.xml}
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
                  const next = { ...result, hash: fnv1a(result.svg + result.xml), updatedAt: new Date().toISOString() };
                  setDraftDiagram(next);
                  onDiagramPreview?.(next);
                  setGeometryError('');
                } catch (e) {
                  setGeometryError((e as Error).message);
                }
              }}
            />
          )}
          {geometryError && (
            <Alert title="Geometry could not be saved" severity="error">
              {geometryError}
            </Alert>
          )}
          <BindingInspector
            draft={draft}
            binding={inspected}
            affected={affected}
            selectionVersion={selectionVersion}
            dispatch={dispatch}
            fields={fields}
            chartEligible={selected?.shape?.localName === 'rect'}
          />
          {draft.config.widgets
            .filter((w) => !cells.has(w.anchorCellId))
            .map((widget) => (
              <p key={widget.id}>
                Chart {widget.label} has missing anchor {widget.anchorCellId}.
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => dispatch({ type: 'remove-widget', id: widget.id })}
                >
                  Remove chart {widget.label}
                </Button>
              </p>
            ))}
          {draft.cellId && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                let n = 1;
                while (draft.config.patterns.some((p) => p.id === `pattern-${n}`)) {
                  n++;
                }
                const id = `pattern-${n}`;
                dispatch({
                  type: 'pattern',
                  pattern: { id, name: `Pattern ${n}`, select: { ids: [draft.cellId!] }, display: {} },
                });
                dispatch({ type: 'scope', scope: 'pattern', patternId: id });
              }}
            >
              Create shared pattern
            </Button>
          )}
          {draft.scope === 'pattern' && (
            <section aria-label="Full pattern preview">
              <Button
                variant="secondary"
                size="sm"
                disabled={!service?.controller || !context || !!diagnostics.length || !!queryError}
                onClick={() => {
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
                    (value) => {
                      setPatternState({ key: patternKey, value });
                      onPatternPreview?.(value);
                    },
                    undefined,
                    [...prepared, ...(localPreview ? [localPreview] : [])]
                  );
                }}
              >
                Preview all pattern matches
              </Button>
              {patternState?.key === patternKey && (
                <output aria-label="Pattern preview progress" aria-live="polite">
                  {
                    patternResults.filter(({ snapshot }) => snapshot.state !== 'idle' && snapshot.state !== 'loading')
                      .length
                  }{' '}
                  / {patternResults.length} query scopes checked
                </output>
              )}
            </section>
          )}
          {draft.scope === 'pattern' && (
            <EditorSection title="Pattern match details">
              <ul aria-label="Affected binding preview">
                {affected.map((id) => (
                  <li key={id}>
                    {id}: {JSON.stringify(plan.cells[id]?.display)}
                  </li>
                ))}
              </ul>
            </EditorSection>
          )}
          {diagnostics.length > 0 && (
            <Alert title="Binding diagnostics" severity="error">
              <ul>
                {diagnostics.map((d, i) => (
                  <li key={i}>
                    {d.path}: {d.message}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {data && (
            <EditorSection title="Metric preview" defaultOpen>
              <section aria-label="Metric resolution preview">
                <ul aria-label="Affected metric resolution">
                  {matchPreviews.map((match) => (
                    <li key={match.cellId}>
                      {match.cellId}: {match.state}
                      {match.failures.length > 0 && `: ${match.failures.join(' ')}`}
                      {match.unvalidated && ' (unvalidated bindings require explicit Preview for this element)'}
                    </li>
                  ))}
                </ul>
                {metricDiagnostics.length ? (
                  <ul>
                    {metricDiagnostics.map((d, i) => (
                      <li key={i}>
                        {d.path}: {d.message}
                      </li>
                    ))}
                  </ul>
                ) : !incompletePreview && affected.length > 0 ? (
                  <p>No resolution failures in available preview data.</p>
                ) : (
                  <p>Select an element and use Preview query to validate its native query bindings.</p>
                )}
                {hoverPreview && (
                  <ul aria-label="Hover row preview">
                    {hoverPreview.rows.map((row) => (
                      <li key={row.key}>
                        {row.title}: {row.text}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </EditorSection>
          )}
          <EditorSection title="Named queries">
            <section aria-label="Query library">
              <TextField
                label="Default datasource UID"
                value={draft.config.defaultDatasource?.uid ?? ''}
                onChange={(uid) => dispatch({ type: 'default-datasource', datasource: uid ? { uid } : undefined })}
              />
              <EditorField label="Named query">
                <Select
                  aria-label="Named query"
                  value={queryId ?? ''}
                  onChange={(selection) => {
                    setQueryId(selection.value ?? '');
                    setQueryError('');
                  }}
                  options={[
                    { value: '', label: 'Select query' },
                    ...draft.config.queries.map((q) => ({ value: q.id, label: q.name })),
                  ]}
                  menuShouldPortal
                  maxMenuHeight={240}
                />
              </EditorField>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  let n = 1;
                  while (draft.config.queries.some((q) => q.id === `query-${n}`)) {
                    n++;
                  }
                  const id = `query-${n}`;
                  setQueryId(id);
                  setQueryError('');
                  dispatch({
                    type: 'query',
                    query: {
                      id,
                      name: `Query ${n}`,
                      source: { kind: 'datasource', target: { refId: `DM${n}` }, parameters: {} },
                    },
                  });
                }}
              >
                Add named query
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const target = data?.request?.targets[0];
                  let n = 1;
                  while (draft.config.queries.some((q) => q.id === `panel-${n}`)) {
                    n++;
                  }
                  const id = `panel-${n}`;
                  setQueryId(id);
                  setQueryError('');
                  dispatch({
                    type: 'query',
                    query: {
                      id,
                      name: `Panel query ${target?.refId ?? 'A'}`,
                      source: { kind: 'panel', refId: target?.refId ?? 'A' },
                    },
                  });
                }}
              >
                Add eager panel reference
              </Button>
              {query && context && data && (
                <QueryEditor
                  key={`${query.id}:${query.source.kind}`}
                  query={query}
                  context={{ ...context, defaultDatasource: draft.config.defaultDatasource }}
                  data={data}
                  onValidity={setQueryError}
                  onChange={(query) => dispatch({ type: 'query', query })}
                  onPreview={() => {
                    release.current?.();
                    setPreviewAction('query');
                    const controller = service?.controller;
                    if (!controller) {
                      setSnapshot({ state: 'error', message: 'Query service is not ready.' });
                      return;
                    }
                    if (diagnostics.length || queryError) {
                      setSnapshot({ state: 'error', message: 'Fix binding diagnostics before preview.' });
                      return;
                    }
                    const existing = previewSnapshot(
                      query,
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
                        consumerId: 'binding-editor-preview',
                        query,
                        scope: draft.cellId ? (plan.cells[draft.cellId]?.scope ?? { cell: {} }) : { cell: {} },
                        context: { ...context, defaultDatasource: draft.config.defaultDatasource },
                        maxDataPoints: 160,
                      },
                      setSnapshot
                    );
                  }}
                />
              )}
              <output aria-label="Query preview result">
                {snapshot.state}
                {snapshot.state === 'error' || snapshot.state === 'unsupported'
                  ? `: ${snapshot.message}`
                  : snapshot.state === 'ready'
                    ? `: ${snapshot.frames.length} frames; fields ${fields.join(', ')}`
                    : ''}
              </output>
            </section>
          </EditorSection>
          {queryError && (
            <Alert title="Query needs attention" severity="error">
              {queryError}
            </Alert>
          )}
          <PatternTransfer
            config={draft.config}
            cellIds={Array.from(cells.keys())}
            onImport={(document, resolution) =>
              dispatch({ type: 'import-patterns', document, resolution, cellIds: Array.from(cells.keys()) })
            }
          />
        </div>
        <footer className={styles.footer} aria-label="Binding draft actions">
          <Button
            variant="primary"
            size="sm"
            aria-label="Apply bindings"
            disabled={!!diagnostics.length || !!queryError || !!geometryError || hasMetricErrors}
            onClick={() => {
              setPreviewEpoch((value) => value + 1);
              onSave(commitDraft(draft), draftDiagram);
              setSavedDiagram(draftDiagram);
              dispatch({ type: 'applied' });
            }}
          >
            Apply
          </Button>
          <Button variant="secondary" size="sm" aria-label="Cancel changes" onClick={reset}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fill="text"
            icon="history"
            aria-label="Undo to saved"
            tooltip="Undo to saved"
            onClick={reset}
          />
        </footer>
      </aside>
    </div>
  );
}
