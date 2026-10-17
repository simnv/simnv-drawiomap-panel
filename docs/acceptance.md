# PoC acceptance

Baseline: 2026-10-17. This file replaces the earlier results of the same day. Grafana 12.4.13 and 13.2.4.
draw.io 32.4.1. Stack: `docker compose` from this repository, started with
`docker compose up -d --force-recreate --wait` and checked with `scripts/wait-stack.sh`.

Every result below is real output from this run. `npm run ci:local` passed end to end (exit 0): it runs the same steps as CI
(`.forgejo/workflows/ci.yml`).

## Spec checks (spec section 6, with the superseded decisions applied)

| #   | Check                        | Command                                                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | build, typecheck, lint, test | `npm run typecheck && npm run lint && npm test && npm run build` | PASS. typecheck: 0 errors. lint: `2 problems (0 errors, 2 warnings)`; the 2 warnings are the deprecated `Select` in an option editor. test: `Test Files 29 passed (29)`, `Tests 309 passed (309)`. build: `webpack 5.112.0 compiled successfully`.                                                                                                                                                                                                                                 |
| 2   | stack and demo dashboard     | `npm run stack:up && npm run stack:smoke`                        | PASS. `scripts/wait-stack.sh` ready after 11 s on a new stack (series, `rate()`, `/api/health`, plugin on :3012 and :3013). Smoke: the WAN link of the demo network has `40999845.86889414` bit/s (expected about 41e6), `OK`. Demo dashboard on both versions (Playwright, 1600×1000): the portograph panel has 108 cells, 20 patched cells, 40 link halves, 0 warnings; the hand-drawn panel has 10 cells, 2 patched cells, 8 link halves, 0 warnings. 0 iframes, 0 page errors. |
| 3   | editor round trip            | `tests/editor.spec.ts`                                           | PASS on both versions. The test opens the bundled editor, inserts a shape, saves, and checks that the Diagram status hash and the panel `data-dmap-hash` change. It also runs the isolation probes (see `docs/security.md`). A second test checks that the saved SVG embeds the plugin image files.                                                                                                                                                                                |
| 4   | hover and pinned card        | `tests/links.spec.ts`                                            | PASS on both versions. A hover shows the card with both directions and sparklines. A click pins the card; the card has the rule links and the field data links; Esc closes it; a click on another cell moves it. A click on a sparkline opens the URL of its row. On a phone viewport, a tap pins the card as a bottom sheet.                                                                                                                                                      |
| 5   | e2e both versions            | `npm run e2e:matrix`                                             | PASS. 12.4.13: `22 passed`. 13.2.4: `22 passed`. 21 tests and the login setup.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | no draw.io scripts in view   | `npm run check:bundle`; `tests/no-drawio.spec.ts`                | PASS. `dist/module.js: 197351 bytes`, `No React 19 breaking changes detected`, `bundle OK`. `tests/no-drawio.spec.ts` passes on both versions: no request for draw.io files and no iframe in view mode.                                                                                                                                                                                                                                                                            |

## Current UI

| Feature                   | Proof                                                                         | Result                                                                                                                                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Link colours by direction | `tests/view.spec.ts`                                                          | PASS on both versions. Link halves take colours from the synthetic traffic; link labels stay above the coloured halves; curved halves follow the edge path.                                                                                                                                      |
| Node icon colouring       | `tests/view.spec.ts` (`node state colours the node icon, not the whole node`) | PASS on both versions. The icon of the node whose `up` series is 0 is red; the node shape keeps its colour.                                                                                                                                                                                      |
| Grafana-native colours    | `tests/color.spec.ts`                                                         | PASS on both versions. A WAN link takes its colour from the continuous scheme of its field (override of query `W`). A LAN link takes it from the thresholds.                                                                                                                                     |
| Capacity sources          | `tests/color.spec.ts`                                                         | PASS on both versions. The hover card shows the capacity of a WAN link from the field **Max** (`41% of 100 Mb/s`) and of a LAN link from the port speed series `S` (`48% of 1 Gb/s`). The hand-drawn panel reads the capacity from a cell attribute.                                             |
| Live zoom and pinch zoom  | `tests/zoom.spec.ts`                                                          | PASS on both versions. Ctrl+wheel (a trackpad pinch) zooms, the reset button shows and restores the view. On a phone, a one-finger swipe at the configured view does not zoom, a pinch zooms, and the reset button restores the view. The fitted diagram is at the top and centred horizontally. |
| Theme                     | `tests/view.spec.ts`                                                          | PASS on both versions. The diagram background follows the Grafana theme (light and dark), not the OS preference.                                                                                                                                                                                 |
| Diagram options layout    | `tests/options.spec.ts`                                                       | PASS on both versions. The Diagram option buttons stay inside the options pane at the narrowest width.                                                                                                                                                                                           |
| Plugin package            | `npm run package`                                                             | PASS. `artifacts/simnv-drawiomap-panel-1.0.0.zip`: 22104392 bytes (21.1 MB). One top folder `simnv-drawiomap-panel/`. `dist/` is 56592 KB in 2411 files; `dist/drawio/` is 55628 KB of it.                                                                                                       |

Screenshots: `docs/screenshots/card-hover-desktop.png`, `card-pinned-desktop.png`, `card-mobile-sheet.png`,
`zoomed-reset-button.png`, `options-diagram.png`, `labels-above-links.png` (set `DMAP_SCREENSHOTS=docs/screenshots`
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
