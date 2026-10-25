# Simplify step 4: a bind without time, a freshness pass over the status cells

- Status: draft 2026-10-25. Design only; no code in this change.
- Scope: `src/binding/engine.ts` (`bindPlan`, a new `staleStatuses`), `src/binding/status.ts` (`evaluateStatus`),
  `src/visuals/useSampleStale.ts` (one clock hook, a new `useStaleStatus`), `src/editor/preview.ts` (`usePreviewTime`
  and `statusDeadlines` go), `src/components/DrawioMapPanel.tsx`, `src/editor/BindingEditor.tsx`, their tests.
- Reads: the simplify plan (step 4, agreed 2026-10-23), the step 3 spec (the store and the hook), `CODING_STANDARDS.md`
  "One concept, one function" and "State and data", the README section "Demand, cache and sample freshness".
- Out of scope: the saved config, the store, the card rows (they already have their own clock), patch diffing (step 5).

## 1. Goals and decisions

1. `bindPlan(plan, resolve, ctx)` takes no time. Its output is a function of the plan, the results and the context.
   The same inputs give the same patches at any moment.
2. The time-dependent part of the status, "the sample is older than the policy allows", runs in one small pass over
   the patches: `staleStatuses(result, nowMs)`. The bind records, for each status cell with a freshness policy, the
   moment after which the status is stale and the view it shows then. The pass compares that moment with the clock.
3. One clock hook, `useClock(deadlines)`, serves the status cells, the card rows, the bar gauge and the sparkline.
   `useSampleStale` becomes a one-line use of it. `usePreviewTime` and `statusDeadlines` are deleted.
4. The user-visible behaviour does not change: the same cells turn stale at the same moments, in the band, the
   markers, the cell attributes, the legend, the card and the popup stage.
5. A data change binds once. Today every data change renders twice and binds twice, because `usePreviewTime` reads
   the clock again in a microtask after each change. The pass needs no second read on the data path (section 3).

## 2. Today: the flow

1. `usePreviewTime(data, generation, snapshot, version, deadlines)` (`preview.ts:14-57`) keeps `nowMs` in React
   state. It sets it again in a microtask after each change of `data`, the generation or the frame version, and at
   each deadline of `deadlines`. Each set renders the panel again and runs `bindPlan` again with the new `nowMs`.
2. `statusDeadlines(plan, resolve)` (`preview.ts:60-71`) resolves every status binding a second time to find the
   deadlines (`sampleAt + staleAfterMs + 1`).
3. `bindPlan(plan, resolve, ctx, nowMs)` (`engine.ts:191`) calls `evaluateStatus(rule, values, nowMs)`
   (`status.ts:30`) for each status cell. After the availability, the invalid-policy and the missing-timestamp gates,
   the rule gives `stale` when `nowMs - sampleAt > staleAfterMs`, else the mapped or default condition. The engine
   writes the view into `patch.statusView` (a `stale` view replaces an earlier `missing` view of the cell; a `normal`
   view does not) and `summarizeStatuses` builds the band rows from the patches.
4. The consumers of `statusView`: `applyPatches` (`data-dmap-status`, `data-dmap-reason`, the `aria-label`),
   `renderOverlay` (the `? stale` marker), `StatusBand` (the summaries), `buildLegend` (the "Warning, stale" entry),
   `buildConfiguredCard` (the status row of a card without hover rows), and the popup `DiagramStage`.
5. The card rows, the bar gauge and the sparkline do not use `nowMs`. Each one has its own timer,
   `useSampleStale(sampleAt, freshness)` (`useSampleStale.ts`), with the same rule (`now > sampleAt + staleAfterMs`).

Two clocks exist (`usePreviewTime` and `useSampleStale`), and the status cells pay a full bind, a patch pass, an
overlay redraw and a label placement at each tick of the first one.

## 3. The new flow

`status.ts`. `evaluateStatus(rule, values)` returns `{ view, stale? }`:

```ts
export interface EvaluatedStatus {
  /** the status as if every sample were fresh */
  view: StatusView;
  /** set when a valid policy covers timed samples: the view that applies when the clock is after `after` */
  stale?: { after: number; view: StatusView };
}
```

The gates stay in their order: availability (`missing`), an invalid policy (`missing`, `INVALID_FRESHNESS_TEXT`), a
sample without a timestamp (`missing`). After them the function evaluates the condition into `view` and, when the rule
has a policy, sets `stale = { after: min(sampleAt) + staleAfterMs, view: <the stale view of today> }`. The stale view
keeps its reason, `queryIds`, `conditionKey` and coverage, so the band groups the same cells into the same row.

`engine.ts`. `bindPlan(plan, resolve, ctx)` writes `patch.statusView = view` under today's precedence rule, and
`patch.staleStatus = stale` when it is set. `PlanBindResult` gains `deadlines: number[]`: the sorted unique `after`
values of every patch, so nobody resolves the status bindings a second time.

