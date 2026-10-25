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
5. The clock causes no bind. Today every data change, generation and frame version renders and binds a second time,
   because `usePreviewTime` reads the clock again in a microtask after each change. After this step the clock reads
   again only when a deadline passes, and a tick runs the pass, never the bind (section 3). The store's own frames (a
   generation change, the result that follows it) still render and bind as they do today (R1-3).

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
with `summarizeStatuses`. It keeps the latest pair per `result` object (a `WeakMap<PlanBindResult, { key: string;
result: PlanBindResult }>`, the key is the joined ids of the stale cells): two consecutive calls with the same stale
set give the same object, and a held `bound` retains one derived result, not one per set it passed through (R1-4).
The precedence of today holds: a stale view replaces whatever view the bind left on the cell, as `status.state !==
'normal'` did; a cell that is not stale keeps the bind's view.

`useSampleStale.ts`. One clock:

```ts
/** The clock, read again after each deadline passes. `now > deadline` is the test every caller makes. */
export function useClock(deadlines: readonly number[]): number;
export function useSampleStale(sampleAt?: number, freshness?: FreshnessPolicy): boolean; // = now > sampleAt + staleAfterMs
export function useStaleStatus(result: PlanBindResult): PlanBindResult; // = staleStatuses(result, useClock(result.deadlines))
```

`useClock` keeps the last read of the clock in state, as an object `{ now }` (`Date.now()` at mount; a new object per
read, so a read that gives the same millisecond still runs the effect, R2-1). Its one effect has the dependencies
`(key, clock)`, with `key` the joined deadlines. It reads the real clock and compares it with the stored read:

- a deadline between the two reads, `min(stored, real) <= at < max(stored, real)`: the stored read and the real
  clock disagree about that deadline. Either it passed while nobody read the clock (a result arrives with a sample
  that is already old) or the clock went backwards (R2-2). The effect sets the read to `Date.now()` in a microtask,
  with no timer (the lint rule `react-hooks/set-state-in-effect` forbids a synchronous set; `panel.tsx` and
  `store.ts` use the same microtask form). A microtask runs before the browser returns to its task queue, so the
  correction renders before the next animation frame; the applier and the band never paint the fresh view (R1-1).
