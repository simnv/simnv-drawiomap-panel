# Diagram authoring compatibility

Date: 2026-10-18. Ticket 8 validates the production workflow introduced by Tickets 2–7. The Task 1 probe remains a separate route check.

## Runtime evidence

The focused production command exercises `query.spec.ts`, `binding-editor.spec.ts`, `visual-regions.spec.ts`, `editor.spec.ts` and `zoom.spec.ts`. Each run uses `@grafana/plugin-e2e` and Chromium. It includes both desktop themes, real datasource requests, dashboard persistence, real draw.io export, physical affine chart geometry, and the existing mobile zoom cases.

| Grafana image                  | Sandbox  | Production focused suite                             | Task 1 probe, dark/light |
| ------------------------------ | -------- | ---------------------------------------------------- | ------------------------ |
| 12.4.13                        | Disabled | 35 passed                                            | 4 / 4 passed             |
| 13.2.4                         | Disabled | 35 passed                                            | 4 / 4 passed             |
| 12.4.13                        | Enabled  | 35 passed; live-route and view-load supplements pass | 4 / 4 passed             |
| 13.2.4                         | Enabled  | 35 passed                                            | 4 / 4 passed             |
| 12.4.0, declared minimum       | Disabled | Full suite: 50 passed, 3 opt-in probes skipped       | Not required             |
| grafana-dev:13.1.0-25957875840 | Disabled | Full suite: 50 passed, 3 opt-in probes skipped       | Not required             |

Safari, Firefox and arbitrary datasource plugins have no result here. The development image was selected from the newest build family returned by Docker Hub's `grafana/grafana-dev` tags API on this run. The response and image digests are retained in the ticket evidence; “latest” is not inferred from its version number.

Sandbox runs assert `/api/frontend/settings`: the plugin allowlist must include `simnv-drawiomap-panel`, and `featureToggles.pluginsFrontendSandbox` must be true. The separate probe additionally verifies that an iframe window is unavailable to plugin code. Configuration alone does not establish sandbox execution.

## Datasources and native editors

| Installed plugin                               | Grafana            | Reported plugin version          | Evidence                                                                                    |
| ---------------------------------------------- | ------------------ | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `prometheus`                                   | 12.4.13            | Empty installed metadata version | Actual native query execution, Min step edit in the probe, opaque native object persistence |
| `grafana-testdata-datasource`                  | 12.4.13            | 12.4.12                          | Actual Random Walk history, production Alias edit, save/reopen and explicit preview         |
| `prometheus` and `grafana-testdata-datasource` | 13.2.4             | Both 13.2.3                      | Actual mixed execution, native editors and dashboard persistence pass                       |
| `prometheus` / `grafana-testdata-datasource`   | 12.4.0             | Empty / 12.4.0                   | Full production browser suite passes                                                        |
| `prometheus` / `grafana-testdata-datasource`   | 13.1.0-25957875840 | Empty / 13.1.0-pre               | Full production browser suite passes                                                        |

One production panel uses a default Prometheus datasource and a TestData query override. The test requires responses from both installed plugin types and actual painted chart pixels. This establishes the tested pair, not universal compatibility. Prometheus uses VictoriaMetrics as its backend; this is not a separate datasource plugin type.

Native editor `onChange` replaces the native target object. Omitted fields stay deleted; opaque fields remain when the editor returns them. The adapter retains the required refId if omitted and removes undefined top-level target properties before JSON validation. Native `onRunQuery` asks for explicit Preview; it does not run an unapplied draft. The inspector also supports validated native-target JSON import when no usable native editor exists. Editors that require other application context, datasource capabilities, or unsupported result shapes remain unverified.

Finite Grafana data frames with one selected numeric series and one time field support history. Null gaps remain gaps. Empty results, one sample, errors and stale samples have local text. A valid fieldless zero-row backend frame is missing data. Non-numeric, ambiguous, malformed, streaming/partial and legacy datapoint results receive explicit validation messages. Direct execution does not inherit Grafana panel transformations or overrides automatically. Returned field configuration and explicit units supply formatting.

## Measured demand and budgets

`query.spec.ts` observes actual `/api/ds/query` requests from before mount. It counts target execution, not datasource metadata or completion requests. The sanitized panel has `targets: []`, so no eager Grafana target can satisfy a hover query accidentally.