```ts
export interface PlanCellPatch extends CellPatch {
  statusView?: StatusView;
  /** the view that replaces `statusView` when the clock is after `after`; `staleStatuses` applies it */
  staleStatus?: { after: number; view: StatusView };
  ...
}
export interface PlanBindResult { patches; diagnostics; summaries; deadlines: number[] }
/** The result at `nowMs`: each patch whose `staleStatus.after` is before `nowMs` shows its stale view. */
export function staleStatuses(result: PlanBindResult, nowMs: number): PlanBindResult
```

`staleStatuses` is pure. It finds the cells with `staleStatus && nowMs > after`. With none, it returns `result`
itself. Else it returns a new result with a new `patches` map in which only those cells have a new patch object
(`{ ...patch, statusView: staleStatus.view }`), the same `diagnostics` and `deadlines`, and `summaries` built again
with `summarizeStatuses`. It memoises per `result` object and per set of stale cells (a `WeakMap<PlanBindResult,
Map<string, PlanBindResult>>` keyed by the joined cell ids): two calls with the same stale set give the same object.
The precedence of today holds: a stale view replaces whatever view the bind left on the cell, as `status.state !==
'normal'` did; a cell that is not stale keeps the bind's view.

`useSampleStale.ts`. One clock:

```ts
/** The clock, read again after each deadline passes. `now > deadline` is the test every caller makes. */
export function useClock(deadlines: readonly number[]): number
export function useSampleStale(sampleAt?: number, freshness?: FreshnessPolicy): boolean  // = now > sampleAt + staleAfterMs
export function useStaleStatus(result: PlanBindResult): PlanBindResult  // = staleStatuses(result, useClock(result.deadlines))
```

`useClock` keeps `now` in state (`Date.now()` at mount). Its one effect takes the smallest deadline that is not yet
passed by `now` and sets one timer for `max(1, deadline - Date.now() + 1)` ms; the timer sets `now = Date.now()`, and
the effect runs again for the next deadline. No deadline left: no timer. A deadline that passed in real time while
`now` was not read (a result arrives with a sample that is already old) gets a 1 ms timer, so the correction is one
render, as the microtask of `usePreviewTime` was; a result whose deadlines are all in the future costs no render.
This is the timer of `useSampleStale` today, for a list. At most one timer per hook instance.

`useStaleStatus` is a `useMemo` over `(result, now)`. Because `staleStatuses` memoises per stale set, a tick that
crosses no deadline gives the same object; the effects that depend on the result do not run.

## 4. What changes on a time tick

| Output | On a tick that crosses a deadline | On a tick that crosses nothing | On a data change |
| --- | --- | --- | --- |
| `bound` (the bind) | same object | same object | new |
| `result` (after the pass) | new object; new patch objects for the stale cells only | same object | new (one bind, one pass) |
| `result.summaries` | new | same | new |
| `interactive`, `legendBlocks`, the applier, the overlay, the link labels | run once (their dependency is `result`) | do not run | run once |
| the link halves and the shape of a stale cell | the same `HalfState` and `ShapeState` objects | same | new |
| the popup list (`listInput.bound`) | does not change: it reads `bound`, the diagnostics hold no stale state | does not change | new |
| the card rows | their own `useSampleStale`, as today | | new |

The identity rule gives the label placement and step 5 (patch diffing) a stable base: a stale tick changes the
status of a cell and nothing of its geometry.

## 5. The hover card and the popup

The card. A `scalar`, `combined` or `history` row keeps `useSampleStale(row.sampleAt, row.freshness)` through the
shared clock; nothing changes for it. The status row of a card without hover rows reads `cardPatch =
result.patches.get(card.cellId)` after the pass, so its title turns `stale` at the same moment as the marker.
`buildConfiguredCard` runs again on that tick for the open card only (its input `cardPatch` is a new object), as
today.

The popup. `BindingEditor` binds with its own resolver (the report overlay over the owner frame) and applies the same
hook: `bound = useMemo(() => bindPlan(plan, resolve, bindContext))`, `result = useStaleStatus(bound)`. The stage and
the preview card take `result.patches`; the diagnostics list takes `bound` (section 4). The explicit preview snapshot
and the frame version leave the time path: a new result is a new `bound`, and its deadlines drive the clock.

