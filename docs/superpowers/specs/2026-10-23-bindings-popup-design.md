# Bindings popup: design and implementation spec

Date: 2026-10-23. Baseline: `9154966` (branch `main`). Grafana 12.4.13 and 13.2.4; `@grafana/*` 12.4.13 installed.
Status: approved product decisions (grilling session), design checked against the code. Workers implement it in
three phases (`docs/superpowers/plans/2026-10-23-bindings-popup-phase-{1,2,3}.md`).

## 1. Goal

Replace the inline binding inspector (the `<aside>` that `BindingEditor` puts beside the panel in panel edit) with one
popup: a Grafana `Modal` of 95vw x 90vh with three resizable panes. The popup is the only place where the user edits
bindings, queries and diagram geometry. The real panel behind the popup stays as it is until the popup closes.

## 2. Approved decisions (do not reopen)

| #   | Decision                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Panel edit only. Three entry points: an "Edit bindings" button in the Diagram options category, a small button in the panel corner in panel edit, a click on the warning badge (opens at that problem). The inline inspector is removed.               |
| 2   | Grafana `Modal`, 95vw x 90vh. Three resizable panes: left list (filter; groups Problems, Patterns, Overrides, Widgets, Queries), centre live diagram with panel data (zoom, pan, click to select), right inspector.                                    |
| 3   | Queries are rows of the left list. A click opens the datasource query editor (`src/editor/QueryEditor.tsx`) in the right pane with a preview result table, error marks and use counts.                                                                 |
| 4   | The inspector keeps the sections of today and adds: a live hover-card preview with real data at the top; for each field the effective value and its source (pattern or override) with "Reset to pattern".                                              |
| 5   | One draft for all edits, including a draw.io geometry save made from the popup. Apply writes the panel options; "Apply and close"; Cancel discards; a close with unsaved changes asks. Undo/redo with Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and header buttons. |
| 6   | draw.io stays a separate modal (opaque-origin iframe, ADR 0001) that opens on top of the popup.                                                                                                                                                        |
| 7   | Multi-select on the canvas (shift-click, box select). "Create pattern from selection" proposes a selector; "Bulk edit" writes one override per selected cell and shows mixed values.                                                                   |
| 8   | While the popup is open, the panel behind keeps its last render and does no per-refresh work. It renders once on close.                                                                                                                                |
| 9   | Below about 1000 px the three panes become the tabs List, Diagram, Inspector.                                                                                                                                                                          |
| 10  | Phases: P1 shell, panes, entry points, move the editor and the list in, remove the inline inspector. P2 live card, field sources, undo/redo, narrow layout. P3 multi-select, pattern from selection, bulk edit, pause behind.                          |

## 3. Facts from the code that the design depends on

- `PanelQueryProvider` (`src/query/panel.tsx`) wraps the whole panel. `PanelQueryContext` gives `{ controller, context }`.
  Grafana `Modal` renders through `ReactDOM.createPortal` (react-aria `OverlayContainer` into `document.body`). React
  context passes through portals. The popup can use `PanelQueryContext`, the theme and the panel props without a new
  provider. `DrawioModal` already runs this way inside `BindingEditor`.
- Grafana `Modal` 12.4 uses floating-ui: `FloatingFocusManager modal={trapFocus}` with
  `getInsideElements={() => [getPortalContainer()]}`. There is no handler that pulls the focus back into the dialog.
  `Select` menus (`menuShouldPortal`, default true, into `#grafana-portal-container`) and datasource popovers work.
- `Modal` Esc: `useDismiss` with a `document` keydown listener (bubble) and a React `onKeyDown`, both call
  `stopPropagation`. `closeOnEscape={false}` disables Esc **and** the outside-press dismiss. Two modals can be open; Esc
  with focus inside the inner modal closes only the inner one; Esc with focus on `document.body` closes both.
- `useSplitter` (`@grafana/ui`) is the only resizable-pane primitive (`direction`, `initialSize`, `usePixels`,
  `dragPosition`, `handleSize`; returns `containerProps`, `primaryProps`, `secondaryProps`, `splitterProps`). There is no
  `Splitter` component.
- `StandardEditorContext` has no `timeRange` and no panel id. The options pane editor cannot own the popup.
- `useStage(containerRef, svg, hash)` sanitises, parses and indexes the SVG once per hash in `useMemo`, and mounts the
  root in a layout effect. A second call builds a second DOM tree.
