# Bindings popup, phase 1: shell, panes, entry points, inline inspector removed

> **For agentic workers:** use superpowers:executing-plans. Work task by task. Run the named tests after each task.
> Commit after each task with a message that names the task. Omit all `Co-Authored-By` trailers.

**Spec:** `docs/superpowers/specs/2026-10-23-bindings-popup-design.md`. Read sections 3, 4, 5, the P1 part of 6, 7 and
11 before you start. Read `CLAUDE.md`, `AGENTS.md`, `CODING_STANDARDS.md`, `.config/AGENTS/instructions.md` and
`.config/AGENTS/e2e-testing.md`.

**Goal:** the user edits bindings in a Grafana `Modal` popup with three panes. The inline inspector beside the panel is
gone. All features of today's editor work in the popup. The panel and the popup share the query controller without
stealing each other's subscriptions.

**Baseline:** `9154966`. Branch from `main`: `feat/bindings-popup-p1`.

## Constraints

- Do not modify `.config/`. Do not change the plugin id or type. Use the webpack config as it is.
- Keep `export function DrawioMapPanel(` as the text of the panel export (`tests/build-authoring-probe.mjs` rewrites it).
- Keep the labels "Diagram binding inspector", "Binding draft actions", "Apply bindings", "Cancel changes",
  "All bindings list". Never put `data-testid="dmap-panel"` or `dmap-stage` inside the popup.
- Write in ASD-STE100 Simplified Technical English in docs, comments and UI text.
- Attach a screenshot of the popup at 1440x900 (`DMAP_SCREENSHOTS=docs/images`) in the final commit.
- P1 does not pause the panel behind (spec 4.4, P3). Do not promise it in README or tests.

## Tasks

### Task 0: spike, measurements, import strategy

- [ ] Add a temporary `React.lazy(() => import('./spike'))` component behind the env flag `DMAP_SPIKE=1` in
      `DrawioMapPanel.tsx` (a `<span data-testid="dmap-spike">` from `src/components/spike.tsx`). Build. Write
      `tests/spike-chunk.spec.ts` that opens the demo dashboard in panel edit and expects `dmap-spike`. Run it on
      3012, 3013, 3122, 3123, 3133, 3143 and 3153 (`docker compose --profile isolation up -d --wait`; the sub-path URL
      is `http://localhost:3153/grafana`). Record pass or fail per variant.
- [ ] Measure with Playwright on 3012: the time of `buildStage` (wrap it with `performance.now()` in a dev-only log) on
      `fixtures/demo/svg/demo-l3.svg` and on a synthetic 2000-cell SVG that `scripts/` generates on the fly (do not
      commit the SVG); `performance.measureUserAgentSpecificMemory()` or the DevTools heap size with and without a second
      stage. Record the numbers.
- [ ] Decide per spec 4.6: lazy (all green) or static (any red). Decide per spec Q3: build in render (< 200 ms) or in an
      effect. Write both decisions and the numbers into `docs/acceptance.md` (table "Bindings popup: Task 0") and into
      spec section 4.6 and Q3 as one line each. Remove the spike code and test.
- Done: the two decisions are in the docs; `npm test` and `npm run build` pass; no spike code remains.

### Task 1: ownership primitives (bus, overlay stack, consumer owners, Esc owner)

- [ ] `src/editor/popup/popupBus.ts`: `PopupTarget` (`none | cell | problem | query`), `PopupAddress = { pathname: string; editPanel: string }`, `currentAddress()` from `locationService.getLocation().pathname` and
      `getSearchObject().editPanel`, `requestOpen(address, target): boolean` (false without a matching subscriber),
      `subscribe(address, listener): () => void`. Tests: match, mismatch, cleanup, no subscriber.
- [ ] `src/editor/popup/overlayStack.ts`: `push(id)`, `pop(id)`, `isTop(id)`, hook `useOverlay(id)` (push on mount, pop
      on unmount). Tests: order with two entries, pop out of order.