| Checkpoint                                     | Cumulative DETAIL requests |
| ---------------------------------------------- | -------------------------: |
| Initial page, card closed                      |                          0 |
| First display, value and history rows together |                          1 |
| Close and reopen while fresh                   |                          1 |
| Change dashboard variable while closed         |                          1 |
| Open after the variable change                 |                          2 |
| Change dashboard range while closed            |                          2 |
| Open after the range change                    |                          3 |

Two hover rows share one named query at the same resolution. A separate test delays a completed real response for device 1, opens device 2 with a different scalar, then attempts the old delivery. Device 2 retains its own identity/value. Browser cancellation can reject delivery before it reaches the plugin; the uncancellable Promise/token case also has executed unit coverage. No claim is made that server work was cancelled.

A public dashboard Refresh with zero eager targets produces new visible HEALTH requests and zero DETAIL requests. Saved monitoring continues in panel edit mode. Import, native edits, chart drafts and Cancel create no new detail demand. Explicit Preview and Apply activate the corresponding demand.

The panel-local cache is fresh for 15 seconds and bounded to 64 entries, 100,000 values and 8 MiB. It evicts inactive least-recently-used entries. Four requests can execute and 64 can queue. One active result is limited to 100,000 values and 8 MiB. Value budgets include timestamps and data fields; byte accounting is conservative. These limits are source-inspected constants with executed controller unit tests, not measurements of a backend's resource usage. Errors are not cached. Keys include datasource, native target, element parameters, current variables, resolved range, timezone, generation and resolution. Closing/changing/unmounting releases demand and obsolete response tokens. Datasource cancellation is best effort.

Grafana's backend transport cancels calls that reuse a request ID. The production adapter now assigns a separate transport identity to each actual execution, across controllers. It preserves targets and controller cache keys, so identical active demand still coalesces. The transport ID works without secure-context-only UUID APIs. The request-isolation regression and real concurrent parameterized Prometheus checks pass.

## Authoring, geometry and presentation

The inspector and diagram share the panel React owner. A host with the public PanelProps dimensions supplies a definite height, including under sandboxing. Browser measurements exposed a 5,805-pixel inspector with no internal scroll before this fix; the repaired lower controls and phone fit pass. Live public `editPanel` navigation activates it. Click and keyboard selection focus its heading; two cloned panels keep independent options. Pattern scope highlights matches and previews the effective binding. Each affected match reports resolved, failed or unvalidated metric bindings, including hover rows and chart bindings. Explicit native Preview validates the selected query for the selected element; other parameter values and queries remain unvalidated. Selection, rendering and import never execute changed draft queries. Apply remains available for unvalidated matches, with their status visible before saving. Element overrides remain explicit. Apply uses `PanelProps.onOptionsChange`; Grafana's public Save dashboard UI persists the result. No internal panel renderer or cross-editor bus is used.

Draw.io owns placement, dimensions and stable physical cell IDs. The plugin owns queries, status, formatting, hover and chart behavior. Real draw.io save/export preserves semantic IDs and chart anchor identity through dashboard save/reopen, including compressed XML. Missing anchors remain diagnostic until repaired or explicitly removed. Duplicate physical IDs fail validation. Copy/paste semantic conflicts, nested groups, Unicode and replacement/cancel have executed unit coverage; arbitrary draw.io shape libraries are not claimed tested.

Portable documents contain referenced native query objects and explicit effective datasource UIDs. Import previews conflicts and applicability. Replace/New identity choices remap references atomically. Production browser tests cover export/import, conflict replacement, cross-panel transfer with different defaults, Cancel and Apply. Import alone makes zero requests.

Chart regions use a React portal into a generated SVG `foreignObject`, inserted immediately after the anchor rectangle. Its local matrix is `parent.getCTM().inverse().multiply(rectangle.getCTM())`. Four screen-space corners agree within 0.5 CSS pixels through nested translation/rotation/skew/scale, fit, resize, wheel zoom, drag pan and reset. Tests require painted canvas pixels, local 180×70 dimensions, paint order and pointer transparency. The probe additionally checks clipping, theme typography and a blocked imported page-wide style.

Normal, partial outage, widespread outage, zero, missing, stale, loading and error states have desktop light/dark captures. Each fixture has one explicit chart and no per-device charts. Abnormal reasons remain visible without hover. Equal widespread causes share one summary while affected nodes retain markers. A crowded top-edge reproducer exposed clipped markers; markers now stay inside the shapes and pass browser bounds assertions. Summaries remain at the SVG's upper-left: they can cross a shape's fill in crowded diagrams. The tested fixture keeps labels/reasons readable; this is not a collision-free layout algorithm.

