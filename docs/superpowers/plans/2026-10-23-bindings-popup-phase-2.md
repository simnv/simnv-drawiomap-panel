# Bindings popup, phase 2: live card, field sources, undo/redo, narrow layout

> **For agentic workers:** use superpowers:executing-plans. Work task by task. Run the named tests after each task.
> Commit after each task with a message that names the task. Omit all `Co-Authored-By` trailers.

**Spec:** `docs/superpowers/specs/2026-10-23-bindings-popup-design.md`, sections 4.3, 5 and the P2 part of 6, plus the
open questions Q1, Q2, Q3. Phase 1 is merged. Read the phase 1 plan to know the files.

**Goal:** the inspector shows the live hover card of the selected cell and the source of each field with a reset
action; the draft has undo and redo; the popup works below 1000 px as tabs; the query pane shows a result table.

**Branch:** `feat/bindings-popup-p2` from `main`.

## Constraints

- The decisions of the spec are fixed. Q1 and Q2 use the recommendations of the spec unless the user says otherwise.
- Keep every label and test id of phase 1.
- Attach screenshots: the inspector with the card preview and sources at 1440x900, and the tab mode at 900x700.

## Tasks

### Task 1: history reducer

- [ ] `src/editor/history.ts`: `interface HistoryState { past: BindingDraft[]; present: BindingDraft; future: BindingDraft[]; lastStep?: { path?: string; at: number } }`; `createHistory(draft)`;
      `reduceHistory(state, action: DraftAction | { type: 'undo' } | { type: 'redo' }, now = Date.now())`.
  - A step is an action whose result changes `present.config` or `present.diagram` (compare by reference after
    `reduceDraft`). `select` and `scope` update `present` without a step.
  - Consecutive `display` actions with the same `Object.keys(action.display)` within 800 ms coalesce (Q1): the new
    present replaces the last one, `past` does not grow. A `coalesceMs` option of `createHistory` sets the window; 0
    disables it.
  - `applied` and `reset` clear `past` and `future`. `undo` and `redo` keep `cellId`, `scope`, `patternId` of the
    present when the target cell still exists in the config scope; else they clear the scope.
  - `past` holds at most 200 entries.
- [ ] `BindingEditor` replaces `useReducer(reduceDraft, ...)` with `useReducer(reduceHistory, ...)`; `draft = history.present`; `canUndo = past.length > 0`, `canRedo = future.length > 0`.
- [ ] Tests `src/editor/history.test.ts`: ten edits, ten undos, redo; a selection is not a step; coalescing on and
      off; `applied` clears; a `diagram` action is one step; the cap of 200.
- Done: tests pass; the existing editor tests pass.

### Task 2: undo/redo controls

- [ ] `BindingsPopup` header: `Button icon="arrow-left" fill="text"` with the text "Undo" and
      `Button icon="arrow-right" fill="text"` with the text "Redo", disabled at the ends, with `aria-keyshortcuts`
      `Control+Z` and `Control+Shift+Z`.
- [ ] Extend the capture-phase keydown owner of `BindingsPopup`: Cmd/Ctrl+Z → undo; Shift+Cmd/Ctrl+Z and Ctrl+Y → redo.
      Skip when the target is `input`, `textarea` or `[contenteditable]` (Q2), when the target is inside another dialog,
      or when the draw.io modal is open.
- [ ] Tests `BindingsPopup.test.tsx`: keys, the text input exception, disabled buttons, history cleared by Apply.
- Done: tests pass.

### Task 3: inline Card and CardPreview

- [ ] `src/interact/Card.tsx`: prop `variant?: 'floating' | 'inline'` (default floating). Inline: `position: static`,
      no close button, `width: 100%`, the sheet logic off, links open in a new tab as today. No other change.
- [ ] `src/editor/popup/CardPreview.tsx`: props `patch?: PlanCellPatch`, `resolve`, `cardContext`, `timeRange`,
      `timeZone`, `width`. Builds `buildConfiguredCard(patch, resolve, cardContext)` in `useMemo` and renders
      `<Card variant="inline" model pinned ... />` inside `<section aria-label="Hover card preview">`. Without rows and
      links it shows "No card for this element".
- [ ] `BindingEditor`: build `cardContext = cardContextFor({ series: extractSeries(data.series), ... })` once per data;
      always build the preview for the selected cell (today's `hoverPreview` requires an explicit preview; keep that
      value for the metric diagnostics, but the card uses the live `resolve` which includes the popup's
      `useBindingSnapshots` results). `InspectorPane` renders `CardPreview` first for a `cell` selection.
