# Simplify step 3: one snapshot store, a history cache, a cheaper card

- Status: draft 2026-10-25, revised after two reviews (section 10) and the user decision on the card (keep uPlot,
  defer it). Design only; no code in this change.
- Scope: a new `src/query/store.ts`, `src/query/frames.ts` (the history cache, O4), `src/binding/engine.ts`
  (`historySeries`), `src/binding/reduce.ts`, `src/query/panel.tsx` (the service gains the store),
  `src/components/DrawioMapPanel.tsx`, `src/visuals/ChartLayer.tsx`, `src/editor/BindingEditor.tsx`,
  `src/editor/preview.ts`, `src/editor/patternPreview.ts`, `src/query/panelSnapshot.ts` (memo), `src/interact/Card.tsx`
  (the deferred charts). Deleted: `src/visuals/useBindingSnapshots.ts`.
- Reads: the simplify plan (step 3, agreed 2026-10-23), the hover result of 2026-10-25 (O1 and O3, `fa85e9e`), the
  live profile of the consumer team (O4), `CODING_STANDARDS.md` "State and data", the popup spec section 4.4 (pause).
- Out of scope: `nowMs` out of `bindPlan` (step 4), patch diffing and the geometry cache (step 5, O2), the saved
  config (version 3 does not change), the controller's execution, budgets and cache (`controller.ts` lines 109-269).

## 1. Goals and decisions

1. One place holds the live result of every consumer: the store. The controller keeps execution, the budgets and the
   inactive cache. React components keep no result in state and build no resolver from arrays.
2. The resolver of `bindPlan` and of the card is a Map lookup: `(cellId, binding)` → the entry of `(cellId, queryId)`
   → its `HistoryModel`, built once per result and binding.
3. The rules that exist in three places today exist once: the store keeps the last settled result while the next
   generation loads and holds while paused; the controller merges identical requests, and nothing else shares a
   result between consumers.
4. A hover over a new cell changes the frame of the card group only. The visible frame, `bindPlan` and the patches do
   not change (O1 stays).
5. The card keeps Grafana's `Sparkline` (uPlot) and defers it: the pointer task renders the title and the row texts,
   the charts follow in a transition (section 5). User decision 2026-10-25: "keep uPlot, defer it".
6. A result crosses the controller boundary once: one copy of the value arrays per emission, before the listeners,
   shared read-only after that. The resolver trusts an entry only when its request identity equals the demand of
   the current render.

## 2. Today: the flow and what is duplicated

The panel (`DrawioMapPanel.tsx`):

1. `PanelQueryProvider` (`panel.tsx:28-101`) makes a controller per session (`session.ts`: the cache and the
   generation survive a remount) and freezes one `QueryContext` per signature.
2. `useBindingSnapshots` (`useBindingSnapshots.ts`) runs twice, for the owners `panel:<id>` (role `visible`, lines
   377-387) and `panel:<id>:card` (role `hover`, the open cell, lines 390-400). For each demand of
   `collectBindingDemands` it builds a consumer id, a request, `key = JSON.stringify(request)` and `match`, asks
   `preparedSnapshot` whether a chart result can serve it (lines 55-67), watches the controller, keeps
   `{ key, preview, last }` in React state (lines 73-165) and buffers emissions while paused (lines 78-93, 135-144). The
   `shown` memo (lines 166-214) picks the current result, else the last of the same match, else a chart result of an
   earlier context, and marks it `kept`.
3. `ChartLayer` `Region` (`ChartLayer.tsx:85-97, 183-256`) watches its own widget, keeps its own `last` by `match`,
   buffers while paused, and publishes each result to the parent through `onPrepared`. The parent keeps them in
   `chartResults` (lines 348-376) and feeds them back into both hooks as `prepared` and into the resolvers.
4. `resolve` (lines 402-417) is `createPreviewResolver(plan, config, data, undefined, format, activeSnapshots)`.
   Each call (`preview.ts:145-153`) runs `config.queries.find`, then `preparedSnapshot` (`preview.ts:104-136`): a filter
   over every active preview with two `JSON.stringify` per candidate, then `resolveBinding` → `toHistory`
   (`frames.ts:46-134`): compile the matchers, scan every field of every frame, copy the time and value arrays, check
   them, filter the numerics, build a display processor. `cardResolve` (lines 418-431) is a second resolver over
   `[...cardSnapshots, ...activeSnapshots]`.
5. `bindPlan` (`engine.ts:145`) memoises the model per path inside one cell and one pass only (lines 180-201).
   `halfState` calls `historySeries` (lines 132-143): one `{ value, time }` object per point, then two arrays.
   `statusDeadlines` resolves the status bindings a second time. `usePreviewTime` joins the state of every active
   snapshot into a string on every render (`preview.ts:19-21`).
6. The card: `buildConfiguredCard(cardPatch, cardResolve, cardContext)` (lines 462-465) resolves every row binding
   again (`cardModel.ts:192-217` rebuilds the field and the display processor for a row unit), `combinedRow` reads the
   capacity series through the same resolver.