- `setOwnedAttrs(el, 'editor', attrs)` keeps its layers in a `WeakMap` per element. A second stage has its own layers.
- `BindingEditor` already computes the draft model: `plan`, `resolve`, `bound = bindPlan(...)`, `nowMs`, previews,
  `hoverPreview`, `listDiagnostics`, `bindingsList`. It renders the inline layout around that model.
- `DrawioMapPanelView` recomputes `result = bindPlan(...)`, `legendBlocks`, `interactive` and the chart layer on every
  data update. Controller listeners in `useBindingSnapshots` and `ChartLayer` (`Widget.response`) call `setState`.
- `dist/module.js` is 386 856 bytes. `scripts/check-bundle.sh` fails above 400 000 bytes. The editor code is in the
  entry today. The scaffold webpack config supports dynamic `import()` (`chunkFilename`, `__webpack_public_path__`
  from the AMD module URI, `crossOriginLoading: 'anonymous'`, SRI). No chunk exists yet.
- `fixtures` and tests: `tests/authoring-controls.ts` helpers take a scope locator. `saveDashboard` expects zero
  dialogs after save. `tests/build-authoring-probe.mjs` rewrites the text `export function DrawioMapPanel(`.

## 4. Architecture

### 4.1 Ownership

```
DrawioMapPanel (PanelProps)                       src/components/DrawioMapPanel.tsx
├─ PanelQueryProvider (live props)                src/query/panel.tsx
│  ├─ DrawioMapPanelView (held props while popup open)   P3: useHeld
│  │  └─ corner: reset, badge (click → open at problem), "Edit bindings" button (panel edit only)
│  └─ Suspense → BindingsPopup (React.lazy chunk)  src/editor/popup/BindingsPopup.tsx
│       └─ Modal 95vw x 90vh, closeOnEscape=false, closeOnBackdropClick=false
│            └─ BindingEditor (draft model + history + stage + previews)   src/editor/BindingEditor.tsx
│                 ├─ ListPane      (filter, Problems, Patterns, Overrides, Widgets, Queries)
│                 ├─ DiagramStage  (second useStage on draft diagram, pan/zoom, select, ChartLayer draft)
│                 ├─ InspectorPane (cell | pattern | query | bulk | empty)
│                 └─ DrawioModal   (geometry; child of the popup tree)
└─ popupBus.subscribe(id) ← DiagramEditor "Edit bindings" (options pane)   src/editor/popup/popupBus.ts
```

- The **panel** owns the popup state: `popup: PopupTarget | null`. It passes live `options`, `data`, `timeRange`,
  `timeZone`, `fieldConfig`, `replaceVariables`, `onOptionsChange` and `onClose` to the popup.
- The **popup** owns the draft (`src/editor/draft.ts`), the history (P2), the second stage, the previews and the
  selection. It never touches the panel DOM.
- The **options pane** button cannot reach the panel props. It calls `requestOpen(target)` on a module-level bus
  (`src/editor/popup/popupBus.ts`: `requestOpen(target)`, `subscribe(listener)`). The panel in panel edit
  (`usePanelEditing(id)`, the `editPanel` URL parameter) subscribes and opens. One panel is in panel edit at a time, so
  the bus needs no panel id. The bus is plain code: no Grafana API, no sandbox dependency, a trivial unit test.
  `PanelContext.onInstanceStateChange` + `StandardEditorContext.instanceState` is the Grafana way, but it crosses the
  sandbox proxy and the scenes relay in both versions; keep it as the fallback if the bus fails in a test.

### 4.2 Data flow

1. Open: `setPopup(target)`. The chunk loads (first open only). The popup mounts `BindingEditor` with
   `config = options.config ?? EMPTY_CONFIG`, `diagram = options.diagram`, `data`, `timeRange`, `timeZone`,
   `fieldConfig`, `replaceVariables`, `bindContext = bindContextFor(...)` (shared with the panel; new
   `src/binding/context.ts`), `service = useContext(PanelQueryContext)` (live).
2. The popup calls `useStage(stageRef, draft.diagram?.svg, draft.diagram?.hash)`. This is the centre stage. `cells` for
   the model come from this stage, not from the panel.