- [ ] Tests `CardPreview.test.tsx`: rows from panel data; an update of `data` changes the rows; empty state.
      `Card.test.tsx`: the inline variant has no close button and no fixed position.
- Done: tests pass; a screenshot shows the card preview above the sections.

### Task 4: field sources and reset

- [ ] `src/editor/fieldSource.ts`: `type FieldSource = { owner: 'pattern' | 'override' | 'default'; name?: string; resettable: boolean }`; `fieldSourceOf(provenance: DisplayProvenance, path: string, editing: DisplayOwner, config: DiagramConfigV2): FieldSource` using `ownersOfPath`. Resettable when the editing owner contributed the
      path (element scope: the override; pattern scope: the pattern).
- [ ] `src/editor/draft.ts`: action `{ type: 'unset'; path: string }`: removes the path (`a.b[2].c` syntax) from the
      override display of `draft.cellId` in element scope, from the edited pattern in pattern scope; removes an
      override that becomes empty.
- [ ] `src/editor/EditorLayout.tsx`: `EditorField` prop `source?: FieldSource & { onReset?: () => void }` renders a
      small text chip after the label ("Pattern Core routers", "Override", "Default") and an `IconButton name="times"`
      with `aria-label="Reset <label> to pattern"` (pattern scope: "to default") when resettable.
- [ ] `src/editor/BindingFields.tsx`: `DisplayFields`, `BindingFields`, `BoundField`, `FreshnessFields`, `TextField`
      get `path` and `sourceOf?(path): FieldSource` and `onReset?(path)`. Each field passes its path (`label`,
      `enabled`, `url`, `reducer`, `link.a2bBinding`, `link.capacityA2b`, `shape.binding`, `status`,
      `status.rules[i]`, `hover.rows[i]`, `hover.rows[i].binding`, widget fields are not provenance-tracked).
      `BindingInspector` wires `displayProvenance(draft.config, cellMeta)` and dispatches `unset`.
- [ ] Tests: `fieldSource.test.ts` (every path that `DisplayFields` renders resolves against a config with one pattern
      and one override; resettable only for the editing owner); `draft.test.ts` (`unset` cases); `BindingInspector`
      test: the chip text and the reset button; after reset the field shows the pattern value and
      `binding.display` agrees.
- Done: tests pass; the lint has no new warning.

### Task 5: query result table, uses and error marks

- [ ] `src/editor/popup/QueryPane.tsx`: after a preview with `state: 'ready'`, render a table (`<table>` with
      `aria-label="Query preview table"`) of the first frame: one column per field, 20 rows maximum, values through
      `getDisplayProcessor({ field, theme, timeZone })`; a line "N frames, M rows, fields: ..." above it. Error marks:
      `Alert severity="error"` for `error` and `unsupported`; the list row shows the problem count already (phase 1).
- [ ] Tests `QueryPane.test.tsx`: table rows and headers; error alert.
- Done: tests pass.

### Task 6: narrow layout

- [ ] `src/editor/popup/PopupLayout.tsx`: a `ResizeObserver` on the container; below 1000 px render `TabsBar` with
      `Tab` List, Diagram, Inspector and one visible pane (`data-dmap-layout="tabs"`; otherwise `"panes"`). The tab
      state is local; a prop `activeTab` and `onTabChange` let `BindingEditor` switch to Inspector after a stage click
      in tab mode. The stage pane keeps its DOM mounted in all modes (hide with `display: none`, not unmount: the stage
      index must survive).
- [ ] Tests `PopupLayout.test.tsx`: tabs below 1000 px; a stage click switches to Inspector.
- Done: tests pass; a screenshot at 900x700 shows the tabs.

### Task 7: e2e and docs

- [ ] `tests/bindings-popup-inspector.spec.ts`: the card preview rows equal the panel card rows for `device-1` of the
      authoring fixture (open the popup, read the preview rows, close, hover the cell, compare); a field with a pattern
      source shows the chip; reset removes the override (the Overrides group count drops); undo/redo through keys and
      buttons; Ctrl+Z inside "Label template" does not change the Overrides count; at 900x700 the tabs show and a stage
      click opens the Inspector tab.
- [ ] `tests/bindings-list.spec.ts`: the 760 px case measures the tab mode.
- [ ] README: "Undo and redo", "Field sources", "Narrow screens"; `docs/acceptance.md` rows for P2.
- Done: `npm run e2e:matrix` passes.

## Done criteria of the phase

- All P2 acceptance items of spec section 6 hold, with evidence in `docs/acceptance.md`.
- Q1, Q2 and Q3 have a line in the spec section 9 with the chosen answer.