The popup (`BindingEditor.tsx`) repeats the panel with its own copies: a second `useStage` (line 127, its own svg
root, correct and kept), `draftQueryService` (the same controller, the context with the draft default datasource,
lines 160-165), its own `chartResults` and `onChartPrepared` (lines 250-279, byte for byte the panel's), one
`useBindingSnapshots` for the owner `popup:<id>` with no role (lines 280-288), `savedResolve` over `prepared` (lines
304-307), `resolve` as an overlay of the explicit preview and the pattern preview results (lines 310-328), `bindPlan`,
`statusDeadlines`, `usePreviewTime` (lines 329-336). The explicit preview watches `popup:<id>:binding-editor-preview`
(line 638); `previewPattern` watches `pattern-preview:<index>` with no owner prefix (`patternPreview.ts:108`).
`CardPreview` and `hoverPreview` both build the card from the same `patch` and `resolve`.

| Concept | Where it is today | After step 3 |
| --- | --- | --- |
| Keep the last settled result while the next loads | controller `refreshing` (timer refresh of one entry, `controller.ts:155-163`); hook `last` + `kept`; `Region.last` | the store entry `last` (section 3); `refreshing` stays, it is the controller's own entry |
| Reuse a chart result for a binding | hook demands (`reuse`), hook `shown`, `preparedSnapshot` in the resolver | gone: the controller merges identical requests (`controller.ts:328-349`); a different resolution is a different request (section 3, "Sharing") |
| Buffer emissions while paused | hook `pending` + `pausedRef`; `Region.pending` + `pausedRef`; `useHeld` of the result | the hook's held frame (section 3, "Pause") |
| Identity by JSON | `key`, `match`, `preparedSnapshot` compares, `usePreviewTime.activeVersion` | one `matchKey` per entry, computed at `want()`; a frame `version` number |
| Resolver | panel `resolve`, `cardResolve`; popup `savedResolve`, `resolve`, one per report result | `resolverFrom(frames, plan, data)`; the popup keeps its report overlay |
| Chart results in React state | panel and popup `chartResults`, `onChartPrepared`, `chartOwner` | deleted; widgets are consumers of the store |
| `toHistory` per (cell, binding) per pass | `resolveBinding` on every call | the history cache (section 4) |

## 3. The store

New module `src/query/store.ts`, pure TypeScript, no React. One store per controller: `PanelQueryProvider` creates
both in the mount effect and exposes `{ controller, store, context }` as `PanelQueryService`. `draftQueryService`
keeps the same store and controller with the draft context: the context travels in the demand, as today.

```ts
export interface StoreDemand {
  cellId: string;                // the cell, or the anchor cell of a chart widget
  query: NamedQuery;
  scope: TemplateScope;
  context: QueryContext;
  maxDataPoints: number;
  /** stable([query, scope, context.defaultDatasource]): the request identity without the generation and the resolution */
  matchKey: string;
}
/** `demandsOf(plan, config, context, maxDataPoints, role, openCellId)` builds them: one per (cellId, queryId), with the key. */
/** What the frame holds for one consumer. The object is stable until the entry changes. */
export interface Shown {
  snapshot: QuerySnapshot;       // settled: the current result; else the last settled one with fromCache: true, else current
  kept: boolean;                 // true when `snapshot` is `last`, a result of an earlier generation or resolution
  generation: number;            // the generation of `snapshot`
  matchKey: string;              // of the request that produced `snapshot`
  maxDataPoints: number;         // the resolution of the request that produced `snapshot`
  demand: StoreDemand;
}
/** The results of one group (or of one owner), for React: a new object only when a `Shown` or the membership changed. */
export interface Frame {
  version: number;
  /** the entry of the pair; in an owner frame with two groups on one pair, the settled one, else the first */
  get(cellId: string, queryId: string): Shown | undefined;
  readonly size: number;
}
export interface SnapshotStore {
  /** Declare the whole wanted set of a group. New demands are watched, missing ones released, equal ones kept. */
  want(owner: string, group: string, demands: StoreDemand[]): void;
  /** The frame of a group; without a group, of every group of the owner. */
  frame(owner: string, group?: string): Frame;
  /** The model of a binding at a cell, from the history cache (section 4). */
  model(shown: Shown, binding: QueryBinding, format: HistoryFormat): HistoryModel;
  subscribe(listener: () => void): () => void;   // one call per microtask batch of changes
  dispose(): void;
}
```

Entries. The key of an entry is `entryKey(owner, group, cellId, queryId)`: the four parts, each encoded with
`encodeURIComponent`, joined with `:` (R3-2: a portograph link id holds `:`, so a raw join could collide); it is also
the `consumerId` given to `controller.watch`, so the controller's "one consumer id, one watch" rule still protects
two owners from each other (test "does not let a second owner with the same ids take the watch of the first"). The resolution is not in the key:
a zoom changes the request of the entry, not the entry (R1-7). An entry holds `demand`, `current: QuerySnapshot`,
`last?: { snapshot, generation, matchKey, maxDataPoints }`, `release` and `shown` (built lazily, cached until `current` or `last`
changes). One entry per `(cellId, queryId)` in a group, not per binding place: the link value, its capacity series
and a hover row that read the same query at the same cell share one watch. A chart widget is the group
`widget:<id>` with `cellId = anchorCellId` (R1-5). Today these are separate consumers of one controller entry; the
watch count drops. Every entry watches; the store shares nothing between entries itself.

Sharing (R2-2). Two demands share one request only when their request identity is identical: the same query, scope
parameters, datasource, time range, time zone, `intervalMs`, `maxDataPoints` and generation. That is the
controller's `cacheKey` (`controller.ts:74-83`), and the controller already merges such watches into one entry and
one request (`controller.ts:328-349`, test "shares one pending request between consumers"). A result of another
resolution is not the same data (`$__interval` changes the values), so it is not shared: the explicit reuse of a
chart result by a binding (`preparedSnapshot`, `purpose: 'reuse'`) goes, with no borrower, no source and no
promotion. Request cost against today: a binding and a widget of one query at one cell with different widths are two
requests instead of one, and a widget of a query without parameters no longer serves every cell bound to that query
(those cells already share one request among themselves, so that is one more request per such widget, not one per
cell). With equal widths nothing changes. The explicit preview of the popup asks `MAX_DATA_POINTS` (264) instead of
160 (`BindingEditor.tsx:642`) and `previewPattern` uses the same demands as the store entries, so both merge with the
entries of the popup in the controller instead of reading `prepared`.

The boundary copy (R1-3, R2-1). Grafana keeps field value arrays by reference, and a streaming datasource appends to
them in place. The copy happens once per emission, in the controller, before `publish` calls the listeners: in the
executor callback (`controller.ts:206-220`), after `measureFrames`, `snapshot = { ...snapshot, frames:
copyFrames(snapshot.frames), fetchedAt, fromCache: false }` with `copyFrames = frames.map(f => ({ ...f, fields:
f.fields.map(fd => ({ ...fd, values: Array.from(fd.values) })) }))`. The 300 listeners of one entry get the one copy;
the cache retains the copy and the executor's original is let go; the budgets measure the same numbers.
`panelSnapshot` makes the same copy once per `(data, refId)` in its memo (section 4, item 6). This replaces today's
two copies per `toHistory` call with one per result: on a result of 300 series with 300 points, 90 000 value slots
per emission, not 27 million as a copy per listener would cost.

`want()`:

1. For each demand, compute the key. An existing entry with the same key, `matchKey`, `context` and `maxDataPoints`
   is kept. The same key with a new `context` (a generation) or a new `maxDataPoints` (a zoom): release the old
   watch, keep `last` (a settled `current` becomes `last`), watch again; `shown` is `last` with `kept: true` until
   the new result. The same key with a new `matchKey` (the query, the scope or the default datasource changed): drop
   `last` too ("does not show the result of a changed query").
2. A new key watches: `controller.watch(demand, listener)`; the controller merges it with an identical request.
3. Entries of the group that are not in the new set are released.
4. Emissions: the listener writes `current`; a settled snapshot also becomes `last` when its `matchKey` is the
   entry's.
5. Every change bumps `version` and notifies once per microtask (R1-8): an emission, a new or released entry, a
   re-watch, `dispose`. A `want()` with an equal set changes nothing and notifies nobody.

`frame(owner, group)`: computed on demand and memoised by `(owner, group, version)`. Before it returns a new object
it compares the membership and the `Shown` of every entry of the group with the previous frame; when all are
identical it returns the previous frame. A change in the card group therefore gives a new card frame and the same
visible frame (O1). The owner frame (every group) is what the popup reads, through the hook, so it is subscribed
(R1-6).

Keep the last good result on refresh. A refresh is a new generation: `want()` watches a new request for the same key
and `shown` returns `last` with `fromCache: true` and `kept: true` until the new result settles, for datasource and
every entry. Zoom (`view`), the pinned card (`card`) and the open editor (`popup`) are React state of
the panel that step 3 does not touch; the frame enters the view only through the hook. The controller and the
session do not change: the shared cache still serves a remount of the same generation at once, so the first frame of
a new store already holds ready results. The store does not live in the session (section 9, accepted).

Pause. The hook is the only reader:

```ts
export function useBindings(service: PanelQueryService | undefined, owner: string, group: string,
                            demands: StoreDemand[], paused: boolean, scope: 'group' | 'owner' = 'group'): Frame
```

It calls `store.want(owner, group, demands)` in an effect (and `want(owner, group, [])` on unmount or a new store)
and reads the frame with `useSyncExternalStore`: the group frame, or with `scope: 'owner'` the frame of every group
of the owner (the popup, R1-6). Its `getSnapshot` returns the held frame while `paused`, else the live frame, which
it records as held. That is `useHeld` inside `getSnapshot`: while paused an emission changes
nothing that React sees, so the view renders zero times (the acceptance measurement of the popup, `docs/acceptance.md`
"popup open"); the first render after the pause gets the live frame with the latest results. No buffer, no pending
map. The ref write in `getSnapshot` is idempotent, as the one in `useHeld` (spec 4.4). `demands` must be a memo of
the caller (the plan, the open cell, the width, the context): a new array each render would call `want()` each
render; `want()` is a diff, so it would be correct but wasted.

Resolver: `resolverFrom(frames: Frame[], demands: Map<string, StoreDemand>, plan, data, format): BindingResolver`
in `store.ts`; `demands` is the memo of the render, keyed `${cellId}:${queryId}`. The map holds every identity the
resolver can be asked for (R2-4): `collectBindingDemands` (`engine.ts:61-96`) gains the widgets of the plan as
demands with `role: 'widget'` and `cellId = anchorCellId`, so `widgetDiagnostics` (`engine.ts:119-122`) finds its
identity in the map. The hooks filter by role as today: the panel's `visible` group takes `visible`, the `card` group
`hover`, a `Region` its one `widget` demand with its own resolution; the popup's map takes all three, and its
`bindings` group watches `visible` and `hover` only (the regions watch the widgets). For a panel-source query it
returns the memoised `panelSnapshot(data, refId)` through the history cache, as today (section 9, accepted). Else it
looks `(cellId, binding.queryId)` up in the frames in order and checks the entry against the demand of this render
(R1-2), as `useBindingSnapshots.ts:179-211` does today, because `want()` runs in an effect after the render:

- `shown.matchKey === demand.matchKey`, `shown.generation === demand.context.generation` and
  `shown.maxDataPoints === demand.maxDataPoints`: the result, as is.
- the same `matchKey`, another generation (a refresh before the effect) or another resolution (a zoom before the
  effect; the settled entry of another group of the owner on the pair, R3-1): the result as `kept`, `fromCache: true`.
- another `matchKey` (the query target, the scope or the default datasource changed under the same id): `{ state:
  'loading' }`, never the old data as a fresh success. The effect then re-watches and drops `last`.
- no entry: `{ state: 'idle' }`, the value today for a demand that is not watched yet.

A `Region` makes the same check on its one entry before it draws. The `kept` and `loading` cases are one render
long; the next frame comes from the store.

## 4. The history cache (O4)

Today `toHistory` scans every field of every frame of the result, compiles the matchers, copies both arrays and
checks every point, on every call: once per (cell, binding) per `bindPlan` pass, again in `statusDeadlines`, again
in the card. The cache makes each of these steps run once per result.

1. `indexFrames(frames: DataFrame[]): FrameIndex`, memoised in a `WeakMap<DataFrame[], FrameIndex>`. The index lists
   each numeric field once with its frame, display name and labels, finds the one time field of its frame, and runs
   the checks of `frames.ts:90-98` (equal lengths, finite ordered timestamps, finite or null values) once per field.
   A field that fails keeps its `unsupported` message in the index.
2. `selectField(index, match, field)`: the candidates by the matchers, memoised in `index.byMatch:
   Map<matchKey, Candidate | 'none' | 'ambiguous' | 'invalid'>` with `matchKey = stable(match) + '\n' + (field ?? '')`.
   `compileMatcher` already caches by pattern string; the compiled list of a binding is built once per `matchKey`.
3. The model: `historyOf(snapshot, binding, format): HistoryModel`, memoised per snapshot object in
   `WeakMap<QuerySnapshot, Map<string, HistoryModel>>` with the key `matchKey|field|reducer|unit|decimals|timeZone|themeId`
   (`themeId` from a `WeakMap<GrafanaTheme2, number>`). The model holds `timestamps` and `values` as references to the
   field arrays of the controller's copy (section 3, "The boundary copy"), not new copies; the type says `readonly`.
   Nobody writes to them (`SparklineView` builds a new field object around `model.values`); a producer cannot reach
   them. `latestValue` comes from `reduceValues` over the array with a loop and no filtered
   copy (`reduce.ts` filters a second time today). `fetchedAt` and `fromCache` come from the snapshot object, which is
   why the store creates its `fromCache: true` copy once per `last`, not per read.
4. `historySeries(model, binding)` builds `values` and `times` with two loops, no per-point object, and is memoised
   on the model (`WeakMap<HistoryModel, Map<queryId, SeriesInfo>>`): one `SeriesInfo` per model lifetime.
5. `resolveBinding` resolves the match templates against the cell scope on every call. The resolved binding is
   memoised per `(binding, scope)` in a `WeakMap<QueryBinding, WeakMap<TemplateScope, QueryBinding | string[]>>`;
   both objects are stable per plan. `toHistory` keeps its name and tests and becomes `historyOf` with the index inside.
6. `panelSnapshot(data, refId)` builds a new object on every call today, so a cache keyed by the snapshot would
   always miss (R1-10). It is memoised per `(data, refId)` in a `WeakMap<PanelData, Map<string, QuerySnapshot>>`,
   with the boundary copy of the frames of that `refId`, and loses its `fetchedAt` parameter: the controller's
   `setPanelData` and the resolver get the same object for the same panel data.

Invalidation is by identity: a new result is a new `frames` array and a new snapshot object; a new plan gives new
binding and scope objects; a theme change gives a new theme object. No entry is ever cleared by hand and no clock is
involved. The WeakMaps release with their keys. A `QuerySnapshot` copied by hand (`{ ...snapshot }`) loses its cache
and only costs one rebuild; the store and the hook make such a copy once per `last`.

## 5. The card's first render

Live numbers (the consumer team, after O1 and O3): 13.9 ms per hover over a new cell at 1x CPU, 12.6 DOM mutations.
`bindPlan` no longer runs on a hover, so the time is the card's own commit plus `buildConfiguredCard`.

Read from the code. A new cell mounts a new `Card` (`key` is `${cellId}:${pinned}`, `DrawioMapPanel.tsx:868`). Each
`history` row renders `SparklineView` → `@grafana/ui` `Sparkline` (`node_modules/@grafana/ui/dist/esm/components/
Sparkline/Sparkline.mjs`): `prepareSeries` (an aligned frame, `getFieldSeriesColor`, display processors),
`preparePlotData2`, `prepareConfig` (a `UPlotConfigBuilder` with scales, axes, series and the theme), then
`UPlotChart.componentDidMount` runs `new uPlot(config, data, el)`: a canvas, font measurement, scale and path
computation, and a paint; the instance is destroyed with the row. `Sparkline` builds a new config builder on every
render, and `UPlotChart.componentDidUpdate` re-creates the instance on a new `config`, so keeping the card mounted
across cells would not help. A `combined` row uses `MirrorSparkline`, plain SVG, about 0.1 ms. `ChartHover` and the
`Card` styles are `useStyles2` memos. `buildConfiguredCard` costs one `toHistory` and one `historySeries` per row
binding today (section 4 removes most of it: a row that reads the query of the link gets the model of the visible
entry).

Estimate, to confirm: a uPlot instance is in the order of 2 to 4 ms at 1x on first creation, so two or three
`history` rows are most of the 13.9 ms. The first measurement step of the implementer settles it (section 7).

The fix (user decision: keep uPlot, defer it). The `Card` renders in two commits. The first, in the pointer task,
has the title, the texts of every row and, for each chart row, an empty box of `chartHeight(row)`: the card has its
final height at once, so `placeAt` places it once and nothing jumps. The charts come in the second commit, in a
transition: `const [chartsReady, setChartsReady] = useState(pinned || variant === 'inline')` and a mount effect
`startTransition(() => setChartsReady(true))`. React 18.3 (`package.json`) has no `useDeferredValue(value,
initialValue)`, and `useDeferredValue` on a mount returns the value itself, so the flag is the deferred value. A
hover card that is pinned by a click remounts (the key holds `pinned`) with the charts at once: the user asked for
it, and the hover card had them. The inline card of the popup is not on a pointer path. A pointer that leaves the
cell before the transition commits unmounts the card and the transition is dropped: a fast sweep over many cells
pays for the texts only. `Row` keeps its `memo`; `Sparkline`, `MirrorSparkline`, `ChartHover` and the Y range do not
change, and a data refresh of a pinned card still re-creates the uPlot instance (`sameConfig`), as today. The
pointer task gets shorter; the total work does not, and the uPlot cost stays as a known line in the profile.

## 6. Migration of each caller

| Caller | Today | After |
| --- | --- | --- |
| `panel.tsx` `PanelQueryProvider` | `{ controller, context }` | `{ controller, store, context }`; `store.dispose()` with the controller |
| `DrawioMapPanel.tsx` visible data | `useBindingSnapshots(..., 'panel:<id>', paused, 'visible')`, `chartResults`, `activeSnapshots`, `resolve` | `visibleDemands = demandsOf(plan, ..., 'visible')` memo (one demand per `(cellId, queryId)`, with `matchKey`); `visible = useBindings(service, 'panel:<id>', 'visible', visibleDemands, paused)`; `resolve = resolverFrom([visible], visibleDemands, plan, data, format)`; `chartResults`, `onChartPrepared`, `chartOwner`, `activeSnapshots` deleted |
| `DrawioMapPanel.tsx` card | second hook for `panel:<id>:card`, `cardResolve` over both arrays | `cardDemands = demandsOf(..., 'hover', card?.cellId)`; `cardFrame = useBindings(service, 'panel:<id>', 'card', cardDemands, paused)`; `cardResolve = resolverFrom([cardFrame, visible], cardDemands ∪ visibleDemands, ...)`; `model` memo depends on `cardFrame`, not on `visible` |
| `Card.tsx` | every row mounts its chart in the first commit | `chartsReady` flag, charts in a transition (section 5); `Row` gets `chartsReady` and renders the empty box of `chartHeight(row)` until then |
| `DrawioMapPanel.tsx` time | `usePreviewTime(data, generation, undefined, activeStates, deadlines)` | `usePreviewTime(data, generation, undefined, visible.version, deadlines)`: the signature takes a version number instead of the state list |
| `ChartLayer.tsx` `Region` | own `watch`, `last`, `pending`, `onPrepared` | `useBindings(service, owner, 'widget:<id>', visible ? [demand] : [], paused)` with `demand.cellId = anchorCellId` and `maxDataPoints = geometry.resolution`; `shown = frame.get(anchorCellId, queryId)`, checked against `demand` as the resolver does (section 3), else loading; `resolveBinding` through the cache; `onPrepared` and the `queries`/`controller`/`context` props go, the service comes in; a resolution change keeps `last` (R1-7) |
| `BindingEditor.tsx` | `chartResults`, `useBindingSnapshots(owner)`, `prepared`, `savedResolve` | `ownerFrame = useBindings(service, 'popup:<id>', 'bindings', demands, false, 'owner')` with the visible and the hover demands of `draft.cellId` in one set; the owner frame holds the widget groups too, subscribed (R1-6), so `widgetDiagnostics` resolves at the anchor cell (R1-5); `savedResolve = resolverFrom([ownerFrame], demands, plan, data, format)`; the report overlay (`resolve`, lines 310-328) stays and wraps `savedResolve`; `prepared` for `previewQuery` and `runPatternPreview` becomes the settled entries of the owner frame |
| `BindingEditor.tsx` explicit preview | `controller.watch` with `popup:<id>:binding-editor-preview`, 160 points, `existing` from `prepared` | one watch with a stable id, outside the store, released on edit as today; `maxDataPoints: MAX_DATA_POINTS` so it merges with the popup's entry of the same cell and query in the controller; the `existing` lookup goes |
| `patternPreview.ts` | `pattern-preview:<index>`, `compatible` previews | unchanged logic; the ids get the owner prefix (`${owner}:pattern-preview:<index>`); the demands carry the same `maxDataPoints` as the store entries, so they merge in the controller; the `compatible` parameter goes; section 9, accepted |
| `CardPreview.tsx`, `cardModel.ts`, `engine.ts` `bindPlan` | take a `BindingResolver` | unchanged signatures; `readBinding` and the per-cell `read` keep their diagnostics; `historySeries` is the cached one |
| `preview.ts`, `panelSnapshot.ts` | `preparedSnapshot`, `previewSnapshot`, `createPreviewResolver`, `usePreviewTime`; `panelSnapshot(data, refId, fetchedAt)` | `preparedSnapshot` and `previewSnapshot` go (identical requests merge in the controller; the render check is in the store); `createPreviewResolver` stays for the popup's report overlay only, over one result; `statusDeadlines` unchanged; `panelSnapshot(data, refId)` memoised with the boundary copy (R1-10) |
| `controller.ts` | publishes the executor's frames | copies the frames once per `ready` emission before `publish` (section 3, "The boundary copy"); nothing else changes |
| `useBindingSnapshots.ts` and its test | the hook | deleted; its tests move to `store.test.ts` (section 8) |

`PlanCellPatch` and `rowBindings` do not change. `BindingDemand.role` gains `'widget'` and `collectBindingDemands`
lists the widgets at their anchor cells (R2-4); the demands of a group are the demands of today reduced to unique
`(cellId, queryId)` pairs; the capacity bindings reach the same pairs.

## 7. Wins and how to measure them

Measured in jsdom on a synthetic result (300 cells, one series each, 300 points, `vitest`, one worker, GC held with
`--max-semi-space-size=512`; the bench lives in the gitignored `local/bench/` of this checkout):

| Step, per pass of 300 cells | Today | After (estimate) |
| --- | --- | --- |
| `toHistory` for every cell | 4.7 ms, 9.1 MB allocated | first pass about 3 ms (the index), then a Map lookup per cell, no allocation |
| of which the frame scan with the matchers | 3.1 ms, 1.2 MB | once per result |
| of which the array copies and checks | 0.5 ms, 3.9 MB | once per result, no copies |
| `historySeries` for every cell | 2.0 ms, 1.7 MB (per-point objects) | once per model |
| `preparedSnapshot` scan, 600 resolves over 600 active previews | 172 ms, 10.9 MB | 600 Map lookups, about 0.1 ms |

The last row is not in the consumer team's profile list; it grows with the square of the bound directions, so it is
the largest cost of a refresh pass on a dense diagram. The live figures of the consumer team (`toHistory` about 60%
of `bindPlan`, about 1.3 MB/s of garbage during hover) are the reference for the before state; the implementer
repeats the live profile after the change.

Bench to add: `src/query/history.bench.test.ts`, in the `logic` project, skipped unless `DMAP_BENCH=1`. It prints
ms and KB per pass for the five rows and asserts the counts with `vi.mock('../binding/reduce', { spy: true })`:
twenty passes over one snapshot call `reduceValues` once per `(match, field, reducer)`. Run:
`DMAP_BENCH=1 NODE_OPTIONS="--expose-gc --max-semi-space-size=512" npx vitest run src/query/history.bench.test.ts --maxWorkers=1`.

The card in the browser: `scripts/bench/card-hover.mjs` (Playwright and CDP, not in CI, not in the e2e projects). It
opens the demo dashboard on `GRAFANA_URL`, starts `Tracing` with `devtools.timeline`, moves the mouse over 20 bound
cells in turn with a 300 ms gap, stops, and prints the median and p90 task time of the `pointermove` tasks and the
top ten self-time functions under them, and the duration of the next task that holds `uPlot` (the chart commit).
Run it before and after the deferral; the target is about 5 ms median for the pointer task at 1x, and the sum of
both tasks about the 13.9 ms of today (the deferral moves work, the cache of section 4 removes some). The jsdom tests
mock `Sparkline` (`Card.test.tsx:11-16`), so no jsdom number exists for the uPlot part.

## 8. Test plan

Unit, `--maxWorkers=2` in a worker; the full suite once on main before the push.

- `src/query/store.test.ts` (new; the cases of `useBindingSnapshots.test.tsx` move here against the store and the
  hook): loading on the first load; the previous result is kept for the next generation until the new one arrives
  (`kept: true`, `fromCache: true`), also for an error; a changed query shows no old result; a changed default
  datasource shows no old result; a binding and a widget of one query at one cell with the same width are one
  controller request, with different widths two; a resolution change of a widget keeps `last` as `kept`; two owners
  with the same ids keep their own watches; a hover group change gives a new card frame and the same visible frame
  object; the render check: a demand with a new `matchKey` resolves to `loading` against the old entry, a new
  generation to `kept`, never to the old result as fresh; a widget identity resolves at its anchor cell; a release
  and `dispose` bump the version and notify; paused: an emission renders nothing, the first render after the pause has
  the latest result, 1000 emissions while paused give one render; `want()` with an equal set watches nothing new and
  notifies nobody; the frame object is identical when no `Shown` and no membership changed; the owner frame changes
  when a widget group changes; `dispose` releases every watch.
- `src/query/controller.test.ts`: a `ready` emission reaches every listener of the entry as one frames object that
  is not the executor's (`toBe` between listeners, `not.toBe` the input); a later write to the executor's array does
  not change the published values; a retained result is the copy.
- `src/query/frames.test.ts` and `panelSnapshot.test.ts`: `historyOf` returns the same model object for the same
  snapshot, match, field, reducer and format; a new snapshot object gives a new model; `timestamps` and `values` are
  the arrays of the snapshot (`toBe`); the checks of `frames.ts:90-98` still give their `unsupported` messages; a unit
  or decimals override gives a model with its own display processor and the shared arrays; the ambiguous and the
  no-match cases; `panelSnapshot` gives the same object for the same `(data, refId)` and copies the frames.
- `src/binding/engine.test.ts`: `historySeries` gives the same `SeriesInfo` object twice for one model; a null gap
  is left out of `values` and `times`; `reduceValues` over `[null, 1, 2]` with each reducer.
- `src/components/DrawioMapPanel.test.tsx`: the existing cases stay green, in particular "a hover over two cells in
  turn does not bind or patch the diagram again", "shares saved visible data with hover rows and keeps monitoring
  after the card closes", "rejects old saved results when the open card context changes", "a pinned card stays open
  through a data refresh and shows the new value", "a new panel size or a new zoom option resets the view", and the
  popup pause measurement (zero view renders over three refreshes). "reuses a ready saved chart for configured scalar
  and history hover rows" changes its expectation: with the same width one request, with another width two (section
  3, "Sharing"). Add: a refresh while the card is pinned renders the card once with the new value and keeps `view`.
