# Bindings popup: design and implementation spec

Date: 2026-10-23. Baseline: `9154966` (branch `main`). Grafana 12.4.13 and 13.2.4; `@grafana/*` 12.4.13 installed.
Status: approved product decisions (grilling session), design checked against the code, revised after the consilium
review (section 11). Workers implement it in three phases (`docs/superpowers/plans/2026-10-23-bindings-popup-phase-{1,2,3}.md`).

## 1. Goal

Replace the inline binding inspector (the `<aside>` that `BindingEditor` puts beside the panel in panel edit) with one
popup: a Grafana `Modal` of 95vw x 90vh with three resizable panes. The popup is the only place where the user edits
bindings, queries and diagram geometry. The real panel behind the popup stays as it is until the popup closes.

## 2. Approved decisions (do not reopen)

| #   | Decision                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Panel edit only. Three entry points: an "Edit bindings" button in the Diagram options category, a small button in the panel corner in panel edit, a click on the warning badge (opens at that problem). The inline inspector is removed.                                                          |
| 2   | Plugin-owned dialog with the look of a Grafana `Modal` (see section 11, "Sandbox DOM access"), 95vw x 90vh. Three resizable panes: left list (filter; groups Problems, Patterns, Overrides, Widgets, Queries), centre live diagram with panel data (zoom, pan, click to select), right inspector. |
| 3   | Queries are rows of the left list. A click opens the datasource query editor (`src/editor/QueryEditor.tsx`) in the right pane with a preview result table, error marks and use counts.                                                                                                            |
| 4   | The inspector keeps the sections of today and adds: a live hover-card preview with real data at the top; for each field the effective value and its source (pattern or override) with "Reset to pattern".                                                                                         |
| 5   | One draft for all edits, including a draw.io geometry save made from the popup. Apply writes the panel options; "Apply and close"; Cancel discards; a close with unsaved changes asks. Undo/redo with Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and header buttons.                                            |
| 6   | draw.io stays a separate modal (opaque-origin iframe, ADR 0001) that opens on top of the popup.                                                                                                                                                                                                   |
| 7   | Multi-select on the canvas (shift-click, box select). "Create pattern from selection" proposes a selector; "Bulk edit" writes one override per selected cell and shows mixed values.                                                                                                              |
| 8   | While the popup is open, the panel behind keeps its last render and does no per-refresh work. It renders once on close.                                                                                                                                                                           |
| 9   | Below about 1000 px the three panes become the tabs List, Diagram, Inspector.                                                                                                                                                                                                                     |
| 10  | Phases: P1 shell, panes, entry points, move the editor and the list in, remove the inline inspector. P2 live card, field sources, undo/redo, narrow layout. P3 multi-select, pattern from selection, bulk edit, pause behind.                                                                     |

## 3. Facts from the code that the design depends on

- `PanelQueryProvider` (`src/query/panel.tsx`) wraps the whole panel and gets the **saved** default datasource
  (`DrawioMapPanel.tsx:156`). `PanelQueryContext` gives `{ controller, context }`. Grafana `Modal` renders through
  `ReactDOM.createPortal` (react-aria `OverlayContainer` into `document.body`); React context passes through portals.
- Grafana `Modal` 12.4 uses floating-ui: `FloatingFocusManager modal={trapFocus}` with
  `getInsideElements={() => [getPortalContainer()]}`; it hides the outside DOM with `aria-hidden`. There is no handler
  that pulls the focus back into the dialog. `Select` menus (`menuShouldPortal`, default true) go to
  `#grafana-portal-container`.
- `Modal` Esc: `useDismiss` with a `document` keydown listener (bubble) and a React `onKeyDown`, both call
  `stopPropagation`. `closeOnEscape={false}` disables Esc **and** the outside-press dismiss. Two modals can be open; Esc
  with focus inside the inner modal closes only the inner one; Esc with focus on `document.body` closes both.
  react-select handles Esc in its React `onKeyDown` (deep in the tree) and calls `preventDefault` only: a capture
  listener on `document` runs **before** it.
- `useSplitter` (`@grafana/ui`) is the only resizable-pane primitive. There is no `Splitter` component.
- `StandardEditorContext` has no `timeRange` and no panel id. The options pane editor cannot own the popup.
- `useStage(containerRef, svg, hash)` sanitises, parses and indexes the SVG in `useMemo` **during render**, and mounts
  the root in a layout effect. `buildCellIndex` clones the label nodes of every cell (`svgStage.ts:111`).
- `setOwnedAttrs(el, 'editor', attrs)` keeps its layers in a `WeakMap` per element. A second stage has its own layers.
- The query controller releases an existing watch with the same `consumerId` when a new watch arrives
  (`controller.ts:277`). `useBindingSnapshots` builds ids `binding:<role>:<cellId>:...` (`useBindingSnapshots.ts:40`)
  and never watches again while it believes it holds the subscription (`:84`). `ChartLayer` uses `widget:<id>`
  (`ChartLayer.tsx:191`). A popup and a panel with the same ids would steal each other's subscriptions.
- `usePreviewTime` (`preview.ts:11`) advances `nowMs` on data, generation, snapshot changes and at status deadlines;
  `bindPlan` depends on it. `useSampleStale` has its own timers.
- `DrawioMapPanelView` recomputes `result`, `legendBlocks`, `interactive` and the chart layer on every data update.
- `dist/module.js` is 386 856 bytes. `scripts/check-bundle.sh` fails above 400 000 bytes and scans `module.js` only.
  The scaffold webpack config supports dynamic `import()`; no chunk exists yet and nothing proves chunk loading on
  12.4.13 or 13.2.4, in the sandbox, with CSP or under `app_sub_url`. `React.lazy` caches a rejected load.
- `tests/authoring-controls.ts` helpers take a scope locator; `selectDiagramElement` uses the "Diagram element"
  combobox. `saveDashboard` expects zero dialogs after save. `tests/build-authoring-probe.mjs` rewrites the text
  `export function DrawioMapPanel(`.

## 4. Architecture

