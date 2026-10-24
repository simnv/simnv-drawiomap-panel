# Test cost audit

Date: 2026-10-24. Branch state: `e63c0b7` plus the new `src/adapter/cellTitle.test.ts`. Machine: 15-core Mac, other workers running e2e at the same time, so every run here used two workers.

This document has the full tables behind the proposal. The proposal itself is in section 3.

## 1. Measurements

### 1.1 Unit suite, one measured run

Command: `vitest run --maxWorkers=2 --reporter=json` with a small custom reporter for the per-file `collectDuration`, `setupDuration`, `environmentLoad` and `prepareDuration`.

| Metric                                                                | Value                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------- |
| Files / tests                                                         | 92 / 1352                                             |
| Wall time                                                             | 56.3 s                                                |
| CPU time                                                              | 115.8 s user + 16.2 s sys = **132 s**                 |
| Vitest `collect` (import and evaluate each test file and its modules) | **51.5 s**                                            |
| Vitest `tests` (the test bodies)                                      | 29.7 s                                                |
| Vitest `environment` (jsdom per file)                                 | 11.7 s                                                |
| `setup` + `prepare` + `transform`                                     | 3.2 + 2.1 + 2.5 s                                     |
| Median test                                                           | 0.4 ms; p90 77 ms; 4 tests over 500 ms, none over 1 s |

The suite spends more CPU on imports than on tests. `server.deps.inline: [/@grafana\//]` makes vite-node evaluate the whole `@grafana/data` graph (moment, lodash, rxjs, d3) in every isolated file context: 0.65 to 0.8 s for each file that imports `@grafana/data`, and 1.0 to 1.3 s when `@grafana/ui` is in the chain (4.4 s for the two files that also pull the popup editor). 48 of 92 files pay this; that is about 45 s of the 51.5 s collect.

### 1.2 Config experiments (same machine, two workers)

| Experiment                                                                                   | Result                                                                                                                                                                                                                                        | Verdict                        |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| A. whole suite, `isolate: false`, forks                                                      | 300 failures (mocks and DOM leak between component files)                                                                                                                                                                                     | not viable for the whole suite |
| B. `pool: 'threads'`                                                                         | 96.6 s wall (collect 90.8 s), 1 flaky failure                                                                                                                                                                                                 | reject                         |
| C. threads + `isolate: false`                                                                | same 300 failures as A                                                                                                                                                                                                                        | reject                         |
| D. `environment: 'node'` for the 57 logic files (own config, no setup file)                  | 31 of 57 files fail at import: `document`, `DOMParser`, `window`, `Element is not defined` in the `@grafana/data` chain and the render modules. The 26 that pass are the cheapest files (about 7 s CPU together)                              | reject: little to gain         |
| E. the 57 logic files (no `render`, no `vi.mock`, no `@grafana/ui`), jsdom, `isolate: false` | **5.7 s wall** (collect 8.9 s, environment 0.6 s) against **22.8 s** isolated (collect 20.5 s, environment 9.3 s). 2 files fail: `src/render/svgStage.test.ts` and `src/render/applier.test.ts` (they find leftover DOM of the previous file) | **adopt as a project**         |

The root `vitest.config.ts` is outside `.config/` and may define `test.projects` (vitest 3.2), so a two-project split needs no change to the scaffolded files.

### 1.3 Fixed cost by import band

### Per-file cost (vitest 3.2.4, jsdom, `--maxWorkers=2`, 2026-10-24)

Wall 56.3 s; CPU 115.8 s user + 16.2 s sys = 132 s. Vitest totals: collect 51.5 s, tests 29.7 s, environment 11.7 s, setup 3.2 s, prepare 2.1 s, transform 2.5 s.

Import band: `ui` = `@grafana/ui` in the import chain (collect 0.9–4.5 s), `data` = `@grafana/data` only (0.64–0.82 s), `pure` = neither (≤ 0.14 s).

| Band | Files | Tests | Fixed cost (collect+env+setup+prepare) | Test time |
| ---- | ----- | ----- | -------------------------------------- | --------- |
| ui   | 24    | 363   | 38.1 s                                 | 27.7 s    |
| data | 24    | 409   | 21.7 s                                 | 1.0 s     |
| pure | 44    | 580   | 8.7 s                                  | 1.0 s     |

