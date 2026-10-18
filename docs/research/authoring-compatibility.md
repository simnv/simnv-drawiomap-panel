# Diagram authoring compatibility

Date: 2026-10-18. Ticket 1 research harness. The implementation route is provisional until Task 8 repeats Grafana 13 and sandbox checks.

## Decision

Mount the diagram preview and binding inspector together inside the plugin panel's binding mode. Keep selection in that React owner. Use direct callbacks and public `PanelProps.onOptionsChange` for Apply. Use `PanelProps.timeRange`, `timeZone`, and `replaceVariables` for the current dashboard context.

Grafana 12.4.13 browser checks prove click-to-heading focus, two cloned panels with independent selection and saved options, dashboard save/reopen, and editor remount. A second navigation changes both the range and `$site` from east to west. The inspector receives the changed values through public panel props.

`StandardEditorContext` has no public panel ID, dashboard range, or category-expansion method. Its optional event bus does not provide a supported category-opening contract. No cross-editor bus route is adopted or claimed isolated. The test-only options probe is diagnostic only. No Grafana DOM selector or internal renderer is used for integration.

For Task 6, keep the inspector inside the panel. A standard options editor can open binding mode through saved options, but must not infer panel identity from global selection. `onOptionsChange` saves plugin options; it does not remove Grafana eager query targets. Save a native definition, guide users to remove its eager target through Grafana's Queries tab, and retain the lazy-loading warning until removal is verified. Programmatic eager-target removal was not validated.

## Datasource editors

Obtain an explicit datasource instance with public `getDataSourceSrv().get(uid)` and its settings with `getInstanceSettings(uid)`. Render its public `components.QueryEditor` inside `DataSourcePluginContextProvider` with those settings. Supply the datasource, native target, `onChange`, `onRunQuery`, dashboard range, refId-filtered PanelData, `queries`, and `CoreApp.Dashboard`.

Native `onChange` updates a draft. A native editor's `onRunQuery` only requests explicit Preview; it must not execute automatically. Prometheus commits the tested Min step edit on blur, which occurs when Run queries is clicked. Preserve the entire target, including unknown properties. Dashboard persistence can reorder JSON object keys, so compare target objects structurally.

| Installed plugin              | Runtime         | Reported plugin version             | Executed result                                                                                  |
| ----------------------------- | --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `prometheus`                  | Grafana 12.4.13 | Empty version in installed metadata | Native Min step edit, opaque property retention, save/reopen, and explicit preview pass          |
| `grafana-testdata-datasource` | Grafana 12.4.13 | 12.4.12                             | Native Random Walk Alias edit, opaque property retention, save/reopen, and explicit preview pass |
| `prometheus`                  | Grafana 13.2.4  | 13.2.3                              | Metadata read; browser acceptance unverified after runtime stall                                 |
| `grafana-testdata-datasource` | Grafana 13.2.4  | 13.2.3                              | Metadata read; browser acceptance unverified after runtime stall                                 |

The executed request test observes `/api/ds/query` requests for the dedicated `DETAIL` target from before mount. Mount, native edits, native Run queries, save, and reopen produce zero detail requests. Prometheus Preview produces one request and one frame. TestData Preview adds one request and one frame. Datasource metadata and completion requests are outside this detail-execution count.

Normalize `DataSourceApi.query()` with RxJS `from`, since its public return type permits either a Promise or Observable. Typecheck verifies both are accepted by the adapter. Runtime checks exercised the installed two plugins; this is not universal datasource compatibility or a test of both return variants with controlled fixtures.

The editors receive filtered PanelData, which is empty in this isolated fixture. Existing eager data transformations, complex native targets, variable interpolation during execution, cancellation, other datasource types, and unsupported result shapes remain Task 3/8 work. Editing the Prometheus expression itself is outside this executed native-edit case; its expression survives persistence unchanged.

## Sparkline regions

Use a React portal into a plugin-generated SVG `foreignObject`, inserted immediately after the rectangle at its paint order. Use the rectangle's local bounds and `parent.getCTM().inverse().multiply(rectangle.getCTM())`. Never use a group's label-inclusive bounding box or flatten rotation/skew into an axis-aligned HTML rectangle.

The fixture contains nested translation, rotation, skew, and scale. Its rectangle adds a local translation of 2 units. Four independent screen-space rectangle corners match the portal corners within 0.5 CSS pixels. The executed test covers fit, narrow/wide resize, wheel zoom, drag pan, and reset. It checks local dimensions of 180 by 70, the nonzero parent-relative offset, actual painted canvas pixels, SVG clipping, and paint order. A marker extends outside the anchor's clip to verify hit-test clipping. The later red rectangle remains above the chart in the inspected screenshot.

Use a passive effect after the preview ref is attached, or pass the mounted SVG stage explicitly. A child layout effect ran before the parent ref attachment in the first probe. Cleanup removes the generated foreignObject.

Supply prepared numeric field range state and explicit line styling to the public Sparkline. A raw numeric field without range state produced a blank region in the initial probe. The passing probe supplies `state.range`, a 2-pixel line, four time samples, and the dashboard range. Task 5 must prepare this field state from actual numeric samples and handle empty/single-sample histories separately.

Imported SVG styles are sanitized before portal insertion. The executed test removes an imported page-wide opacity rule and verifies that the body remains opaque. Generated chart content uses explicit theme colors and typography, overriding the imported group's 99-pixel font and custom color. The executed theme is dark. Light theme is unverified. This checks the tested CSS cases, not arbitrary CSS isolation under every datasource or Grafana theme.

