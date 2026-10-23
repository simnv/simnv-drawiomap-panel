# Bindings popup, phase 3: multi-select, pattern from selection, bulk edit, pause behind

> **For agentic workers:** use superpowers:executing-plans. Work task by task. Run the named tests after each task.
> Commit after each task with a message that names the task. Omit all `Co-Authored-By` trailers.

**Spec:** `docs/superpowers/specs/2026-10-23-bindings-popup-design.md`, sections 4.4, 5 and the P3 part of 6, plus the
open questions Q5 and Q6. Phases 1 and 2 are merged.

**Goal:** the user selects several cells on the centre stage, creates a pattern from the selection with a proposed
selector, or edits the selected cells at once. The panel behind the popup does no per-refresh work while the popup is
open and renders once on close.

**Branch:** `feat/bindings-popup-p3` from `main`.

## Constraints

- The decisions of the spec are fixed. Q5 uses Shift+drag for the box select unless the user says otherwise.
- Keep every label and test id of phases 1 and 2.
- Attach screenshots: a box selection with extras and missed cells marked, and the bulk pane with a mixed field.

## Tasks

### Task 1: useHeld and the paused consumers

- [ ] `src/components/useHeld.ts`: `useHeld<T>(value: T, hold: boolean): T`. State adjustment during render: when
      `hold` is false and the held value differs, set it; return the held value.
- [ ] `src/visuals/useBindingSnapshots.ts`: parameter `paused = false`; return `useHeld(snapshots, paused)`. The
      subscriptions do not change.
- [ ] `src/visuals/ChartLayer.tsx`: prop `paused?: boolean`; in `Widget`, `const shown = useHeld(response, paused)` is
      what renders and what `onPrepared` publishes; no publish while paused.
- [ ] Tests: `useHeld.test.ts`; `useBindingSnapshots.test.tsx` (a controller emission while paused does not change the
      result; after unpause the next render has it); `ChartLayer.test.tsx` (same for a widget).
- Done: tests pass.

### Task 2: pause the panel behind

- [ ] `src/components/DrawioMapPanel.tsx`: `DrawioMapPanelView` gets `paused: boolean`. At its top:
      `const live = { ...props, service: useContext(PanelQueryContext) }; const held = useHeld(live, paused)` and the
      body reads from `held` only. Pass `paused` to `useBindingSnapshots` and `ChartLayer`. The popup itself keeps the
      live props (it is rendered by the outer `DrawioMapPanel`).
- [ ] Opening the popup closes the card and the legend highlight; the Esc handler of the panel stays.
- [ ] Tests in `DrawioMapPanel.test.tsx`: with the popup open, three `rerender` with new data and a controller
      emission leave `data-dmap-patched`, the fill of a patched link half and the `applyPatches` spy count unchanged;
      after close one render shows the new data. Apply while open does not change the panel until close.
- [ ] e2e: `tests/refresh.spec.ts` gets a case "popup open": set a 5 s refresh, open the popup, wait for three
      refresh requests, compare the `style` attribute snapshot of the link halves of `dmap-panel` before and after;
      close; the halves update.
- Done: tests pass on both versions.

### Task 3: multi-select on the stage

- [ ] `BindingEditor`: selection becomes `selected: string[]` (primary = last; `draft.cellId` = primary through
      `select`). Shift-click toggles a cell; a plain click replaces the selection. `DiagramStage` marks every selected
      cell with `data-dmap-selected="true"` and the primary with `data-dmap-primary="true"`.
- [ ] `DiagramStage`: Shift+pointerdown on the stage starts a rubber band (`<div data-testid="dmap-box-select">`
      absolutely positioned in the stage container); `usePanZoom.ignore` returns true while the band is active; on
      pointerup the cells whose group `getBoundingClientRect` intersects the band become the selection (Shift keeps the
      earlier ones). Touch pointers are ignored.
- [ ] The inspector heading reads "N elements" for two or more cells. `BindingInspector` and the single-cell sections
      render only for one cell.