- [ ] `src/editor/popup/useEscOwner.ts`: hook `useEscOwner({ id, dialogRef, enabled, onEscape })` that implements the
      two layers of spec 4.3 (React `onKeyDown` props for the dialog body, and the `document` bubble listener for a
      target outside the dialog when `isTop(id)`). Tests with a real `@grafana/ui` `Select` open inside the dialog:
      Esc closes the menu only; a second Esc calls `onEscape`; Esc with focus on `body` calls `onEscape` only when top;
      Esc inside a nested `[role="dialog"]` does nothing.
- [ ] Consumer owners: `useBindingSnapshots(plan, config, service, openCellId, maxDataPoints, prepared, owner: string)`
      prefixes every `consumerId` with `${owner}:`; `ChartLayer owner: string` prefixes `widget:<id>`. The panel passes
      `panel:${id}`. Tests: two hooks with different owners on one fake controller keep both subscriptions; releasing
      one leaves the other; equal requests still share one executor call (cache dedup).
- Done: tests pass; `npm run typecheck` passes; the panel behaves as before.

### Task 2: draft, context and the model inputs

- [ ] `src/binding/context.ts`: `bindContextFor({ theme, fieldThresholds, replaceVariables, timeZone, linkWidth })`
      (the `display` function of `DrawioMapPanel.tsx` lines 258-271) and `cardContextFor(...)` (lines 384-399). The
      panel calls both; the fallback `formatting` in `BindingEditor.tsx` lines 272-282 goes away.
- [ ] `src/editor/draft.ts`: `diagram?: Diagram`, `savedDiagram?: Diagram`, `createDraft(config, diagram?)`, action
      `{ type: 'diagram'; diagram }`, `reset` restores `savedDiagram`, `applied` copies `diagram` into `savedDiagram`,
      `isDirty(draft)`. Tests for each.
- [ ] `src/editor/draftContext.ts`: `draftQueryService(service, defaultDatasource)` returns `{ controller, context: { ...context, defaultDatasource } }`, memo-friendly (same object while inputs are equal). Test: identity and the
      overlay of the default datasource.
- [ ] `src/editor/revision.ts`: `baseRevision(options)` → `{ hash?: string; config: string }` and
      `hasConflict(base, options)`. Tests.
- Done: tests pass.

### Task 3: stage and layout primitives

- [ ] `src/editor/popup/PopupLayout.tsx`: two nested `useSplitter` (`direction: 'row'`, `usePixels: true`, left
      `initialSize` 280, right 380, `dragPosition: 'middle'`); sizes in `localStorage` `dmap.bindingsPopup.panes`;
      ignore storage errors; the centre pane has `minWidth: 0` and `overflow: hidden`. Props: `list`, `stage`,
      `inspector: ReactNode`. Tests: three regions; sizes persist.
- [ ] `src/editor/popup/DiagramStage.tsx`. Props: `stage: Stage`, `stageRef`, `patches`, `selection: { selected: string[]; affected: string[]; highlight: string[] }`, `onSelect(cellId, { shift })`, `chartLayer` (the `ChartLayer`
      props except `root`, `cells`, `viewport`, `revision`), `owner`. It mounts `stageRef` in a container
      `data-testid="dmap-popup-stage"`; applies `applyPatches` and `renderOverlay` in one `requestAnimationFrame`
      (`DrawioMapPanel.tsx` lines 506-518 without `markInteractive`); lays out with `viewBoxFor({ mode: 'fit', percent: 100, align: 'center', minScale: 0 }, ...)` on a `ResizeObserver` and `usePanZoom({ wheel: true, dragPan: true, align: 'center' })` with the "Reset zoom" button; writes the editor attribute layer (`BindingEditor.tsx` lines
      199-214; clear on unmount); styles the outlines with emotion (the `<style>` block of lines 390-394); every cell
      gets `cursor: pointer`; click and Enter/Space call `cellAt` → `onSelect`; `panZoom.takeClick()` swallows a drag;
      hosts `ChartLayer`. If Task 0 chose the deferred build, the container shows a `Spinner` until `stage.root` exists.
- [ ] Tests `DiagramStage.test.tsx`: patches applied; selection attributes; click selects; unmount clears the editor
      layer; a second stage from the same SVG does not change the first DOM tree.