3. The model is the one in `BindingEditor` today: `plan = resolvePatterns(metas, draft.config)`,
   `resolve = createPreviewResolver(...)` with `prepared` = the popup's own `useBindingSnapshots(plan, draft.config, service, selectedCellId, width, chartPrepared)` plus the explicit previews, `bound = bindPlan(plan, resolve, bindContext, nowMs)`.
4. `DiagramStage` applies `bound.patches` with `applyPatches` and `renderOverlay` in one `requestAnimationFrame`, lays
   out with `viewBoxFor`/`applyLayout` (mode `fit`, `wheel: true`, `dragPan: true`), hosts `ChartLayer` with the `draft`
   prop (widgets of the draft), and writes the `editor` attribute layer (`data-dmap-selected`, `-affected`, `-highlight`,
   `tabindex`, `role=button`) with `setOwnedAttrs`. A click calls `cellAt(e.target, stage.index)` → `select(cellId)`.
5. Apply: `onOptionsChange({ ...options, config: commitDraft(draft), diagram: draft.diagram ?? options.diagram })`,
   then `dispatch({ type: 'applied' })`. The popup is not keyed by the saved revision: it keeps its state. "Apply and
   close" applies, then closes. Cancel dispatches `reset`. Close with a dirty draft opens `ConfirmModal`
   ("Discard changes?", confirm "Discard", dismiss "Keep editing").
6. Close: `setPopup(null)`. The panel renders once with the live props (P3: the hold ends).

Dirty = `JSON.stringify(draft.config) !== JSON.stringify(draft.saved) || draft.diagram?.hash !== savedDiagramHash`.

### 4.3 Esc and keyboard

- The popup sets `closeOnEscape={false}` and `closeOnBackdropClick={false}` and owns Esc: one `document` keydown
  listener in the capture phase while the popup is open. It ignores the event when `e.defaultPrevented` (react-select
  closes its menu with `preventDefault`), when the target is inside another `[role="dialog"]` (ConfirmModal,
  DrawioModal, a datasource modal) or inside the draw.io iframe (the iframe never forwards keys). Otherwise it calls
  `stopPropagation` and `requestClose()`. This also stops the Grafana `esc` keybinding (exit panel edit) and the
  "both modals close" case.
- The panel keeps its capture-phase Esc handler for cards, but opening the popup closes the card (`setCard(null)`).
- P2: the same listener handles Cmd/Ctrl+Z (undo), Shift+Cmd/Ctrl+Z and Ctrl+Y (redo). It skips text inputs,
  textareas and `contenteditable` targets (native undo keeps them). The header buttons always work.

### 4.4 Pause behind (P3)

New hook `useHeld<T>(value: T, hold: boolean): T` (`src/components/useHeld.ts`): returns the last value seen while
`hold` was false (state adjustment during render). Apply it in three places, all keyed on `paused = popup !== null`:

1. `DrawioMapPanelView` receives `paused` and holds its props and `useContext(PanelQueryContext)` as one object. All
   memos (`series`, `plan`, `resolve`, `result`, `legendBlocks`, `interactive`) keep their identity; no effect runs.
2. `useBindingSnapshots(..., paused)` holds its return value. The subscriptions stay (the cache stays warm), the
   listeners still write state, but the consumer sees the held value.
3. `ChartLayer paused` holds `Widget.response` and skips `onPrepared` publishes. The IntersectionObserver and the
   geometry stay live (the layout does not change while a modal is open).

`PanelQueryProvider` stays live: the popup needs the live `data`, `timeRange` and context generation. On close, `hold`
turns false; the next render sees the live values once. Keep-last-good is unchanged: the held render **is** the last
good render.

### 4.5 Centre stage: second stage instance

The popup re-parses `draft.diagram.svg` with `useStage`. Cost: one sanitise + parse + index per open per hash, and a
second SVG DOM while the popup is open. The demo diagram (108 cells) takes a few milliseconds; a multi-megabyte map can
take a few hundred milliseconds and blocks the first paint of the modal. Accept it in P1; the modal title and panes
paint first when the stage builds in an effect (open question Q3). Do not clone the panel root: its `original` values
are already patched, and the clone would carry the overlay and the editor attributes of the panel.

The draft diagram (a geometry save in draw.io) changes the hash: the stage rebuilds, the selection stays if the cell
still exists. The panel behind does not change until Apply and close.

