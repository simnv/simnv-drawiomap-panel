# Bindings popup, phase 1: shell, panes, entry points, inline inspector removed

> **For agentic workers:** use superpowers:executing-plans. Work task by task. Run the named tests after each task.
> Commit after each task with a message that names the task. Omit all `Co-Authored-By` trailers.

**Spec:** `docs/superpowers/specs/2026-10-23-bindings-popup-design.md`. Read sections 3, 4, 5 and the P1 part of 6 and 7
before you start. Read `CLAUDE.md`, `AGENTS.md`, `CODING_STANDARDS.md`, `.config/AGENTS/instructions.md` and
`.config/AGENTS/e2e-testing.md`.

**Goal:** the user edits bindings in a Grafana `Modal` popup with three panes. The inline inspector beside the panel is
gone. All features of today's editor work in the popup. The editor code loads as a lazy chunk.

**Baseline:** `9154966`. Branch from `main`: `feat/bindings-popup-p1`.

## Constraints

- Do not modify `.config/`. Do not change the plugin id or type. Use the webpack config as it is.
- Keep `export function DrawioMapPanel(` as the text of the panel export (`tests/build-authoring-probe.mjs` rewrites it).
- Keep the labels "Diagram binding inspector", "Binding draft actions", "Apply bindings", "Cancel changes",
  "All bindings list". Never put `data-testid="dmap-panel"` or `dmap-stage` inside the popup.
- Write in ASD-STE100 Simplified Technical English in docs, comments and UI text.
- Attach a screenshot of the popup at 1440x900 (`DMAP_SCREENSHOTS=docs/images`) in the final commit.

## Tasks

### Task 1: shared bind context and the popup bus

- [ ] Create `src/binding/context.ts` with `bindContextFor({ theme, fieldThresholds, replaceVariables, timeZone, linkWidth })`
      returning `BindContext` (the `display` function of `DrawioMapPanel.tsx` lines 258-271) and
      `cardContextFor({ series, theme, timeZone, display, replaceVariables, fieldThresholds })` (lines 384-399).
      Make the panel call both. Remove the fallback `formatting` in `BindingEditor.tsx` lines 272-282.
- [ ] Create `src/editor/popup/popupBus.ts`: `type PopupTarget = { kind: 'none' } | { kind: 'cell'; cellId: string } | { kind: 'problem'; path: string; code?: string } | { kind: 'query'; queryId: string }`; `requestOpen(target)`;
      `subscribe(listener): () => void`. One module-level `Set` of listeners.
- [ ] Tests: `src/binding/context.test.ts` (the display function uses `field.display` when present, else
      `getDisplayProcessor`); `src/editor/popup/popupBus.test.ts` (subscribe, request, unsubscribe).
- Done: `npm test` passes; `npm run typecheck` passes; the panel renders the same as before (`DrawioMapPanel.test.tsx`).

### Task 2: draft holds the diagram

- [ ] `src/editor/draft.ts`: add `diagram?: Diagram` and `savedDiagram?: Diagram` to `BindingDraft`; `createDraft(config, diagram?)`; action `{ type: 'diagram'; diagram: Diagram }`; `reset` restores `savedDiagram`; `applied` copies
      `diagram` into `savedDiagram`. Add `isDirty(draft): boolean` (config JSON differs or diagram hash differs).
- [ ] Tests in `src/editor/draft.test.ts` for the three cases and `isDirty`.
- Done: `draft.test.ts` passes.

### Task 3: BindingEditor becomes the popup body

- [ ] Change the props of `BindingEditor` (`src/editor/BindingEditor.tsx`): remove `cells`, `children`, `inspectorWidth`,
      `onPreview`, `onQueryPreview`, `onPatternPreview`, `onDiagramPreview`. Add `diagram?: Diagram`, `data: PanelData`,
      `timeRange`, `timeZone`, `bindContext: BindContext`, `initial?: PopupTarget`, `onDirtyChange?(dirty)`,
      `onApply(config, diagram?)`, `onRequestClose()`, `onApplyAndClose()`.
