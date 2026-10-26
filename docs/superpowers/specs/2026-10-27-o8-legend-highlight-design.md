# O8: the legend highlight does not render the panel

- Status: draft 2026-10-27.
- Scope: `src/components/DrawioMapPanel.tsx` (the legend state and the highlight effect), a new
  `src/legend/highlightStore.ts`, their tests, a new bench `scripts/bench/legend-hover.mjs`, `docs/acceptance.md`.
- Reads: the simplify plan (O8), the consumer team's measurement on a dense sheet of about 300 cells, the step 5 spec
  (`2026-10-26-simplify-step5-patch-diff-design.md`, the frame order of the apply pass), `CODING_STANDARDS.md`.
- Out of scope: the legend model (`buildLegend`), the CSS of the dim, `highlightCells`, the binding editor highlight
  (`BindingsList`, `DiagramStage`: the popup has its own stage and its own state), the own render of the `Legend`
  component (its `active` state stays).

## 1. Goals

1. A pointer or a focus on a legend entry, a tap on an entry, and the same on a linked legend row of the diagram
   (`bindSymbolLegend`), change the classes of the cells and nothing else. The panel view (`DrawioMapPanelView`) does
   not render, so the status band, the chart layer, the card and the corner buttons do not render, and no effect of
   the view runs again.
2. The visible result and the behaviour do not change: the same classes on the same elements, in the same frame
   (one animation frame after the event), the same keyboard, pointer and touch rules, the same pinned card and hover
   card, the same `aria-label` and tab stops. Opening the bindings popup ends the highlight, as now.

## 2. Today: the flow

1. `Legend` keeps the active entry in its state (`active`). A pointer enter, a focus or a tap sets it. The component
   renders, and its effect calls `onHighlight(activeIds)`.
2. `onHighlight` is `setLegendHits`, a state of `DrawioMapPanelView` (`DrawioMapPanel.tsx:439`). The rows of the
   diagram call `setRowMarks`, a second state of the view (`:445`, through `bindSymbolLegend` at `:557`).
3. The new state renders the whole view: all hooks run again (16 `useMemo`, two `useBindings`,
   `useStaleStatus`, `usePanZoom`, eight `useHeld`), the `opts` object is built again, and every child renders:
   `StatusBand`, `ChartLayer` and its regions, `Legend` a second time (it is not memoised), the open
   `Card` (its layout effect has no dependencies, so it reads `getBoundingClientRect` and places the card again), the
   corner buttons.
4. Only one effect has a changed dependency: the highlight effect (`:542-553`). It calls `highlightCells` in the
   next animation frame. The apply pass does not run again (its dependencies do not change).

Browser bench `scripts/bench/legend-hover.mjs` (Chromium, demo dashboard on 13.2, 1600x1000, first panel, 9 legend
entries and 2 diagram rows, 3 rounds, 300 ms gap; the shared dist of 2026-10-27 00:06, a build of main or of a branch
with the same panel code):

| Per hover                                           | Entry of the panel legend (27 hovers) | Row of the diagram (6 hovers) |
| --------------------------------------------------- | ------------------------------------- | ----------------------------- |
| React commits                                       | 2 (the legend, then the view)         | 1 (the view)                  |
| renders of the view, over all hovers                | 30                                    | 6                             |
| renders of the status band / the legend, all hovers | 29 / 56                               | 6 / 6                         |
| pointer event to the class change of the root       | median 17.3 ms, p90 22.0 ms           | median 12.0 ms, p90 19.5 ms   |
| main-thread task time in the 300 ms window          | median 8.9 ms, p90 18.0 ms            | median 6.7 ms, p90 8.8 ms     |

The demo has 118 cells. The consumer team's sheet has about 300 cells and more patterns, so each view render costs
more there (more memo checks, more chart regions, a bigger card).

## 3. The new flow

### 3.1 The store

`src/legend/highlightStore.ts`, one store per panel view (`useState(createHighlightStore)`):