The pause. While the popup is open the held frame keeps `bound` the same; the clock of the panel still ticks, the
pass gives a new result at the deadline, and the applier runs once (acceptance row "A status deadline during the pause
marks the status stale", unchanged).

## 6. Migration of each caller

| Caller | Today | After |
| --- | --- | --- |
| `status.ts` `evaluateStatus(rule, values, nowMs): StatusView` | the stale check inside | `evaluateStatus(rule, values): EvaluatedStatus`; the stale view and `after` in `stale` |
| `engine.ts` `bindPlan(plan, resolve, ctx, nowMs)` | `evaluateStatus(..., nowMs)` | `bindPlan(plan, resolve, ctx)`; `patch.staleStatus`; `result.deadlines`; new `staleStatuses(result, nowMs)` |
| `preview.ts` | `usePreviewTime`, `statusDeadlines` | deleted; the file keeps `QueryPreview`, `reportedSnapshot`, `createPreviewResolver` |
| `useSampleStale.ts` | one timer per sample | `useClock(deadlines)`, `useSampleStale` over it, `useStaleStatus(result)` |
| `DrawioMapPanel.tsx` | `deadlines`, `nowMs`, `bindPlan(..., nowMs)` in the `result` memo | `bound = useMemo(bindPlan(plan, resolve, bindingContext))`; `result = useStaleStatus(bound)`; the warnings memo over `bound.diagnostics`; everything else reads `result` as today |
| `BindingEditor.tsx` | `nowMs = usePreviewTime(data, generation, previewState?.snapshot, ownerFrame.version, statusDeadlines(plan, resolve))`; `bound` with `nowMs` | `bound` without time; `shown = useStaleStatus(bound)`; `cardPatch` and `DiagramStage` read `shown`; `listInput` and `metricDiagnostics` keep `bound` |
| `Card.tsx`, `BarGaugeView.tsx`, `SparklineView.tsx` | `useSampleStale` | unchanged call sites |

## 7. Test plan

Unit, `npm run test:affected` in the worktree; the full suite once on main before the push. Failing tests first.

- `src/binding/status.test.ts`: `evaluateStatus(rule, values)` returns `view` and `stale`; the gates still give
  `missing` with their reasons; without a policy `stale` is undefined; with two samples `after` is the oldest sample
  plus `staleAfterMs`; the stale view keeps the reason "Sample is stale (expected every N ms)" and its `conditionKey`.
- `src/binding/engine.test.ts`: `bindPlan` takes no time: the same inputs give the same `statusView` at any clock;
  `result.deadlines` lists the sorted unique `after` of the status cells and nothing for cells without a policy;
  `staleStatuses(result, after)` returns `result` itself; `staleStatuses(result, after + 1)` returns a new result in
  which the stale cell has a new patch with the stale view, the other patches are the same objects, and `summaries`
  has the stale row; a stale view replaces an earlier `missing` view of the same cell (the link coverage case); two
  calls with the same stale set give the same object; the existing case "compares sample age to configured cadence
  regardless of chart resolution" moves to `staleStatuses`.
- `src/visuals/useSampleStale.test.tsx` (new): the `usePreviewTime` deadline test moves here against `useClock`:
  the clock reads again after each deadline, holds at most one timer, releases it when the deadlines change or on
  unmount; a deadline that is already passed when it arrives gives one correction; `useSampleStale` through the clock
  keeps its cases in `Card.test.tsx`, `SparklineView.test.tsx` and `BarGaugeView` (unchanged).
- `src/editor/patternPreview.test.tsx`: the `usePreviewTime` block goes.
- `src/components/DrawioMapPanel.test.tsx`: the existing "lets a freshness deadline mark the status stale while
  paused, with one applier call" stays green; add "a data refresh with a fresh status sample binds once and renders
  once" (the `binds` counter of the test harness and `work.viewRenders`); the render-count bounds of the pause tests
  stay or go down.
- `src/editor/BindingEditor.test.tsx`: a status with a policy in the popup stage turns stale at its deadline
  (`data-dmap-status="stale"` on the popup cell) and the preview card's status row shows `stale`.

E2E, when the coordinator frees the shared dist: `tests/refresh.spec.ts` (keep the last render, the popup pause) and
`tests/status-band.spec.ts` (the band rows from the summaries); one spec at a time. No e2e spec asserts a stale
state; the unit tests cover the moments. On main, `npm run e2e:matrix` (the rendered panel changes).

Docs in the same diff: a row in the PoC spec "Superseded decisions" (the bind takes no time; the stale state is a
pass at render time), `docs/acceptance.md` (the measurement row of a data refresh: one bind, not two). The README
section "Demand, cache and sample freshness" describes behaviour that does not change; no option changes.

## 8. Open questions, with a recommendation each

1. The one render with the fresh view before the 1 ms correction, for a sample that arrives already stale.
   Recommendation: accept; it exists today through the microtask, and the applier works in the next animation frame,
   so the DOM gets the stale state only.
2. `staleStatuses` could sit in `status.ts` next to `evaluateStatus`. It reads `PlanBindResult`, a type of
   `engine.ts`, which imports `status.ts`. Recommendation: keep it in `engine.ts`, next to `bindPlan`, with no import
   cycle.
3. The widget regions (`ChartLayer`) pass `freshness` to `SparklineView`, which uses `useSampleStale`.
   Recommendation: no change; they are not part of the bind.

## 9. Review resolutions

(filled after the Codex review)
