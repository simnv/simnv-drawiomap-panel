import React, { useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { getDisplayProcessor, type PanelData } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { resolvePatterns } from '../binding/patterns';
import { cellAt } from '../interact/hit';
import { validateConfig, type DiagramConfigV2 } from '../model/config';
import { buildCellIndex, cellMetas, mountSvg } from '../render/svgStage';
import type { BindContext, CellIndex, Diagram } from '../types';
import { BindingInspector } from './BindingInspector';
import { commitDraft, createDraft, reduceDraft } from './draft';
import { QueryEditor } from './QueryEditor';
import { PanelQueryContext } from '../query/panel';
import type { QuerySnapshot } from '../query/types';
import { TextField } from './BindingFields';
import { cellIdentityDiagnostics, cellScope } from '../adapter/portograph';
import { cellMatches } from '../binding/select';
import { bindPlan } from '../binding/engine';
import { buildConfiguredCard } from '../interact/cardModel';
import { createPreviewResolver, statusDeadlines, usePreviewTime, type QueryPreview } from './preview';
import { previewPattern, type PatternPreview } from './patternPreview';
import { PatternTransfer } from './PatternTransfer';
import { DrawioModal } from './DrawioModal';
import { sanitizeSvg } from '../render/sanitize';
import { fnv1a } from '../util/hash';
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
  prepared = [],
  bindContext,
  diagram,
  onDiagramPreview,
}: BindingEditorProps) {
  const theme = useTheme2();
  const [draft, dispatch] = useReducer(reduceDraft, config, createDraft);
  const [savedDiagram, setSavedDiagram] = useState(diagram);
  const [draftDiagram, setDraftDiagram] = useState(diagram);
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
      cells,
      previewEpoch,
    }),
    [query, context, draft.cellId, draft.config, draft.scope, draft.patternId, cells, previewEpoch]
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
  const plan = useMemo(() => resolvePatterns(cellMetas(cells), draft.config), [cells, draft.config]);
  const affected =
    draft.scope === 'pattern'
      ? Object.values(plan.cells)
          .filter((c) => c.patternIds.includes(draft.patternId ?? ''))
          .map((c) => c.cellId)
      : draft.cellId
        ? [draft.cellId]
        : [];
  const [patternState, setPatternState] = useState<{ key: object; value: PatternPreview }>();
  const patternRelease = useRef<() => void>();
  const patternKey = useMemo(
    () => ({ config: draft.config, scope: draft.scope, patternId: draft.patternId, cells, context, previewEpoch }),
    [draft.config, draft.scope, draft.patternId, cells, context, previewEpoch]
  );
  if (patternState && patternState.key !== patternKey) {
    setPatternState(undefined);
  }
  const patternResults = patternState?.key === patternKey ? patternState.value.previews : [];
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
  useEffect(() => {
    onPreview?.(draft.config);
  }, [draft.config, onPreview]);
  const affectedKey = JSON.stringify(affected);
  useEffect(() => {
    const restore: Array<() => void> = [];
    for (const [id, cell] of cells) {
      const attrs = {
        tabindex: '0',
        role: 'button',
        'aria-label': `${id} diagram element`,
        'data-dmap-selected': id === draft.cellId ? 'true' : 'false',
        'data-dmap-affected': affected.includes(id) ? 'true' : 'false',
      };
      for (const [key, value] of Object.entries(attrs)) {
        const previous = cell.group.getAttribute(key);
        cell.group.setAttribute(key, value);
        restore.push(() =>
          previous === null ? cell.group.removeAttribute(key) : cell.group.setAttribute(key, previous)
        );
      }
    }
    return () => restore.forEach((f) => f());
    // affectedKey represents the complete list without an unstable array dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, draft.cellId, affectedKey]);
  const diagnostics = [...draft.diagnostics, ...validateConfig(draft.config).diagnostics, ...plan.diagnostics];
  const localPreview: QueryPreview | undefined =
    query && context && previewState?.key === previewKey
      ? {
          query,
          cellId: draft.cellId,
          context: { ...context, defaultDatasource: draft.config.defaultDatasource },
          snapshot,
        }
      : undefined;
  const resolve = data
    ? createPreviewResolver(
        plan,
        draft.config,
        data,
        localPreview,
        {
          theme,
          timeZone: context?.timeZone,
          generation: context?.generation,
        },
        [...patternResults, ...prepared]
      )
    : undefined;
  const nowMs = usePreviewTime(
    data,
    context?.generation,
    previewState?.snapshot,
    patternResults.map((result) => result.snapshot),
    resolve ? statusDeadlines(plan, resolve) : []
  );
  const formatting: BindContext = bindContext ?? {
    theme,
    replaceVariables: (text) => text,
    linkWidth: { min: 2, max: 10 },
    display: (series, value) => (series.field.display ?? getDisplayProcessor({ field: series.field, theme }))(value),
  };
  const bound = resolve ? bindPlan(plan, resolve, formatting, nowMs) : undefined;
  const cardPatch = draft.cellId ? bound?.patches.get(draft.cellId) : undefined;
  const hoverPreview =
    (localPreview || patternResults.length > 0) && cardPatch && resolve
      ? buildConfiguredCard(cardPatch, resolve, { ...formatting, series: [] })
      : undefined;
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
          '[data-dmap-affected="true"] { outline: 2px dashed currentColor; } [data-dmap-selected="true"] { outline: 3px solid currentColor; }'
        }
      </style>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <aside
        aria-label="Diagram binding inspector"
        style={{ width: inspectorWidth, flexShrink: 0, boxSizing: 'border-box', overflow: 'auto', padding: 12 }}
      >
        {draftDiagram && <button onClick={() => setGeometryOpen(true)}>Edit geometry in draw.io</button>}
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
        {geometryError && <p role="alert">{geometryError}</p>}
        <div aria-label="Element selection" style={{ maxHeight: 96, overflow: 'auto' }}>
          {Array.from(cells.keys()).map((id) => (
            <button key={id} onClick={() => select(id)}>
              Select {id}
            </button>
          ))}
        </div>
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
              <button onClick={() => dispatch({ type: 'remove-widget', id: widget.id })}>
                Remove chart {widget.label}
              </button>
            </p>
          ))}
        {draft.cellId && (
          <button
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
          </button>
        )}
        {draft.scope === 'pattern' && (
          <section aria-label="Full pattern preview">
            <button
              disabled={!service?.controller || !context || !!diagnostics.length || !!queryError}
              onClick={() => {
                patternRelease.current?.();
                if (!service?.controller || !context) {
                  return;
                }
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
            </button>
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
          <ul aria-label="Affected binding preview">
            {affected.map((id) => (
              <li key={id}>
                {id}: {JSON.stringify(plan.cells[id]?.display)}
              </li>
            ))}
          </ul>
        )}
        {diagnostics.length > 0 && (
          <ul role="alert">
            {diagnostics.map((d, i) => (
              <li key={i}>
                {d.path}: {d.message}
              </li>
            ))}
          </ul>
        )}
        {data && (
          <section aria-label="Metric resolution preview">
            <h4>Metric resolution preview</h4>
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
        )}
        <section aria-label="Query library">
          <h3>Named queries</h3>
          <TextField
            label="Default datasource UID"
            value={draft.config.defaultDatasource?.uid ?? ''}
            onChange={(uid) => dispatch({ type: 'default-datasource', datasource: uid ? { uid } : undefined })}
          />
          <label>
            Named query
            <select
              aria-label="Named query"
              value={queryId ?? ''}
              onChange={(e) => {
                setQueryId(e.target.value);
                setQueryError('');
              }}
            >
              <option value="">Select query</option>
              {draft.config.queries.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </label>
          <button
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
          </button>
          <button
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
          </button>
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
                const controller = service?.controller;
                if (!controller) {
                  setSnapshot({ state: 'error', message: 'Query service is not ready.' });
                  return;
                }
                if (diagnostics.length || queryError) {
                  setSnapshot({ state: 'error', message: 'Fix binding diagnostics before preview.' });
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
        {queryError && <p role="alert">{queryError}</p>}
        <PatternTransfer
          config={draft.config}
          cellIds={Array.from(cells.keys())}
          onImport={(document, resolution) =>
            dispatch({ type: 'import-patterns', document, resolution, cellIds: Array.from(cells.keys()) })
          }
        />
        <button
          disabled={!!diagnostics.length || !!queryError || !!geometryError || hasMetricErrors}
          onClick={() => {
            setPreviewEpoch((value) => value + 1);
            onSave(commitDraft(draft), draftDiagram);
            setSavedDiagram(draftDiagram);
            dispatch({ type: 'applied' });
          }}
        >
          Apply bindings
        </button>
        <button onClick={reset}>Cancel changes</button>
        <button onClick={reset}>Undo to saved</button>
      </aside>
    </div>
  );
}