| File                                        | Tests | Test time ms | Collect ms | Env ms | ms/test | Band |
| ------------------------------------------- | ----- | ------------ | ---------- | ------ | ------- | ---- |
| `src/components/DrawioMapPanel.test.tsx`    | 100   | 10757        | 4473       | 249    | 108     | ui   |
| `src/editor/BindingEditor.test.tsx`         | 28    | 5832         | 4416       | 249    | 208     | ui   |
| `src/editor/BindingsList.test.tsx`          | 26    | 2362         | 1073       | 110    | 91      | ui   |
| `src/editor/patternPreview.test.tsx`        | 34    | 2167         | 1051       | 103    | 64      | ui   |
| `src/editor/popup/BindingsPopup.test.tsx`   | 19    | 1925         | 1096       | 117    | 101     | ui   |
| `src/editor/popup/BulkPane.test.tsx`        | 14    | 958          | 1119       | 110    | 68      | ui   |
| `src/editor/BindingInspector.test.tsx`      | 7     | 708          | 1047       | 112    | 101     | ui   |
| `src/editor/multiSelect.test.tsx`           | 11    | 699          | 1008       | 105    | 64      | ui   |
| `src/editor/DrawioModal.test.tsx`           | 7     | 157          | 1267       | 197    | 22      | ui   |
| `src/editor/popup/QueryPane.test.tsx`       | 9     | 195          | 1284       | 138    | 22      | ui   |
| `src/editor/QueryEditor.test.tsx`           | 5     | 163          | 1274       | 121    | 33      | ui   |
| `src/editor/popup/PopupLayout.test.tsx`     | 18    | 117          | 1219       | 149    | 6       | ui   |
| `src/editor/popup/PluginDialog.test.tsx`    | 13    | 401          | 991        | 102    | 31      | ui   |
| `src/editor/geometry.test.tsx`              | 2     | 274          | 1086       | 109    | 137     | ui   |
| `src/editor/popup/DiagramStage.test.tsx`    | 22    | 361          | 1007       | 98     | 16      | ui   |
| `src/module.test.ts`                        | 3     | 2            | 1300       | 124    | 1       | ui   |
| `src/options/DiagramEditor.test.tsx`        | 5     | 73           | 1202       | 125    | 15      | ui   |
| `src/editor/BindingFields.test.tsx`         | 1     | 119          | 1137       | 137    | 119     | ui   |
| `src/editor/popup/usePopupKeys.test.tsx`    | 16    | 169          | 1066       | 108    | 11      | ui   |
| `src/editor/popup/CardPreview.test.tsx`     | 4     | 50           | 1114       | 133    | 13      | ui   |
| `src/options/RulesEditor.test.tsx`          | 3     | 72           | 1090       | 115    | 24      | ui   |
| `src/visuals/TooltipBox.test.tsx`           | 7     | 16           | 1117       | 135    | 2       | ui   |
| `src/components/LazyBindingsPopup.test.tsx` | 3     | 81           | 1057       | 114    | 27      | ui   |
| `src/editor/popup/popupBus.test.ts`         | 6     | 3            | 1042       | 110    | 0       | ui   |
| `src/query/panel.test.tsx`                  | 4     | 324          | 638        | 109    | 81      | data |
| `src/legend/Legend.test.tsx`                | 26    | 162          | 762        | 134    | 6       | data |
| `src/visuals/ChartLayer.test.tsx`           | 16    | 101          | 778        | 122    | 6       | data |
| `src/visuals/ChartHover.test.tsx`           | 23    | 104          | 746        | 127    | 5       | data |
| `src/binding/engine.test.ts`                | 67    | 19           | 820        | 126    | 0       | data |
| `src/legend/model.test.ts`                  | 13    | 18           | 764        | 145    | 1       | data |
| `src/visuals/MirrorSparkline.test.tsx`      | 7     | 16           | 771        | 141    | 2       | data |
| `src/interact/Card.test.tsx`                | 17    | 87           | 702        | 136    | 5       | data |
| `src/binding/context.test.ts`               | 5     | 16           | 758        | 139    | 3       | data |
| `src/query/frames.display.test.ts`          | 2     | 14           | 720        | 138    | 7       | data |
| `src/query/controller.test.ts`              | 30    | 10           | 752        | 112    | 0       | data |
| `src/interact/cardModel.test.ts`            | 75    | 36           | 722        | 113    | 0       | data |
| `src/components/StatusBand.test.tsx`        | 3     | 2            | 743        | 122    | 1       | data |
| `src/binding/series.test.ts`                | 5     | 3            | 731        | 116    | 1       | data |
| `src/visuals/SparklineView.test.tsx`        | 17    | 45           | 690        | 116    | 3       | data |
| `src/visuals/useBindingSnapshots.test.tsx`  | 16    | 21           | 709        | 116    | 1       | data |
| `src/query/grafana.test.ts`                 | 12    | 5            | 703        | 125    | 0       | data |
| `src/render/overlay.test.ts`                | 15    | 22           | 698        | 117    | 1       | data |
| `src/query/panelSnapshot.test.ts`           | 6     | 2            | 708        | 126    | 0       | data |
| `src/editor/previewTime.test.tsx`           | 1     | 8            | 704        | 121    | 8       | data |
| `src/query/frames.test.ts`                  | 14    | 18           | 695        | 118    | 1       | data |
| `src/binding/color.test.ts`                 | 10    | 5            | 699        | 117    | 0       | data |
| `src/editor/preview.test.ts`                | 20    | 3            | 680        | 116    | 0       | data |
| `src/editor/draftContext.test.ts`           | 5     | 2            | 646        | 110    | 0       | data |
| `src/render/sanitize.test.ts`               | 13    | 232          | 8          | 137    | 18      | pure |
| `src/render/applier.test.ts`                | 55    | 257          | 15         | 108    | 5       | pure |
| `src/adapter/portograph.test.ts`            | 22    | 151          | 24         | 146    | 7       | pure |
| `src/render/svgStage.test.ts`               | 17    | 85           | 135        | 114    | 5       | pure |
| `src/editor/popup/boxTargets.test.ts`       | 2     | 2            | 60         | 137    | 1       | pure |
| `src/editor/testUtils.test.tsx`             | 6     | 51           | 5          | 132    | 8       | pure |
| `src/binding/reduce.test.ts`                | 3     | 2            | 4          | 160    | 1       | pure |
| `src/model/config.test.ts`                  | 78    | 11           | 18         | 137    | 0       | pure |
| `src/editor/proposeSelector.test.ts`        | 11    | 3            | 52         | 116    | 0       | pure |
| `src/visuals/hoverSample.test.ts`           | 10    | 2            | 5          | 158    | 0       | pure |
| `src/binding/status.test.ts`                | 7     | 3            | 5          | 143    | 0       | pure |
| `src/legend/position.test.ts`               | 4     | 2            | 4          | 143    | 0       | pure |
| `src/legend/symbolRows.test.ts`             | 10    | 25           | 7          | 121    | 3       | pure |
| `src/editor/bindingsModel.test.ts`          | 31    | 6            | 17         | 126    | 0       | pure |
| `src/editor/draft.test.ts`                  | 38    | 10           | 19         | 122    | 0       | pure |
| `src/binding/template.test.ts`              | 5     | 2            | 4          | 135    | 0       | pure |
| `src/editor/history.test.ts`                | 23    | 6            | 18         | 125    | 0       | pure |
| `src/editor/decode.test.ts`                 | 3     | 1            | 4          | 135    | 0       | pure |
| `src/editor/fieldSource.test.ts`            | 8     | 4            | 13         | 126    | 0       | pure |
| `src/util/hash.test.ts`                     | 2     | 2            | 4          | 130    | 1       | pure |
| `src/render/cellAttrs.test.ts`              | 3     | 2            | 4          | 132    | 1       | pure |
| `src/legend/highlight.test.ts`              | 2     | 3            | 14         | 123    | 1       | pure |
| `src/editor/revision.test.ts`               | 4     | 2            | 13         | 127    | 0       | pure |
| `src/editor/target.test.ts`                 | 4     | 8            | 8          | 121    | 2       | pure |
| `src/editor/drawio-shim.test.ts`            | 6     | 13           | 6          | 119    | 2       | pure |
| `src/render/geometry.test.ts`               | 26    | 6            | 6          | 124    | 0       | pure |
| `src/binding/patterns.test.ts`              | 18    | 8            | 15         | 117    | 0       | pure |
| `src/visuals/tooltipPlace.test.ts`          | 16    | 2            | 4          | 127    | 0       | pure |
| `src/editor/protocol.test.ts`               | 17    | 4            | 6          | 126    | 0       | pure |
| `src/editor/popup/overlayStack.test.tsx`    | 4     | 6            | 4          | 124    | 1       | pure |
| `src/query/session.test.ts`                 | 3     | 3            | 4          | 122    | 1       | pure |
| `src/smoke.test.ts`                         | 1     | 7            | 8          | 120    | 7       | pure |
| `src/interact/hit.test.ts`                  | 12    | 4            | 17         | 115    | 0       | pure |
| `src/render/zoom.test.ts`                   | 19    | 4            | 7          | 120    | 0       | pure |
| `src/editor/availability.test.ts`           | 11    | 5            | 5          | 119    | 0       | pure |
| `src/rules/schema.test.ts`                  | 17    | 7            | 9          | 115    | 0       | pure |
| `src/interact/links.test.ts`                | 8     | 3            | 5          | 121    | 0       | pure |
| `src/editor/leafPaths.test.ts`              | 10    | 2            | 5          | 121    | 0       | pure |
| `src/binding/select.test.ts`                | 9     | 3            | 7          | 117    | 0       | pure |
| `src/editor/files.test.ts`                  | 6     | 6            | 4          | 114    | 1       | pure |
| `src/fixtures.test.ts`                      | 6     | 3            | 4          | 118    | 1       | pure |
| `src/options/importDiagram.test.ts`         | 4     | 3            | 3          | 115    | 1       | pure |
| `src/components/useHeld.test.tsx`           | 3     | 7            | 4          | 113    | 2       | pure |
| `src/visuals/domain.test.ts`                | 23    | 2            | 6          | 112    | 0       | pure |

