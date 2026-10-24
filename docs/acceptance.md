# PoC acceptance

Baseline: 2026-10-17. This file replaces the earlier results of the same day. Grafana 12.4.13 and 13.2.4.
draw.io 32.4.1. Stack: `docker compose` from this repository, started with
`docker compose up -d --force-recreate --wait` and checked with `scripts/wait-stack.sh`.

Every result below is real output from this run. `npm run ci:local` passed end to end (exit 0): it runs the same steps as CI
(`.woodpecker/build.yaml`, `.woodpecker/e2e.yaml`).

## E2E suites by Grafana version

The Playwright projects are `matrix` (the tests on surfaces that differ between Grafana versions) and `plugin` (the plugin's own DOM).
The rows below that say "PASS on both versions" were measured before the split. Since the split:

| Command               | Runs                                                          | Use                                        |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| `npm run e2e:12`      | `matrix` on 12.4                                              | the version split suite, first half        |
| `npm run e2e:13`      | `matrix` and `plugin` on 13.2                                 | the version split suite, second half       |
| `npm run e2e:matrix`  | `e2e:12` then `e2e:13`                                        | before the push; CI runs the same split    |
| `npm run e2e:release` | `matrix` and `plugin` on 12.4 and 13.2, then the WebKit check | before a tag: the safety net for the split |

A plugin DOM regression on 12.4 only is found by `e2e:release`, not by the push suite. The `matrix` list is in the README, section "E2E suites".

## Spec checks (spec section 6, with the superseded decisions applied)

| #   | Check                        | Command                                                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | build, typecheck, lint, test | `npm run typecheck && npm run lint && npm test && npm run build` | PASS. typecheck: 0 errors. lint: `2 problems (0 errors, 2 warnings)`; the 2 warnings are the deprecated `Select` in an option editor. test: `Test Files 29 passed (29)`, `Tests 309 passed (309)`. build: `webpack 5.112.0 compiled successfully`.                                                                                                                                                                                                                                 |
| 2   | stack and demo dashboard     | `npm run stack:up && npm run stack:smoke`                        | PASS. `scripts/wait-stack.sh` ready after 11 s on a new stack (series, `rate()`, `/api/health`, plugin on :3012 and :3013). Smoke: the WAN link of the demo network has `40999845.86889414` bit/s (expected about 41e6), `OK`. Demo dashboard on both versions (Playwright, 1600×1000): the portograph panel has 108 cells, 20 patched cells, 40 link halves, 0 warnings; the hand-drawn panel has 10 cells, 2 patched cells, 8 link halves, 0 warnings. 0 iframes, 0 page errors. |
| 3   | editor round trip            | `tests/editor.spec.ts`                                           | PASS on both versions. The test opens the bundled editor, inserts a shape, saves, and checks that the Diagram status hash and the panel `data-dmap-hash` change. It also runs the isolation probes (see `docs/security.md`). A second test checks that the saved SVG embeds the plugin image files.                                                                                                                                                                                |
| 4   | hover and pinned card        | `tests/links.spec.ts`                                            | PASS on both versions. A hover shows the card with both directions and sparklines. A click pins the card; the card has the display url link and the field data links; Esc closes it; a click on another cell moves it. A click on a sparkline opens the URL of its row. On a phone viewport, a tap pins the card as a bottom sheet.                                                                                                                                                |
| 5   | e2e both versions            | `npm run e2e:matrix`                                             | PASS. 12.4.13: `22 passed`. 13.2.4: `22 passed`. 21 tests and the login setup.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | no draw.io scripts in view   | `npm run check:bundle`; `tests/no-drawio.spec.ts`                | PASS. `dist/module.js: 197351 bytes`, `No React 19 breaking changes detected`, `bundle OK`. `tests/no-drawio.spec.ts` passes on both versions: no request for draw.io files and no iframe in view mode.                                                                                                                                                                                                                                                                            |

## Current UI

| Feature                   | Proof                                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Link colours by direction | `tests/view.spec.ts`                                                          | PASS on both versions. Link halves take colours from the synthetic traffic; link labels stay above the coloured halves; curved halves follow the edge path.                                                                                                                                                                                                                                                         |
| Node icon colouring       | `tests/view.spec.ts` (`node state colours the node icon, not the whole node`) | PASS on both versions. The icon of the node whose `up` series is 0 is red; the node shape keeps its colour.                                                                                                                                                                                                                                                                                                         |
| Grafana-native colours    | `tests/color.spec.ts`                                                         | PASS on both versions. A WAN link takes its colour from the continuous scheme of its field (override of query `W`). A LAN link takes it from the thresholds.                                                                                                                                                                                                                                                        |
| Capacity sources          | `tests/color.spec.ts`                                                         | PASS on both versions. The hover card shows the capacity of a WAN link from the field **Max** (`41% of 100 Mb/s`) and of a LAN link from the port speed series `S` (`48% of 1 Gb/s`). The hand-drawn panel reads the capacity from a cell attribute.                                                                                                                                                                |
| Live zoom and pinch zoom  | `tests/zoom.spec.ts`                                                          | PASS on both versions. Ctrl+wheel (a trackpad pinch) zooms, the reset button shows and restores the view. On a phone, a one-finger swipe at the configured view does not zoom, a pinch zooms, and the reset button restores the view. The alignment of the fitted diagram (top, centred) is a unit test: `DrawioMapPanel.test.tsx` "a fitted diagram goes to the top by default, to the centre with Align: center". |
| Reset button corner       | `tests/reset-corner.spec.ts`                                                  | PASS on both versions. One dashboard with four panels (one legend corner each) for untitled panels and one for titled panels: two page loads for 8 checks. After a zoom, the reset button is in the top-left corner. It does not touch the Grafana panel menu button (panel with and without a title), the status band, the warning badge or the legend in any corner. A click restores the view.                   |
| Theme                     | `tests/view.spec.ts`                                                          | PASS on both versions. The diagram background follows the Grafana theme (light and dark), not the OS preference.                                                                                                                                                                                                                                                                                                    |
| Diagram options layout    | `tests/options.spec.ts`                                                       | PASS on both versions. The Diagram option buttons stay inside the options pane at the narrowest width.                                                                                                                                                                                                                                                                                                              |
| Plugin package            | `npm run package`                                                             | PASS. `artifacts/simnv-drawiomap-panel-1.0.0.zip`: 22104392 bytes (21.1 MB). One top folder `simnv-drawiomap-panel/`. `dist/` is 56592 KB in 2411 files; `dist/drawio/` is 55628 KB of it.                                                                                                                                                                                                                          |

Screenshots: `docs/images/card-hover-desktop.png`, `card-pinned-desktop.png`, `card-mobile-sheet.png`,
`zoomed-reset-button.png`, `options-diagram.png`, `labels-above-links.png` (set `DMAP_SCREENSHOTS=docs/images`
to write them again).

## Isolation variants

The services of the compose profile `isolation` (see `docker-compose.yaml`). Command:
`docker compose --profile isolation up -d --wait <service>`, then `GRAFANA_URL=<url> npx playwright test`.

| Grafana | Setting                          | URL                           | Result              |
| ------- | -------------------------------- | ----------------------------- | ------------------- |
| 12.4.13 | frontend sandbox                 | http://localhost:3122         | 21 passed, 1 failed |
| 13.2.4  | frontend sandbox                 | http://localhost:3123         | 21 passed, 1 failed |
| 13.2.4  | `content_security_policy = true` | http://localhost:3133         | 22 passed           |
| 13.2.4  | frontend sandbox + CSP           | http://localhost:3143         | 21 passed, 1 failed |
| 13.2.4  | `app_sub_url = /grafana`         | http://localhost:3153/grafana | 22 passed           |

- The sandbox settings are `GF_SECURITY_ENABLE_FRONTEND_SANDBOX_FOR_PLUGINS=simnv-drawiomap-panel` and
  `GF_FEATURE_TOGGLES_ENABLE=pluginsFrontendSandbox`. `/api/frontend/settings` on :3123 shows
  `pluginsFrontendSandbox: true` and `enableFrontendSandboxForPlugins: ['simnv-drawiomap-panel']`.
- The editor tests and `tests/no-drawio.spec.ts` pass in the sandbox.
- The failed test in the sandbox is `live zoom on a phone › the fitted diagram is at the top of a tall panel and
centred horizontally`: `expect(g.bottom).toBeGreaterThan(50)`, received `0`. The fitted diagram fills the full panel
  height on a phone viewport in the sandbox. This is an open item.

## Bindings popup: Task 0

Spike and measurements for the bindings popup (spec `2026-10-23-bindings-popup-design.md`, sections 4.5 and 4.6).
The spike was a `React.lazy(() => import('./spike'))` component that shows `data-testid="dmap-spike"` in panel edit.
The test opened the panel editor and expected the element. The chunk (`164.js`, 321 bytes) loaded in all variants.

| Grafana | Setting                   | URL                           | Chunk loads |
| ------- | ------------------------- | ----------------------------- | ----------- |
| 12.4.13 | none                      | http://localhost:3012         | pass        |
| 13.2.4  | none                      | http://localhost:3013         | pass        |
| 12.4.13 | frontend sandbox          | http://localhost:3122         | pass        |
| 13.2.4  | frontend sandbox          | http://localhost:3123         | pass        |
| 13.2.4  | `content_security_policy` | http://localhost:3133         | pass        |
| 13.2.4  | sandbox + CSP             | http://localhost:3143         | pass        |
| 13.2.4  | `app_sub_url=/grafana`    | http://localhost:3153/grafana | pass        |

Stage build time (`sanitizeSvg` + `mountSvg` + `buildCellIndex`, `performance.now()`, Grafana 12.4.13, Chromium, first
build after page load) and JS heap after two forced garbage collections (CDP `Runtime.getHeapUsage`):

| Diagram                                          | SVG size | Cells | Build time | Heap, one stage | Heap, two stages |
| ------------------------------------------------ | -------- | ----- | ---------- | --------------- | ---------------- |
| `demo-l3.svg`                                    | 72 kB    | 108   | 8 ms       | 38.0 MB         | 38.7 MB          |
| `demo-l1.svg`                                    | 101 kB   | 172   | 11 ms      | 38.1 MB         | 38.9 MB          |
| `legacy-html-labels.svg`                         | 386 kB   | 100   | 12 ms      | 39.1 MB         | 38.8 MB          |
| synthetic (`scripts/gen-synthetic-svg.mjs 2000`) | 668 kB   | 2001  | 77 ms      | 43.8 MB         | 45.4 MB          |

Decisions:

- Import strategy (spec 4.6): **lazy** (`React.lazy`). All seven variants are green.
- Stage build (spec Q3): **in render** (`useStage` as it is). The largest synthetic diagram builds in 77 ms, below the
  200 ms limit. A second stage adds 0.7 to 1.6 MB.

## Bindings popup: Phase 1 results

Commands: `npm run e2e:12`, `npm run e2e:13` (the version split suite, see "E2E suites by Grafana version"), and `GRAFANA_URL=<url> npx playwright test tests/bindings-popup.spec.ts`
for the variants (`AUTHORING_SANDBOX=1` on the sandbox ports).

| Grafana | Setting                   | URL                           | Result                              |
| ------- | ------------------------- | ----------------------------- | ----------------------------------- |
| 12.4.13 | none                      | http://localhost:3012         | full suite passed (4 skipped)       |
| 13.2.4  | none                      | http://localhost:3013         | full suite passed (4 skipped)       |
| 12.4.13 | frontend sandbox          | http://localhost:3122         | `bindings-popup.spec.ts`: 19 passed |
| 13.2.4  | frontend sandbox          | http://localhost:3123         | `bindings-popup.spec.ts`: 19 passed |
| 13.2.4  | `content_security_policy` | http://localhost:3133         | `bindings-popup.spec.ts`: 19 passed |
| 13.2.4  | sandbox + CSP             | http://localhost:3143         | `bindings-popup.spec.ts`: 19 passed |
| 13.2.4  | `app_sub_url=/grafana`    | http://localhost:3153/grafana | `bindings-popup.spec.ts`: 19 passed |

- The popup chunk (`bindings-popup.js`, 91 KB) loads in all seven variants. `dist/module.js` is 332 KB; `check:bundle` scans every
  `dist/*.js` for draw.io tokens and reports the sizes.
- The popup is a plugin-owned dialog, not a Grafana `Modal` (spec section 11, "Sandbox DOM access"): in the frontend sandbox, a
  `Modal` gives plugin code a mock element for the diagram stage. The browser tests check, in every variant, that the stage root is in
  the page with no sandbox mock element, that the focus is in the dialog on open and returns to the opener, that Tab wraps, and that
  the discard question, a Select menu and the draw.io modal paint above the dialog.
- `tests/authoring-compat.spec.ts` tests a separate probe component (`tests/authoring-compat.probe.tsx`) against Grafana panel APIs.
  It does not use the inspector of the plugin, so it needs no migration. Run it with `AUTHORING_COMPAT=1` and
  `tests/authoring-compat.config.ts` on the isolated stack that `tests/authoring-stack.mjs` generates.

## Bindings popup: Phase 2 results

Phase 2 adds the live hover card preview, field sources with reset, undo and redo, the tab layout below 1000 px, and the
query result table, "Used by" list and deletion (spec `2026-10-23-bindings-popup-design.md`, section 6, P2).

| Acceptance item (spec section 6, P2)                                                                      | Evidence                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The card preview shows the rows of the panel card for the same element and data                           | `tests/bindings-popup-inspector.spec.ts`: rows of the preview equal the rows of the hover card of `device-1` in the panel. Unit: `CardPreview.test.tsx`, `Card.test.tsx`. |
| The preview updates on a data refresh without a click; an element without hover rows has a message        | Unit `CardPreview.test.tsx` (new resolver changes the rows; empty states). e2e: "No card for this element" for `chart-1`.                                                 |
| A pattern field shows the pattern name; an override shows "Override" with a reset button                  | e2e: chip "Pattern Repeated routers"; "Override" after an edit; "Reset Label template to pattern". Unit `fieldSource.test.ts`, `BindingInspector.test.tsx`.               |
| A reset inside a hover row resets the whole rows array; the Effective binding preview agrees              | e2e: after the reset the Overrides group count drops to 0 and the pattern rows show. Unit `BindingInspector.test.tsx`, `draft.test.ts` (`unset`).                         |
| Ten edits and ten undos restore the saved config; redo replays; one field is one step; a selection splits | Unit `history.test.ts`: ten edits, "abc" in one field, two fields, selection between keystrokes, owner change, window, `coalesceMs: 0`, caps of 200 steps and 5 diagrams. |
| A geometry save is one step; Apply clears the history                                                     | Unit `history.test.ts`; `BindingsPopup.test.tsx` (Apply clears). e2e: Apply disables Undo and Redo.                                                                       |
| Ctrl+Z in a text input or the Monaco editor keeps the native undo; with a nested dialog it does nothing   | Unit `usePopupKeys.test.tsx`, `BindingsPopup.test.tsx`. e2e: Label template, the Prometheus code editor, the metrics explorer dialog.                                     |
| At 1280 px three panes; at 900 px three tabs; the tabs keep the selection                                 | e2e: 1280x800 `panes`, 900x700 `tabs`; a stage click opens the Inspector tab; the selection survives tab changes. Unit `PopupLayout.test.tsx`.                            |
| The query pane shows a result table, a "Used by" list and deletes with a confirmation                     | e2e: table of `Standalone trend`, used-by of `health`, Esc keeps the query, delete then Undo. Unit `QueryPane.test.tsx`, `draft.test.ts` (`remove-query`).                |

Screenshots (written by the browser tests to `/tmp/dmap-popup-p2/`): `inspector-desktop-<port>.png` (1440x900, card preview and
source chips), `sources-desktop-<port>.png` (an override with reset buttons), `query-table-<port>.png`, and
`tabs-list|diagram|inspector-900-<port>.png` (900x700 tab mode).

Decisions and deviations:

- The tab threshold is the width of the popup (95 vw of the window minus padding), not the window: a 1024 px window has tabs.
- A text-like `input` keeps the native undo. A checkbox or a switch has no text undo, so Ctrl+Z there undoes the draft.
- The history keys also do nothing while another `[role="dialog"]` is visible in the page, also when the focus has not moved into
  it yet. In the frontend sandbox a Grafana dialog is a mock that this check cannot see; the focus guard and the event target
  check of the Esc owner still apply there.
- The reset of a path in the health rule resets the whole `status` rule (its schema needs the binding and the default), as a hover
  row path resets `hover.rows`.
- Coalescing joins edits that change exactly one leaf. The leaves come from a diff of the owner's display before and after the
  edit, so typing into one field of a binding (which the editor writes whole) is one step. When the first step creates a value
  with many leaves (a new binding), the next edit of one of them within the window joins it.
- Undo and redo keep the 5-revision diagram cap: whole steps go, the oldest past steps first. An undo or redo with nothing to do
  ends the edit run, and leaves the query editors and the validity messages alone; a real step clears the validity messages and
  remounts the query editors.
- A reset of `hover.rows` removes only that key; `hover.enabled` stays (a hover with only `enabled` is valid and merges with the
  rows of the patterns).
- The tabs follow the ARIA tabs pattern (one tab stop, arrow keys, Home and End).

## Bindings popup: Phase 3 results

Phase 3 adds multi-select on the stage, the box select, a pattern from the selection, bulk edit with leaf operations, and the
pause of the panel behind the popup (spec `2026-10-23-bindings-popup-design.md`, section 6, P3, and section 11).

| Acceptance item (spec section 6, P3)                                                                                    | Evidence                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shift-click three cells, bulk label: three overrides; rows and link bindings unchanged; one undo removes all three      | e2e `bindings-popup-selection.spec.ts` test 1: Overrides (0) → (3), one Undo → (0), Redo → (3), Apply, reopen: three overrides, the hover rows of a cell unchanged. Unit `BulkPane.test.tsx`, `draft.test.ts` (`display-many`, `batch`), `history.test.ts`.                                                                                           |
| Box select over two routers ranks the proposals by extra cells, `ids` last; Create adds it                              | e2e test 2 (a diagram whose nodes carry a `role` attribute): `role=router`, "matches 3, extra 1", the extra marked on the canvas, ids last; ids clears the extras; Create is one step. Unit `proposeSelector.test.ts`, `multiSelect.test.tsx`.                                                                                                        |
| A band released outside the stage selects the clipped band; Esc selects nothing; the click after a band selects nothing | Unit only (the e2e repeats were deleted by the test cost audit): `DiagramStage.test.tsx` "clips a band that ends outside the stage to the stage", "cancels the band on Esc", "suppresses the click after a band once", "keeps suppressing the click after Esc"; `boxTargets.test.ts`. The e2e tests 1 and 2 keep the real shift-click and shift-drag. |
| With a 5 s refresh the panel behind keeps its paint for three refreshes; on close it updates once                       | e2e `refresh.spec.ts` "popup open": the link halves and `data-dmap-patched` do not change and the panel subtree has zero DOM mutations over three refreshes; after Close the halves change. A control (no popup) shows mutations. Unit `DrawioMapPanel.test.tsx`.                                                                                     |
| A status deadline during the pause marks the status stale                                                               | Unit `DrawioMapPanel.test.tsx`: the band shows "stale" with the popup open, with one applier call; the popup stays open.                                                                                                                                                                                                                              |
| A close during a loading preview leaves the panel consumers attached                                                    | Unit `DrawioMapPanel.test.tsx`: after Discard and close, a value on the panel's request reaches the panel.                                                                                                                                                                                                                                            |

Measurement (unit, jsdom, `DrawioMapPanel.test.tsx`, demo diagram, three dashboard refreshes with new data; measured with the rules of version 1, the test now binds the version 2 demo config):

| Run        | Panel applier calls during the 3 refreshes | Panel view renders during the 3 refreshes | After close                          |
| ---------- | ------------------------------------------ | ----------------------------------------- | ------------------------------------ |
| no popup   | 3                                          | 6                                         | not applicable                       |
| popup open | 0                                          | 0                                         | 1 applier call, 2 renders (one data) |

In the browser (e2e): zero DOM mutations in `dmap-panel` over three refreshes while the popup is open.

Bundle: `dist/module.js` 339 288 bytes (P2: 337 072), `dist/bindings-popup.js` 123 389 bytes (P2: 108 048); `check:bundle` passes.

Screenshot (written by the browser tests to `/tmp/dmap-popup-p3/`): `pattern-from-selection-<port>.png` (two routers boxed, the
proposal with its counts, the extra router outlined on the canvas). The bulk pane with the chip Mixed has only unit tests now
(`BulkPane.test.tsx`).

Decisions and deviations:

- The pointer capture of the box starts when the pointer leaves the 4 px click slop, not at the press. A captured press sends its
  click to the stage, so Shift + click could not toggle the cell under it. The release and `pointercancel` still reach the stage
  from outside.
- A box select always adds to the selection: the band starts with Shift, and Shift keeps the earlier cells. A plain click starts a
  new selection.
- The band tests the elements of the diagram: the nodes (with their ports and icon), the links (with their label) and other plain
  cells. The canvas, layers, groups, the legend, and any cell that holds nodes or links (a root that draw.io nests) never join.
- The demo diagram has no `router` attribute: every node has `pg-kind="node"`. Two demo routers get the label proposal `/^rtr-/` (no extra) first, then `{ kind: 'node' }` (8 extras). The e2e test uses a diagram with a `role` attribute to show the
  attribute proposal of the spec. The ranking is the spec's: fewest extras first, attributes before label on a tie, ids last.
- Hover rows, other arrays and the health rule (`status`) count as one leaf each in a bulk edit. The health rule is replaced as a
  whole when its kind changes, so a lone leaf of it is not a valid override. `status.rules` of the plan is `status` here.
- A binding is one unit leaf in a bulk edit: common only if deep-equal, else Mixed with no binding fields (spec section 11, decision A; astra dissents). A mixed field has a Clear button that removes it from every selected override.
- While the popup is open the query context is held, and consumers buffer emissions and apply them once on close (unit `DrawioMapPanel.test.tsx`, `useBindingSnapshots.test.tsx`, `ChartLayer.test.tsx`). Esc keeps click suppression until its pointer ends; a window pointerup clears a pending band (`DiagramStage.test.tsx`).
- A bulk change that clears a field removes it from the overrides. It cannot hide a value that a pattern gives the element.
- A bulk edit joins one undo step while the same cells and the same leaf change within the window, as a single element does.
- "Create pattern" is one `batch`: the pattern, then the selection of the first match, then the pattern scope (a selection resets the
  scope, so it comes before it).
- The panel view does not render at all while paused (a `React.memo` that ignores new props of the dashboard while it is paused),
  and holds its inputs and its query service with `useHeld`. The popup's own consumers (`popup:<id>`) keep running on the live data.