- else, with `next` the smallest deadline that the real clock has not passed: one timer for
  `min(2147483647, next - real + 1)` ms (the cap of today's two clocks, R1-2); the timer stores a new read, and the
  effect runs again: the deadline passed, so `next` moves on; a capped wake-up before a far deadline finds the same
  `next` and sets the timer again.
- no deadline left: no timer.

A result whose deadlines are all in the future costs no render. This is the timer of `useSampleStale` today, for a
list. At most one timer per hook instance. A clock that goes backwards with no change of the deadlines and no timer
pending is seen at the next change of either; nothing else re-reads the clock.

`isPast(deadline, now)` in `status.ts` is the one test of a deadline against the clock (`now > deadline`);
`staleStatuses` and `useSampleStale` call it (R2-5).

`useStaleStatus` is a `useMemo` over `(result, now)`. Because `staleStatuses` memoises per stale set, a tick that
crosses no deadline gives the same object; the effects that depend on the result do not run.

## 4. What changes on a time tick

| Output                                                                   | On a tick that crosses a deadline                                      | On a tick that crosses nothing | On a data change         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------ | ------------------------ |
| `bound` (the bind)                                                       | same object                                                            | same object                    | new                      |
| `result` (after the pass)                                                | new object; new patch objects for the stale cells only                 | same object                    | new (one bind, one pass) |
| `result.summaries`                                                       | new                                                                    | same                           | new                      |
| `interactive`, `legendBlocks`, the applier, the overlay, the link labels | run once (their dependency is `result`)                                | do not run                     | run once                 |
| the link halves and the shape of a stale cell                            | the same `HalfState` and `ShapeState` objects                          | same                           | new                      |
| the popup list (`listInput.bound`)                                       | does not change: it reads `bound`, the diagnostics hold no stale state | does not change                | new                      |
| the card rows                                                            | their own `useSampleStale`, as today                                   |                                | new                      |

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

| Caller                                                        | Today                                                                                                                                        | After                                                                                                                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status.ts` `evaluateStatus(rule, values, nowMs): StatusView` | the stale check inside                                                                                                                       | `evaluateStatus(rule, values): EvaluatedStatus`; the stale view and `after` in `stale`                                                                                            |
| `engine.ts` `bindPlan(plan, resolve, ctx, nowMs)`             | `evaluateStatus(..., nowMs)`                                                                                                                 | `bindPlan(plan, resolve, ctx)`; `patch.staleStatus`; `result.deadlines`; new `staleStatuses(result, nowMs)`                                                                       |
| `preview.ts`                                                  | `usePreviewTime`, `statusDeadlines`                                                                                                          | deleted; the file keeps `QueryPreview`, `reportedSnapshot`, `createPreviewResolver`                                                                                               |
| `useSampleStale.ts`                                           | one timer per sample                                                                                                                         | `useClock(deadlines)`, `useSampleStale` over it, `useStaleStatus(result)`                                                                                                         |
| `DrawioMapPanel.tsx`                                          | `deadlines`, `nowMs`, `bindPlan(..., nowMs)` in the `result` memo                                                                            | `bound = useMemo(bindPlan(plan, resolve, bindingContext))`; `result = useStaleStatus(bound)`; the warnings memo over `bound.diagnostics`; everything else reads `result` as today |
| `BindingEditor.tsx`                                           | `nowMs = usePreviewTime(data, generation, previewState?.snapshot, ownerFrame.version, statusDeadlines(plan, resolve))`; `bound` with `nowMs` | `bound` without time; `shown = useStaleStatus(bound)`; `cardPatch` and `DiagramStage` read `shown`; `listInput` and `metricDiagnostics` keep `bound`                              |
| `Card.tsx`, `BarGaugeView.tsx`, `SparklineView.tsx`           | `useSampleStale`                                                                                                                             | unchanged call sites                                                                                                                                                              |

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
  regardless of chart resolution" becomes "binds without time" (its loop over `intervalMs` goes: `BindContext` has no
  resolution, the old test spread an unknown property; the cache age of the fixture still plays no part).
- `src/visuals/useSampleStale.test.tsx` (new): the `usePreviewTime` deadline test moves here against `useClock`:
  the clock reads again after each deadline, holds at most one timer, releases it when the deadlines change or on
  unmount; a deadline that is already passed when it arrives is corrected in a microtask, with no timer
  (`vi.getTimerCount()` is 0 after the flush, and the value is already past the deadline); a deadline more
  than 2147483647 ms away sets a capped timer and the capped wake-up sets it again (R1-2); `useSampleStale` through
  the clock keeps its cases in `Card.test.tsx`, `SparklineView.test.tsx` and `BarGaugeView` (unchanged).
- `src/editor/patternPreview.test.tsx`: the `usePreviewTime` block goes.
- `src/components/DrawioMapPanel.test.tsx`: the existing "lets a freshness deadline mark the status stale while
  paused, with one applier call" stays green; add "a panel-source data update with a fresh status sample binds once"
  (a stable context, no store frame: the `binds` counter of the harness grows by one, where today it grows by two,
  R1-3); add "a status sample that is already stale on arrival shows stale in the first applier call" (the band and
  `data-dmap-status` after one animation frame, R1-1); the render-count bounds of the pause tests stay or go down.
- `src/editor/BindingEditor.test.tsx`: a status with a policy in the popup stage turns stale at its deadline
  (`data-dmap-status="stale"` and the reason on the popup cell), with no new data. The preview card's status row
  reads the same `cardPatch`, so it needs no test of its own.

E2E, when the coordinator frees the shared dist: `tests/refresh.spec.ts` (keep the last render, the popup pause) and
`tests/status-band.spec.ts` (the band rows from the summaries); one spec at a time. No e2e spec asserts a stale
state; the unit tests cover the moments. On main, `npm run e2e:matrix` (the rendered panel changes).

Docs in the same diff: a row in the PoC spec "Superseded decisions" (the bind takes no time; the stale state is a
pass at render time), `docs/acceptance.md` (the measurement row of a data refresh: one bind, not two). The README
section "Demand, cache and sample freshness" describes behaviour that does not change; no option changes.

## 8. Open questions, with a recommendation each

1. (closed by R1-1) A sample that arrives already stale is corrected in the effect flush of the render that shows
   it, before the next animation frame; no timer and no microtask.
2. `staleStatuses` could sit in `status.ts` next to `evaluateStatus`. It reads `PlanBindResult`, a type of
   `engine.ts`, which imports `status.ts`. Recommendation: keep it in `engine.ts`, next to `bindPlan`, with no import
   cycle.
3. The widget regions (`ChartLayer`) pass `freshness` to `SparklineView`, which uses `useSampleStale`.
   Recommendation: no change; they are not part of the bind.

## 9. Review resolutions

Review 1 (Codex, 2026-10-25). No finding on the stale-over-missing precedence, the strict `>` boundary, the `+1`,
the pause, the mount-time clock, the migration table or the coding standards.

| Concern                                                                                                                                                                              | Resolution                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-1 (P1). A sample already stale on arrival got a 1 ms timer; the applier's animation frame and the band could paint the fresh view first, where today's microtask had corrected it | The effect sets `now` in a microtask, with no timer, when `Date.now()` is past the next deadline (a synchronous set is a lint error); the microtask runs before the next animation frame (section 3; test "already passed when it arrives"; the panel test "already stale on arrival"). |
| R1-2 (P2). The clock dropped the `2147483647` cap of both clocks of today; a policy has no upper bound                                                                               | The cap is in the formula; a capped wake-up finds the same `next` and sets the timer again (section 3; test "a deadline more than 2147483647 ms away").                                                                                                                                 |
| R1-3 (P2). "One bind per data change" is not a general guarantee: a generation change and its result are frames of the store                                                         | Restated as "the clock causes no bind"; the exact-count test is scoped to a panel-source update with a stable context (sections 1 and 7).                                                                                                                                               |
| R1-4 (P2). The memo kept one derived result per stale set a held `bound` passed through, quadratic in the cells                                                                      | The memo keeps the latest pair per `bound`; identity is for consecutive calls with the same set (section 3).                                                                                                                                                                            |

Review 2 (Codex, 2026-10-25, the diff of `be066ca`). No finding on the strict boundary, the precedence, the result identity, patch mutation, the summaries, the caller dependencies, the pause and remount wiring, the card, the legend, the band, or privacy.

| Concern                                                                                                                                                                                   | Resolution                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-1 (P1). A timer that fired after a backward clock adjustment read the stored millisecond again; React skipped the equal state and no timer was armed again, so the cell stayed healthy | The read is an object `{ now }`, new per read: the effect runs after every read and arms the next timer (section 3; test "arms the next timer also when a read gives the stored millisecond again").                                                                                                                    |
| R2-2 (P1). With the stored read ahead of a clock that went backwards, the render-time filter discarded a new deadline below the stored read and the cell showed stale                     | The render filters nothing. The effect compares the stored read with the real clock and corrects when a deadline lies between them, in either direction (section 3; test "follows a clock that went backwards").                                                                                                        |
| R2-3 (P2). The panel test "already stale on arrival" used a sample ten seconds old, stale against the mount read already, so it did not exercise the correction                           | The first sample is far in the future (no deadline moves the read); 450 ms later a sample arrives whose deadline lies between the mount read and now (section 7).                                                                                                                                                       |
| R2-4 (P2). The 400 ms policies of the integration tests race a slow first render; the re-check: a 1500 ms policy still races a mount slower than 1500 ms                                  | The popup test mounts with a sample far in the future (the fresh state cannot be missed), then gives the editor a sample of now through `rerenderWith` and waits for the stale state (1500 ms policy, 4000 ms wait). The "binds once" test does not depend on the window; the pre-existing pause test keeps its 400 ms. |
| R2-5 (P2). `now > after` was written in three places                                                                                                                                      | `isPast(deadline, now)` in `status.ts`; `staleStatuses` and `useSampleStale` call it (section 3).                                                                                                                                                                                                                       |