```ts
export interface HighlightState {
  /** The cells of the active entry of the panel legend; null: no entry. */
  legend: string[] | null;
  /** The marks of the active row of the diagram; null: no row. */
  rows: RowMarks | null;
}
export interface HighlightStore {
  get(): HighlightState;
  setLegend(ids: string[] | null): void;
  setRows(marks: RowMarks | null): void;
  /** Both to null. */
  clear(): void;
  /** Calls `listener` after each change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}
```

A set with the same value (identity) does not call the listeners. `get` returns the same object until a change, so
the store also works with `useSyncExternalStore` if a later change needs it.

### 3.2 The writers

- `Legend` gets `onHighlight={store.setLegend}`. Its interface does not change.
- `bindSymbolLegend(root, index, store.setRows)`.
- Opening the popup: an effect `if (paused) store.clear()`. Today a state adjustment in the render does the same
  (`setLegendHits(null)` and `setRowMarks(null)`). The `Legend` keeps its `active` state in both cases, as today.

### 3.3 The reader: one effect, no state

The highlight effect of the view subscribes to the store. It runs on the same inputs as today, without the two states:
`stage.root`, `stage.index`, `legendMembers`, `legendBlocks.length > 0` and `result`. On each run and on each change
of the store it calls `highlightCells` in the next animation frame, with the rule of today: the rows of the diagram
come before the panel legend; the panel legend with no blocks shows nothing. A new frame cancels a frame that did not
run yet, and the cleanup cancels it too.

```ts
useEffect(() => {
  if (!stage.root) return;
  const root = stage.root;
  let frame: number | undefined;
  const paint = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const { legend, rows } = highlight.get();
      rows
        ? highlightCells(root, stage.index, rows.members, rows.hits)
        : highlightCells(root, stage.index, legendMembers, hasBlocks ? legend : null);
    });
  };
  paint();
  const unsubscribe = highlight.subscribe(paint);
  return () => {
    unsubscribe();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}, [stage.root, stage.index, legendMembers, hasBlocks, result, highlight]);
```

The effect stays in the view, after the apply effect, so in a commit that runs both, the highlight frame comes after
the apply frame, as today. The other design (a leaf component that reads the store with `useSyncExternalStore`) was
not taken: a child effect runs before the effects of its parent, so the leaf would queue its frame before the apply
frame; and each hover would still make one commit of the leaf.

One order case: in a refresh commit, the `Legend` effect (a child) can write a new id list before the view effect
runs again. The old subscription then queues a frame with the old members; the cleanup of the view effect cancels it,
and the new run paints with the new members.

### 3.4 What renders and what runs per hover

| Hover on               | Before                                                              | After                                        |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| an entry of the legend | `Legend` twice, the view and all its children once, one view effect | `Legend` once; one frame of `highlightCells` |
| a row of the diagram   | the view and all its children once, one view effect                 | no render; one frame of `highlightCells`     |

## 4. Tests

Unit, written first (they fail on main):

- `highlightStore.test.ts`: `get` after each set; a listener gets one call per change and none for the same value;
  `clear` sets both to null with one call; unsubscribe stops the calls.
- `DrawioMapPanel.test.tsx`, "colour legend": a pointer enter and a pointer leave on an entry, and a focus and a blur,
  give the same classes as today and render the view zero times (the counter `work.viewRenders`), with no applier
  call.
- "legend rows of the diagram": a row hover gives the same classes and renders the view zero times.
- A pinned card stays pinned and open during a legend hover (and the view does not render).
- "bindings popup": opening the popup during a legend hover ends the highlight (a characterisation test: it passes
  before and after).

The `Legend.test.tsx` and `symbolRows.test.ts` tests do not change: the interfaces stay.

E2E on 13.2, one spec at a time: `legend`, `hover-kinds`, `card-tooltip`, `visual-regions`. Bench
`scripts/bench/legend-hover.mjs` before and after, in `docs/acceptance.md`.
