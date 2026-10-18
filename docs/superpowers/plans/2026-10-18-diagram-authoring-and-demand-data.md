# Diagram Authoring and Demand Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Preserve the user's chosen execution method: supervised Sol/Luna workers through Orca orchestration. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support quiet topology monitoring, explicitly placed Grafana visuals, and click-to-bind authoring with genuinely deferred hover queries.

**Architecture:** Retain the SVG stage and pure binding pipeline. Add one panel-local query controller shared by visible widgets, hover cards, and authoring previews; preserve Grafana's normal query pipeline for existing eager panel data. Compile named queries and panel-local patterns into presentation models, then render those through SVG patches and small Grafana React components.

**Tech Stack:** TypeScript, React, Grafana packages pinned to 12.4.13 at the inspected baseline, draw.io exported SVG, Vitest/jsdom, Playwright with `@grafana/plugin-e2e`.

**Spec:** [Approved product spec](../specs/2026-10-18-diagram-authoring-and-demand-data.md). Read it before execution. This plan proposes engineering interfaces and defaults; source inspection is complete, runtime integration remains unverified.

## Global Constraints

- Keep plugin ID `simnv-drawiomap-panel` and plugin type unchanged.
- Keep Grafana dependency floor `>=12.4.0`; verify supported 12.x and 13.x environments.
- Use the supplied webpack configuration; do not modify `.config/` or bundle React.
- Use `@grafana/plugin-e2e` for browser tests and read `.config/AGENTS/e2e-testing.md`.
- Keep credentials out of options, logs, fixtures, reports, and screenshots.
- Preserve SVG sanitization, editor message validation, and existing sandbox protections.
- View mode loads no draw.io editor runtime.
- Use Orca orchestration with Sol/Luna workers for implementation grunt work.
- Omit all `Co-Authored-By` trailers from commits.

The two product streams share the same query/binding model, so use one ordered plan.
Each task has its own testable result. Do not replace the renderer or rewrite the
entire plugin before completing the first end-to-end slice.

## Review Focus

1. A hover closes or changes while a non-cancellable Promise is pending: never publish its result into the new card. Task 3.
2. Repeated labels, overlapping patterns, or ambiguous metric matches: expose ambiguity and scope rather than binding the first accidental match. Tasks 2 and 4.
3. Time range, variables, datasource, or pixel resolution changes while cached data exists: isolate results and stop obsolete refresh work. Task 3.
4. Imported nested transforms, clipping, and duplicate/removed chart anchors: preserve positions and report invalid anchors. Tasks 1 and 5.
5. Empty/single-sample/stale/error data during a widespread outage: keep visible meanings distinct without hiding separate causes. Tasks 4, 5, and 8.

## Existing implementation and proposed files

Baseline: `881f4dfa9ddf6412cf4eccfd9a3440594876e38d`. Recheck HEAD and local edits before executing.