- [ ] Inside: `const stageRef = useRef<HTMLDivElement>(null)`; `const stage = useStage(stageRef, draft.diagram?.svg, draft.diagram?.hash)`; `cells = stage.index`. The geometry save dispatches `{ type: 'diagram' }` instead of the
      local `draftDiagram` state. Keep the model code (lines 83-369) as it is; move the "Named queries" `Select` and the
      add buttons out of the inspector (Task 5 puts them in the list pane).
- [ ] Add `prepared`: the popup's own `useBindingSnapshots(plan, draft.config, service, draft.cellId, Math.max(1, Math.min(264, stageWidth - 16)), chartPrepared)` where `chartPrepared` comes from the `onPrepared` of
      the popup `ChartLayer` (Task 4). Merge it with the explicit previews as `DrawioMapPanel.tsx` lines 306-351 do.
- [ ] Render `<PopupLayout list={...} stage={...} inspector={...} />` (Task 4). Until Task 4 exists, render the three
      parts in a flex row.
- [ ] Tests: migrate `src/editor/BindingEditor.test.tsx`, `patternPreview.test.tsx`, `geometry.test.tsx`: pass
      `diagram={{ svg, xml: '', hash, updatedAt }}` built from `src/fixtures/authoring.svg` instead of `cells`; select
      cells by a click on `[data-cell-id]` inside `dmap-popup-stage`; keep every assertion.
- Done: the four editor test files pass.

### Task 4: PopupLayout and DiagramStage

- [ ] `src/editor/popup/PopupLayout.tsx`: two nested `useSplitter` from `@grafana/ui` (`direction: 'row'`,
      `usePixels: true`, left `initialSize` 280, right 380, `dragPosition: 'middle'`). Keep the sizes in `localStorage`
      under `dmap.bindingsPopup.panes` (`{ left, right }`); ignore storage errors. The centre pane has `minWidth: 0` and
      `overflow: hidden`. Props: `list`, `stage`, `inspector: ReactNode`.
- [ ] `src/editor/popup/DiagramStage.tsx`. Props: `stage: Stage`, `stageRef`, `patches: Map<string, CellPatch>`,
      `selection: { selected: string[]; affected: string[]; highlight: string[] }`, `onSelect(cellId: string, modifiers: { shift: boolean })`, `chartLayer?: Omit<ChartLayerProps, 'root' | 'cells' | 'viewport' | 'revision'>`. It:
  - mounts `stageRef` in a container `data-testid="dmap-popup-stage"` with `colorScheme` from the theme;
  - applies `applyPatches` and `renderOverlay` in one `requestAnimationFrame` (copy `DrawioMapPanel.tsx` lines 506-518
    without `markInteractive`);
  - lays out with `viewBoxFor({ mode: 'fit', percent: 100, align: 'center', minScale: 0 }, stage.base, size, view)` on a
    `ResizeObserver` of the container, and `usePanZoom({ wheel: true, dragPan: true, align: 'center' })`; shows the
    "Reset zoom" `IconButton` when zoomed;
  - writes the editor attribute layer with `setOwnedAttrs(cell.group, 'editor', {...})` (move `BindingEditor.tsx`
    lines 199-214 here; clear on unmount);
  - styles the outlines with emotion on the container (move the `<style>` block of `BindingEditor.tsx` line 390-394);
    every cell gets `cursor: pointer`;
  - on click and on Enter/Space calls `cellAt(e.target, stage.index)` → `onSelect(id, { shift: e.shiftKey })`;
    `panZoom.takeClick()` swallows a drag;
  - hosts `<ChartLayer root={stage.root} cells={stage.index} viewport={container} revision={size + view} draft={...} />`.
- [ ] Tests: `src/editor/popup/DiagramStage.test.tsx` (patches applied to the stage DOM, selected attribute, click
      selects, unmount clears the editor layer); `PopupLayout.test.tsx` (three regions render; sizes persist).
- Done: tests pass; `npm run lint` passes.

### Task 5: ListPane with the Queries and Problems groups