### 4.1 Ownership and the entry channel

```
DrawioMapPanel (PanelProps)                       src/components/DrawioMapPanel.tsx
├─ PanelQueryProvider (live props)                src/query/panel.tsx
│  ├─ DrawioMapPanelView (held inputs while popup open)   P3: useHeld, consumer owner "panel:<id>"
│  │  └─ corner: reset, badge (click → open at problem), "Edit bindings" button (panel edit only)
│  └─ BindingsPopup (import strategy: spike, see 4.6)  src/editor/popup/BindingsPopup.tsx
│       └─ Modal 95vw x 90vh, closeOnEscape=false, closeOnBackdropClick=false, overlayStack entry
│            └─ BindingEditor (draft, history, stage, previews, draft query context, consumer owner "popup:<id>")
│                 ├─ ListPane / DiagramStage / InspectorPane
│                 └─ DrawioModal (geometry; child of the popup tree; overlayStack entry)
└─ popupBus (addressed) ← DiagramEditor "Edit bindings" (options pane)   src/editor/popup/popupBus.ts
```

- The **panel** owns the popup state `popup: PopupTarget | null`. It passes live `options`, `data`, `timeRange`,
  `timeZone`, `fieldConfig`, `replaceVariables`, `onOptionsChange`, `onClose` and `id` to the popup.
- The **popup** owns the draft, the history (P2), the second stage, the previews and the selection. It never touches
  the panel DOM.