### 4.6 Bundle

`DrawioMapPanel` imports the popup with `React.lazy(() => import('../editor/popup'))` and a `Suspense` with a null
fallback. The chunk holds `BindingsPopup`, `BindingEditor`, the panes, `BindingFields`, `QueryEditor`,
`PatternTransfer`, `bindingsModel`, `draft`, `history`. `module.js` shrinks (the editor leaves the entry).
`DiagramEditor` (options pane) keeps its static `DrawioModal` import. Verify on 12.4, 13.2 and the sandbox variants
(3122, 3123): the sandbox loads plugin code through its own loader. If a chunk fails to load there, fall back to a
static import and raise the limit in `scripts/check-bundle.sh` (a repo script) with a note in `docs/acceptance.md`.

## 5. Components and file plan

| File                                                   | Phase | Action  | Content                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/editor/popup/index.ts`                            | P1    | new     | `export { BindingsPopup as default }`: the lazy chunk entry.                                                                                                                                                                                                                                                                                                                                              |
| `src/editor/popup/BindingsPopup.tsx`                   | P1    | new     | `Modal` shell, header (title, dirty mark, Apply, Apply and close, Cancel, Close), Esc owner, `ConfirmModal`, passes props to `BindingEditor`.                                                                                                                                                                                                                                                             |
| `src/editor/popup/PopupLayout.tsx`                     | P1    | new     | Three panes with two nested `useSplitter` (row; `usePixels`; left 280 px, right 380 px initial; sizes kept in `localStorage` key `dmap.bindingsPopup.panes`). P2: tabs below 1000 px.                                                                                                                                                                                                                     |
| `src/editor/popup/DiagramStage.tsx`                    | P1    | new     | Centre pane. Props: `stage`, `stageRef`, `patches`, `selection`, `onSelect(cellId, { shift })`, `chartLayer`, `theme`. Pan/zoom with `usePanZoom`, reset button, editor attribute layer, outline styles.                                                                                                                                                                                                  |
| `src/editor/popup/ListPane.tsx`                        | P1    | new     | Filter input, "Problems only", groups Problems, Patterns, Overrides, Widgets (reuse `BindingsList`), Queries (new rows), footer: Add named query, Add eager panel reference, Default datasource, PatternTransfer.                                                                                                                                                                                         |
| `src/editor/popup/InspectorPane.tsx`                   | P1    | new     | Switch on the selection: cell → `BindingInspector` + today's sections; query → `QueryPane`; nothing → hint. P2: `CardPreview` on top. P3: `BulkPane`, `PatternFromSelection`.                                                                                                                                                                                                                             |
| `src/editor/popup/QueryPane.tsx`                       | P1    | new     | `QueryEditor` + "Preview query" + result line. P2: result table (first 20 rows, `getDisplayProcessor`), use list (rows that reference the query), error marks.                                                                                                                                                                                                                                            |
| `src/editor/popup/popupBus.ts`                         | P1    | new     | `PopupTarget`, `requestOpen`, `subscribe`.                                                                                                                                                                                                                                                                                                                                                                |
| `src/binding/context.ts`                               | P1    | new     | `bindContextFor({ theme, fieldConfig, replaceVariables, timeZone, linkWidth })` and `cardContextFor(...)`: one place for the `display` function. The panel and the popup call it.                                                                                                                                                                                                                         |
| `src/editor/BindingEditor.tsx`                         | P1    | changed | Keeps the model. Drops the inline `<aside>`, `inspectorWidth`, `children`, `onPreview`, `onQueryPreview`, `onPatternPreview`, `onDiagramPreview`. New props: `diagram`, `data`, `timeRange`, `timeZone`, `bindContext`, `initial: PopupTarget`, `onDirtyChange`, `onApply`. Renders `PopupLayout`.                                                                                                        |
| `src/editor/draft.ts`                                  | P1    | changed | `diagram?: Diagram` in `BindingDraft`; action `{ type: 'diagram'; diagram }`; `reset` restores the saved diagram; `applied` saves it. P2: `{ type: 'unset'; path }`. P3: `{ type: 'display-many'; cellIds; display }`.                                                                                                                                                                                    |
| `src/editor/history.ts`                                | P2    | new     | `HistoryState { past, present, future }`, `reduceHistory`, `undo`, `redo`. A step = an action that changes `config` or `diagram`. `applied` and `reset` clear `past` and `future`.                                                                                                                                                                                                                        |
| `src/editor/bindingsModel.ts`, `BindingsList.tsx`      | P1    | changed | `QueryRow { kind: 'query'; queryId; name; sourceKind; uses: number }`, `queries` in `BindingsList`, `rowMatches` for queries, `problemsOf(list)` flat list for the Problems group, row selection state (`selectedKey`).                                                                                                                                                                                   |
| `src/editor/BindingFields.tsx`, `EditorLayout.tsx`     | P2    | changed | `EditorField` gets `source?: FieldSource` (chip + "Reset to pattern"). `DisplayFields` gets `sourceOf(path)` and `onReset(path)`; each field passes its path.                                                                                                                                                                                                                                             |
| `src/interact/Card.tsx`                                | P2    | changed | `variant?: 'floating' \| 'inline'`: inline has static position, no close button, full pane width.                                                                                                                                                                                                                                                                                                         |
| `src/editor/proposeSelector.ts`                        | P3    | new     | `proposeSelector(selected: CellMeta[], all: CellMeta[]): { select: CellSelector; extra: string[]; missed: string[] }`.                                                                                                                                                                                                                                                                                    |
| `src/components/useHeld.ts`                            | P3    | new     | `useHeld(value, hold)`.                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/visuals/ChartLayer.tsx`, `useBindingSnapshots.ts` | P3    | changed | `paused` prop and parameter.                                                                                                                                                                                                                                                                                                                                                                              |
| `src/components/DrawioMapPanel.tsx`                    | P1    | changed | Remove the inline inspector, `draftConfig`, `draftDiagram`, `patternPreview`, `queryPreview`, `inspectorWidth`, the `editing` branches in `onClick`, `onKeyDown`, `onPointerMove` and `cardPatch`. Add `popup` state, lazy popup, corner button `dmap-edit-bindings`, badge `onClick`, bus subscription, `diagnostics` next to `warnings`. P3: `paused`. Keep the text `export function DrawioMapPanel(`. |
| `src/options/DiagramEditor.tsx`                        | P1    | changed | Button "Edit bindings" (`data-testid="dmap-edit-bindings-option"`, icon `link`, disabled without `value?.svg`) → `requestOpen({ kind: 'none' })`.                                                                                                                                                                                                                                                         |
| `src/module.ts`                                        | P1    | changed | The description of "Legacy rules" names the popup.                                                                                                                                                                                                                                                                                                                                                        |
| `README.md`                                            | P1–P3 | changed | Sections "Bind elements" and "All bindings" describe the popup; P2 adds undo/redo and sources; P3 adds multi-select.                                                                                                                                                                                                                                                                                      |
| removed code                                           | P1    | removed | The inline layout in `BindingEditor.tsx` (the `<aside>`, the `Diagram element` header `Select` moves to the list filter), `inspectorWidth`, the `<style>` block, the `editing` cell wiring in the panel.                                                                                                                                                                                                  |