- Done: tests pass; `npm run lint` passes.

### Task 4: editor and panel integration (one step, with the unit tests)

- [ ] `src/editor/bindingsModel.ts`: `QueryRow`, `queries`, `rowMatches` for queries, `problemsOf(list)`,
      `cellRows(text, cells)` (exact id, id prefix, contains in id or label; returns all, the UI pages by 20). A
      `queries[i]` diagnostic goes to the query row and to the referencing rows. Tests.
- [ ] `src/editor/BindingsList.tsx`: groups Problems, Patterns, Overrides, Widgets, Queries, Cells; props `selectedKey`,
      `onSelectQuery`, `onSelectProblem`, `onSelectCell`; the selected row has `aria-current="true"`; "Show more" on the
      Cells group. Migrate `BindingsList.test.tsx` (no tabs).
- [ ] `src/editor/popup/ListPane.tsx`: filter `Input` (`aria-label="Filter bindings"`), "Problems only", the list, a
      footer with "Add named query", "Add eager panel reference" (`BindingEditor.tsx` lines 642-688), "Default
      datasource UID" and `PatternTransfer`; legacy rules hint.
- [ ] `src/editor/popup/QueryPane.tsx`: `QueryEditor` with the `onPreview` of today (lines 689-735) against the
      **draft query service**, the `<output aria-label="Query preview result">` line and the use count. No delete, no
      "Used by" list (P2).
- [ ] `src/editor/popup/InspectorPane.tsx`: `<aside role="complementary" aria-label="Diagram binding inspector">`;
      cell → today's body (lines 443-619, 746-757 without the named queries section); query → `QueryPane`; nothing →
      "Select an element in the diagram or a row in the list".
- [ ] `src/editor/BindingEditor.tsx`: props `config`, `diagram`, `base`, `data`, `timeRange`, `timeZone`, `bindContext`,
      `owner`, `initial?`, `legacyRules?`, `onDirtyChange?`, `onApply(config, diagram?)`, `onRequestClose()`,
      `onConflict?`. Remove `cells`, `children`, `inspectorWidth`, `onPreview`, `onQueryPreview`, `onPatternPreview`,
      `onDiagramPreview`. Inside: `useStage(stageRef, ...)` (or the deferred variant), `draftService = draftQueryService(service, draft.config.defaultDatasource)` for `useBindingSnapshots` (owner `popup:<id>`,
      `openCellId = draft.cellId`), `ChartLayer`, the explicit preview and `previewPattern`; the geometry save
      dispatches `diagram`; selection state `{ kind: 'cell' | 'query' }`; `initial` handling (`problem` selects the
      owning row and sets "Problems only"). Renders `PopupLayout`.
- [ ] `src/editor/popup/BindingsPopup.tsx`: `Modal isOpen title="Edit bindings" closeOnEscape={false} closeOnBackdropClick={false}` with the `DrawioModal` sizes; header (`aria-label="Binding draft actions"`): dirty
      mark, "Apply bindings", "Apply and close", "Cancel changes", "Close bindings"; body `data-testid="dmap-bindings-popup"`;
      `useOverlay('bindings-popup')`, `useEscOwner`; `ConfirmModal` "Discard changes?"; the conflict `Alert` with
      "Overwrite", "Reload saved", "Keep editing" (spec 4.2 step 6); if lazy: the `Suspense` fallback `Modal` with a
      `Spinner` and an error boundary with "Retry" that makes a new lazy factory. `src/editor/popup/index.ts` exports it.
- [ ] `src/components/DrawioMapPanel.tsx`: `popup` state in the outer component; the popup rendered inside the provider
      with the live props and `id`; the addressed bus subscription while `editing` with cleanup; close and drop on edit
      exit or unmount (also while loading); opening closes the card. Remove `draftConfig`, `draftDiagram`,
      `patternPreview`, `queryPreview`, `wasEditing`, `previewConfig`, `previewDiagram`, `inspectorWidth`, `stageWidth`,
      the `editing` branches in `onClick`, `onKeyDown`, `onPointerMove`, `cardPatch` and `useBindingSnapshots`, the
      `ChartLayer draft` prop, the `BindingEditor` wrapper, the cursor rule for `[role='button']`. Add `diagnostics`
      next to `warnings`; the badge is a `<button>` in panel edit (opens `{ kind: 'problem', path }`) and a `<div>` in
      view mode; the corner `IconButton name="link" tooltip="Edit bindings" data-testid="dmap-edit-bindings"` after the
      badge, panel edit only; `owner="panel:<id>"` to the consumers.