| Existing module                                                     | Action                                                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/components/DrawioMapPanel.tsx`, `src/components/useStage.ts`   | Keep orchestration and SVG stage; connect query demand, visual regions, and authoring state           |
| `src/binding/engine.ts`, `series.ts`, `src/rules/schema.ts`         | Preserve pure computations; add explicit query references and compiled pattern inputs                 |
| `src/render/svgStage.ts`, `geometry.ts`, `applier.ts`, `overlay.ts` | Keep current SVG discovery/rendering; add chart anchors and compact status reasons                    |
| `src/adapter/portograph.ts`, `src/types.ts`                         | Preserve semantic identity; introduce versioned configuration and common types                        |
| `src/interact/cardModel.ts`, `Card.tsx`                             | Consume resolved data; replace hand-drawn sparkline with shared Grafana visual                        |
| `src/options/RulesEditor.tsx`, `src/module.ts`                      | Add authoring entry and named query configuration; retire conflicting rule controls after replacement |
| `src/editor/DrawioModal.tsx`                                        | Preserve editor protocol; verify chart metadata survives export                                       |

New modules:

- `src/model/config.ts`: versioned definitions, strict schema, validation diagnostics.
- `src/query/types.ts`, `controller.ts`, `grafana.ts`, `frames.ts`: small public query interface; execution, cache/queue, and frame conversion behind it.
- `src/binding/patterns.ts`, `status.ts`: pure effective binding and status evaluation.
- `src/visuals/SparklineView.tsx`, `BarGaugeView.tsx`, `ChartLayer.tsx`: bounded, query-free React presentation.
- `src/editor/BindingEditor.tsx`, `BindingInspector.tsx`, `QueryEditor.tsx`, `draft.ts`: draft authoring and native datasource editor adapter.
- `src/fixtures/authoring.{drawio,svg}`: sanitized repeated-device/link/chart example.

Colocate unit tests as `*.test.ts` or `*.test.tsx`. Extend existing tests rather than
copying equivalent coverage. Keep controller helpers private unless another real caller needs them.

## Proposed interfaces and defaults

These names are the shared contract for the tasks below. Define them once; do not
create competing versions in editor, hover, and rendering code.

### Saved configuration (`src/model/config.ts`)

- `DiagramConfigV2`: `{ version: 2; queries: NamedQuery[]; patterns: Pattern[]; overrides: ElementOverride[]; widgets: Widget[]; defaultDatasource?: DataSourceRef }`.
- `NamedQuery`: stable `id`, editable `name`, and `source` union:
  - `{ kind: 'panel'; refId: string }` references already-delivered Grafana panel frames.
  - `{ kind: 'datasource'; datasource?: DataSourceRef; target: DataQuery; parameters: Record<string, string> }` stores a native query. Parameter values are semantic scope paths such as `cell.device`; parameter names use the reserved `dm_` prefix.
- `QueryBinding`: `{ queryId: string; match: Record<string, string>; field?: string; reducer: ReducerName }`. Reuse `ReducerName` from `src/types.ts`. Require an unambiguous selected field/series where a visual expects one value; regex/multi-match selection must be explicit.
- `Pattern`: `{ id: string; name: string; select: CellSelector; display: DisplayConfig }`. Reuse existing selector semantics and binding types; later patterns override explicitly supplied properties.
- `ElementOverride`: `{ cellId: string; display: Partial<DisplayConfig> }`. Overrides apply last. Missing means inherit; explicit disable is represented by an `enabled: false` property, not `undefined`.
- `DisplayConfig`: existing link/shape options plus `status?: StatusRule`, `hover?: HoverSpec`, and query bindings. Use typed nested merges; arrays replace as a whole.
- `Widget`: `{ id: string; anchorCellId: string; kind: 'sparkline' | 'bar'; binding: QueryBinding; label: string; unit?: string; min?: number; max?: number; url?: string }`.
- `HoverSpec`: `{ rows: HoverRow[] }`; each row is a discriminated union for value, metadata, history, or drilldown. Only configured rows request extra data.
- `StatusRule`: explicit value mapping or ordered predicates over query bindings, plus required sample freshness configuration when stale detection is enabled. Use existing condition vocabulary where possible; do not introduce an expression language.
- `validateConfig(input: unknown): { config?: DiagramConfigV2; diagnostics: Diagnostic[] }`; `Diagnostic` has stable `code`, `path`, and readable `message`.

Store V2 under `options.config`; keep `options.diagram` for XML/SVG/hash. Recognize legacy
configuration and offer explicit recreation/import. Do not silently erase it or guess
an automatic conversion of queries/hover history. The implementation may preserve
legacy rendering temporarily, but V2 authoring must have one source of truth.

### Query module (`src/query/types.ts`)

- `QueryContext`: dashboard `timeRange`, `timeZone`, `scopedVars`, `refreshMs`, query
  `intervalMs`, and `generation`. Increment generation when the effective range or
  dashboard variables change; use the same resolved context for a whole refresh cycle.
- `QueryDemand`: `{ consumerId: string; query: NamedQuery; scope: TemplateScope; context: QueryContext; maxDataPoints: number }`.
- `QuerySnapshot`: discriminated `idle | loading | ready | empty | error | unsupported`;
  ready carries `frames: DataFrame[]`, `fetchedAt`, and `fromCache`. Failures carry a
  sanitized message, never raw request headers or credentials.
- `QueryController`: `setPanelData(data: PanelData): void`,
  `watch(demand: QueryDemand, listener: (value: QuerySnapshot) => void): () => void`,
  `dispose(): void`. The returned function releases this consumer's demand.
- `QueryExecutor`: `(request: ResolvedQueryRequest, emit: (snapshot: QuerySnapshot) => void) => () => void`.
  `ResolvedQueryRequest` contains resolved datasource reference, native targets,
  `DataQueryRequest` context, and the cache key. The executor hides Promise versus Observable behavior.
- `createQueryController(execute: QueryExecutor, policy: QueryPolicy, now: () => number): QueryController`.
- `QueryPolicy`: proposed initial constants `freshMs=15000`, `maxEntries=64`,
  `maxCachedValues=100000`, `maxCachedBytes=8388608`, `maxConcurrent=4`,
  `maxQueued=64`, `maxActiveResultValues=100000`, `maxActiveResultBytes=8388608`.
  These are engineering defaults for validation, not claimed performance measurements.

Key cache entries by resolved datasource identity, native target, resolved element
parameters, effective range/context, and resolution. Never stringify functions or
mutable datasource instances. A panel-source reference reuses supplied data and does
not start another datasource request. It cannot honestly promise lazy fetching if
the dashboard already runs that query: flag hover-only eager references in authoring
and require conversion/removal from eager targets to meet the lazy-loading requirement.

Use a stable resolved relative-time window within each refresh generation; do not
generate a different `now` for every consumer. Expiration and dashboard refresh are
separate causes of renewal. No timer refetches after the last consumer releases a key.
Cache budgets count retained frame data. Enforce the active-result limits on received
results and reject oversized results with an explanation; request resolution limits
reduce payload size but cannot guarantee datasource response size. Queue overflow
also gets an explicit local error. Never silently truncate a series to fit a budget.

The default datasource is the plugin's explicit `defaultDatasource`. Public PanelProps
does not expose Grafana's configured panel datasource; `get(null)` is not a reliable
substitute. A query without an explicit/default datasource is invalid, not an invitation
to execute against an unrelated global default.

### Binding and presentation

- `resolvePatterns(cells: CellMeta[], config: DiagramConfigV2): BindingPlan` in `patterns.ts`.
  `BindingPlan` contains effective per-cell displays, matching pattern IDs, query
  bindings, widget anchors, and diagnostics. It contains no live DOM or datasource objects.
- `evaluateStatus(rule: StatusRule, values: ResolvedValue[], nowMs: number): StatusView`
  in `status.ts`; `ResolvedValue` retains value, sample timestamp, and availability.
  `StatusView` carries `normal | warning | critical | down | missing | stale`, a reason,
  and affected query IDs. `summarizeStatuses(items: CellStatus[]): StatusSummary[]`
  groups only equal configured condition/reason combinations, not merely equal severity.
- `toHistory(snapshot: QuerySnapshot, binding: QueryBinding): HistoryModel` in `frames.ts`.
  `HistoryModel` carries explicit state, numeric/time fields, latest display value,
  and source freshness. Preserve null gaps and timestamp meaning; do not smooth samples.
- `readChartAnchor(cell: CellEntry, parent: SVGGraphicsElement): ChartAnchor | undefined`
  in `render/geometry.ts`; `ChartAnchor` carries the rectangle primitive's local bounds
  and affine matrix relative to the portal parent. Preserve rotation/skew; group bounds
  that include labels are not a chart rectangle. Diagnose null or singular CTMs.
- `SparklineView({ model, width, height, timeRange, label, onDrilldown? })` and
  `BarGaugeView({ value, field, width, height })` consume prepared models only.

### Authoring

- `createDraft(config: DiagramConfigV2): BindingDraft`,
  `reduceDraft(draft: BindingDraft, action: DraftAction): BindingDraft`,
  `commitDraft(draft: BindingDraft): DiagramConfigV2` in `editor/draft.ts`.
- `DraftAction` is select element, select edit scope, change query, change display,
  change pattern selector, add/remove widget, import patterns, or reset draft.
- `BindingEditor` owns the draft, selection, diagram preview, and inspector. Persist
  only through public panel/options callbacks. Use a plugin-owned inspector if
  Grafana's standard options area cannot expose reliable selection/focus integration.
- `QueryEditor` receives `NamedQuery`, current `QueryContext`, `onChange`, and explicit
  preview callback. Editing a query never runs it just because the editor mounts.

## Execution and ownership

Use one Orca worker per task and one owner for services, ports, builds, and browser
tests. Sol handles query and editor integration; Luna can handle bounded fixtures,
formatting, and evidence checks. Independent work may overlap only after shared
interfaces land. No two workers edit `types.ts` or `DrawioMapPanel.tsx` concurrently.
After each task, review its diff and evidence, then commit only its owned files with
the suggested message. Do not push, publish, or deploy as part of this plan.

### Task 1: Prove the Grafana integration routes

**Files:** Create `tests/authoring-compat.spec.ts`, `src/fixtures/authoring.{drawio,svg}`;
modify `src/components/DrawioMapPanel.tsx` and `src/options/RulesEditor.tsx` only as needed
for a small removable development probe. Record results in `docs/research/authoring-compatibility.md`.

**Interfaces:** Consumes public `PanelProps`, custom options editor props, datasource
`components.QueryEditor`, and SVG CTM methods. Produces a verified integration choice
for Task 6 and a datasource compatibility matrix for Task 3; no production interface yet.

- [ ] Add a browser test proving diagram click can focus a plugin-owned inspector heading in panel edit mode, and edits reach public save callbacks without global selection state. Test two cloned panels and editor remount. StandardEditorContext has no panel ID or host-category expansion method: use the panel-scoped bus only after proving isolation, otherwise mount preview and inspector together with direct React callbacks. Verify the fallback receives current dashboard range/variables through a public route before adopting it.
- [ ] Render the installed public datasource query editor for Prometheus and a second different built-in query type. Wrap it with `DataSourcePluginContextProvider` and instance settings; supply datasource, native query, callbacks, range, filtered PanelData, queries, and `CoreApp.Dashboard`. Preserve its target through change/save/reopen and execute only after explicit preview.
- [ ] Verify a Sparkline region tracks a nested transformed anchor through fit, resize, pan, and zoom on Grafana 12 and 13. Prefer a React portal in a plugin-generated SVG `foreignObject` at the anchor's paint order, using local rectangle bounds and parent-relative CTM. Confirm clipping, theme/CSS isolation and sandbox behavior; if this fails, validate an affine HTML overlay before changing the implementation choice.
- [ ] Run `npm run e2e:12 -- tests/authoring-compat.spec.ts` and `npm run e2e:13 -- tests/authoring-compat.spec.ts` against an explicitly owned running stack. Expected: all three integration routes pass; record package/runtime versions and unsupported cases.
- [ ] Remove temporary probe controls before committing. If a public integration fails, document its concrete alternative and revise dependent tasks before implementation; do not substitute internal `PanelRenderer`, `Graph`, or Grafana DOM selectors.
- [ ] Commit with `test: verify diagram authoring integration routes`.

### Task 2: Introduce versioned configuration and deterministic patterns

**Files:** Create `src/model/config.ts`, `src/model/config.test.ts`,
`src/binding/patterns.ts`, `src/binding/patterns.test.ts`; modify `src/types.ts`,
`src/rules/schema.ts`, `src/adapter/portograph.ts`, and their existing tests.

**Interfaces:** Produces all saved configuration types, `validateConfig`, and
`resolvePatterns`. Existing `CellMeta`, `CellSelector`, `TemplateScope` remain shared.

- [ ] Write schema/precedence tests with these assertions:

```ts
expect(validateConfig(duplicateQueryIds).diagnostics).toContainEqual(
  expect.objectContaining({ code: 'duplicate-query-id' })
);
expect(resolvePatterns(cells, config).cells['device-1'].display).toMatchObject(expectedOverride);
expect(resolvePatterns(cells, config).diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-anchor' }));
```

- [ ] Run `npm test -- src/model/config.test.ts src/binding/patterns.test.ts`; confirm new-contract assertions fail before adding production behavior.
- [ ] Implement strict validation for query IDs, references, native target persistence, selectors, overrides, hover row kinds, and widget anchors. Reject duplicate semantic IDs and missing parameter paths with actionable diagnostics.
- [ ] Add round-trip tests for XML/SVG identity, same-label distinct devices, later-pattern precedence, explicit disable, and legacy detection without silently overwriting old options.
- [ ] Rerun targeted tests and `npm run typecheck`; expected all pass. Commit `feat: define diagram queries and reusable binding patterns`.

### Task 3: Implement demand-loaded queries and bounded cache

Task 1 handoff: see `docs/research/authoring-compatibility.md`. Prometheus and TestData native editors passed on Grafana 12.4.13. Preserve complete native objects and normalize Promise/Observable query returns. Metadata reads do not count as explicit detail execution. Grafana 13 and sandbox acceptance remain Task 8 gates after runtime recovery.

**Files:** Create `src/query/{types,controller,grafana,frames}.ts`,
`src/query/{controller,grafana,frames}.test.ts`; modify panel integration only to
provide one controller and current context, retaining existing eager `PanelData`.

**Interfaces:** Produces `QueryController`, `QueryExecutor`, `createQueryController`,
`QuerySnapshot`, and `toHistory` as specified above. Pure tests inject a fake executor/clock.

- [ ] Write controller tests using deferred Promise and Observable executors:

```ts
expect(execute).not.toHaveBeenCalled(); // constructing controller does not fetch
const releaseA = controller.watch(demand, receiveA);
const releaseB = controller.watch({ ...demand, consumerId: 'hover-b' }, receiveB);
expect(execute).toHaveBeenCalledTimes(1);
releaseA();
releaseB();
resolveOldResult();
expect(receiveForNewSelection).not.toHaveBeenCalledWith(oldReadySnapshot);
```

- [ ] Run `npm test -- src/query/controller.test.ts`; verify failures cover absent scheduling behavior, then implement request coalescing, subscriptions, cancellation attempts, generation guards, refresh, cache freshness, and eviction.
- [ ] Implement Grafana execution with `getDataSourceSrv().get`, native query objects, scoped variables, inherited range/timezone, and width-derived resolution. Delegate variable escaping to datasource interpolation; reject unresolved/colliding `dm_` parameters. Never concatenate unescaped native query strings.
- [ ] Add tests for two datasource UIDs, native editor target preservation, context/resolution changes, reopened fresh cache, expiry, LRU/value/byte budgets, concurrency limit, and panel-source reuse without network calls. Verify queued requests with no remaining consumer never execute.
- [ ] Normalize numeric time frames; preserve nulls and sample timestamps. Test unsupported shapes, ambiguous fields, invalid timestamps, empty response, explicit query errors, and data source lookup failures. Separate field formatting from network execution; do not assume direct queries inherit Grafana transformations/overrides automatically.
- [ ] Run `npm test -- src/query` and `npm run typecheck`; expected all pass. Commit `feat: load diagram detail queries on demand`.

### Task 4: Evaluate bindings and quiet status presentation

**Files:** Create `src/binding/status.ts`, `src/binding/status.test.ts`;
modify `src/binding/engine.ts`, `src/interact/cardModel.ts`, `src/render/applier.ts`,
`src/render/overlay.ts`, and their existing tests.

**Interfaces:** Consumes `BindingPlan` and resolved query values; produces existing
patches plus `StatusView`, summary groups, and demand descriptions for configured hover rows.

- [ ] Add tests showing explicit health and opted-in thresholds, zero versus down,
      missing versus stale, incomplete coverage, and normal neutral styling. Assert sample
      age is compared to configured cadence, never to chart resolution.
- [ ] Run `npm test -- src/binding/status.test.ts src/binding/engine.test.ts`; confirm new expectations fail, then implement pure status evaluation and effective binding application.
- [ ] Add tests that identical widespread conditions produce one summary with affected
      elements still marked, while distinct causes remain distinct. Keep directional
      link magnitude colors separate from device health semantics.
- [ ] Make card rows consume configured data/models. Generating a closed-card model
      must neither demand history nor fetch extra values. Preserve current URL validation
      and field formatting semantics; report unmatched/ambiguous metrics in the editor.
- [ ] Run `npm test -- src/binding src/interact/cardModel.test.ts src/render` and
      `npm run typecheck`; expected all pass. Commit `feat: evaluate explicit diagram status and hover bindings`.

### Task 5: Render explicit Grafana visuals and lazy hover cards

Task 1 selected the SVG foreignObject portal provisionally. Use rectangle-local bounds and parent-relative CTM, initialize after the stage ref is attached, and prepare numeric range state plus explicit Sparkline line styling. The Grafana 12 dark-theme geometry, clipping, CSS, and painted-pixel checks passed; Grafana 13, light theme, and sandbox remain Task 8 gates.

**Files:** Create `src/visuals/{SparklineView,BarGaugeView,ChartLayer}.tsx` and
`src/visuals/{SparklineView,ChartLayer}.test.tsx`; modify
`src/render/geometry.ts`, `src/components/DrawioMapPanel.tsx`,
`src/components/DrawioMapPanel.test.tsx`, `src/interact/Card.tsx`.

**Interfaces:** Consumes `Widget`, `QueryController`, `HistoryModel`, and chart anchors;
produces query-free visual adapters and a layer that owns per-visible-region subscriptions.

- [ ] Add component tests proving only explicit chart regions render, hover-only requests
      remain zero until a card opens, and closing/switching releases the old demand.
- [ ] Run `npm test -- src/visuals src/components/DrawioMapPanel.test.tsx`; confirm the new behavior is absent before implementation.
- [ ] Implement bounded React regions using public Grafana `Sparkline` and `BarGauge`
      through the verified Task 1 portal route. Only plugin-created React content enters
      generated foreignObjects; preserve sanitization of imported markup. Follow CTM/viewport changes, panel clipping, and nested transforms. Gate requests by
      actual display visibility; remove invisible-region demand while retaining fresh cache.
- [ ] Replace custom hover polylines with `SparklineView`; explicitly render loading,
      empty, one-sample, stale, and error states. A normal bar requires a meaningful min/max;
      absent bounds produce a numeric display and validation hint rather than invented limits.
- [ ] Add null-gap, units, latest-value, theme, zoom, and interaction hit-testing tests.
      Keep error text local to the affected widget; no full-panel failure for one query.
- [ ] Run targeted tests plus `npm run typecheck`; expected all pass. Commit `feat: render explicit Grafana visuals in diagram regions`.

### Task 6: Add named query authoring and element inspector

Task 1 selected preview and inspector together inside the plugin panel, with direct React callbacks and context from public PanelProps. No standard-options bus or host-category expansion route is adopted. Programmatic eager-target removal was not validated; use the manual Grafana Queries-tab removal guidance and keep its lazy-loading warning until removal is verified. See `docs/research/authoring-compatibility.md`.

**Files:** Create `src/editor/{BindingEditor,BindingInspector,QueryEditor}.tsx`,
`src/editor/draft.ts`, `src/editor/draft.test.ts`, `src/editor/BindingEditor.test.tsx`;
modify `src/options/RulesEditor.tsx`, `src/module.ts`, and `DrawioMapPanel.tsx`.

**Interfaces:** Consumes V2 configuration, `BindingPlan`, shared query controller,
and public save callbacks. Produces `BindingDraft`, draft reducer, commit operation,
and native datasource editor adapter. Follow the verified Task 1 integration route.

- [ ] Add draft tests for this-element override versus shared-pattern edit, cancel,
      apply, undo-to-saved draft, and import conflict diagnostics. Add focus assertions:

```ts
await user.click(screen.getByRole('button', { name: 'Select device-1' }));
expect(screen.getByRole('heading', { name: 'device-1 bindings' })).toHaveFocus();
expect(screen.getByLabelText('Edit scope')).toHaveValue('element');
```

- [ ] Run `npm test -- src/editor/draft.test.ts src/editor/BindingEditor.test.tsx`;
      verify new behavior fails, then implement draft state and the inspector.
- [ ] Wire pointer and keyboard selection to highlight, inspector scroll/focus, identity,
      pattern provenance, and overrides. Hover does not focus. Switching edit scope
      previews all affected elements before Apply; invalid bindings cannot silently save.
      Add `cellAt(target: EventTarget | null, cells: CellIndex): CellEntry | undefined` in
      `src/interact/hit.ts`, independent of patches, so unbound elements are selectable.
- [ ] Add a query library with datasource default/override, native query editor, parameter
      mapping, result field selection, and explicit preview. Label eager panel references
      accurately; supply a conversion workflow for a hover-only query and remove its eager
      target only through a public Grafana editor path validated in Task 1. If query mutation
      is unavailable, save the native definition and guide the user to remove the eager
      target in Grafana's query tab; keep the lazy-loading warning until removal is verified.
- [ ] Configure hover rows and link/shape status without YAML-only controls. Save native
      target objects losslessly. When a datasource has no supported editor, show a clear
      limitation and allow explicit native-target JSON import with schema validation.
- [ ] Run targeted editor tests and `npm run typecheck`; expected all pass. Commit
      `feat: author diagram bindings through a focused side inspector`.

### Task 7: Author chart regions and import/export patterns

**Files:** Modify `BindingInspector.tsx`, `draft.ts`, `src/options/DiagramEditor.tsx`,
`src/editor/DrawioModal.tsx`, `src/render/svgStage.ts`, `src/adapter/portograph.ts`;
extend their tests and `src/fixtures/authoring.{drawio,svg}`.

**Interfaces:** Consumes Task 6 draft actions and Task 5 widget/anchor contracts.
Produces persisted chart assignments and portable panel-local pattern documents.

- [ ] Add tests for selecting an ordinary draw.io rectangle as a chart region, choosing
      a named query, save/export/reopen with unchanged cell identity, and explicit widget
      removal when its anchor is deleted. Missing anchors produce diagnostics, not hidden widgets.
- [ ] Run relevant unit tests to confirm the new paths fail; then add inspector actions
      for sparkline/bar assignments, label/unit/bounds/drilldown, and draw.io geometry editing.
- [ ] Implement versioned pattern export containing the referenced query definitions.
      Import previews ID conflicts and element-override applicability; users choose replace
      or a new identity. Remap query references atomically; never resolve by display name.
- [ ] Test copy/paste duplicate metadata, Unicode labels, nested groups, diagram replacement,
      pattern export/import across panels, and cancel before apply. No network activity follows import alone.
- [ ] Run targeted tests and `npm run typecheck`; expected all pass. Commit
      `feat: author chart regions and portable panel patterns`.

### Task 8: Validate the full workflow and document supported behavior

Blocking acceptance carried from Task 1: repeat `authoring-compat.spec.ts` on Grafana 13.2.4, both sandbox targets, and light theme after the shared OrbStack backend recovers. Grafana 12.4.13 dark baseline passed all three routes; no Grafana 13/sandbox/light result is claimed. Reuse the test-only harness and inspect the owned `drawiomap-t1` project before taking service ownership. Its stop attempt timed out during the outage.

**Files:** Create `tests/query.spec.ts`, `tests/binding-editor.spec.ts`,
`tests/visual-regions.spec.ts`; extend `tests/editor.spec.ts`, `tests/zoom.spec.ts`,
`provisioning/datasources/` and the demo dashboard with sanitized fixtures;
update `README.md` and `docs/research/authoring-compatibility.md`.

**Interfaces:** Exercises the public UI, persisted dashboard options, and actual datasource
requests on the supported matrix. Uses the monitoring-inspired sanitized fixture, not live infrastructure.

- [ ] Add browser assertions for request counts: initial page/closed hover zero detail
      requests, first open one demand, fresh reopen no duplicate, variable/range change new
      demand, and late old-result rejection. Include both value and history hover rows.
- [ ] Prove mixed datasource selection with two actual datasource types. Record which
      datasource plugins and versions were tested; do not claim universal compatibility.
- [ ] Exercise representative-element selection, inspector focus, pattern preview,
      explicit element override, query editing, chart assignment, save/reopen, and import/export.
- [ ] Check desktop light/dark rendering of normal, partial outage, widespread outage,
      zero, missing, stale, loading, and error states. Confirm abnormal reasons are visible
      without hover and the diagram is not filled with default per-element charts.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and
      `npm run check:bundle`. Run focused specs with `npm run e2e:12 -- tests/query.spec.ts tests/binding-editor.spec.ts tests/visual-regions.spec.ts tests/editor.spec.ts tests/zoom.spec.ts`, then the equivalent `e2e:13` command. Expected: all pass.
- [ ] Run the project's required minimum-supported/latest-dev browser coverage if it
      differs from the pinned local matrix; report unavailable targets as unverified, not passed.
      Validate effective frontend sandbox settings before claiming sandbox coverage.
- [ ] Document unsupported datasource editors/result types, cache semantics, freshness,
      migration/recreation, and the geometry/behavior split. Record measured request counts
      and query budgets. Remove superseded custom chart code and conflicting V1 controls
      only after the new workflow passes; keep rollback available as a normal commit revert.
- [ ] Commit `test: cover demand-loaded diagram authoring end to end`.

## Verification and handoff notes

Current scripts use Vitest, not Jest. Local Grafana targets are 12.4.13 on port 3012
and 13.2.4 on port 3013; inspect current compose before starting. `e2e:matrix` assumes
the stack exists. `ci:local` tears down volumes and is unsuitable for a casually
shared stack. One worker owns stack lifecycle; avoid concurrent rebuild/restart races.

Completion means product acceptance, request-count tests, the supported browser matrix,
and visual inspection are evidenced. A successful typecheck or source read alone does
not establish actual datasource behavior, overlay geometry, focus, or sandbox support.

Before execution, review this plan against the spec. After approval, preserve the
selected Orca Sol/Luna execution method. Planning changed documentation only.