Test IDs and labels. Keep: `role="complementary"` with `aria-label="Diagram binding inspector"` on the right pane,
`aria-label="Binding draft actions"` on the header actions, buttons "Apply bindings" and "Cancel changes", region
"All bindings list" on the left pane list. New: `data-testid="dmap-bindings-popup"` on the dialog body,
`data-testid="dmap-popup-stage"` on the centre stage (never `dmap-panel` or `dmap-stage`: page-wide locators of the
existing tests would hit two elements), `data-testid="dmap-edit-bindings"` (corner), `dmap-edit-bindings-option`
(options pane), buttons "Apply and close", "Close bindings", "Undo", "Redo", list group buttons "Problems (N)",
"Queries (N)", row buttons `Edit query <name>`.

## 6. Phases, acceptance criteria and tests

### P1: shell, panes, entry points, editor and list moved in, inline inspector removed

Scope: sections 4.1–4.3, 4.5, 4.6; the file plan rows marked P1. The Queries group has rows with name, id, source kind,
use count and a problem mark; a row opens `QueryPane` with the editor of today and its result line. Pattern selection
by a list row or by a cell of the stage; the "Diagram element" search becomes the list filter (a cell id typed in the
filter matches overrides and pattern matches; the stage click is the main way to select a cell).

Acceptance:

