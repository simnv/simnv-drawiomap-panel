# Contributing

You need Node.js and Docker.

## Demo stack

```bash
npm install
npm run build
npm run stack:up
npm run stack:smoke
```

The stack starts these services:

| Service         | URL                   |
| --------------- | --------------------- |
| Grafana 12.3.11 | http://localhost:3011 |
| Grafana 12.4.13 | http://localhost:3012 |
| Grafana 13.2.4  | http://localhost:3013 |
| VictoriaMetrics | http://localhost:8428 |

A generator pushes synthetic traffic series. Open the demo dashboard: http://localhost:3012/d/drawiomap-demo (or port 3013). Anonymous access is on, with the Admin role.

The dashboard shows the demo-lab diagram. The links have colours from the synthetic traffic. The icon of the `lte` node is red because its `up` series is 0. Move the pointer on a link to see the traffic in each direction. Move it on `rtr-a` or `rtr-b` to see the CPU sparkline.

Stop the stack with `npm run stack:down`. This command also deletes the volumes.

## Commands

```bash
npm run dev               # webpack in watch mode
npm test                  # Vitest unit tests (jsdom, real SVG fixtures)
npm run typecheck && npm run lint
npm run check:bundle      # fails if draw.io runtime code is in the bundle
npm run e2e:12.3          # Playwright project `matrix` on Grafana 12.3 (the stack must run)
npm run e2e:12            # Playwright project `matrix` on Grafana 12.4
npm run e2e:13            # Playwright projects `matrix` and `plugin` on Grafana 13
npm run e2e:matrix        # all three: the version split suite
npm run e2e:webkit        # the WebKit check of the card tooltip on Grafana 13
npm run e2e:release       # everything on both versions, then the WebKit check (before a tag)
npm run stack:wait        # wait for the demo series, Grafana health and the plugin (bounded, no fixed sleep)
npm run package           # artifacts/simnv-drawiomap-panel-<version>.zip (run npm run build first)
npm run ci:local          # all CI steps in order: install, checks, build, package, e2e (the version split) on both versions
npm run build:dashboard   # rebuild provisioning/dashboards/demo.json
npm run docs:screenshots  # capture the doc images
./scripts/export-fixtures.sh   # export fixtures/{demo,hand}/*.drawio to fixtures/demo/svg/*.svg
```

`npm run docs:screenshots` captures every doc image from the demo stack. It writes the images to `src/img/screenshots` (the plugin catalogue) and to `docs/guide/images` (the guide). It uses the dark theme. The Playwright project `docs` exists only when `PW_DOCS=1`, so `npm run e2e` never overwrites the images.

## Benches

Two benches, not in CI. The history bench prints ms and KB per pass of 300 cells for the history cache, the frame scan, the boundary copy, `historySeries` and 600 store resolves; run it alone, with the GC held. The card bench records a Chromium trace of 20 hovers on the demo dashboard and prints the pointermove task times, the chart commit and the top self-time functions; it needs the stack and the built plugin.

```bash
DMAP_BENCH=1 NODE_OPTIONS="--expose-gc --max-semi-space-size=512" npx vitest run src/query/history.bench.test.ts --maxWorkers=1
GRAFANA_URL=http://localhost:3013 node scripts/bench/card-hover.mjs
```

## Fixtures and records

The demo network in `fixtures/demo/` is fictional. Its `.yaml` sources are portograph input; `npx portograph render fixtures/demo/demo-l3.yaml --format drawio --output fixtures/demo/demo-l3.drawio` makes the `.drawio` file again.

The acceptance results are in [docs/acceptance.md](docs/acceptance.md). The decision records are in [docs/adr/](docs/adr/). The option reference is in [docs/guide/](docs/guide/index.md).

## E2E suites

`playwright.config.ts` has two Chromium projects. The split follows the surface that a test depends on:

- `matrix`: the tests on surfaces that differ between Grafana versions: the panel edit page and the options pane, the dashboard save API, the datasource query editors, the dashboard refresh in panel edit, field config and overrides, the theme, plugin and chunk loading. They run on 12.3, 12.4 and 13.2. A whole spec file is in `matrix` when it is in the list `MATRIX_SPECS` in `playwright.config.ts`. A single test is in `matrix` when it has the tag `@matrix` (`test(title, { tag: '@matrix' }, fn)`).
- `plugin`: every other test, that is, the tests on the DOM that the plugin draws itself. They run on 13.2 in the push suite and in CI, and on 12.4 too in `npm run e2e:release`. No suite runs them on 12.3.

`npm run e2e:12.3` and `npm run e2e:12` run `matrix`; `npm run e2e:13` runs `matrix` and `plugin`; `npm run e2e:release` runs `matrix` on 12.3, both projects on 12.4 and 13.2, and then the WebKit check. Pass a spec file after `--` to run one spec, for example `npm run e2e:13 -- tests/links.spec.ts`. Use `--project=name` with an equals sign: `--project name` takes the next file name as a project.