- [ ] Tests `DiagramStage.test.tsx`: shift-click toggles; box select with mocked rects; plain click replaces.
- Done: tests pass.

### Task 4: proposeSelector and "Create pattern from selection"

- [ ] `src/editor/proposeSelector.ts`: `proposeSelector(selected: CellMeta[], all: CellMeta[]): Proposal[]` where
      `Proposal = { select: CellSelector; extra: string[]; missed: string[]; score: number }`, sorted best first.
      Candidates: (1) `{ kind, attrs }` with every attribute whose value is equal across the selection, except `pg-id`,
      `id`, `label` and `pg-schema`; drop attributes one by one from the least selective while the result keeps zero
      missed and the extras do not grow; (2) `{ kind, label: '/^<escaped common prefix>/' }` when the common prefix of
      `labelText` has three or more characters; (3) `{ ids }` of the selection (zero extra, zero missed, lowest
      priority). Score: missed count x 1000 + extra count; ties keep the candidate order. Use `cellMatches` to compute
      extras and missed.
- [ ] `src/editor/popup/PatternFromSelection.tsx`: a section in the inspector for two or more selected cells. Shows the
      best proposal in the pattern selector fields of `BindingInspector` (kind, ids, attrs as "key=value" rows, label
      regex), the counts "matches N, extra M, missed K", the other proposals as a `RadioButtonGroup`, and "Create
      pattern". Edits re-evaluate with `cellMatches`. While the section is open, `DiagramStage` marks extras with
      `data-dmap-extra="true"` and missed cells with `data-dmap-missed="true"` (dashed and dotted outlines in two
      theme colours).
- [ ] "Create pattern" dispatches `{ type: 'pattern', pattern: { id, name: 'Pattern N', select, display: {} } }` and
      `{ type: 'scope', scope: 'pattern', patternId: id }`, then selects the first matched cell. One history step: add
      a composite action `{ type: 'batch'; actions: DraftAction[] }` to `reduceDraft` and treat it as one step in
      `reduceHistory`.
- [ ] Tests `proposeSelector.test.ts` with the demo metas (`fixtures/demo`): two routers → `pg-kind` attrs with the
      other routers as extras; three cells with nothing in common → ids; a label prefix case; the escaping of regex
      characters. `PatternFromSelection.test.tsx`: the marks and the create flow.
- Done: tests pass.

### Task 5: bulk edit

- [ ] `src/editor/draft.ts`: action `{ type: 'display-many'; cellIds: string[]; display: Partial<DisplayConfig> }`
      writes `changeDisplay` into the override of each cell (creating overrides as needed). `reduceHistory` treats it
      as one step.
- [ ] `src/editor/popup/BulkPane.tsx`: for two or more cells. `commonDisplay(cellIds, plan)` returns the display with
      the paths equal across the effective displays of all cells, and `mixedPaths: string[]`. Renders `DisplayFields`
      with `value = common` and a note "Mixed values: <paths>" (`aria-label="Mixed values"`); a field with a mixed path
      shows the chip "Mixed" through `sourceOf`. A change dispatches `display-many` with the patch. "Remove overrides
      of the selection" dispatches a `batch` of `remove-override`.
- [ ] Tests `BulkPane.test.tsx` and `draft.test.ts` (`display-many`, `batch`).
- Done: tests pass.

### Task 6: e2e and docs

- [ ] `tests/bindings-popup-selection.spec.ts`: shift-click three cells, set "Label template", Apply, reopen, the
      Overrides group has three more rows; one undo removes the three; Shift+drag over two routers of the demo diagram
      proposes `pg-kind` with extras marked; editing the selector to `ids` clears the extras; Create adds a pattern row.
- [ ] README: "Select several elements", "Create a pattern from a selection", "Bulk edit", "The panel while the popup
      is open". `docs/acceptance.md` rows for P3.
- Done: `npm run e2e:matrix` passes; the screenshots are attached.

## Done criteria of the phase

- All P3 acceptance items of spec section 6 hold, with evidence in `docs/acceptance.md`.
- Q5 and Q6 have a line in the spec section 9 with the chosen answer.
