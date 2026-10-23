# Bindings popup, phase 3: multi-select, pattern from selection, bulk edit, pause behind

> **For agentic workers:** use superpowers:executing-plans. Work task by task. Run the named tests after each task.
> Commit after each task with a message that names the task. Omit all `Co-Authored-By` trailers.

**Spec:** `docs/superpowers/specs/2026-10-23-bindings-popup-design.md`, sections 4.4, 4.7, 5, the P3 part of 6,
section 9 (Q5, Q6, Q8) and section 11. Phases 1 and 2 are merged.

**Goal:** the user selects several cells on the centre stage, creates a pattern from the selection with a proposed
selector, or edits the selected cells at once without touching their other settings. The panel behind the popup does
no per-refresh work while the popup is open and renders once on close.

**Branch:** `feat/bindings-popup-p3` from `main`.

## Constraints

- The decisions of the spec are fixed. Q5 uses Shift+drag for the box select.
- Keep every label and test id of phases 1 and 2.
- Attach screenshots: a box selection with extras and missed cells marked, and the bulk pane with a mixed field.

## Tasks

### Task 1: useHeld and the paused consumers

- [ ] `src/components/useHeld.ts`: `useHeld<T>(value: T, hold: boolean): T` ref-based: `const ref = useRef(value); if (!hold) { ref.current = value; } return ref.current;`.
      No state write during render. Test: a new object on every render with `hold` false does not loop (render count
      equals the rerender count); with `hold` true the first value stays; after `hold` turns false the next render
      returns the live value.
- [ ] `useBindingSnapshots(..., owner, paused = false)`: returns `useHeld(snapshots, paused)`; subscriptions unchanged.
- [ ] `ChartLayer paused?: boolean`: in `Widget`, `const shown = useHeld(response, paused)` renders and publishes; no
      `onPrepared` call while paused.
- [ ] Tests: `useBindingSnapshots.test.tsx` (a controller emission while paused does not change the result; after
      unpause the next render has it; a result whose demand key changed during the pause is dropped on resume);
      `ChartLayer.test.tsx` (same for a widget).
- Done: tests pass.

### Task 2: pause the panel behind

- [ ] `DrawioMapPanelView` gets `paused: boolean`. Hold each input separately at the top: `data`, `timeRange`,
      `timeZone`, `options`, `fieldConfig`, `width`, `height`, `replaceVariables` and the `PanelQueryService` object
      from `useContext` (`const service = useHeld(useContext(PanelQueryContext), paused)`). Never build a new object to
      hold. The body reads the held values only. Pass `paused` to `useBindingSnapshots` and `ChartLayer`.
      `usePreviewTime` and `useSampleStale` keep running (spec 4.4): a deadline re-runs `bindPlan` once on held data.
- [ ] Opening the popup closes the card and the legend highlight.
- [ ] Tests in `DrawioMapPanel.test.tsx`: with the popup open, three `rerender` with new data and a controller
      emission leave `data-dmap-patched`, the fill of a patched link half and the `applyPatches` spy count unchanged,
      and the render count of the view is bounded (no loop); a status deadline during the pause changes the status to
      stale (one applier call); after close one render shows the new data; Apply while open does not change the panel
      until close; a close while a popup preview is loading leaves the panel consumers attached (count watches per
      owner on the fake controller).
- [ ] e2e: `tests/refresh.spec.ts` case "popup open": 5 s refresh, open the popup, wait for three refresh requests,
      compare the `style` snapshot of the link halves of `dmap-panel` before and after; close; the halves update.
- Done: tests pass on both versions.

### Task 3: multi-select on the stage

- [ ] `BindingEditor`: `selected: string[]` (primary = last; `draft.cellId` = primary). Shift-click toggles; a plain
      click replaces. `DiagramStage` marks every selected cell `data-dmap-selected="true"` and the primary
      `data-dmap-primary="true"`.
- [ ] `DiagramStage` box select (spec 6 P3, Q5): Shift+`pointerdown` with `pointerType` mouse or pen on the stage calls
      `setPointerCapture`; a `<div data-testid="dmap-box-select">` follows `pointermove`; `pointerup` and
      `pointercancel` end the band (capture delivers them when the pointer is outside the stage; the band is clipped to
      the stage rect); Esc during the band cancels it (selects nothing); a flag suppresses the next `click`;
      `usePanZoom.ignore` returns true while the band is active; touch pointers are ignored. Cells whose group
      `getBoundingClientRect` intersects the band become the selection (Shift keeps the earlier ones).
- [ ] The inspector heading reads "N elements" for two or more cells; the single-cell sections render for one cell.
- [ ] Tests `DiagramStage.test.tsx`: shift-click toggles; plain click replaces; box select with mocked rects; capture
      requested; release outside the stage clips; Esc cancels; the click after a band is suppressed.