- In panel edit, the options pane button, the corner button and the warning badge open the popup. In view mode no
  corner button shows, the badge is a static element, and no chunk request happens (`tests/no-drawio.spec.ts`).
- The popup shows three panes; the splitters drag; sizes persist across opens.
- A click on a cell in the centre stage selects it: the inspector heading `<id> bindings` takes focus, the cell has
  `data-dmap-selected="true"` in the popup stage, and the panel behind has no editor attributes.
- Apply writes the options; "Apply and close" writes and closes; Cancel restores the saved draft; Close with a dirty
  draft asks; Esc asks the same way and does not exit panel edit; Esc inside an open Select only closes the menu.
- "Edit geometry in draw.io" opens `DrawioModal` on top; a save changes the centre stage, not the panel behind;
  Esc in the draw.io modal closes only the draw.io modal.
- The datasource query editor of the TestData and Prometheus datasources renders and its selects work inside the popup.
- `npm run check:bundle` passes; `dist/module.js` is smaller than before; a second file (the chunk) exists in `dist`.
- The e2e matrix (12.4 and 13.2) passes; the sandbox variant 3123 passes `tests/bindings-popup.spec.ts`.

Tests:

- Unit (vitest): `popupBus.test.ts`; `BindingsPopup.test.tsx` (open, dirty confirm, Esc ownership, apply and close);
  `DiagramStage.test.tsx` (patches applied, selection attributes, click selects, second stage leaves the panel DOM
  untouched); `bindingsModel.test.ts` (query rows, uses, `problemsOf`); migrate `BindingEditor.test.tsx`,
  `BindingsList.test.tsx`, `patternPreview.test.tsx`, `geometry.test.tsx` to render `BindingEditor` with a `diagram`
  prop and the pane labels; migrate the edit-mode tests of `DrawioMapPanel.test.tsx` to open the popup first
  (`vi.mock` the lazy import with the static module); corner order test gets the new button.
- e2e: new `tests/bindings-popup.spec.ts` (entry points, panes, Esc, dirty confirm, chunk loads on both versions,
  no chunk in view mode); migrate the specs of section 7.

### P2: live card, field sources, undo/redo, narrow layout

Scope: `CardPreview` at the top of the cell inspector built with `buildConfiguredCard(cardPatch, resolve, cardContextFor(...))` on the live `resolve` (the popup's `useBindingSnapshots` registers the hover demand of the
selected cell); `Card variant="inline"`. Field sources with `displayProvenance(draft.config, cellMeta)` and
`ownersOfPath` → `sourceOf(path)`; a chip "Pattern <name>", "Override" or "Default" beside each field; "Reset to
pattern" dispatches `unset` (removes the path from the override in element scope; in pattern scope the chip reads
"Reset to default"). `history.ts` with the keyboard and the header buttons. `PopupLayout` tabs below 1000 px of modal
width (`ResizeObserver`); a stage click in tab mode switches to the Inspector tab. `QueryPane` result table, uses and
error marks.

Acceptance:

- The card preview shows the same rows as the panel card for the same cell and data; it updates on a data refresh
  without a click; a cell without hover rows shows "No card for this element".
- A field set by a pattern shows the pattern name; an override shows "Override" and the reset button; reset removes
  the override key and the field shows the pattern value again; the Effective binding preview agrees.
- Ten edits, ten undos restore the saved config; redo replays them; a geometry save is one step; Apply clears the
  history; the buttons disable at the ends; Ctrl+Z inside a text input does not undo the draft.
- At 1280 px three panes; at 900 px three tabs; the tabs keep the selection.

Tests: unit `history.test.ts`, `CardPreview.test.tsx`, `fieldSource.test.ts` (paths of `DisplayFields` all resolve),
`PopupLayout.test.tsx` (tabs); e2e `tests/bindings-popup-inspector.spec.ts` (card preview, sources, undo/redo keys,
900 px tabs, screenshot).

### P3: multi-select, pattern from selection, bulk edit, pause behind