`scripts/run-e2e.sh` (the scripts above) starts Playwright with `min(4, floor(CPUs / 2))` workers, and at least 2. `PW_WORKERS=N` or `--workers N` sets another count. The script sets `GRAFANA_URL` from the port argument (an inherited `GRAFANA_URL` is not used) and runs `scripts/wait-stack.sh` first; with `DMAP_STACK_READY=1` it skips that wait (`npm run ci:local` sets it after its own wait).

The compose stack and the CI workflow set `GF_DASHBOARDS_MIN_REFRESH_INTERVAL=1s`, so a test dashboard can refresh every second. Grafana runs a refresh only when its interval is in the dashboard list `timepicker.refresh_intervals`: the `createDiagram` option `refresh` writes it. Tests that wait for a timer use this interval, not the default 5 s.

A test that writes a screenshot for review into `local/` does it only when `DMAP_SCREENSHOTS` is set. A normal run writes nothing into `local/`.

Playwright does not call a vertical or horizontal link half visible, because its polyline has no width or height. Use `hoverHalf` and `pointOnHalf` from `tests/authoring-controls.ts` to hover or click a half. They wait for a layout box and use the mouse.

## Unit test projects

`vitest.config.ts` has two projects. `npm test` and `npm run test:affected` run both. Pick the project by the file name:

- `logic`: a plain `src/**/*.test.ts` file. It has no `render`, no `vi.mock` and no `@grafana/ui`. The project runs on the threads pool with `isolate: false`: the files of one worker share their module registry, so the import of `@grafana/data` is paid once for each worker and not for each file. Each file still gets its own jsdom document. `vitest.setup.logic.ts` resets the body, the root attributes, the storage, the timers and the query sessions after each test. A test in this project must not leave module state behind.
- `components`: every `src/**/*.test.tsx` file, the `.ts` files that mock modules (`src/module.test.ts`, `src/query/grafana.test.ts`), and the `.ts` files that reach DOMPurify (`portograph`, `setCellAttrs`, `harness`, `applier`, `sanitize`, `sanitizeCache`, `svgStage`). Node loads DOMPurify once for each worker and binds it to the jsdom window of the first file that imports it, so in the next file `sanitize` returns null. To make this failure independent of the file order, `vitest.setup.logic.ts` mocks `dompurify` with an error: a logic file that reaches it always fails. Each file has its own process, jsdom and module registry, so mocks and mounted trees cannot leak.

Worker limit: in Vitest 4 and 5, `maxWorkers` is one limit for all projects that run at the same time. The two projects share one worker queue. `vitest.config.ts` sets `maxWorkers: 6` at the root, so a plain `npm test` run (which the pre-push hook also uses) starts 6 workers in total. The old split (2 for `logic`, 4 for `components`) is not possible: projects with different `maxWorkers` need different `sequence.groupOrder`, and then they run one after the other. When you pass `--maxWorkers=N` on the command line (as `test:affected` does), the config sets no limit and N is the total for both projects. In Vitest 3, N applied to each pool.

A new `.test.ts` file that needs `vi.mock`, `@grafana/ui` or `sanitizeSvg` goes in the `componentTests` list in `vitest.config.ts`. Put polyfills in `vitest.polyfills.ts` (a function that each setup file calls: a setup file runs for every test file, a module that it imports runs once for each worker). Run one project with `npx vitest run --project logic`. After you change the logic setup, run it once with `--sequence.shuffle` to find order dependence.

## Git hooks

Run `npm run hooks:install` once for each clone. It sets `core.hooksPath` to `.githooks`.

- `pre-commit`: the privacy check on the staged diff, then `npm run typecheck` and `npm run lint` when code files are staged.
- `pre-push`: the privacy check on the pushed commits (a commit that a branch and its tags both publish is scanned once), then `npm test` with 4 workers. When another vitest process is active, the hook waits for it to end (at most 10 minutes), because two runs make the timed tests time out.

The privacy check prints `file:line` only. It uses generic patterns (home paths, MAC addresses, private IPv4 outside the demo ranges in `.githooks/privacy-allow.txt`) and the private terms in `~/.config/simnv-drawiomap-panel/denylist` (set `SIMNV_PANEL_DENYLIST` to use another path). Without that file only the generic patterns run. `npm run check:privacy` scans all tracked files. CI runs the generic patterns in the `privacy` step of `.github/workflows/ci.yml` and `.woodpecker/ci.yaml`.

## CI

GitHub is the primary repository. GitHub Actions runs two workflows:

- `.github/workflows/ci.yml`, on push and pull request to `main`: `npm ci`, privacy check, typecheck, lint, unit tests, build, `check:bundle`, `package`. It uploads the plugin zip as the artifact `plugin-zip`. It runs no e2e tests.
- `.github/workflows/release.yml`, on a pushed tag `vX.Y.Z`: it runs `ci.yml` on the tag, checks that the tag is `v` plus the `package.json` version, and makes a GitHub release with the zip, its `.sha256` file, the same zip and checksum under the stable name `simnv-drawiomap-panel.zip` (the install docs link `releases/latest/download/simnv-drawiomap-panel.zip`, so they need no edit per release) and the notes from the `CHANGELOG.md` section of that version. To release a tag that exists already, run the workflow by hand with the tag as input.