- Done: tests pass.

### Task 4: proposeSelector and "Create pattern from selection"

- [ ] `src/editor/proposeSelector.ts`: `proposeSelector(selected: CellMeta[], all: CellMeta[]): Proposal[]` with
      `Proposal = { select: CellSelector; extra: string[]; missed: string[]; kind: 'attrs' | 'label' | 'ids' }`.
      Candidates: (1) `{ kind, attrs }` with every attribute equal across the selection except `pg-id`, `id`, `label`,
      `pg-schema`; drop attributes one by one from the least selective while missed stays zero and extras do not grow;
      (2) `{ kind, label: '/^<escaped common prefix>/' }` when the common prefix of `labelText` has three or more
      characters; (3) `{ ids }`. Ranking: drop candidates with missed cells; sort `attrs` and `label` together by extras (fewest first), attrs before label on
      a tie; `ids` is always last. Use `cellMatches`.
- [ ] `src/editor/popup/PatternFromSelection.tsx`: for two or more selected cells: the best proposal in the pattern
      selector fields (kind, ids, attrs as "key=value" rows, label regex), the counts "matches N, extra M, missed K",
      the other proposals as a `RadioButtonGroup`, "Create pattern". Edits re-evaluate with `cellMatches`. While open,
      `DiagramStage` marks extras `data-dmap-extra="true"` and missed cells `data-dmap-missed="true"`.
- [ ] "Create pattern" dispatches one `{ type: 'batch'; actions }` (`pattern`, `scope`, `select` of the first match);
      `reduceDraft` applies the actions in order; `reduceHistory` treats a batch as one step.
- [ ] Tests `proposeSelector.test.ts` with the demo metas: two routers → `attrs { 'pg-kind': 'router' }` first with the
      other routers as extras and `ids` last; three cells with nothing in common → `ids`; a label prefix case; regex
      escaping; a candidate with missed cells is dropped. `PatternFromSelection.test.tsx`: marks and the create flow.
- Done: tests pass.

### Task 5: bulk edit with leaf operations

- [ ] `src/editor/leafPaths.ts` (from phase 2): add `diffLeaves(before, after): Array<{ path; value }>` and
      `setLeaf(display, path, value)` / `getLeaf(display, path)`.
- [ ] `src/editor/draft.ts`: action `{ type: 'display-many'; cellIds: string[]; ops: Array<{ path: string; value: unknown }> }`
      sets each leaf in the override of each cell (creating overrides as needed) and touches nothing else. `batch` as
      in Task 4. Tests: inherited and unrelated fields survive; hover rows of each cell stay; an override is created only
      with the set leaves.
- [ ] `src/editor/popup/BulkPane.tsx`: `commonLeaves(cellIds, plan)` returns `{ common: Partial<DisplayConfig>; mixedPaths: string[] }` over the effective displays; `hover.rows`, every array, `status` and every metric binding (`shape.binding`, `link.*Binding`) count as one
      unit leaf each and are common only when deep-equal across all cells; a mixed binding shows the chip and mounts no
      `BindingFields`; a mixed field has a Clear button (remove op for each selected override). Renders `DisplayFields` with `value = common`; `sourceOf` returns
      the chip "Mixed" for mixed paths; the hover and status sections show "Mixed, edit per element" when their arrays
      are mixed and render no rows. A change becomes `diffLeaves(common, next)` → `display-many`. "Remove overrides of
      the selection" dispatches a `batch` of `remove-override`.
- [ ] Tests `BulkPane.test.tsx`: a label change writes one leaf to three cells; mixed arrays show the note and are not
      written; `draft.test.ts` for `display-many` and `batch`.
- Done: tests pass.

### Task 6: e2e and docs

- [ ] `tests/bindings-popup-selection.spec.ts`: shift-click three cells, set "Label template", one undo removes the
      three overrides, redo restores them, Apply, reopen, the Overrides group has three more rows and the hover rows of
      a cell are unchanged; Shift+drag over two routers proposes `pg-kind` first with extras marked and `ids` last;
      editing the selector to `ids` clears the extras; Create adds a pattern row; a band released outside the stage
      selects the clipped cells; Esc during a band selects nothing.
- [ ] README: "Select several elements", "Create a pattern from a selection", "Bulk edit", "The panel while the popup
      is open" (replaces the P1 interim sentence). `docs/acceptance.md` rows for P3.
- Done: `npm run e2e:matrix` passes; the screenshots are attached.

## Done criteria of the phase

- All P3 acceptance items of spec section 6 hold, with evidence in `docs/acceptance.md`.
