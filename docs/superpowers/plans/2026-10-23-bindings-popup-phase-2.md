# Bindings popup, phase 2: live card, field sources, undo/redo, narrow layout

> **For agentic workers:** use superpowers:executing-plans. Work task by task. Run the named tests after each task.
> Commit after each task with a message that names the task. Omit all `Co-Authored-By` trailers.

**Spec:** `docs/superpowers/specs/2026-10-23-bindings-popup-design.md`, sections 4.3, 4.5, 4.7, 5, the P2 part of 6,
section 9 (Q1, Q2, Q3) and section 11. Phase 1 is merged. Read the phase 1 plan to know the files.

**Goal:** the inspector shows the live hover card of the selected cell and the source of each field with a reset
action; the draft has undo and redo; the popup works below 1000 px as tabs; the query pane has a result table, a
"Used by" list and deletion.

**Branch:** `feat/bindings-popup-p2` from `main`.

## Constraints

- The decisions of the spec are fixed. Q1 and Q2 use the answers of spec section 9.
- Keep every label and test id of phase 1.
- Attach screenshots: the inspector with the card preview and sources at 1440x900, and the tab mode at 900x700.
- P2 does not pause the panel behind (spec 4.4, P3).

## Tasks

### Task 1: history reducer

- [ ] `src/editor/history.ts`: `interface HistoryState { past: BindingDraft[]; present: BindingDraft; future: BindingDraft[]; session?: { path: string; owner: string; at: number } }`;
      `createHistory(draft, { coalesceMs = 800 } = {})`; `reduceHistory(state, action: DraftAction | { type: 'undo' } | { type: 'redo' }, now = Date.now())`.
  - A step is an action whose result changes `present.config` or `present.diagram` (reference compare after
    `reduceDraft`). `select` and `scope` update `present` without a step.
  - Coalescing (Q1): a `display` action coalesces with the previous step only when `leafPaths(action.display)` has
    exactly one path, that path equals `session.path`, the owner (`override:<cellId>` or `pattern:<index>`) equals
    `session.owner`, and `now - session.at <= coalesceMs`. Then `present` is replaced and `past` does not grow.
    `select`, `scope`, `undo`, `redo`, `applied`, `reset`, `diagram` and any other action end the session. `coalesceMs: 0` disables coalescing.
  - `applied` and `reset` clear `past` and `future`. `undo` and `redo` keep `cellId`, `scope`, `patternId` when the
    target still exists; else they clear the scope.
  - Caps: `past` holds at most 200 entries; at most 5 distinct `diagram` objects live in `past` and `future` together
    (drop the oldest past entries that hold a sixth revision).
- [ ] `src/editor/leafPaths.ts`: `leafPaths(partial: Partial<DisplayConfig>): string[]` (dotted paths with `[i]`
      indexes; an array value is one leaf at the array path). Shared with phase 3 (`diffLeaves`).
- [ ] `BindingEditor` uses `useReducer(reduceHistory, ...)`; `draft = history.present`; `canUndo`, `canRedo`.
- [ ] Tests `history.test.ts`: ten edits, ten undos, redo; a selection is not a step; "abc" in one field is one step;
      two fields are two steps; a selection between keystrokes splits; owner change splits; coalescing off; `applied`
      clears; a `diagram` action is one step; the caps of 200 steps and 5 diagram revisions. `leafPaths.test.ts`.
- Done: tests pass; the phase 1 editor tests pass.

### Task 2: undo/redo controls

- [ ] `BindingsPopup` header: `Button icon="arrow-left" fill="text"` "Undo" and `Button icon="arrow-right" fill="text"`
      "Redo", disabled at the ends, with `aria-keyshortcuts` `Control+Z` and `Control+Shift+Z`.
- [ ] Extend `useEscOwner` into `usePopupKeys`: both layers of spec 4.3 handle Cmd/Ctrl+Z → undo, Shift+Cmd/Ctrl+Z and
      Ctrl+Y → redo. Skip when the target is `input`, `textarea`, `[contenteditable]` or inside `.monaco-editor` (Q2),
      inside another `[role="dialog"]`, or when the popup is not the top overlay.
- [ ] Tests `BindingsPopup.test.tsx`: keys; the text input, Monaco root and nested dialog exceptions; disabled buttons;
      history cleared by Apply.
- Done: tests pass.

### Task 3: inline Card and CardPreview

- [ ] `src/interact/Card.tsx`: prop `variant?: 'floating' | 'inline'` (default floating). Inline: `position: static`,
      no close button, `width: 100%`, the sheet logic off. No other change.
- [ ] `src/editor/popup/CardPreview.tsx`: props `patch?`, `resolve`, `cardContext`, `timeRange`, `timeZone`, `width`.
      Builds `buildConfiguredCard(patch, resolve, cardContext)` in `useMemo`; renders `<Card variant="inline" ... />`
      in `<section aria-label="Hover card preview">`; without rows and links "No card for this element".
- [ ] `BindingEditor`: `cardContext = cardContextFor(...)` once per data; the card uses the live `resolve` (it includes
      the popup `useBindingSnapshots` results, hover demand of `draft.cellId`, through the draft query service).
      `InspectorPane` renders `CardPreview` first for a `cell` selection.