- [ ] `src/options/DiagramEditor.tsx`: "Edit bindings" (`data-testid="dmap-edit-bindings-option"`, `icon="link"`,
      `variant="secondary"`, disabled without `value?.svg`) → `requestOpen(currentAddress(), { kind: 'none' })`; a
      false return shows the tooltip "Open the panel editor first". `src/module.ts`: the "Legacy rules" description
      names the popup.
- [ ] Unit tests: `BindingsPopup.test.tsx` (Esc layers, dirty confirm, conflict alert with `rerender` of new saved
      options, apply and close, loading and error states if lazy); migrate `BindingEditor.test.tsx`,
      `patternPreview.test.tsx`, `geometry.test.tsx` (pass `diagram` built from `src/fixtures/authoring.svg`; select
      cells by a click in `dmap-popup-stage`; `onDiagramPreview` assertions become: the popup stage hash changes, the
      panel does not); migrate the edit-mode cases of `DrawioMapPanel.test.tsx` (open the popup through the corner
      button; add isolation assertions: the panel DOM keeps its attributes while the draft changes; the panel and the
      popup hold subscriptions at the same time; reopen without a refresh fills from the cache; the draft default
      datasource reaches only the popup demands; leaving panel edit closes the popup); corner order test;
      `DiagramEditor.test.tsx` button states. `src/editor/testUtils.ts`: `selectElement` → `selectStageCell`.
- Done: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:bundle` pass (with the Task 0
  outcome applied to `scripts/check-bundle.sh`); `grep -n inspectorWidth src` finds nothing.

### Task 5: browser migration and docs

- [ ] `tests/authoring-controls.ts`: `openBindingsPopup(page)` (click `dmap-edit-bindings`, return the dialog),
      `closeBindingsPopup(page)` ("Close bindings", zero dialogs), `selectStageCell(dialog, id)`,
      `filterBindings(dialog, text)`; remove `selectDiagramElement`.
- [ ] New `tests/bindings-popup.spec.ts`: the three entry points; the options pane button in view mode opens nothing;
      three panes; splitter drag; stage click focuses `<id> bindings` and sets `data-dmap-selected` in
      `dmap-popup-stage` only; Esc clean closes, dirty asks, inside an open Select closes the menu only, in the draw.io
      modal closes only it, with a pinned panel card before open the first Esc asks; leaving panel edit with the popup
      open drops it; TestData and Prometheus editors: keyboard, menu, Monaco typing, the metrics explorer dialog and Esc
      in it, focus return on close; `Apply and close` persists after `saveDashboard`; if lazy: one chunk request in panel
      edit, none in view mode.
- [ ] Migrate the specs per spec section 7: `binding-editor` (draft assertions in the popup stage plus isolation of
      `dmap-panel`), `bindings-list`, `editor-layout`, `editor` test 3, `editor-refresh` geometry (popup stage hash
      changes, panel hash unchanged, panel hash changes after Apply and close), `cursor` test 2, `zoom` fit test,
      `options`, `reset-corner`, `no-drawio`.
- [ ] Run `npm run e2e:matrix`; run `tests/bindings-popup.spec.ts` on 3123 and 3133. Record in `docs/acceptance.md`.
- [ ] README: rewrite "Bind elements" (lines 64-88): entry points, panes, Apply and close, Cancel, close confirmation,
      conflict alert, "the panel behind updates on refresh until a later release".
- Done: both versions pass; 3123 and 3133 pass.

## Done criteria of the phase

- All P1 acceptance items of spec section 6 hold, with evidence in `docs/acceptance.md`.
- No inline inspector code remains. The view-mode e2e specs pass unchanged.