- `src/visuals/ChartLayer.test.tsx`: a widget keeps its last result across a generation; while paused it shows the
  held result and publishes nothing; it releases its entry when it leaves the viewport.
- `src/editor/BindingEditor.test.tsx` and `CardPreview.test.tsx`: the preview card updates on a store change, also
  on a change of a widget entry (the owner frame is subscribed); a changed query target under the same id shows
  loading, not the old rows; the explicit preview overlay still wins over the stored result; `widgetDiagnostics` sees
  the widget entries at their anchor cells.
- `src/interact/Card.test.tsx`: the first commit of a hover card has the row texts and an empty box of
  `chartHeight(row)` per chart row and no `Sparkline`; after the transition (`act`) the charts are there; a pinned
  card and the inline card have the charts in the first commit; the card height does not change between the commits.

E2E, one spec at a time in the worktree, then `npm run e2e:matrix` on main (the rendered panel and the editor change):
`tests/refresh.spec.ts` (keep the last render, the popup pause), `tests/links.spec.ts` and `tests/card-tooltip.spec.ts`
(the card waits for the charts: the probes must wait for `dmap-card-spark` content, not for `dmap-card` alone),
`tests/sparkline-range.spec.ts`, `tests/hover-kinds.spec.ts`, `tests/zoom.spec.ts` (a refresh during a zoomed view; a
zoomed widget keeps its last chart), `tests/visual-regions.spec.ts` (widgets through the store; a widget scrolled out
and back), `tests/bindings-popup.spec.ts` and `tests/bindings-popup-inspector.spec.ts` (the preview card),
`tests/query.spec.ts` and `tests/panel-edit-requests.spec.ts` (the request count: one more request per widget whose
query is also bound at another width; the expectation is adjusted with the reason). Open the screenshot of the card
before the change is called done.