The probe covers a mounted, nondegenerate rectangle. Null/singular CTMs, anchor replacement/deletion, and draw.io export round-trips of the SVG transform fixture remain Task 5/7 validation. The production layer must recreate regions when the SVG stage changes.

The portal works in the executed Grafana 12 baseline. An affine HTML overlay was not selected because the portal did not fail a platform gate in that runtime. Grafana 13 and frontend sandbox behavior remain unverified. Both sandbox servers reported the correct plugin allowlist and `pluginsFrontendSandbox=true` before the shared runtime stalled. Configuration alone is not sandbox execution evidence. The harness includes a realm restriction probe and full geometry checks for the deferred runs.

## Executed coverage and environment

| Target                                       | Theme      | Result                                                                |
| -------------------------------------------- | ---------- | --------------------------------------------------------------------- |
| Grafana 12.4.13, sandbox disabled, port 3412 | Dark       | 3 route tests and authentication pass, 4 total                        |
| Grafana 13.2.4, sandbox disabled, port 3413  | Dark       | Attempted; API cleanup and later service health timed out, not passed |
| Grafana 12.4.13, sandbox enabled, port 3422  | Dark/light | Configuration verified; browser checks unverified                     |
| Grafana 13.2.4, sandbox enabled, port 3423   | Dark/light | Configuration verified; browser checks unverified                     |
| Both baseline runtimes                       | Light      | Unverified                                                            |

Browser evidence was collected before merging integration tip `ef1b5f4`. The merged source passed 349 unit tests, typecheck, lint with two existing warnings, the probe build, and the production build. Browser checks could not be repeated after that merge because the runtime remained unavailable.

Grafana 12 commit: `6367d911d57309d1da370872b8fd76237b5a0ffa`. Grafana 13 commit: `0e79aef9d91abf3bdadae9af15763029072fb45b`. Local Grafana SDK dependencies are pinned to 12.4.13, with React 18.3.1. Read exact installed tool versions from the task report.

The runtime stall affected all four owned Grafana services, both pre-existing main-stack Grafana services, `docker ps`, and Docker's Unix-socket `_ping`. Host memory was 73% free and disk had 432 GiB available. `orb status` returned Running. The likely failure boundary is the OrbStack guest/backend; the precise cause and guest resource pressure are unverified. No shared runtime restart was performed. The coordinator explicitly deferred Grafana 13, sandbox, and light-theme acceptance to Task 8.

## Repeat the research harness

Production source has no probe imports or controls. The probe exists only under `tests/`. The build runner temporarily wraps `DrawioMapPanel` and instruments `RulesEditor`, typechecks, builds with the repository webpack configuration, then restores both files and removes the temporary module in `finally`, including when typecheck/build fails. Ordinary E2E runs skip these research tests unless the opt-in config is used.

Reuse `.drawio/webapp` read-only if the assets are already available. Build before starting Grafana so the plugin is registered on startup.

```sh
node tests/build-authoring-probe.mjs
node tests/authoring-stack.mjs /tmp/drawiomap-implementation-20261018/t1-stack
docker compose -p drawiomap-t1 -f /tmp/drawiomap-implementation-20261018/t1-stack/compose.json up -d victoriametrics metrics-gen grafana12
VM_PORT=3428 ./scripts/wait-stack.sh 3412
AUTHORING_GRAFANA_URL=http://localhost:3412 npm run e2e:12 -- tests/authoring-compat.spec.ts --config tests/authoring-compat.config.ts
```

Use one owned Grafana service at a time when repeating the matrix. Stop `grafana12`, start `grafana13`, wait on port 3413, then run:

```sh
AUTHORING_GRAFANA_URL=http://localhost:3413 npm run e2e:13 -- tests/authoring-compat.spec.ts --config tests/authoring-compat.config.ts
```

Repeat with `AUTHORING_THEME=light`. For sandbox services, select `sandbox12` or `sandbox13`, ports 3422/3423, and set `AUTHORING_SANDBOX=1`. The geometry test verifies both effective configuration and a blocked `iframe.contentWindow` read from plugin code. Neither assertion was executed against sandbox in this run.

`AUTHORING_EVIDENCE_DIR` selects the screenshot/geometry-JSON directory; the default is ignored `artifacts/authoring-compat`. The package E2E scripts still perform their existing main-port readiness gate at 3012/3013. The opt-in config selects the owned browser/API base URL independently, so use the owned readiness check above as well. A down main stack can block that package-script gate; direct `npx playwright test --config tests/authoring-compat.config.ts tests/authoring-compat.spec.ts` is the harness alternative after the owned check.

Restore the ordinary distribution and release only this project after testing:

```sh
npm run build
docker compose -p drawiomap-t1 -f /tmp/drawiomap-implementation-20261018/t1-stack/compose.json down
```

The owned services are `drawiomap-t1-{grafana12,grafana13,sandbox12,sandbox13,victoriametrics,metrics-gen}-1`. A bounded owned-only stop timed out during the runtime outage. Their final stop state is unverified; Task 8 must inspect them after recovery. The main Compose project and its volumes were not modified.

Public reference: [Grafana panel event bus](https://grafana.com/developers/plugin-tools/how-to-guides/panel-plugins/subscribe-events). Installed public declarations and the mounted runtime establish the API use above. Internal Sparkline implementation was inspected only to explain its prepared-field requirement; production adapters must import the public export.