Scope: selection `string[]` in `BindingEditor` state (primary = last). Shift-click toggles. Shift+drag on the stage
draws a rubber band; cells whose `getBoundingClientRect` intersects it are selected (plain drag pans). The inspector
shows `BulkPane` for two or more cells: the common display (equal values) in `DisplayFields`, a list of the paths that
differ ("Mixed: link.a2bBinding, label"), and every change dispatches `display-many` (one history step). "Create
pattern from selection" calls `proposeSelector`: candidates in order: `{ kind, attrs }` with the attributes equal across
the selection (excluding `pg-id`, `id`, `label`), then `{ kind, label: /^<common prefix>/ }`, then `{ ids }`; the best
candidate has no missed cells and the fewest extra cells. The stage marks extras (`data-dmap-extra`) and missed cells
(`data-dmap-missed`); the selector fields are editable; "Create" dispatches `pattern` and switches to pattern scope.
Pause behind as in section 4.4.

Acceptance:

- Shift-click on three cells, Bulk edit sets a label template: three overrides exist, one undo removes all three.
- Box select over two routers of the demo diagram proposes `{ kind: 'node', attrs: { 'pg-kind': 'router' } }` with the
  other routers as extras; editing the selector updates the marks; Create adds the pattern.
- With the popup open and a 5 s dashboard refresh, the panel behind keeps `data-dmap-patched`, the link colours and
  the chart canvases unchanged for three refreshes; on close it updates within one render (the unit test counts the
  applier calls; the e2e test compares attribute snapshots).

Tests: unit `proposeSelector.test.ts`, `useHeld.test.ts`, `DrawioMapPanel.test.tsx` pause cases, `DiagramStage`
box select; e2e `tests/bindings-popup-selection.spec.ts`, `tests/refresh.spec.ts` gets a "popup open" case.

## 7. Migration of the existing e2e tests