- [ ] Tests `CardPreview.test.tsx`: rows from panel data; a data update changes the rows; empty state. `Card.test.tsx`:
      the inline variant.
- Done: tests pass; a screenshot shows the card preview above the sections.

### Task 4: field sources and reset

- [ ] `src/editor/fieldSource.ts`: `type FieldSource = { owner: 'pattern' | 'override' | 'default'; name?: string; resettable: boolean; resetPath: string }`;
      `fieldSourceOf(provenance, path, editing: DisplayOwner, config)`. The effective source comes from
      `ownersOfPath(provenance, path)` (last owner wins). The reset eligibility is computed apart: `resetPath` is the
      array path when `path` lies inside `hover.rows[i]` or `status.rules[i]`, else `path`; `resettable` is true when the
      **edited owner's own display** (`config.overrides[...]`.display or `config.patterns[index].display`) has a value at
      `resetPath`. Tests: every path that `DisplayFields` renders, against a config with one pattern and one override;
      an override that sets `hover.rows` makes `hover.rows[0].label` resettable at `hover.rows`; a path only the pattern
      sets is not resettable in element scope.
- [ ] `src/editor/draft.ts`: action `{ type: 'unset'; path }` removes `path` from the edited owner's display (element
      scope: the override of `draft.cellId`; pattern scope: the edited pattern); an empty override is removed. Tests
      include an array path and a nested leaf.
- [ ] `src/editor/EditorLayout.tsx`: `EditorField source?: FieldSource & { onReset?: () => void }` renders a chip
      after the label ("Pattern Core routers", "Override", "Default") and, when resettable, an `IconButton name="times"`
      with `aria-label="Reset <label> to pattern"` (array: "Reset hover rows to pattern"; pattern scope: "to default").
- [ ] `src/editor/BindingFields.tsx`: `DisplayFields`, `BindingFields`, `BoundField`, `FreshnessFields`, `TextField`
      get `path`, `sourceOf?(path)`, `onReset?(resetPath)`. Each field passes its path (`label`, `enabled`, `url`,
      `reducer`, `link.a2bBinding`, `link.capacityA2b`, `shape.binding`, `status`, `status.rules[i]`, `hover.rows[i]`,
      `hover.rows[i].binding`; widget fields are not provenance-tracked). `BindingInspector` wires
      `displayProvenance(draft.config, cellMeta)` and dispatches `unset`.
- [ ] Tests: `BindingInspector` test: chip text and reset button; after a reset inside a hover row the rows of the
      pattern show again and `binding.display` agrees.
- Done: tests pass; the lint has no new warning.

### Task 5: query result table, "Used by" and deletion

- [ ] `src/editor/popup/QueryPane.tsx`: after a preview with `state: 'ready'`, a `<table aria-label="Query preview table">`
      of the first frame: one column per field, 20 rows maximum, values through `getDisplayProcessor({ field, theme, timeZone })`; a line "N frames, M rows, fields: ..." above it. Error marks: `Alert severity="error"` for `error`
      and `unsupported`. A "Used by" list of the rows that reference the query (from `bindingsModel`). "Delete query"
      with `ConfirmModal` when `uses > 0`; action `{ type: 'remove-query'; id }` in `draft.ts`.
- [ ] Tests `QueryPane.test.tsx`: table; error alert; used-by list; delete with and without uses. `draft.test.ts`.
- Done: tests pass.

### Task 6: narrow layout

- [ ] `PopupLayout`: a `ResizeObserver` on the container; below 1000 px render `TabsBar` with `Tab` List, Diagram,
      Inspector and one visible pane (`data-dmap-layout="tabs"`, else `"panes"`). Props `activeTab`, `onTabChange`;
      `BindingEditor` switches to Inspector after a stage click in tab mode. The stage pane stays mounted in all modes
      (`display: none`, never unmount: the stage index must survive).
- [ ] Tests `PopupLayout.test.tsx`: tabs below 1000 px; a stage click switches to Inspector; the stage DOM survives a
      tab change.
- Done: tests pass; a screenshot at 900x700 shows the tabs.

### Task 7: e2e and docs

- [ ] `tests/bindings-popup-inspector.spec.ts`: the card preview rows equal the panel card rows for `device-1` of the
      authoring fixture (read the preview rows, close, hover the cell, compare); a pattern-sourced field shows the chip;
      a reset inside a hover row resets the array (the Overrides group count drops when the override becomes empty);
      undo/redo through keys and buttons; Ctrl+Z inside "Label template" and inside the Prometheus Monaco editor does
      not change the Overrides count; Ctrl+Z with the metrics explorer dialog open does nothing; at 900x700 the tabs
      show and a stage click opens the Inspector tab.
- [ ] `tests/bindings-list.spec.ts`: the 760 px case measures the tab mode.
- [ ] README: "Undo and redo", "Field sources", "Narrow screens", "Delete a query"; `docs/acceptance.md` rows for P2.
- Done: `npm run e2e:matrix` passes.

## Done criteria of the phase

- All P2 acceptance items of spec section 6 hold, with evidence in `docs/acceptance.md`.