### Top 20 tests by own duration

| ms  | File                                 | Test                                                                                                                                         |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 864 | `editor/BindingEditor.test.tsx`      | binding inspector > validates, clears and removes history height with series=true                                                            |
| 800 | `editor/BindingEditor.test.tsx`      | binding inspector > validates, clears and removes history height with series=false                                                           |
| 615 | `editor/BindingEditor.test.tsx`      | binding inspector > opts chart and value/history hover rows into sample freshness and blocks invalid cadence                                 |
| 506 | `components/DrawioMapPanel.test.tsx` | DrawioMapPanel bindings popup > drops the prepared result of a removed chart before the next explicit preview                                |
| 452 | `editor/BindingEditor.test.tsx`      | binding inspector > keeps native JSON validation in the query pane and drops the typed text when the pane closes with invalid=true           |
| 422 | `components/DrawioMapPanel.test.tsx` | pause behind > lets a freshness deadline mark the status stale while paused, with one applier call                                           |
| 380 | `editor/BindingsList.test.tsx`       | bindings list > deletes an override into the draft after a confirmation and applies it through the draft                                     |
| 372 | `components/DrawioMapPanel.test.tsx` | pause behind > leaves the panel consumers attached when the popup closes during a loading preview                                            |
| 364 | `components/DrawioMapPanel.test.tsx` | saved chart results in authoring previews > individual preview keeps ordinary demand fallback with only a saved error result                 |
| 353 | `components/DrawioMapPanel.test.tsx` | saved chart results in authoring previews > individual preview keeps ordinary demand fallback with only a saved loading result               |
| 342 | `components/DrawioMapPanel.test.tsx` | saved chart results in authoring previews > individual preview keeps ordinary demand fallback with only a saved unsupported result           |
| 341 | `components/DrawioMapPanel.test.tsx` | DrawioMapPanel bindings popup > runs an edited native target for the popup only, keeps the panel watch alive, and the panel runs it after Ap |
| 332 | `editor/BindingEditor.test.tsx`      | binding inspector > keeps native JSON validation in the query pane and drops the typed text when the pane closes with invalid=false          |
| 320 | `editor/patternPreview.test.tsx`     | explicit full pattern preview > loads only the missing binding scopes on explicit action, reports progress and retains distinct prepared val |
| 307 | `editor/BindingEditor.test.tsx`      | binding inspector > authors hover rows, shape/link bindings and explicit health rules through forms                                          |
| 298 | `components/DrawioMapPanel.test.tsx` | pause behind > does no per-refresh work for the panel behind and renders the latest data once on close                                       |
| 274 | `editor/BindingEditor.test.tsx`      | binding inspector > assigns an ordinary rectangle to a named chart query, persists its identity and removes it explicitly                    |
| 250 | `editor/BindingEditor.test.tsx`      | binding inspector > deletes a query from its pane, lists the users first, and brings the query back with Undo                                |
| 236 | `editor/BindingInspector.test.tsx`   | field sources in the inspector > resets the whole rows array from a field inside a hover row; the pattern rows show again                    |
| 230 | `components/DrawioMapPanel.test.tsx` | pause behind > Apply while open changes the panel on close only                                                                              |