- **Addressed bus.** `requestOpen(address, target)` and `subscribe(address, listener)` with
  `address = { pathname: location.pathname, editPanel: String(search.editPanel) }`, both sides read from
  `locationService`. The panel subscribes only while `usePanelEditing(id)` is true and unsubscribes on edit exit,
  unmount and address change. A request without a subscriber is dropped (the button shows a tooltip "Open the panel
  editor first"; it is disabled without a diagram).
- **Edit session.** When `editing` turns false (navigation, "Back to dashboard", browser back) or the panel unmounts,
  the popup closes and the draft is dropped, also while the popup chunk is still loading. P1 keeps this transition in
  place of the removed `wasEditing` reset.

### 4.2 Data flow

1. Open: `setPopup(target)`. The popup mounts `BindingEditor` with `config = options.config ?? EMPTY_CONFIG`,
   `diagram = options.diagram`, `base = { hash: options.diagram?.hash, config: JSON.stringify(options.config) }`
   (the pinned base revision), `data`, `timeRange`, `timeZone`, `fieldConfig`, `replaceVariables`,
   `bindContext = bindContextFor(...)` (new `src/binding/context.ts`, shared with the panel) and
   `service = useContext(PanelQueryContext)`.
2. **Draft query context.** The popup derives `draftService = { controller: service.controller, context: { ...service.context, defaultDatasource: draft.config.defaultDatasource } }` (memoised on the saved context and the
   draft default datasource) and gives it to every popup consumer: `useBindingSnapshots`, `ChartLayer`, the explicit
   previews and `previewPattern`. The provider keeps the saved default datasource for the panel.
3. The popup calls `useStage(stageRef, draft.diagram?.svg, draft.diagram?.hash)`: the centre stage. `cells` come from
   this stage, not from the panel.
4. The model is the one in `BindingEditor` today: `plan`, `resolve` with `prepared` = the popup's own
   `useBindingSnapshots(plan, draft.config, draftService, selectedCellId, width, chartPrepared, { owner })` plus the
   explicit previews, `bound = bindPlan(plan, resolve, bindContext, nowMs)`.
5. `DiagramStage` applies `bound.patches` with `applyPatches` and `renderOverlay` in one `requestAnimationFrame`, lays
   out with `viewBoxFor`/`applyLayout` (mode `fit`, `wheel: true`, `dragPan: true`), hosts `ChartLayer` with the `draft`
   prop and `owner`, writes the `editor` attribute layer with `setOwnedAttrs`. A click calls `cellAt(e.target, stage.index)` → `select(cellId)`.
6. **Apply with conflict detection.** Before Apply the popup compares the live `options` with `base`. Equal: write
   `onOptionsChange({ ...options, config: commitDraft(draft), diagram: draft.diagram ?? options.diagram })`, dispatch
   `applied`, move `base` to the new revision. Different (an external change while the popup was open): keep the
   draft, show an `Alert` "The saved bindings changed while you edited" with "Overwrite" (apply the draft over the new
   options and re-pin), "Reload saved" (drop the draft, reload from the live options) and "Keep editing". Apply stays
   blocked until the user chooses. The popup is not keyed by the revision: it keeps its state.
7. "Apply and close" applies, then closes (not when a conflict is pending). Cancel dispatches `reset`. Close with a
   dirty draft opens `ConfirmModal` ("Discard changes?", confirm "Discard", dismiss "Keep editing").
8. Close: `setPopup(null)`. The panel renders once with the live values (P3: the hold ends).

Dirty = `isDirty(draft)`: the config JSON differs from `draft.saved`, or `draft.diagram?.hash !== draft.savedDiagram?.hash`.

### 4.3 Esc and keyboard

- The popup sets `closeOnEscape={false}` and `closeOnBackdropClick={false}` and owns Esc in two layers:
  1. A React `onKeyDown` on the dialog body (bubble phase). It runs after react-select, Monaco and nested React
     handlers: it ignores `e.defaultPrevented` and targets inside another `[role="dialog"]` or the draw.io iframe, else
     calls `e.stopPropagation()` and `requestClose()`. React's `stopPropagation` stops the native event at the root
     container, before the Grafana `esc` keybinding on `document`.
  2. A `document` keydown listener in the **bubble** phase for the case "focus on `document.body`": it acts only when
     the target is not inside the dialog, the popup is the **topmost** entry of `overlayStack`, and the event is not
     `defaultPrevented`. `overlayStack` (`src/editor/popup/overlayStack.ts`) is a module-level stack; `BindingsPopup`,
     the `ConfirmModal` wrapper and `DrawioModal` push on mount and pop on unmount. A datasource dialog that we do not
     own is detected by the `[role="dialog"]` test of layer 1.
- Opening the popup closes the card of its panel (`setCard(null)`). In panel edit only the edited panel is mounted
  (scenes dashboards in 12.4 and 13.2), so no other panel listens for Esc.
- P2: the same two layers handle Cmd/Ctrl+Z (undo), Shift+Cmd/Ctrl+Z and Ctrl+Y (redo). They skip text inputs,
  textareas, `contenteditable` and the Monaco editor root (native undo). The header buttons always work.

### 4.4 Consumer ownership (P1) and pause behind (P3)

**Consumer namespaces.** `useBindingSnapshots(..., { owner })` and `ChartLayer owner` prefix every `consumerId` with
`owner` (`panel:<panelId>` and `popup:<panelId>`). The request cache of the controller keys on the resolved request
(`cacheKey`), not on the consumer id, so the dedup of equal requests stays. The panel and the popup hold their
subscriptions at the same time; closing the popup releases only `popup:*` consumers.

**Hold.** `useHeld<T>(value: T, hold: boolean): T` (`src/components/useHeld.ts`) is ref-based and idempotent:
`const ref = useRef(value); if (!hold) { ref.current = value; } return ref.current;`. No state write during render, so
no re-render loop. It is applied to each input separately (the props of `DrawioMapPanelView`: `data`, `timeRange`,
`options`, `fieldConfig`, `width`, `height`, `replaceVariables`, `timeZone`, and the `PanelQueryService` object), never
to a new object built each render. Also held: the return value of `useBindingSnapshots(..., paused)` and
`Widget.response` in `ChartLayer paused` (no `onPrepared` publish while paused). Subscriptions stay open.

**The clock keeps running.** `usePreviewTime` and `useSampleStale` are not paused: a status deadline re-runs
`bindPlan` once on held data and marks the data stale, which is true. Decision 8 is about per-refresh work; a frozen
clock would show stale data as fresh.

**Resume contract.** On close the hold ends; the next render reads the live inputs. `useBindingSnapshots` already
rejects a result whose demand key changed (`:139`); a result for a changed query is dropped, the latest compatible
result shows, and "keep last good" applies while a new request runs. A close during a loading preview releases the
popup consumers; the panel consumers are untouched.

P1 and P2 differ from the final behaviour: until P3 the panel behind keeps updating on refresh.

### 4.5 Centre stage: second stage instance

The popup re-parses `draft.diagram.svg` with `useStage` in render. Cost (estimates, to measure in P1 Task 0 on the
largest fixture and a synthetic 2000-cell diagram): one sanitise + parse + index per open per hash, a second SVG DOM
plus the cloned label nodes of every cell, and in P2 one retained `Diagram` object per geometry revision in the
history. Rules: the history keeps at most 5 distinct diagram revisions (older past entries are dropped first); the
stage is destroyed on close; if the measured build takes more than 200 ms, `BindingEditor` builds the stage in an
effect behind a spinner so the shell paints first (Q3). Do not clone the panel root: its `original` values are
already patched.

A geometry save changes the hash: the stage rebuilds, the selection stays if the cell still exists. The panel behind
does not change until Apply and close.

### 4.6 Bundle and import strategy

P1 starts with a spike (phase 1, Task 0): a trivial lazy component behind a temporary flag, built once, loaded on
12.4.13, 13.2.4, sandbox 3122/3123, CSP 3133, sandbox+CSP 3143 and sub-path 3153 by one Playwright test. Then:

- All green: the popup loads with `React.lazy`. Contract: a `Suspense` fallback `Modal` with a spinner; an error
  boundary with "The editor could not load" and a "Retry" button that creates a **new** lazy factory (React caches the
  rejected one); `scripts/check-bundle.sh` scans every `dist/*.js` for the draw.io tokens and reports the chunk sizes;
  `tests/no-drawio.spec.ts` asserts no chunk request in view mode.
- Any red: static import. `scripts/check-bundle.sh` limit goes to 500 000 bytes with the reason in `docs/acceptance.md`
  and in this section. View mode still loads no draw.io code (the invariant of `CODING_STANDARDS.md`).

**Task 0 result (2026-10-23): lazy.** All seven variants load the chunk. See `docs/acceptance.md`, table "Bindings popup: Task 0".

### 4.7 Draft operations

- `display` (one cell or one pattern), `unset path` (P2), `display-many` (P3) and `batch` (P3) are reducer actions.
- Arrays replace whole in `mergeDisplay`. So: a reset of a path inside an array (`hover.rows[i]...`, `status.rules[i]...`)
  resets the whole array path (`hover.rows`); and bulk edit writes **leaf paths**, never a partial object (4.7 in P3).

## 5. Components and file plan

| File                                                    | Phase | Action  | Content                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/editor/popup/index.ts`                             | P1    | new     | `export { BindingsPopup as default }`: the chunk entry (or the static import target).                                                                                                                                                                                                                                                                        |
| `src/editor/popup/BindingsPopup.tsx`                    | P1    | new     | `Modal` shell, header (title, dirty mark, Apply, Apply and close, Cancel, Close), Esc owner (4.3), `ConfirmModal`, conflict `Alert` (4.2 step 6), loading and error states (4.6).                                                                                                                                                                            |
| `src/editor/popup/overlayStack.ts`                      | P1    | new     | `push(id)`, `pop(id)`, `isTop(id)`, `useOverlay(id)`.                                                                                                                                                                                                                                                                                                        |
| `src/editor/popup/popupBus.ts`                          | P1    | new     | `PopupTarget`, `PopupAddress`, `currentAddress()`, `requestOpen(address, target)`, `subscribe(address, listener)`.                                                                                                                                                                                                                                           |
| `src/editor/popup/PopupLayout.tsx`                      | P1    | new     | Three panes with two nested `useSplitter` (row; `usePixels`; left 280 px, right 380 px; sizes in `localStorage` key `dmap.bindingsPopup.panes`). P2: tabs below 1000 px.                                                                                                                                                                                     |
| `src/editor/popup/DiagramStage.tsx`                     | P1    | new     | Centre pane: mount, patches, overlay, layout, pan/zoom, reset button, editor attribute layer, outlines, click select, `ChartLayer` host. P3: box select.                                                                                                                                                                                                     |
| `src/editor/popup/ListPane.tsx`                         | P1    | new     | Filter, "Problems only", groups Problems, Patterns, Overrides, Widgets, Queries, Cells (Q4), footer: Add named query, Add eager panel reference, Default datasource, `PatternTransfer`.                                                                                                                                                                      |
| `src/editor/popup/InspectorPane.tsx`                    | P1    | new     | Switch on the selection: cell → today's sections; query → `QueryPane`; nothing → hint. P2: `CardPreview`. P3: `BulkPane`, `PatternFromSelection`.                                                                                                                                                                                                            |
| `src/editor/popup/QueryPane.tsx`                        | P1    | new     | `QueryEditor` + "Preview query" + result line + use count. P2: result table, "Used by" list, delete with confirm, error marks.                                                                                                                                                                                                                               |
| `src/binding/context.ts`                                | P1    | new     | `bindContextFor(...)`, `cardContextFor(...)`: one place for the `display` function.                                                                                                                                                                                                                                                                          |
| `src/visuals/useBindingSnapshots.ts`, `ChartLayer.tsx`  | P1    | changed | `owner` in the consumer ids. P3: `paused`.                                                                                                                                                                                                                                                                                                                   |
| `src/editor/BindingEditor.tsx`                          | P1    | changed | Keeps the model. Drops the inline `<aside>` and the preview callbacks. New props: `diagram`, `base`, `data`, `timeRange`, `timeZone`, `bindContext`, `owner`, `initial`, `onDirtyChange`, `onApply`, `onRequestClose`. Draft query context (4.2 step 2). Renders `PopupLayout`.                                                                              |
| `src/editor/draft.ts`                                   | P1    | changed | `diagram`, `savedDiagram`, action `diagram`, `isDirty`. P2: `unset`. P3: `display-many` (leaf paths), `batch`.                                                                                                                                                                                                                                               |
| `src/editor/history.ts`                                 | P2    | new     | `HistoryState`, `reduceHistory`, coalescing by leaf path + owner + session, diagram revision cap 5, step cap 200.                                                                                                                                                                                                                                            |
| `src/editor/bindingsModel.ts`, `BindingsList.tsx`       | P1    | changed | `QueryRow`, `queries`, `rowMatches` for queries, `problemsOf(list)`, `cellRows(text, cells)` for the Cells group (exact id first, then prefix, then contains; "Show more" beyond 20), `selectedKey`.                                                                                                                                                         |
| `src/editor/fieldSource.ts`                             | P2    | new     | `fieldSourceOf(provenance, path, editingOwner, config)`: effective source and reset eligibility computed apart.                                                                                                                                                                                                                                              |
| `src/editor/BindingFields.tsx`, `EditorLayout.tsx`      | P2    | changed | `EditorField source`; `DisplayFields sourceOf(path)` and `onReset(path)`; array paths reset at the array.                                                                                                                                                                                                                                                    |
| `src/interact/Card.tsx`                                 | P2    | changed | `variant?: 'floating' \| 'inline'`.                                                                                                                                                                                                                                                                                                                          |
| `src/editor/proposeSelector.ts`                         | P3    | new     | `proposeSelector(selected, all): Proposal[]` with semantic candidates first (4.7, section 6 P3).                                                                                                                                                                                                                                                             |
| `src/editor/popup/BulkPane.tsx`                         | P3    | new     | Common leaves, mixed paths, leaf-level `display-many`.                                                                                                                                                                                                                                                                                                       |
| `src/components/useHeld.ts`                             | P3    | new     | Ref-based `useHeld(value, hold)`.                                                                                                                                                                                                                                                                                                                            |
| `src/components/DrawioMapPanel.tsx`                     | P1    | changed | Remove the inline inspector, draft previews, `inspectorWidth`, the `editing` branches. Add `popup` state, the import of the popup (4.6), corner button `dmap-edit-bindings`, badge `onClick`, addressed bus subscription with session cleanup, `diagnostics`, `owner="panel:<id>"`. P3: `paused` per input. Keep the text `export function DrawioMapPanel(`. |
| `src/options/DiagramEditor.tsx`                         | P1    | changed | Button "Edit bindings" (`data-testid="dmap-edit-bindings-option"`, disabled without `value?.svg`) → `requestOpen(currentAddress(), { kind: 'none' })`.                                                                                                                                                                                                       |
| `src/module.ts`, `README.md`, `scripts/check-bundle.sh` | P1–P3 | changed | Option text; README sections per phase; chunk scan or limit change (4.6).                                                                                                                                                                                                                                                                                    |
| removed code                                            | P1    | removed | The inline layout in `BindingEditor.tsx`, `inspectorWidth`, the `<style>` block, the `editing` cell wiring and `wasEditing` reset in the panel (replaced by the edit-session cleanup of 4.1).                                                                                                                                                                |

Test IDs and labels. Keep: `role="complementary"` with `aria-label="Diagram binding inspector"` on the right pane,
`aria-label="Binding draft actions"` on the header actions, buttons "Apply bindings" and "Cancel changes", region
"All bindings list" on the left pane list. New: `data-testid="dmap-bindings-popup"` on the dialog body,
`data-testid="dmap-popup-stage"` on the centre stage (never `dmap-panel` or `dmap-stage`), `data-testid="dmap-edit-bindings"`
(corner), `dmap-edit-bindings-option` (options pane), buttons "Apply and close", "Close bindings", "Undo", "Redo",
"Overwrite", "Reload saved", group buttons "Problems (N)", "Queries (N)", "Cells (N)", row buttons `Edit query <name>`.

## 6. Phases, acceptance criteria and tests

### P1: shell, panes, entry points, editor and list moved in, inline inspector removed

Scope: sections 4.1–4.3, 4.4 (consumer namespaces only), 4.5, 4.6; the P1 rows of section 5. The Queries group has
rows with name, id, source kind, use count and a problem mark; a row opens `QueryPane` with the editor of today, its
result line and the use count. Query deletion and the "Used by" list are P2. The "Diagram element" search is replaced
by the list filter with the Cells group.

Acceptance:

- Task 0 result recorded in `docs/acceptance.md`: chunk loading on the six variants, stage build time on the largest
  fixture and the synthetic diagram, peak heap with the popup open.
- In panel edit, the options pane button, the corner button and the warning badge open the popup; the button in the
  options pane of another dashboard or of view mode opens nothing. In view mode no corner button shows and no chunk
  request happens.
- The popup shows three panes; the splitters drag; sizes persist across opens.
- A click on a cell in the centre stage selects it: the inspector heading `<id> bindings` takes focus, the cell has
  `data-dmap-selected="true"` in the popup stage, and the panel behind has no editor attributes.
- The panel and the popup hold their query subscriptions at the same time: with the popup open, the panel's hover-only
  link colours stay; after close and reopen without a refresh, the popup previews fill from the cache and the panel
  consumers are still attached (unit test with a fake controller counting watches and releases per owner).
- A draft change of the default datasource reaches the automatic previews of the popup (the demand context carries
  it) and not the panel.
- Apply writes the options; "Apply and close" writes and closes; Cancel restores the saved draft; Close with a dirty
  draft asks; Esc asks the same way and does not exit panel edit; Esc inside an open Select (real react-select order)
  only closes the menu; Esc in a nested dialog closes only that dialog; Esc with focus on `body` asks.
- An external options change while the popup is open (test: `rerender` with new saved options, as
  `DrawioMapPanel.test.tsx:376`) blocks Apply with the conflict alert; "Overwrite" applies; "Reload saved" drops the draft.
- Leaving panel edit with the popup open closes it and drops the draft, also during the chunk load.
- "Edit geometry in draw.io" opens `DrawioModal` on top; a save changes the centre stage, not the panel behind.
- The TestData and Prometheus query editors work inside the popup with the keyboard: menus, code editor, a nested
  dialog (Prometheus metrics explorer), and focus returns to the opener on close.
- `npm run check:bundle` passes with the outcome of 4.6; the e2e matrix (12.4 and 13.2) passes; `tests/bindings-popup.spec.ts`
  passes on 3123 and 3133.

Tests: unit `popupBus.test.ts` (address match, no subscriber, cleanup), `overlayStack.test.ts`, `BindingsPopup.test.tsx`
(Esc layers with a real `Select`, dirty confirm, conflict alert, apply and close, loading and error states),
`DiagramStage.test.tsx`, `bindingsModel.test.ts` (query rows, `problemsOf`, `cellRows`), `useBindingSnapshots.test.tsx`
(owner prefix, two owners coexist); migrate `BindingEditor.test.tsx`, `BindingsList.test.tsx`, `patternPreview.test.tsx`,
`geometry.test.tsx` (`onDiagramPreview` → the stage hash of `dmap-popup-stage` changes and the panel hash does not),
`DrawioMapPanel.test.tsx` edit-mode cases (open the popup first; isolation: the panel DOM is unchanged by draft edits).
e2e: new `tests/bindings-popup.spec.ts`; migrate the specs of section 7.

### P2: live card, field sources, undo/redo, narrow layout

Scope: `CardPreview` on the live `resolve`; `Card variant="inline"`. Field sources: `fieldSourceOf` gives the effective
source from `displayProvenance` and the reset eligibility from the **edited owner's own display** (does the override or
the pattern set this path or an array above it); the chip reads "Pattern <name>", "Override" or "Default"; "Reset to
pattern" dispatches `unset` on the leaf path, or on the array path for a path inside `hover.rows[i]` or
`status.rules[i]` (the button then reads "Reset hover rows to pattern"); in pattern scope the label is "to default".
History (Q1): a step is an action that changes `config` or `diagram`; consecutive `display` actions coalesce only when
they touch exactly one and the same leaf path, the same owner (cell or pattern index) and the same session, within
800 ms; `select`, `scope`, `undo`, `redo`, `applied`, `reset` and a `diagram` action end the session. Tabs below
1000 px. `QueryPane` result table, "Used by" list, delete with confirm.

Acceptance:

- The card preview shows the same rows as the panel card for the same cell and data; it updates on a data refresh
  without a click; a cell without hover rows shows "No card for this element".
- A field set by a pattern shows the pattern name; an override shows "Override" and the reset button; a reset inside a
  hover row resets the whole rows array and the rows of the pattern show again; the Effective binding preview agrees.
- Ten edits, ten undos restore the saved config; redo replays them; typing "abc" into one field is one step; typing
  into two different fields is two steps; a selection between two keystrokes splits the step; a geometry save is one
  step; Apply clears the history; Ctrl+Z inside a text input or the Monaco editor does not undo the draft; Ctrl+Z with a
  nested dialog open does nothing.
- At 1280 px three panes; at 900 px three tabs; the tabs keep the selection.

Tests: unit `history.test.ts`, `CardPreview.test.tsx`, `fieldSource.test.ts` (every path of `DisplayFields`; array
reset; eligibility apart from source), `PopupLayout.test.tsx`; e2e `tests/bindings-popup-inspector.spec.ts` (card
preview, sources, array reset, undo/redo keys incl. the Prometheus code editor and a nested dialog, 900 px tabs).

### P3: multi-select, pattern from selection, bulk edit, pause behind

Scope: selection `string[]` (primary = last). Shift-click toggles. **Box select** (Q5): Shift+pointerdown on the stage
with a mouse or pen starts a band; once the pointer leaves the 4 px click slop the stage calls `setPointerCapture` (a captured press would send its click to the stage, so Shift-click could not toggle the cell under it); the band follows `pointermove`; `pointerup` or `pointercancel` anywhere
ends it (capture delivers them); Esc cancels it; a release outside the stage counts the band clipped to the stage; the
next `click` after a band is suppressed (a `takeClick`-style flag); a plain drag pans. Cells whose group
`getBoundingClientRect` intersects the band are selected.
**Create pattern from selection:** `proposeSelector` builds the candidates `{ kind, attrs }` (attributes equal across
the selection, except `pg-id`, `id`, `label`, `pg-schema`; attributes dropped one by one while missed stays zero and
extras do not grow), `{ kind, label: /^<escaped common prefix>/ }` (prefix of three or more characters), `{ ids }`.
Ranking: drop candidates with missed cells; semantic candidates (attrs, then label) come **before** `ids`; among
attrs candidates the fewest extras win. `ids` is the fallback, never the first proposal when a semantic candidate
exists. The stage marks extras and missed cells; the selector is editable; "Create" is one `batch` step.
**Bulk edit:** `commonLeaves(cellIds, plan)` returns the leaf paths with equal values across the effective displays and
`mixedPaths`; `BulkPane` renders `DisplayFields` with the common leaves and the chip "Mixed" on mixed paths; a change
is turned into leaf operations (`diffLeaves(before, after)`) and dispatched as `display-many { cellIds, ops: [{ path, value }] }`, which sets each leaf in each override and leaves every other leaf, inherited or own, untouched. Array
fields (`hover.rows` and every other array) and the health rule `status` (replaced as a whole when its kind changes) are editable in bulk only when all cells have identical values; otherwise the
section shows "Mixed, edit per element". Pause behind as in 4.4.

Acceptance:

- Shift-click on three cells, Bulk edit sets a label template: three overrides exist; the hover rows and the link
  bindings of each cell (own and inherited) are unchanged; one undo (before Apply) removes all three.
- Box select over two routers of the demo diagram proposes `{ kind: 'node', attrs: { 'pg-kind': 'router' } }` first
  with the other routers as extras and `ids` last; editing the selector updates the marks; Create adds the pattern.
- A band started on the stage and released outside selects the cells inside the clipped band; Esc during a band selects
  nothing; the click after a band selects nothing.
- With the popup open and a 5 s dashboard refresh, the panel behind keeps `data-dmap-patched`, the link colours and
  the chart canvases unchanged for three refreshes; a status deadline during the pause still marks the status stale;
  on close it updates within one render; a close during a loading preview leaves the panel consumers attached.

Tests: unit `proposeSelector.test.ts`, `useHeld.test.ts` (no loop with a new object each render), `BulkPane.test.tsx`
and `draft.test.ts` (leaf ops keep inherited and unrelated fields), `DrawioMapPanel.test.tsx` pause cases (refresh,
deadline, close during loading), `DiagramStage` box select (capture, cancel, outside release, click suppression);
e2e `tests/bindings-popup-selection.spec.ts`, `tests/refresh.spec.ts` "popup open" case.

## 7. Migration of the existing e2e tests

| Spec                                                                            | Change                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/binding-editor.spec.ts`                                                  | Open the popup first. Scope `inspector` to the popup dialog. Click cells in `dmap-popup-stage`. The draft assertions (line 107 and after) move to the popup stage and add isolation: the panel `dmap-panel` keeps its attributes while the draft changes. Select the query row, then use `QueryPane`. Close the popup before the run button and before `saveDashboard`. |
| `tests/bindings-list.spec.ts`                                                   | The list is the left pane: no tabs. Group buttons gain "Problems (N)", "Queries (N)", "Cells (N)". `data-dmap-selected` lives in `dmap-popup-stage`. Overflow checks: the left pane at 1440, the tab mode at 760 (P2).                                                                                                                                                  |
| `tests/editor-layout.spec.ts`                                                   | Rewrite for the popup: theme luminance of the dialog, no horizontal overflow at 1440x900 and 1024x768, header actions stay visible while the inspector body scrolls.                                                                                                                                                                                                    |
| `tests/editor.spec.ts` test 3                                                   | Open the popup, select `chart-1` in the stage, "Edit geometry in draw.io". Close the draw.io dialog with a locator scoped to `dmap-editor-modal`. Apply and close before save.                                                                                                                                                                                          |
| `tests/editor-refresh.spec.ts` (geometry)                                       | Open the popup before "Edit geometry in draw.io". New semantics: after the save the `dmap-popup-stage` hash changes, the `dmap-panel` hash does not; after "Apply and close" the panel hash changes. The frame survives two refreshes as before.                                                                                                                        |
| `tests/cursor.spec.ts` test 2                                                   | Panel edit behaves as view mode: hand cursor on card cells only, no `role="button"` on other cells. The tab-stop and `data-dmap-selected` checks move to `dmap-popup-stage` in `tests/bindings-popup.spec.ts`.                                                                                                                                                          |
| `tests/zoom.spec.ts` fit test                                                   | Remove the two inspector lines. The fit check iterates `dmap-panel` only; the popup is closed there.                                                                                                                                                                                                                                                                    |
| `tests/options.spec.ts`                                                         | Add "Edit bindings" to the button list that must stay inside the 300 px pane.                                                                                                                                                                                                                                                                                           |
| `tests/reset-corner.spec.ts`                                                    | Add: in view mode no `dmap-edit-bindings`; the badge keeps its size.                                                                                                                                                                                                                                                                                                    |
| `tests/no-drawio.spec.ts`                                                       | Add: no request for a second plugin script in view mode (lazy outcome only).                                                                                                                                                                                                                                                                                            |
| `tests/authoring-controls.ts`                                                   | `selectDiagramElement` → `selectStageCell(dialog, id)` (click in `dmap-popup-stage`) and `filterBindings(dialog, text)`; add `openBindingsPopup(page)`, `closeBindingsPopup(page)`.                                                                                                                                                                                     |
| `tests/editor-missing.spec.ts`, `authoring-compat.spec.ts`, the view-mode specs | No change. Run them in the matrix.                                                                                                                                                                                                                                                                                                                                      |

New tests across phases: panel and popup subscriptions at the same time; reopen without refresh; owner reuse after
close; external conflict; real `Select` Esc order; freshness deadline during the pause; close during loading.

## 8. Risks

| Risk                                                                               | Mitigation                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Chunk loading fails in the sandbox, with CSP or under a sub-path.                  | Task 0 spike on six variants decides lazy or static (4.6). Lazy has a retry contract.                                                |
| Esc closes two modals, exits panel edit, or closes the popup from inside a Select. | Two-layer Esc ownership with the overlay stack (4.3). e2e asserts the cases with a real `Select` and a nested dialog.                |
| The popup and the panel steal each other's query subscriptions.                    | Consumer owner namespaces in P1 (4.4). Unit test with two owners.                                                                    |
| The pause loops or still does per-refresh work.                                    | Ref-based `useHeld` per input; held consumer outputs; the clock stays; resume contract (4.4). Tests count renders and applier calls. |
| A datasource editor breaks the focus trap.                                         | Keep the default trap. P1 tests TestData and Prometheus: keyboard, menus, Monaco, nested dialog, focus return.                       |
| Two SVG DOM trees and retained diagram revisions for a large diagram.              | Measure in Task 0; destroy on close; cap 5 diagram revisions; deferred build above 200 ms (Q3).                                      |
| The draft default datasource does not reach the automatic previews.                | Draft query context for all popup consumers (4.2 step 2).                                                                            |
| An external options change is applied over silently.                               | Pinned base revision and the conflict alert (4.2 step 6).                                                                            |
| `useSplitter` differs on 13.2.                                                     | The e2e matrix runs on 13.2. Fallback: a 60-line local splitter hook.                                                                |
| `saveDashboard` fails with an open dialog.                                         | Tests close the popup before save (section 7).                                                                                       |
| `Select` is deprecated in 12.4 (lint warnings).                                    | New single-value string selects use `Combobox`; existing fields stay.                                                                |

## 9. Open technical questions: answers after the consilium

- **Q1 Undo granularity.** A step is an action that changes `config` or `diagram`. Coalescing by exact leaf path +
  owner + session within 800 ms; selection, scope, undo, redo, Apply, reset and a geometry save end the session. A
  `coalesceMs: 0` flag disables it.
- **Q2 Ctrl+Z in text inputs.** Native undo in text inputs, textareas, contenteditable and Monaco; the draft undo
  everywhere else and through the header buttons. Tests include a datasource code editor and a nested dialog.
- **Q3 Stage build timing.** `useStage` builds in render, so the shell cannot paint first with it. P1 Task 0 measures;
  above 200 ms on the large fixtures the build moves into an effect behind a spinner in P1, not P2.
  **Task 0 result: build in render.** The 2000-cell diagram builds in 77 ms (limit 200 ms); a second stage adds 0.7 to 1.6 MB.
- **Q4 Cells group.** Shown whenever the filter has text: exact id first, then id prefix, then contains in id or label;
  20 rows and a "Show more" button.
- **Q5 Box select.** Shift+drag with pointer capture, Esc cancel, outside release clipped, click suppression (6, P3).
- **Q6 External option changes.** Not ignored: pinned base revision, conflict alert with Overwrite, Reload saved, Keep
  editing (4.2 step 6).
- **Q7 Entry channel.** The addressed bus (pathname + `editPanel`) with edit-session cleanup (4.1). `instanceState`
  stays the fallback; it needs its own integration test on both versions and in the sandbox.
- **Q8 Apply while open.** Keep. P1 and P2 differ from the final behaviour: the panel behind still refreshes until P3.

## 10. Documents to update

- `README.md`: "Bind elements", "All bindings", geometry, the query section (each phase, same diff).
- `docs/acceptance.md`: the Task 0 spike results, the popup checks per phase, the bundle outcome.
- `docs/superpowers/specs/2026-10-18-diagram-authoring-and-demand-data.md`: no edit; this spec supersedes its
  "side inspector" sentences. The PoC spec section 8 table needs no row.

## 11. Consilium decisions

Review of `276d5da` by Codex (astra). Each claim was checked against the code. Product decisions stay fixed.

| Item                               | Astra's view                                                                                            | Decision               | Reason                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q6 external changes                | Pin the base revision, detect conflicts, keep the draft.                                                | Accepted               | `DrawioMapPanel.test.tsx:376` shows the case. Section 4.2 step 6.                                                                                                                                                                                                                                                                                                                |
| Q7 entry channel                   | No unaddressed bus; address by dashboard + panel + session.                                             | Accepted               | `usePanelEditing` compares the numeric id only. Address = pathname + `editPanel`, session cleanup (4.1).                                                                                                                                                                                                                                                                         |
| Q1 undo coalescing                 | Coalesce by exact leaf path + owner + session; `Object.keys` groups unrelated paths.                    | Accepted               | Section 9 Q1.                                                                                                                                                                                                                                                                                                                                                                    |
| Q2 native undo                     | Agree; test code editors and nested dialogs.                                                            | Accepted               | Section 9 Q2.                                                                                                                                                                                                                                                                                                                                                                    |
| Q3 stage in render                 | `useStage` builds in render; measure first.                                                             | Accepted               | `useStage.ts:41`. Task 0 measures; deferred build moves to P1 if needed.                                                                                                                                                                                                                                                                                                         |
| Q4 cells group                     | Show always when filtering; exact ids first; access beyond 20.                                          | Accepted               | Section 9 Q4.                                                                                                                                                                                                                                                                                                                                                                    |
| Q5 box select details              | Pointer capture, cancel, outside release, click suppression.                                            | Accepted               | Section 6 P3.                                                                                                                                                                                                                                                                                                                                                                    |
| Q8 interim behaviour               | State that P1 and P2 differ from the final pause.                                                       | Accepted               | Sections 4.4 and 9.                                                                                                                                                                                                                                                                                                                                                              |
| A1 consumer id theft               | Namespace consumers per owner; keep the cache dedup.                                                    | Accepted (P1)          | Verified: `controller.ts:277` releases the same id; `useBindingSnapshots.ts:84` never re-watches. Section 4.4.                                                                                                                                                                                                                                                                   |
| A2 pause loop and remaining work   | Stable snapshot boundary; pause clock-driven updates; resume contract.                                  | Accepted in part       | The loop is real (state write during render with a new object). Fixed with a ref-based `useHeld` per input and a resume contract. **Rejected:** pausing `usePreviewTime` and `useSampleStale`. A frozen clock shows stale data as fresh, against the "never a good state for missing data" rule; a deadline re-runs `bindPlan` once on held data, which is not per-refresh work. |
| A3 Esc order and topmost overlay   | Capture listener runs before react-select; track the topmost overlay; other panels.                     | Accepted in part       | Verified in react-select. Layer 1 moves to a React `onKeyDown` on the dialog (bubble); `overlayStack` tracks the topmost overlay. **Rejected:** the "other panel's card listener" case. In panel edit only the edited panel is mounted (scenes, 12.4 and 13.2); its card closes on open. An e2e case pins a card, opens the popup and presses Esc to prove it.                   |
| A4 draft default datasource        | One draft query context for all popup consumers.                                                        | Accepted               | Verified: the provider gets the saved value, `useBindingSnapshots` uses `service.context`. Section 4.2 step 2.                                                                                                                                                                                                                                                                   |
| A5 bus ownership and cleanup       | Dispose on edit exit, owner change, navigation, also while loading.                                     | Accepted               | Section 4.1 "Edit session".                                                                                                                                                                                                                                                                                                                                                      |
| A6 static import as the P1 default | Static is safer; lazy needs a load/error/retry contract and a full matrix.                              | Accepted with a change | The spike (Task 0) on six variants decides before any popup code; lazy gets the retry contract and chunk scanning; static gets the documented limit change. A fixed static default would give up the view-mode bundle gain without a measurement.                                                                                                                                |
| A7 focus claim too broad           | Keep the default trap; test TestData and Prometheus fully.                                              | Accepted               | Section 3 wording narrowed; P1 acceptance lists the keyboard, Monaco, nested dialog and focus return checks.                                                                                                                                                                                                                                                                     |
| A8 second-stage memory             | Cloned label nodes, retained geometry revisions; mark timings as estimates.                             | Accepted               | `svgStage.ts:111`. Section 4.5: estimates, measurement in Task 0, cap of 5 diagram revisions.                                                                                                                                                                                                                                                                                    |
| P1 bulk edit wipes hover rows      | Partial objects replace `hover`; define leaf-level operations.                                          | Accepted               | Verified: `changeDisplay` spreads top-level keys; `DisplayFields` substitutes `[]`. Section 6 P3: leaf ops, arrays only when identical.                                                                                                                                                                                                                                          |
| P2 task order                      | Primitives first, integration in one step, browser migration last; defer deletion.                      | Accepted               | Phase 1 plan rewritten in that order; query deletion and the "Used by" list move to P2.                                                                                                                                                                                                                                                                                          |
| P3 reset inside arrays             | Arrays replace whole; reset the whole array; eligibility from the edited owner.                         | Accepted               | Verified: `mergeDisplay` comment "Arrays replace". Section 6 P2.                                                                                                                                                                                                                                                                                                                 |
| P4 selector ranking                | `missed*1000+extra` always ranks `ids` first.                                                           | Accepted               | Verified arithmetic. Semantic candidates first, `ids` as the fallback (6, P3).                                                                                                                                                                                                                                                                                                   |
| P5 test migration details          | editor-refresh semantics, draft isolation, geometry test, combobox helper, undo after Apply, new tests. | Accepted               | Section 7 rows updated; the phase 3 e2e undoes before Apply; the new test list is in section 7.                                                                                                                                                                                                                                                                                  |

### Sandbox DOM access: Grafana `Modal` replaced by a plugin-owned dialog

Found in P1 on the sandbox variants 3122, 3123 and 3143. Decided by the second consilium (Fable and astra, option 1).

- **Fact.** `getSafeSandboxDomElement` (Grafana `documentSandbox.ts`, 12.4.13 and 13.2.4) gives plugin code the real element only if
  its `parentNode` is `document.body`, it is outside `#reactRoot`, or it is inside `[data-plugin-sandbox=<plugin id>]`. Any other
  element in `#reactRoot` arrives as a detached mock. `#grafana-portal-container`, the portal of `Modal`, is inside `#reactRoot`.
  So the `ref` of the diagram stage in a `Modal` was a mock, and the imperative DOM work of the stage did not reach the page.
- **Decision.** The popup is a plugin-owned dialog (`src/editor/popup/PluginDialog.tsx`). Its host is a `div` that carries
  `data-plugin-sandbox=<plugin id>` and sits directly in `document.body` while the dialog is mounted. It renders a backdrop and a
  `role="dialog" aria-modal="true"` box through `createPortal`, with the tokens of `getModalStyles` (size 95vw x 90vh).
- **Z-order.** The dialog uses `zIndex.modal - 1` and the backdrop `zIndex.modalBackdrop - 1`. A Grafana `ConfirmModal`, the draw.io
  `DrawioModal` and the `Select` menus (Grafana portals) paint above it.
- **Focus.** Own trap: initial focus inside, Tab and Shift+Tab wrap, focus returns to the opener on close (the panel records the
  opener at the click, because the chunk loader mounts later), body scroll lock. Outside the dialog, `inert` is set on the page
  except on the ancestors of the portal container, so that a nested Grafana modal stays usable. In the sandbox the portal container
  is a mock and its place is unknown: the app root stays usable, and `aria-modal`, the backdrop and the trap keep the user inside.
  `@floating-ui/react` is not added.
- **Esc.** `useEscOwner` treats an event target that is a sandbox mock (`data-grafana-plugin-sandbox-element`) as an element of
  another owner. The document layer runs in the capture phase, so the Grafana `esc` key binding does not leave panel edit.
- **Loading and error states** use the same dialog, not a Grafana `Modal`, so that no Grafana focus manager competes for the focus.