Docs in the same diff: `docs/acceptance.md` (the hover and refresh rows, the new bench), a row in the PoC spec
"Superseded decisions" (results in a store, not in component state; the card charts deferred), README "Development"
(the bench commands). No README option changes.

## 9. Open questions, with a recommendation each

Decided 2026-10-25 (user): the card keeps uPlot and defers it (section 5). Accepted unless the review changes them:
one entry per `(cellId, queryId)`; the store per controller, not in the session; panel-source queries read from
`data` in the resolver (the controller's `setPanelData` runs in an effect, a store path would show one stale render);
`previewPattern` stays on `controller.watch` with owner-prefixed ids; a separate `store.ts` next to `controller.ts`;
the theme in the model key through a `WeakMap<GrafanaTheme2, number>` id.

Decided by the second review (R2-2): a result is shared only between identical requests, by the controller; no
explicit reuse, no borrowers. The request cost is stated in section 3, "Sharing".

Open:

1. The one more request per widget whose query is also bound at another width. Recommendation: accept; the card
   showed the points of another interval, which nobody chose. If the count matters on a dashboard, the author gives
   the widget the width of the card or the panel option for the card resolution (step 5 can add one).
2. The first commit of the hover card shows empty chart boxes for one transition. Recommendation: accept; the boxes
   keep the height, so the placement is final, and a pinned or inline card has the charts at once. If the review
   wants a visible state, a `role="status"` text "Loading chart" in the box costs nothing; a skeleton animation is
   not worth a dependency.
3. `fetchedAt` of a memoised `panelSnapshot` is the time of its first call for that `data`, not of each read.
   Recommendation: accept; `fetchedAt` feeds the fetch age only, and a `data` object has one arrival time.

## 10. Review resolutions

| Concern | Resolution |
| --- | --- |
| R1-1 (P1). A borrower loses its source: a widget leaves the viewport and the binding that reused it never updates | First: borrower promotion. Second review: the explicit reuse, the borrowers and the promotion are removed (R2-2); every entry watches, the controller merges identical requests, so no entry depends on another. |
| R1-2 (P1). A changed query or default datasource under the same id renders old data before `want()` runs | `StoreDemand.matchKey` is computed in the render memo; `resolverFrom` and `Region` check the entry against the demand of the render: a new `matchKey` gives `loading`, a new generation gives `kept`, never a fresh success (section 3, "Resolver"). |
| R1-3 (P1). Aliasing: Grafana keeps value arrays by reference; a streaming producer appends in place | One copy per `ready` emission, in the controller before `publish`, and in the `panelSnapshot` memo; every listener, model and series shares that copy read-only (section 3, "The boundary copy"; section 4, item 3). |
| R1-4 (P2). Reuse took any settled result, at any resolution | First: `ready`/`empty` only and a resolution condition. Second review: no explicit reuse at all; only identical requests share, in the controller (R2-2). |
| R1-5 (P2). `widget:<id>` as `cellId` broke the anchor-based lookup of `widgetDiagnostics` | A widget entry has `cellId = anchorCellId` in its own group `widget:<id>`; the owner frame's `get` prefers the settled entry of a pair (section 3; migration table). |
| R1-6 (P2). The popup read `store.frame(owner)` with no subscription | `useBindings(..., 'owner')` returns the owner frame through `useSyncExternalStore`; `savedResolve` reads only that frame (section 3, "Pause"; migration table). |
| R1-7 (P2). A resolution change dropped `last` | `maxDataPoints` is out of the entry key and the `matchKey`; a zoom re-watches the same entry and keeps `last` as `kept` (section 3, "Entries" and step 1). |
| R1-8 (P2). Membership changes did not notify | Every change bumps `version` and notifies: an emission, a new or released entry, a re-watch, `dispose`; an equal set notifies nobody (section 3, step 5). |
| R1-9 (P2). Gaps and peaks lost in an SVG sparkline | Moot: fix A is dropped by the user decision; the card keeps Grafana's `Sparkline` and defers it (section 5). |
| R1-10 (P2). `panelSnapshot` built a new object per call, the WeakMap caches always missed | `panelSnapshot(data, refId)` memoised per `(data, refId)` with the boundary copy; `fetchedAt` is the first call's (section 4, item 6; open question 3). |
| R2-1 (P1). The copy ran once per consumer: 300 listeners of one entry each copied the result (27 million slots per emission) | The copy moves into the controller's executor callback, once per `ready` emission, before `publish`; the listeners, the cache and the budgets see the one copy (section 3, "The boundary copy"; migration table, `controller.ts`; test in section 8). |
| R2-2 (P2). `maxDataPoints >=` did not make two requests equivalent (`$__interval` changes the values) | Sharing only between identical request identities, which is the controller's `cacheKey` and its existing merge; the explicit reuse, `byQuery`, `source`, `borrowers` and the promotion are removed. The request cost is stated: one more request per widget whose query is also bound at another width, none with equal widths; the popup's explicit and pattern previews use the store's resolution so they merge too (section 3, "Sharing"; section 9, open question 1). |
| R2-3 (P2). Promotion after a generation change started an obsolete request | Moot: no promotion (R2-2). |
| R3-1 (P2). The owner frame prefers the settled entry of a pair (R1-5); with a binding at 264 points and a widget at its own width on one pair, the binding rows showed the widget's result as fresh while their entry loaded, against R2-2 | R2-2 wins: `Shown` carries `maxDataPoints`, and the render check gives `kept` for a result of another resolution, as for another generation; a binding row never shows a result of another resolution as its own fresh result, and a zoomed widget shows its old result as kept until the new one answers (section 3, "Resolver"; tests "a settled entry of another resolution in the owner frame shows as kept" and "a zoomed widget shows its result of the old resolution as kept"). |
| R3-2 (P2). The entry key `${owner}:${group}:${cellId}:${queryId}` could collide: portograph cell ids hold `:` (`pg-link~radio:dhcp->rtr-a:wan2`), and the controller would release the other tuple's watch | `entryKey` encodes each part with `encodeURIComponent` before the join (section 3, "Entries"; test "two tuples whose raw join is equal get two watches"). |
| R2-4 (P2). Widget-only diagnostics had no identity in the resolver's demand map | `collectBindingDemands` lists the widgets at their anchor cells with `role: 'widget'`; the popup's map holds all roles, the hooks filter by role, a `Region` takes its own widget demand with its resolution (section 3, "Resolver"; section 6). |