- [ ] `src/editor/bindingsModel.ts`: `QueryRow { kind: 'query'; key; index; queryId; name; sourceKind: 'panel' | 'datasource'; uses: number; problems }`; `queries: QueryRow[]` in `BindingsList`; `rowMatches` for query rows
      (name, id, source kind); `problemsOf(list): Array<{ row?: BindingRow | QueryRow; problem: RowProblem }>` flat and
      deduplicated. A diagnostic with path `queries[i]` goes to the query row **and** to the referencing rows.
- [ ] `src/editor/BindingsList.tsx`: render the groups Problems (flat list; a click selects the owning row), Patterns,
      Overrides, Widgets, Queries. Props: `selectedKey?: string`, `onSelectQuery(queryId)`, `onSelectProblem(problem)`.
      The selected row has `aria-current="true"`.
- [ ] `src/editor/popup/ListPane.tsx`: the filter `Input` (`aria-label="Filter bindings"`), "Problems only", the
      `BindingsList`, a footer with "Add named query", "Add eager panel reference" (move from `BindingEditor.tsx`
      lines 642-688), the "Default datasource UID" field and `PatternTransfer`. Legacy rules hint when `legacyRules > 0`.
- [ ] Q4 of the spec: when the filter text matches no row, show a "Cells" group with up to 20 cell ids or labels that
      contain the text; a click selects the cell.
- [ ] Tests: `bindingsModel.test.ts` (query rows, uses, problemsOf); migrate `BindingsList.test.tsx` (no tabs; groups
      include Problems and Queries; selection).
- Done: tests pass.

### Task 6: InspectorPane and QueryPane

- [ ] `src/editor/popup/InspectorPane.tsx`: `<aside role="complementary" aria-label="Diagram binding inspector">`.
      Selection `cell` → today's body (`BindingEditor.tsx` lines 443-619 and 746-757 without the named queries section):
      geometry button, `BindingInspector`, missing anchors, "Create shared pattern", pattern preview, diagnostics, metric
      preview. Selection `query` → `QueryPane`. Nothing → "Select an element in the diagram or a row in the list".
- [ ] `src/editor/popup/QueryPane.tsx`: `QueryEditor` with the `onPreview` of today (`BindingEditor.tsx` lines 689-735),
      the `<output aria-label="Query preview result">` line, and a "Used by" list of the rows that reference the query
      (from `bindingsModel`). Delete query button with `ConfirmModal` when `uses > 0`.
- [ ] Selection state in `BindingEditor`: `{ kind: 'cell'; cellId } | { kind: 'query'; queryId } | undefined`, derived
      from `draft.cellId` and a local `queryId`. `initial` sets it on mount: `cell` selects the cell; `query` selects the
      query; `problem` selects the owning row of the first problem with that path and sets the filter to "Problems only".
- [ ] Tests: `InspectorPane.test.tsx` (three states); `QueryPane.test.tsx` (used-by list, preview line).
- Done: tests pass.

### Task 7: BindingsPopup shell and the lazy chunk

- [ ] `src/editor/popup/BindingsPopup.tsx`: `Modal isOpen title="Edit bindings" closeOnEscape={false} closeOnBackdropClick={false}` with the `DrawioModal` class sizes (95vw x 90vh). Header row
      (`aria-label="Binding draft actions"`): dirty mark "Unsaved changes", "Apply bindings", "Apply and close",
      "Cancel changes", "Close bindings". Body `data-testid="dmap-bindings-popup"`. Esc owner: a `document` keydown
      listener in the capture phase (spec 4.3). `ConfirmModal` "Discard changes?" (confirm "Discard", dismiss
      "Keep editing") when the draft is dirty on close.
- [ ] `src/editor/popup/index.ts`: `export { BindingsPopup as default } from './BindingsPopup'`.
- [ ] `src/components/DrawioMapPanel.tsx`: `const BindingsPopup = React.lazy(() => import('../editor/popup'))`;
      `popup` state in `DrawioMapPanel` (outer); `<Suspense fallback={null}>` renders the popup inside the provider;
      the bus subscription in an effect when `editing`; opening closes the card.