Health freshness uses sample age and configured cadence, independent of cache age and chart step. A browser test observes normal → stale without another response/request. Unit tests verify exact deadlines and timer cleanup. Hover scalar/history and explicit chart freshness have separate executed unit coverage.

## Migration, rollback and remaining limits

The plugin is unshipped. V2 config takes precedence over saved legacy rules, without deleting the dashboard or its legacy options. Conflicting legacy controls are hidden for V2 panels after the new workflow passes. V1 panels retain their controls. Custom card chart code was already replaced by the shared Grafana adapter in Ticket 5. Back up dashboard JSON before conversion; recreate authoring configuration if needed. Rollback uses ordinary commit reverts plus the saved dashboard JSON. XML/SVG alone does not contain plugin behavior.

Eager panel references retain Grafana's normal query ownership. Preview and rendering use the same eager-data adapter: failed requests take precedence over retained frames, while Loading and NotStarted remain loading. A refId-attributed error affects that query; an unattributed failure affects the whole request. Missing results remain distinct from failures. The inspector can copy a native definition, but removal of its eager target requires the user to use Grafana's Queries tab. The warning remains until removal is observed. No internal target mutation API is used.

Full chart axes, legends, interactive multi-series exploration, round gauges, cross-dashboard pattern synchronization and arbitrary datasource/editor/result compatibility remain outside this scope. Existing PoC security/CSP/subpath checks in `docs/acceptance.md` are historical; current authoring claims are limited to the matrix above.

## Review repair validation

Ticket 9 adds regressions for retained eager failures, refId-attributed errors,
native replacement/deletion and per-match metric preview. All 505 unit tests pass.
The final query and binding-editor browser specs pass on Grafana 12.4.13 and
13.2.4, with 10 tests including authentication on each. Grafana 13.2.4 with the
asserted frontend sandbox passes seven authoring/geometry tests, including the
actual TestData Random Walk → CSV Content replacement, save/reopen and native
field deletion. Both versions use PanelEditPage.backToDashboard() for persistence.

The repair uses the approved minimum for pattern preview: each match has an honest
resolution state, while only the selected native query/element executes explicitly.
Other parameter values stay unvalidated. Eager failures and mixed-ref errors have
unit coverage at preview/controller seams, not a new live datasource-failure claim.
The minimum/latest-dev and theme matrices above remain Ticket 8 evidence and were
not rerun for this repair. Details are in
`/tmp/drawiomap-implementation-20261018/ticket-9-report.md`.

## Reproduction and evidence

Ticket evidence is in `/tmp/drawiomap-implementation-20261018/ticket-8-report.md`. It records commits, exact commands, results, screenshots, image digests and teardown. The owned project is `drawiomap-t1`; only one owned Grafana runs at a time. Do not use `ci:local` against a shared stack because it deletes volumes.

```sh
GRAFANA_URL=http://localhost:3412 VM_PORT=3428 npm run e2e:12 -- tests/query.spec.ts tests/binding-editor.spec.ts tests/visual-regions.spec.ts tests/editor.spec.ts tests/zoom.spec.ts --workers=1
GRAFANA_URL=http://localhost:3413 VM_PORT=3428 npm run e2e:13 -- tests/query.spec.ts tests/binding-editor.spec.ts tests/visual-regions.spec.ts tests/editor.spec.ts tests/zoom.spec.ts --workers=1
```

The launcher uses the same explicit URL for readiness and browser execution. Build the production distribution before these commands. For the test-only probe, run `node tests/build-authoring-probe.mjs`, then select `tests/authoring-compat.config.ts` with `AUTHORING_GRAFANA_URL`, optional `AUTHORING_THEME=light`, and `AUTHORING_SANDBOX=1` for sandbox services. Restore `npm run build` afterwards. Probe source is never imported in the production distribution.

References: [Grafana plugin browser tests](https://grafana.com/developers/plugin-tools/e2e-test-a-plugin/test-a-panel-plugin), [public backend query transport](https://github.com/grafana/grafana/blob/v12.4.13/packages/grafana-runtime/src/utils/DataSourceWithBackend.ts), [pinned Prometheus target processing](https://github.com/grafana/grafana/blob/v12.4.13/packages/grafana-prometheus/src/datasource.ts), and [development image tags](https://hub.docker.com/r/grafana/grafana-dev/tags).