Reasons for the top costs:

| Test(s)                                                                                                                                   | Reason                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BindingEditor` "validates, clears and removes history height" x2 (800 to 860 ms)                                                         | full editor mount (list, stage, inspector) through `renderEditor`, then eight edit-and-Apply cycles; each Apply validates and re-renders the draft; `chooseOption` opens a Select menu. `it.each` doubles a scenario that differs only in the row shape |
| `BindingEditor` "opts chart and value/history hover rows into sample freshness" (615 ms), "authors hover rows ... through forms" (307 ms) | the same full mount plus many form edits with `fireEvent.change` on labelled fields                                                                                                                                                                     |
| `BindingEditor` "keeps native JSON validation ... invalid=%s" (452 + 332 ms)                                                              | `it.each` duplicate, full mount, `findByText` polling                                                                                                                                                                                                   |
| `DrawioMapPanel` "drops the prepared result of a removed chart" (506 ms), "runs an edited native target for the popup only" (341 ms)      | full panel plus popup mount (the lazy chunk is mocked to load at once), `waitFor` polling at 50 ms steps                                                                                                                                                |
| `DrawioMapPanel` "pause behind" x7 (230 to 420 ms)                                                                                        | full panel plus popup, three refreshes, real `requestAnimationFrame` waits (16 ms each)                                                                                                                                                                 |
| `DrawioMapPanel` "individual preview keeps ordinary demand fallback with only a saved error / loading / unsupported" x3 (340 to 364 ms)   | three near-duplicate scenarios, each with its own full mount                                                                                                                                                                                            |
| `BindingsList` "deletes an override ... after a confirmation" (380 ms) and the other 190 ms tests                                         | `getByRole('button', { name })` over the whole popup DOM; 32 role queries in the file                                                                                                                                                                   |
| `patternPreview` "releases a pending run on select / query / pattern / edit" x4 (160 to 200 ms)                                           | four near-duplicate scenarios that differ by the trigger                                                                                                                                                                                                |
| `BindingInspector` (7 tests, 100 ms each)                                                                                                 | each test mounts the whole editor through `renderEditor` to check one chip                                                                                                                                                                              |
| `geometry.test.tsx` (228 ms)                                                                                                              | four `waitFor` polls                                                                                                                                                                                                                                    |

No test uses `userEvent` or fake timers in a costly way. The heavy files are the two that mount everything (`DrawioMapPanel.test.tsx`, 100 tests, 10.8 s; `BindingEditor.test.tsx`, 28 tests, 5.8 s), and both pay 4.4 s to import.

### 1.4 e2e cost per spec

### e2e cost per spec (Chromium, 2 workers, the two 118-test runs of 2026-10-24 in `/tmp/dmap-e2e-full.log`; `panel-edit-requests.spec.ts` is newer than the logs)

Run totals: 113 passed, 4 skipped, 3.5 and 3.7 min wall per Grafana version; sum of test time 414 s and 436 s.

| Spec                               | Tests | Sum s (run 1 / run 2)           | Max test s | Versions needed      | Why                                                                                       | Unit overlap                                                                                                                                    |
| ---------------------------------- | ----- | ------------------------------- | ---------- | -------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `links.spec.ts`                    | 4     | 41 / 40                         | 32.7       | one                  | plugin DOM                                                                                | DrawioMapPanel hover card (20 tests); the 32 s phone run is a toBeInViewport ratio 0.9995 retry                                                 |
| `binding-editor.spec.ts`           | 7     | 41 / 34                         | 8.0        | both                 | datasource editors, dashboard save                                                        | BindingEditor.test.tsx covers the logic; keep as the integration proof                                                                          |
| `bindings-popup-inspector.spec.ts` | 7     | 30 / 32                         | 6.0        | split                | Ctrl+Z in the Prometheus code editor and the metrics explorer need both; the rest one     | BindingInspector.test.tsx, history.test.ts, QueryPane.test.tsx                                                                                  |
| `bindings-popup-selection.spec.ts` | 7     | 31 / 30                         | 7.0        | one                  | plugin DOM                                                                                | DiagramStage.test.tsx, BulkPane.test.tsx, proposeSelector.test.ts cover all 7 scenarios                                                         |
| `refresh.spec.ts`                  | 4     | 36 / 30                         | 25.0       | both                 | dashboard refresh timer                                                                   | DrawioMapPanel "pause behind" (7 tests); the 23 s test waits 3 x 5 s refreshes                                                                  |
| `bindings-popup.spec.ts`           | 6     | 29 / 43                         | 18.0       | split                | chunk load in panel edit/view, persistence after save: both; entry points and layout: one | BindingsPopup.test.tsx, LazyBindingsPopup.test.tsx                                                                                              |
| `legend.spec.ts`                   | 9     | 26 / 22                         | 3.6        | one, 3 tests         | plugin DOM                                                                                | Legend.test.tsx (26) and DrawioMapPanel legend tests cover toggle, show, collapsed, drag, phone tap; keep hover highlight, corner on zoom, drag |
| `reset-corner.spec.ts`             | 9     | 34 / 19                         | 4.6        | both, 2 pages        | Grafana panel menu button                                                                 | DrawioMapPanel corner stacking (4 tests); 8 of 9 tests are corner x title permutations                                                          |
| `card-tooltip.spec.ts`             | 7     | 18 / 22                         | 3.4        | one (+WebKit opt-in) | Grafana tooltip portal                                                                    | ChartHover.test.tsx, TooltipBox.test.tsx                                                                                                        |
| `zoom.spec.ts`                     | 6     | 15 / 15                         | 4.5        | split                | "Fit keeps ... panel edit mode" both; the rest one                                        | DrawioMapPanel live zoom (16 tests), zoom.test.ts                                                                                               |
| `editor.spec.ts`                   | 3     | 16 / 14                         | 7.6        | both                 | draw.io iframe, dashboard save and reopen                                                 | protocol.test.ts, files.test.ts                                                                                                                 |
| `bindings-list.spec.ts`            | 4     | 13 / 13                         | 3.7        | one                  | plugin DOM in the popup                                                                   | BindingsList.test.tsx covers filters, groups, delete; keep the two fit-the-pane tests                                                           |
| `view.spec.ts`                     | 7     | 12 / 13                         | 2.1        | split                | theme (2 tests) both; geometry, labels, arrows one                                        | applier.test.ts, overlay.test.ts, geometry.test.ts                                                                                              |
| `visual-regions.spec.ts`           | 3     | 12 / 12                         | 6.6        | one                  | screenshots                                                                               | none                                                                                                                                            |
| `query.spec.ts`                    | 5     | 13 / 11                         | 3.3        | both                 | installed Prometheus and TestData plugins                                                 | controller.test.ts, grafana.test.ts                                                                                                             |
| `min-scale.spec.ts`                | 4     | 11 / 10                         | 3.1        | one                  | plugin DOM, real scroll                                                                   | DrawioMapPanel "Minimum scale" (5 tests)                                                                                                        |
| `editor-refresh.spec.ts`           | 2     | 9 / 9                           | 5.2        | both                 | dashboard refresh in panel edit (scenes)                                                  | none at this level                                                                                                                              |
| `editor-layout.spec.ts`            | 2     | 8 / 8                           | 4.1        | one                  | theme from user preferences                                                               | PopupLayout.test.tsx                                                                                                                            |
| `color.spec.ts`                    | 3     | 7 / 8                           | 3.5        | both                 | field config, overrides, continuous schemes from Grafana                                  | binding/color.test.ts                                                                                                                           |
| `hover-kinds.spec.ts`              | 3     | 9 / 6                           | 3.7        | one, 1 test          | plugin DOM                                                                                | DrawioMapPanel.test.tsx "cards only for cells with content" (6 tests) covers all 3                                                              |
| `cursor.spec.ts`                   | 2     | 6 / 6                           | 3.6        | one                  | CSS cursor, Tab order in panel edit                                                       | DrawioMapPanel.test.tsx "marks only the cells that open a card"                                                                                 |
| `status-band.spec.ts`              | 3     | 6 / 6                           | 2.2        | one                  | plugin DOM                                                                                | DrawioMapPanel status band (3 tests)                                                                                                            |
| `sparkline-range.spec.ts`          | 2     | 5 / 4                           | 2.5        | one                  | uPlot canvas pixels                                                                       | SparklineView.test.tsx, domain.test.ts                                                                                                          |
| `editor-missing.spec.ts`           | 1     | 3 / 3                           | 2.9        | one                  | plugin DOM                                                                                | DrawioModal.test.tsx                                                                                                                            |
| `options.spec.ts`                  | 1     | 2 / 2                           | 2.4        | both                 | options pane splitters                                                                    | none                                                                                                                                            |
| `no-drawio.spec.ts`                | 1     | 1 / 2                           | 2.2        | both                 | plugin loading                                                                            | module.test.ts "contains no draw.io runtime"                                                                                                    |
| `phone-sheet.spec.ts`              | 1     | 1 / 2                           | 2.1        | one                  | viewport                                                                                  | DrawioMapPanel "narrow panel shows the card as a sheet"                                                                                         |
| `panel-edit-requests.spec.ts`      | 1     | est. 12–15 (sleeps 5 + 3 + 2 s) | –          | both                 | query re-run on panel edit                                                                | query/panel.test.tsx                                                                                                                            |

Outliers worth a fix on their own:

- `links.spec.ts` "a tap pins the card as a bottom sheet": 32.5 and 32.7 s in both runs, 1.3 s in the earlier 147-test runs. The `toBeInViewport()` assertion retries to the 30 s expect timeout on a ratio of 0.9995. `ratio: 0.99` ends it in a second. Saving: 30 s per version.
- `refresh.spec.ts` "popup open": 23 to 25 s, three dashboard refreshes at the Grafana minimum of 5 s. `GF_DASHBOARDS_MIN_REFRESH_INTERVAL=1s` on the compose Grafana and a 1 s refresh in the spec cut it to about 8 s. Saving: 15 s per version.
- `reset-corner.spec.ts`: 8 of 9 tests are the corner x title permutations, each with its own dashboard and page load. One dashboard with four panels (one legend corner each) and one for the titled variant gives two page loads. Saving: 15 to 25 s per version.
- The `bindings-popup.spec.ts` "share one page" test took 10.6 and 18.0 s: it is already a merge of eight checks, so its cost is fair.

## 2. Redundancy and value

### 2.1 Unit tests that duplicate each other

| Duplicate set                                                                                                                               | Keep                                                                                                                 | Action               |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `BindingEditor` `it.each([false, true])` for history height and for native JSON validity                                                    | one mount, both variants as assertions                                                                               | saves 1.2 s          |
| `DrawioMapPanel` "individual preview keeps ordinary demand fallback" x3                                                                     | one `it.each` with one mount and three saved states                                                                  | saves 0.7 s          |
| `patternPreview` "releases a pending run on X" x4                                                                                           | one parametrised test over the four triggers                                                                         | saves 0.5 s          |
| `DrawioMapPanel` colour legend (5 tests: collapsed chip, open, `legend.show`, corner, hover highlight) against `Legend.test.tsx` (26 tests) | `Legend.test.tsx` for the component; in the panel keep one integration test: the entry highlight dims the real cells | saves 4 panel mounts |
| `DrawioMapPanel` hover card (20 tests) against `Card.test.tsx` (17)                                                                         | both: different layers (pointer and pin state in the panel, row rendering in the card). No change                    |                      |
| `BindingInspector.test.tsx` (7 tests, full editor mount) against `fieldSource.test.ts` (8 pure tests)                                       | the pure file for the rules; two component tests (chip text, reset button)                                           | saves 5 mounts       |

Tests of `@grafana/ui` or browser behaviour instead of ours: `Legend.test.tsx` "is a focusable native button, so Enter and Space toggle it" tests a browser rule that jsdom does not even apply; drop it. The other candidates (`usePopupKeys` Select menu Esc, `PluginDialog` Tab wrap, `TooltipBox` placement) test plugin code and stay.

### 2.2 e2e tests that repeat a unit test

Listed per spec in the table above. The full repeats, where the e2e adds no browser-only fact: `hover-kinds.spec.ts` (3 tests, all in `DrawioMapPanel` "cards only for cells with content"), six of nine `legend.spec.ts` tests (toggle, Enter/Space, `legend.show`, `legend.collapsed`, resize, phone tap), `bindings-popup-selection.spec.ts` beyond the two screenshot tests, `status-band.spec.ts` apart from "not on the diagram", and the two zoom alignment tests. Each e2e test costs 1.5 to 5 s per version; the equivalent unit test costs 5 to 100 ms.

### 2.3 Both versions or one

Version-specific surface: the panel edit page and options pane, the dashboard save API (`/api/dashboards/db` in 12.4, `/apis/dashboard.grafana.app/` in 13.2; `saveDashboard` in `tests/authoring-fixtures.ts` handles both), the datasource query editors (Prometheus code editor, metrics explorer, TestData), dashboard refresh in panel edit, the panel menu button, theme from user preferences, field config and overrides, plugin and chunk loading.

- **Both versions (about 40 tests, about 150 s of test time, about 80 s wall at two workers):** `binding-editor`, `bindings-popup` persistence and chunk-load tests, `bindings-popup-inspector` Ctrl+Z tests, `color`, `editor`, `editor-refresh`, `no-drawio`, `options`, `panel-edit-requests`, `query`, `refresh`, `reset-corner` (two pages), `view` theme tests, `zoom` "Fit keeps ... panel edit mode".
- **One version, 13.2 (about 73 tests):** everything that is plugin DOM inside the panel: `bindings-list`, `bindings-popup-selection`, `card-tooltip` (plus the WebKit opt-in), `cursor`, `editor-layout`, `editor-missing`, `hover-kinds`, `legend`, `links`, `min-scale`, `phone-sheet`, `sparkline-range`, `status-band`, `visual-regions`, the rest of `view`, `zoom`, `bindings-popup`, `bindings-popup-inspector`.

### 2.4 Gaps

| Behaviour                                                                                                                                                                                     | State                                                                                                                                                                                          | Proposed test                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double template expansion: `resolveTemplate` output goes through `replaceVariables` again at `src/interact/cardModel.ts:436`, `src/interact/links.ts:76` and `src/visuals/ChartLayer.tsx:283` | no test that a resolved label or URL part that contains `$var` text stays literal; `cardModel.test.ts` only checks the `javascript:` rejection                                                 | pure: `cardModel.test.ts` and `links.test.ts` with a `replaceVariables` spy that records its input; decide whether the second pass is wanted and lock it |
| Esc with typed, un-imported text (Native target JSON, a filter, a label field)                                                                                                                | `usePopupKeys` proves Esc in a plain field calls `onEscape`; `BindingsPopup` "closes on Esc when the draft is clean" never types first. The draft is clean, so Esc closes and the text is lost | component: type, press Esc, expect either the confirmation or the text kept; needs a product decision first                                              |
| Legend taps across panels                                                                                                                                                                     | unit `symbolRows.test.ts` and `Legend.test.tsx` cover it; no e2e touches two panels at once although the demo dashboard has two                                                                | one e2e on 13.2: tap a row in the L3 panel, tap a row in the hand-drawn panel, expect the first highlight gone                                           |
| Query session lifecycle on remount and Cancel                                                                                                                                                 | covered since `fe902ad`, `f98a3eb`, `859a5eb`: `session.test.ts`, `panel.test.tsx` (remount, StrictMode, generation) and `tests/panel-edit-requests.spec.ts`                                   | none; keep the e2e in the both-versions set                                                                                                              |
| Refresh keeps zoom, pinned card and open editor (`CODING_STANDARDS.md`)                                                                                                                       | zoom and editor: `editor-refresh.spec.ts`, `DrawioMapPanel` "a new panel size or a new zoom option resets the view"; pinned card across a data refresh: not found                              | component: pin a card, rerender with new data, expect the pin                                                                                            |
| Sanitiser idempotence                                                                                                                                                                         | `sanitize.test.ts` line 122                                                                                                                                                                    | none                                                                                                                                                     |

## 3. Proposal (ranked)

| #   | Change                                                                                                                                                                                                                                                                                                                                                                                   | Expected saving                                                                        | Risk                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Two vitest projects in `vitest.config.ts`.** `logic`: the 57 files with no `render`, no `vi.mock` and no `@grafana/ui` import, jsdom, `isolate: false`, a setup that resets `document.body` between files. `components`: the other 36 files as today. Move `svgStage.test.ts` and `applier.test.ts` to `components` if the body reset is not enough                                    | logic tier 22.8 s to 5.7 s wall; about 35 s of the 132 s CPU                           | low; measured. State leaks show up as order-dependent failures, so run the logic project once with `--sequence.shuffle` before merge |
| 2   | **e2e version split.** One Playwright project per set: `matrix` (both versions, about 40 tests) and `plugin` (13.2 only). `npm run e2e:12` runs `matrix` only                                                                                                                                                                                                                            | 12.4 run from about 3.5 min to about 1.3 min; the matrix from about 7 to about 4.8 min | low; the split follows the API surface in 2.3. A 12.4-only regression in plugin DOM would be found by the release matrix (item 7)    |
| 3   | **Three e2e fixes:** `toBeInViewport({ ratio: 0.99 })` in `links.spec.ts`, 1 s minimum refresh in compose plus `refresh.spec.ts`, two pages for `reset-corner.spec.ts`                                                                                                                                                                                                                   | 60 to 70 s per version                                                                 | low                                                                                                                                  |
| 4   | **Delete the e2e repeats** of 2.2 (`hover-kinds` to 1 test, `legend` to 3, `bindings-popup-selection` to 2, `status-band` to 1, drop the two zoom alignment tests)                                                                                                                                                                                                                       | about 35 s per version                                                                 | low; unit coverage listed per test                                                                                                   |
| 5   | **Component-file merges and rewrites** of 2.1: the three `it.each` and near-duplicate sets, `BindingInspector` on `fieldSource`, the panel colour-legend tests, and merge the small `ui` files that share a harness (`BindingFields` 1 test, `CardPreview` 4, `QueryEditor` 5, `QueryPane` 9, `previewTime` 1) into their parents, 1.1 s of import per file removed                      | 5 to 8 s CPU                                                                           | medium: hand edits in the two largest test files; one adversarial review round                                                       |
| 6   | **Tiers and who runs them.** Worker: `npm run test:affected` (as now) plus the `logic` project in full (5.7 s). Before merge to main: full unit plus a smoke e2e on 13.2 (`view`, `links` hover, `bindings-popup` persistence, `editor` round trip, `no-drawio`, `panel-edit-requests`: about 40 s). Before push: full unit plus the split matrix of item 2. CI: the same as before push | the worker loop drops from about 7 min (unit plus matrix) to under 1 min               | process only                                                                                                                         |
| 7   | **Release matrix** stays complete: all specs on both versions plus the WebKit project and the isolation variants of `docs/acceptance.md`, run before a tag, not on every push                                                                                                                                                                                                            | none; this is the safety net for item 2                                                | none                                                                                                                                 |
| 8   | **Add the gap tests** of 2.4: double expansion (pure), Esc with typed text (component, after the decision), a two-panel legend e2e on 13.2, a pinned card across a refresh (component)                                                                                                                                                                                                   | +0.5 s unit, +3 s e2e                                                                  | low                                                                                                                                  |

Rejected by measurement: `pool: 'threads'` (slower, flaky), `isolate: false` for the whole suite (300 failures), a `node` environment tier (31 of 57 logic files fail at import; the rest are the cheapest files).