- [ ] Remove from `DrawioMapPanelView`: `draftConfig`, `draftDiagram`, `patternPreview`, `queryPreview`, `wasEditing`,
      `previewConfig`, `previewDiagram`, `inspectorWidth`, `stageWidth` (use `width`), the `editing` branches in
      `onClick`, `onKeyDown`, `onPointerMove`, `cardPatch` and `useBindingSnapshots`, the `ChartLayer draft` prop, the
      `BindingEditor` wrapper, and the cursor rule for `[role='button']` in `styles.stage`. `opts.config` and
      `opts.diagram` come from `options` only.
- [ ] Add `diagnostics: Diagnostic[]` next to `warnings` (from `bound.diagnostics`); the badge becomes a `<button>`
      in panel edit (`onClick` → open `{ kind: 'problem', path }` of the first diagnostic, or `{ kind: 'none' }`) and
      stays a `<div>` in view mode. Add the corner `IconButton name="link" tooltip="Edit bindings" data-testid="dmap-edit-bindings"` in the corner row after the badge, panel edit only.
- [ ] `src/options/DiagramEditor.tsx`: button "Edit bindings" (`data-testid="dmap-edit-bindings-option"`, `icon="link"`,
      `variant="secondary"`, disabled without `value?.svg`) → `requestOpen({ kind: 'none' })`. `src/module.ts`: the
      "Legacy rules" description names the popup.
- [ ] Tests: `BindingsPopup.test.tsx` (Esc asks when dirty and closes when clean; Esc with `defaultPrevented` does
      nothing; Apply and close calls `onOptionsChange` then `onClose`); migrate the edit-mode cases of
      `src/components/DrawioMapPanel.test.tsx`: `vi.mock('../editor/popup', ...)` with the static module, open the popup
      through the corner button, keep every assertion; corner order test includes the new button; `DiagramEditor.test.tsx`
      checks the button and its disabled state.
- Done: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` and `npm run check:bundle` pass; `dist/`
  contains `module.js` and one chunk; `module.js` is smaller than 386 856 bytes.

### Task 8: e2e migration and the new spec

- [ ] New `tests/bindings-popup.spec.ts` with `@grafana/plugin-e2e`: the three entry points; three panes visible;
      splitter drag changes the left pane width; a stage click focuses the heading `<id> bindings` and sets
      `data-dmap-selected` inside `dmap-popup-stage` only; Esc with a clean draft closes; Esc with a dirty draft shows
      "Discard changes?"; Esc inside an open Select closes only the menu; the draw.io modal opens on top and Esc closes
      only it; `Apply and close` persists after `saveDashboard`; the chunk request happens once in panel edit and never
      in view mode.
- [ ] Migrate the specs of spec section 7: `binding-editor`, `bindings-list`, `editor-layout`, `editor` test 3,
      `editor-refresh` (geometry), `cursor` test 2, `zoom` fit test, `options`, `reset-corner`, `no-drawio`.
      Add a helper `openBindingsPopup(page)` to `tests/authoring-controls.ts` that clicks `dmap-edit-bindings` and
      returns the dialog locator; `closeBindingsPopup(page)` clicks "Close bindings" and waits for zero dialogs.
- [ ] Run `npm run e2e:matrix`. Run `GRAFANA_URL=http://localhost:3123 npx playwright test tests/bindings-popup.spec.ts`
      (sandbox) and the same on 3133 (CSP). Record the results in `docs/acceptance.md` (a new table "Bindings popup").
- [ ] README: rewrite "Bind elements" (lines 64-88) for the popup; describe the three entry points, the panes, Apply
      and close, Cancel and the close confirmation.
- Done: both versions pass; the sandbox and CSP runs pass or the fallback of spec 4.6 is applied and documented.

## Done criteria of the phase

- All P1 acceptance items of spec section 6 hold, with evidence in `docs/acceptance.md`.
- No inline inspector code remains: `grep -n inspectorWidth src` finds nothing.
- The view-mode e2e specs pass unchanged.