The actions are pinned by commit SHA. Dependabot (`.github/dependabot.yml`) proposes updates each week.

To release: set the version in `package.json` and the heading in `CHANGELOG.md`, run `npm run e2e:release`, commit and push `main`. Run `npm run ci:status -- --wait`: GitHub Actions and Woodpecker must both pass on the commit. Then `git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z`. Push at most 3 tags at a time: GitHub starts no tag workflow for a push with more tags. For such a tag, run `release.yml` by hand.

Woodpecker CI (v3, docker backend) runs the e2e tests on a Forgejo mirror of the GitHub repository. It runs the workflow `.woodpecker/ci.yaml` on a push to `main`, pull request and manual events (the mirror also copies the Dependabot branches; GitHub Actions checks those). The benches multiply their time budgets by 6 when `CI` is set (GitHub Actions and Woodpecker set it). `DMAP_BENCH_BUDGET_SCALE` sets another multiplier. One workflow runs all steps in order, because workflows do not share a workspace. A failed step fails the workflow, and the steps after it do not run.

1. Build: `npm ci`, privacy check, typecheck, lint, unit tests, build, `check:bundle`, `package`. The last step shows the plugin zip and its sha256. There is no cache: the run downloads the pinned draw.io release (about 46 MB from github.com) once, and `scripts/vendor-drawio.sh` checks its sha256. Woodpecker has no cache without a volume or a plugin.
2. Stack: the step `grafana-files` runs `scripts/ci-grafana-files.sh`: it copies `dist/` and `provisioning/` to `ci/` in the workspace (one plugin folder for each Grafana) and checks that the copies are the same as `dist/`, the files of the plugin zip. The detached steps `victoriametrics`, `metrics-gen`, `grafana123`, `grafana12` and `grafana13` start the stack (the same images as `docker-compose.yaml`: Grafana 12.3.11, 12.4.13 and 13.2.4). The step name is the hostname. Grafana reads the plugin and the provisioning from the workspace (`GF_PATHS_PLUGINS`, `GF_PATHS_PROVISIONING`). The step `wait` runs `scripts/wait-stack.sh` with `VM_URL=http://victoriametrics:8428` and `GRAFANA_URL="http://grafana123:3000 http://grafana12:3000 http://grafana13:3000"`.
3. E2E: the steps `e2e-123`, `e2e-12` and `e2e-13` run Playwright in `mcr.microsoft.com/playwright`, with the same version as `@playwright/test`, on the `node_modules` and `dist/` of the build. `e2e-123` runs the project `matrix` on Grafana 12.3. `e2e-12` runs the project `matrix` on Grafana 12.4. `e2e-13` runs the projects `matrix` and `plugin` on 13.2 (see "E2E suites"). The runs are one after the other because they share the Playwright output folders. If an earlier e2e step fails, the next one does not run. CI does not run the WebKit check.

The steps do not use the docker socket, volumes, privileged mode or secrets. The repository does not have to be trusted. The steps need access to registry.npmjs.org, github.com and raw.githubusercontent.com (draw.io release and its LICENSE).

### CI status and logs

`npm run ci:status -- [--wait] [--logs] [<commit>]` shows the GitHub Actions runs and the Woodpecker pipeline of a commit (default `HEAD`). `--wait` polls every 30 seconds until no run is pending, and tries again 3 times after an API error. `--logs` prints the last 60 lines of each failed Woodpecker step. The exit status is 0 (all passed), 1 (a run failed), 2 (a run is pending, also when `--wait` stops after 60 minutes) or 3 (a setup or API error). A new commit is pending on Woodpecker until the next mirror sync (every 10 minutes). The detached steps (`grafana*`, `metrics-gen`) always end with exit 137 at teardown. That is not a failure, and the script does not report it.

The script needs the `gh` CLI and, for Woodpecker, `WOODPECKER_SERVER` and `WOODPECKER_TOKEN` (a Woodpecker personal token) in the gitignored `.env`. It takes the Woodpecker repository from the git remote `forgejo`, and `WOODPECKER_REPO=owner/name` overrides it. Do not write the Forgejo hostname in repository files.

### Mirror setup

Make the mirror with Forgejo "New migration" from GitHub, with "This repository will be a mirror" and a 10-minute interval. A normal repository with a push from your machine does not sync. Then activate the mirror in Woodpecker.

`npm run ci:woodpecker` runs the workflow with `woodpecker-cli exec` (image `woodpeckerci/woodpecker-cli:v3`) on the local docker. It copies the files of the working tree (without ignored files) to `~/.cache/wp-ci/repo` (`WP_DIR` selects another folder), so `node_modules` and `dist/` of your checkout do not change.

`npm run ci:local` runs the same steps without Woodpecker. It runs typecheck, ESLint and the unit tests at the same time and prints the output of each step in a fixed order, as soon as that step ends. ESLint runs without the import guards: the unit suite runs them. Its e2e steps use the compose stack and `scripts/run-e2e.sh`. `SKIP_INSTALL=1` keeps `node_modules`. `SKIP_E2E=1` stops after the package step. The e2e steps stop the compose stack at the end (`docker compose down -v`).