| Spec                                                                            | Change                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/binding-editor.spec.ts`                                                  | Open the popup first (`dmap-edit-bindings`). Scope `inspector` to the popup dialog. Click cells in `dmap-popup-stage`. "Named queries" is a list group: select the query row, then use `QueryPane`. Close the popup before the run button and before `saveDashboard`. |
| `tests/bindings-list.spec.ts`                                                   | The list is the left pane: no "All bindings" tab. Group buttons gain "Problems (N)" and "Queries (N)". `data-dmap-selected` lives in `dmap-popup-stage`. The overflow checks measure the left pane at 1440 and the tab mode at 760 (P2).                              |
| `tests/editor-layout.spec.ts`                                                   | Rewrite for the popup: theme luminance of the dialog, no horizontal overflow at 1440x900 and 1024x768, header actions stay visible while the inspector body scrolls.                                                                                                  |
| `tests/editor.spec.ts` test 3                                                   | Open the popup, select `chart-1` in the stage, "Edit geometry in draw.io". Close the draw.io dialog with a locator scoped to `dmap-editor-modal`. Apply and close before save.                                                                                        |
| `tests/editor-refresh.spec.ts` (geometry)                                       | Open the popup before "Edit geometry in draw.io". The refresh runs with `dispatchEvent` already.                                                                                                                                                                      |
| `tests/cursor.spec.ts` test 2                                                   | Panel edit now behaves as view mode: assert the hand cursor on card cells only and no `role="button"` on other cells. Move the tab-stop and `data-dmap-selected` checks to `dmap-popup-stage` in `tests/bindings-popup.spec.ts`.                                      |
| `tests/zoom.spec.ts` fit test                                                   | Remove the two inspector lines. The fit check iterates `dmap-panel` only; the popup is closed there.                                                                                                                                                                  |
| `tests/options.spec.ts`                                                         | Add "Edit bindings" to the button list that must stay inside the 300 px pane.                                                                                                                                                                                         |
| `tests/reset-corner.spec.ts`                                                    | Add: in view mode no `dmap-edit-bindings`; the badge keeps its size.                                                                                                                                                                                                  |
| `tests/no-drawio.spec.ts`                                                       | Add: no request for a second plugin script in view mode.                                                                                                                                                                                                              |
| `tests/editor-missing.spec.ts`, `authoring-compat.spec.ts`, the view-mode specs | No change. Run them in the matrix.                                                                                                                                                                                                                                    |

Unit tests: `src/components/DrawioMapPanel.test.tsx` edit-mode cases open the popup; `BindingEditor.test.tsx`,
`BindingsList.test.tsx`, `patternPreview.test.tsx`, `geometry.test.tsx` pass `diagram` instead of `cells` and use the
pane labels. `src/editor/testUtils.ts` `selectElement` becomes a stage click helper or a filter helper.

## 8. Risks

| Risk                                                                                  | Mitigation                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chunk loading in the frontend sandbox or with CSP fails or is blocked.                | P1 runs `tests/bindings-popup.spec.ts` on 3122/3123/3133 before merge. Fallback: static import, raise the limit in `scripts/check-bundle.sh`, note it in `docs/acceptance.md`. |
| Esc closes two modals, or exits panel edit, or closes the popup from inside a Select. | The popup owns Esc (section 4.3). e2e asserts the three cases.                                                                                                                 |
| A datasource editor portals a focusable element and the focus trap fights it.         | Grafana `Modal` has no focus pull-back; `getInsideElements` includes the portal container. Check TestData and Prometheus editors in P1; keep `trapFocus` default.              |
| Two SVG DOM trees for a large diagram: memory and first-paint delay.                  | Build once per hash; destroy on close; measure with the largest demo fixture; Q3 for a deferred build.                                                                         |
| The panel behind still updates through controller listeners after P1.                 | Known until P3. P1 does not promise a frozen panel. P3 closes it with `paused` at the three places of section 4.4.                                                             |
| `useSplitter` behaves differently on 13.2 or is renamed.                              | It is public in 12.4. The e2e matrix runs on 13.2. Fallback: a 60-line local splitter hook in `PopupLayout.tsx`.                                                               |
| Each keystroke is one undo step.                                                      | Q1.                                                                                                                                                                            |
| `saveDashboard` helper fails with an open dialog.                                     | Tests close the popup before save (section 7).                                                                                                                                 |
| The `Diagram element` search Select goes away; users who typed an id lose that path.  | The list filter matches cell ids and labels (pattern matches, overrides). A cell without a binding is reachable by a stage click only; Q4.                                     |
| `Select` is deprecated in 12.4 (lint warnings).                                       | New single-value string selects use `Combobox`; existing fields stay.                                                                                                          |

## 9. Open technical questions and recommendations

- **Q1 Undo granularity.** Decision 5 says "each draft action = one step". `select` and `scope` are draft actions but
  change no config. Recommendation: a step is an action that changes `config` or `diagram`; consecutive `display`
  actions on the same path within 800 ms coalesce into one step (typing). If the user wants no coalescing, drop the
  timer: the reducer has a flag.
- **Q2 Ctrl+Z in text inputs.** Recommendation: native undo in text inputs, textareas and contenteditable; the draft
  undo everywhere else and through the header buttons.
- **Q3 Stage build timing.** Recommendation: P1 builds the stage in `useMemo` as today. If the largest fixture delays
  the first paint by more than 200 ms, P2 moves `buildStage` into an effect behind a spinner in the centre pane.
- **Q4 Selecting an unbound cell without the stage.** Recommendation: the list filter shows a "Cells" group of matching
  cell ids and labels when the text matches no row (max 20), as a fallback for keyboard users. Small; P1.
- **Q5 Box select gesture.** Recommendation: Shift+drag draws the rubber band; a plain drag pans (the stage has
  `dragPan: true`). Shift-click toggles one cell. Touch keeps pinch and pan; multi-select on touch is out of scope.
- **Q6 Options changed outside the popup while it is open.** Only Apply changes them in practice. Recommendation: the
  popup ignores external `options` changes; the panel renders them on close.
- **Q7 Entry point mechanism.** Recommendation: the module bus (section 4.1). If a reviewer prefers the Grafana
  `instanceState` route, it is a 20-line swap in `DiagramEditor` and `DrawioMapPanel`.
- **Q8 Apply while open.** Decision 8 means the panel behind shows the applied result only on close. Recommendation:
  keep it; the centre stage already shows it.

## 10. Documents to update

- `README.md`: "Bind elements", "All bindings", geometry, the query section (each phase, same diff).
- `docs/acceptance.md`: new rows for the popup checks and the chunk check after P1.
- `docs/superpowers/specs/2026-10-18-diagram-authoring-and-demand-data.md`: no edit; this spec supersedes its
  "side inspector" sentences in "Patterns, hover, and inspector". The PoC spec section 8 table needs no row: the PoC spec
  has no inspector decision.
