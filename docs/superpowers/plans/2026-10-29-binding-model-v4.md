# Binding model v4: implementation plan (P0–P3)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. Work task by task. Steps use checkboxes (`- [ ]`). Write the test first, run it, see
> it fail, then write the code. Omit all `Co-Authored-By` lines in commit messages.

**Goal:** replace the v3 pattern bindings with the v4 model (classes in the panel options, `bind` and `key` on the
cells, a YAML editor), regenerate the 10 panels of the consumer team with it, and then add the split editor.

**Architecture:** P1 builds the v4 runtime in new modules beside v3, then one cut-over task wires it and deletes v3
and the v3 popup. P2 changes the generator of the consumer team (cell attributes, classes, `pull`, merge, deploy
gate). P1 and P2 ship as one change set (A11). P3 adds the split editor on top of the plain YAML option of P1.

**Tech stack:** TypeScript, React, `@grafana/ui` and `@grafana/data` 12.4.13, zod 3.23.8, `yaml` 2.x (lazy chunks
only), vitest, Playwright with `@grafana/plugin-e2e`; consumer: Python 3 with `uv`, pytest, Node 22 for the harness.

**Spec:** `docs/superpowers/specs/2026-10-28-binding-model-v4-design.md`, revision 4 (commit `fd28d1b`). The spec is
the contract. Each task names its sections; read them before you start. "Sn" below means spec section n; "P1.4"
means P1 acceptance item 4 of spec section 9.

## Global constraints

Every task includes these rules.

- **Decisions.** Do not change a decision (D1–D26) or an amendment (A1–A17). When the code does not fit the spec,
  stop and escalate with the evidence.
- **Privacy.** The panel repository and its history are public. In panel files use only the demo network names
  (`fixtures/demo/`). Do not write the name of the consumer project, a home path, a real host name, a MAC address or
  a private IP outside the demo ranges: write "the consumer team" and "the consumer repository". Real diagrams,
  screenshots and notes go in the gitignored `local/` folder. Run `npm run check:privacy` before each panel commit.
  Never bypass the git hooks (`npm run hooks:install` once per worktree).
- **Writing.** ASD-STE100 Simplified Technical English in docs, comments, UI text and commit messages.
- **Grafana plugin rules.** Do not modify `.config/`. Do not change the plugin id or type. Use the webpack config
  as it is. Use `@grafana/plugin-e2e` for e2e tests (read `.config/AGENTS/e2e-testing.md`).
- **Standards.** Read `CODING_STANDARDS.md` before the first change. A Y range goes through `yDomain`, and graphs
  start at zero by default. Missing data is grey "no data", never a good state.
- **CPU budget.** At most 4 heavy jobs at one time for the whole run (full suites, e2e runs, builds, CPU-heavy
  workers). A task that says "Parallel: yes" can run beside its siblings only inside this limit. Vitest runs with
  `--maxWorkers=4`; when four tasks run at one time, each uses `--maxWorkers=2`. E2E runs one spec at a time with
  `--workers 1`. At most two e2e tasks run at one time: one e2e worker with its two Grafana containers counts as one
  heavy job. The full `npm test`, `npm run e2e:matrix` and `npm run e2e:release` run only at a release step, on
  `main`.
- **Branches, panel.** The integration branch is `binding-model-v4`. Each task works in its own Orca worktree on a
  branch `v4/<task-id>` from the current head of `binding-model-v4`, and merges back with `git merge --no-ff` after
  its review. Two tasks that run in parallel touch no common file; the "Files" list of each task is its ownership.
- **Branches, consumer.** All consumer work is on the branch `drawiomap-v4` in a separate worktree of the consumer
  repository. Never commit on the consumer `main` and never touch its working tree: it holds uncommitted edits of
  the owner. Create the worktree from the committed `main` head (task P0-2).
- **Until the cut-over (P1-13c).** v3 view mode stays complete and green. Add each v4 function next to the v3
  function in the same file, or in a new file. Do not change v3 behaviour, except where a task says so (the applier
  key of P1-05 is a fix for both; P1-13a removes the v3 popup and editor, not the v3 view mode). P1-13c removes the
  v3 runtime.
- **Names.** The v4 symbols keep the names that their task gives them (`bindV4`, `statusPaintV4`, `buildCardV4`,
  and so on) through P1 and P3. This plan has no rename step; a rename is a later cleanup. The harness (P1-12) keeps
  its pinned names.
- **Commits.** One commit per finished step group, with a message that names the task, for example
  `feat(v4): P1-02 matcher contract`. No `Co-Authored-By` lines.

### Standard commands

Panel, in the task worktree (run from its root):

```sh
# unit tests of the task, then the tests related to the files changed on the task branch
npx vitest run <test files of the task> --maxWorkers=4
npx vitest run --changed binding-model-v4 --maxWorkers=4
npm run typecheck
npm run lint              # eslint and check:imports
npm run check:imports     # alone, when the task changes imports only
npm run check:privacy
npm run build && npm run check:bundle   # when the task says so; a build is a heavy job
```

E2E in a panel worktree. The shared stack (ports 3012 and 3013) mounts the `dist/` of the main checkout, so a task
starts its own Grafana with its own `dist/`. Each e2e task has its own port pair (13.2 / 12.4), so two parallel e2e
tasks never share a port. Replace 3213 and 3212 below with the pair of the task:

| Task | 13.2 | 12.4 |
|---|---|---|
| P1-15a (it merges before P1-16 starts) | 3213 | 3212 |
| P1-15b | 3243 | 3242 |
| P1-16 | 3213 | 3212 |
| P1-17 | 3223 | 3222 |
| P1-18 | 3233 | 3232 |
| P3-07 | 3213 | 3212 |
| P3-08 | 3223 | 3222 |
| P3-09 (isolation) | 3233, 3243 | — |

```sh
MAIN="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
[ -e node_modules ] || ln -s "$MAIN/node_modules" node_modules
[ -d .drawio/webapp ] || { mkdir -p .drawio && cp -R "$MAIN/.drawio/webapp" "$MAIN/.drawio/webapp.version" .drawio/; }
npm run build
docker compose -f "$MAIN/docker-compose.yaml" up -d --wait victoriametrics   # the shared datasource
docker run -d --rm --name dmap-<task-id> --network simnv-drawiomap-panel_default -p 127.0.0.1:3213:3000 \
  -e GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=simnv-drawiomap-panel -e GF_AUTH_ANONYMOUS_ENABLED=true \
  -e GF_AUTH_ANONYMOUS_ORG_ROLE=Admin -e GF_DEFAULT_APP_MODE=development -e GF_LOG_LEVEL=warn \
  -e GF_NEWS_NEWS_FEED_ENABLED=false \
  -v "$PWD/dist:/var/lib/grafana/plugins/simnv-drawiomap-panel" -v "$PWD/provisioning:/etc/grafana/provisioning" \
  grafana/grafana:13.2.4
GRAFANA_URL=http://localhost:3213 npx playwright test tests/<spec>.spec.ts --project=plugin --workers 1
# a spec of MATRIX_SPECS: --project=matrix, on 13.2 and again on a 12.4 container (grafana/grafana:12.4.13, port 3212)
docker stop dmap-<task-id>
```

Consumer, in the consumer worktree (run from its root):

```sh
uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/<test file> -q -p no:cacheprovider -rs
scripts/dm tests          # gen_diagrams + gen_drawiomap tests; a heavy job
scripts/dm regen [--sheet <name>]   # regenerate with the pinned tools; a heavy job
scripts/dm gates          # the deploy gates of scripts/deploy.sh step 0
```

### Review rules

- **Task review.** Each panel task with a `src/` diff gets one adversarial review of its diff against
  `CODING_STANDARDS.md` and its spec sections, by a fresh agent or a Codex worker that did not write the code.
  Correctness and privacy findings block the merge. Do one full round, fix, then one targeted re-check. Docs, tests
  and fixtures get a lighter review. Consumer tasks get the same review against spec section 7.
- **Phase gate.** Each phase ends with a gate task (P0-G, P1-G, P2-G, P3-G). An independent reviewer (a Codex worker
  supervised through Orca, model of the coordinator's choice) reads the whole phase diff against the spec and
  `CODING_STANDARDS.md`. Same blocking rule. Then the gate commands of the task run once.

## Phase map

| Phase | Repo | Tasks | Ships |
|---|---|---|---|
| P0 | panel, consumer | P0-1, P0-2, P0-G | baselines only; no release |
| P1 | panel | P1-00 … P1-20 (with the splits 09a/b, 11a/b, 13a/b/c, 15a/b), P1-G | together with P2 (A11) |
| P2 | consumer | P2-01 … P2-10, P2-G | together with P1 |
| R | both | R-1 … R-4 | the P1+P2 change set |
| P3 | panel (P3-11: both) | P3-01 … P3-11, P3-G, P3-R | a second change set |

Waves (a task starts when its dependencies are merged; at most 4 heavy jobs at one time; a wave with more than four
tasks runs four, and the next task starts when one merges):

| Wave | Tasks |
|---|---|
| 0 | P0-1 (done on `v4/P0-1`, commit `a1aec84`, not merged yet), P0-2 (in progress on the consumer branch `drawiomap-v4`) |
| 0G | P0-G, then P1-00 (types only, about 20 minutes) |
| 1 | P1-01, P1-02, P1-03, P1-04 |
| 2 | P1-05, P1-06, P1-07, P1-08, P1-09a (P1-09a needs only P1-00 … P1-03) |
| 3 | P1-09b, P1-10, P1-13a (P1-13a touches no file of P1-09 … P1-11) |
| 4 | P1-11a, then P1-11b; P1-13b (beside P1-11a or P1-11b) |
| 5 | P1-12, then P1-13c (the cut-over) |
| 6 | P1-14, P1-19, P1-20 (after P1-19); P1-15a after P1-14; P2-01 can start here (it needs only P1-12) |
| 7 | P1-15b, P1-16, P1-17, P1-18 (e2e: at most two of them at one time, each on its own ports; the next starts when one merges) |
| 6–8 | P2-02, P2-03, P2-04, then P2-05: they need only P2-01 and fill free heavy-job slots of waves 6–8 |
| 8 | P1-G |
| 9 | the P2 tasks of waves 6–8 that are not done yet |
| 10 | P2-06, P2-07, P2-08 |
| 11 | P2-09, P2-10, P2-G |
| 12 | R-1 … R-4 |
| 13 | P3-01, P3-02, P3-03; then P3-04 … P3-11 |

---

## P0: baselines before any delete

The v3 code must be the code of `main`. Before P0-1, check that `git diff main -- src` on `binding-model-v4` is
empty. P0 finishes before the first P1 task merges.

### Task P0-1: bench of the v3 bind (panel)

- **Repo:** panel. **Spec:** S9 P0 item 1, S10.3 "Performance". **Depends on:** none. **Parallel:** yes (with P0-2).
- **Files:** create `src/fixtures/benchBind.ts` (the fixture builder, version-free), create
  `src/binding/bind.v3.bench.test.ts`; modify `docs/acceptance.md` (a new table "Binding model v4: bench").
- **Interfaces:** Produces
  `buildBenchFixture(opts: { cells: number; series: number; seed: number }): { svg: string; data: PanelData; cellIds: string[] }`
  and `benchV3Config(f): unknown` (the v3 config for the fixture). P1-19 reuses `buildBenchFixture` with a v4
  config, so the fixture holds no v3 type.

- [ ] Write `src/fixtures/benchBind.test.ts`: the builder gives 300 cells and 1000 series with demo names
      (`node-*`, `sw-*`), deterministic for one seed.
- [ ] Run it: `npx vitest run src/fixtures/benchBind.test.ts --maxWorkers=4`. Expect FAIL (no module).
- [ ] Write the builder. Run again; expect PASS.
- [ ] Write the bench as `src/query/history.bench.test.ts` does: bind 300 cells × 1000 series with the v3 engine
      (`bindPlan`, `src/binding/engine.ts:150`), 20 runs, report the median in ms.
- [ ] Run it 3 times: `npx vitest run src/binding/bind.v3.bench.test.ts --maxWorkers=1`. Write the median of the 3
      medians, the machine (CPU model only) and the commit into `docs/acceptance.md`.
- [ ] Gate: `npm run typecheck && npm run lint && npm run check:privacy`. Commit: `test(v4): P0-1 v3 bind bench`.

Done: the number and the commit are in `docs/acceptance.md`; the fixture builder holds no v3 type.

### Task P0-2: colour-parity record and frame fixtures (consumer)

- **Repo:** consumer. **Spec:** S9 P0 item 2, S8.1, S8.2, S9 P2 acceptance 6. **Depends on:** none.
  **Parallel:** yes (with P0-1).
- **Files (consumer):** create `scripts/gen_drawiomap/tests/behaviour/parity_record.py`, create
  `scripts/gen_drawiomap/tests/fixtures/behaviour/v3-parity/{net-l2-dm,boiler-enclosure}.json`, create
  `scripts/gen_drawiomap/tests/fixtures/behaviour/frames/{net-l2-dm,boiler-enclosure}-{v3,v4}.json`, create
  `scripts/gen_drawiomap/tests/test_parity_record.py`, create
  `scripts/gen_drawiomap/tests/behaviour/parity_paint.mjs` (approved by the owner).
- **Interfaces:** Produces the record format
  `{sheet, panelSha, at, cells: {<cellId>: {severity, fill, stroke, text, halves?: {a2b: {color, percent}, b2a: {color, percent}}}}}`
  that P2-10 compares against.

- [ ] Create the consumer worktree and branch from the committed `main` head:
      `git -C <consumer repo> worktree add ../<consumer repo name>-v4 -b drawiomap-v4 main`. Do all consumer work
      there. Check `git -C <worktree> status --short` is empty.
- [ ] Record the frames once, at one fixed time range, with `tests/behaviour/vm_fixture.py`: the v3 targets of the
      two sheets (their refIds of today) and the v4 targets of S8.1 and S8.2 (refId = query name; boiler
      `mrwm2_norm` without `min`). Both files hold the same `from`, `to` and step, so P2-10 compares at the same
      frames.
- [ ] Write `test_parity_record.py`: the record of a tiny fixture sheet (`tests/fixtures/tiny.drawio`) has one entry
      per bound cell with all fields. Run:
      `uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/test_parity_record.py -q -p no:cacheprovider -rs`.
      Expect FAIL.
- [ ] Write `parity_record.py`: run the v3 harness (`replay.mjs`, `hover.mjs`, `legend.mjs`) at the current pin
      (`pins.PANEL_SHA` = `68847e4…`) on the v3 frame file; write the record. Run the test; expect PASS.
- [ ] Run the record for net-l2-dm and boiler-enclosure. Commit:
      `test(drawiomap): P0-2 v3 colour parity record`.

Done: two records and four frame files are on `drawiomap-v4`; the records name the panel pin.

### Task P0-G: P0 gate

- **Depends on:** P0-1, P0-2. **Parallel:** no.
- **Status at plan review:** P0-1 is done on `v4/P0-1` (commit `a1aec84`, not merged). P0-2 is in progress on the
  consumer branch `drawiomap-v4`.
- [ ] Light review of `v4/P0-1` (tests and docs, as for every other task) and of the P0-2 commits on
      `drawiomap-v4` (the consumer review, against S9 P0). Fix the blocking findings on the task branch.
- [ ] A reviewer checks: the bench number is reproducible (one more run within 15 %); the records cover every
      bound cell of the two sheets; the v4 frame files hold every refId of S8.1 and S8.2.
- [ ] Merge `v4/P0-1` into `binding-model-v4` with `git merge --no-ff`.

---

## P1: the panel runtime (panel repository)

### Task P1-00: the shared types of wave 1

- **Repo:** panel. **Spec:** S4 (the entry kinds and the type), S2.2 (the `match` value). **Depends on:** P0-G.
  **Parallel:** no (it merges before wave 1 starts; about 20 minutes).
- **Files:** create `src/binding/report.ts`, `src/binding/report.test.ts`; create `src/model/v4.ts` with the
  `MatchV4` type only (P1-01 adds the rest).
- **Interfaces:** Produces, in `src/binding/report.ts`: `REPORT_KINDS` (a readonly tuple of the S4 kinds),
  `ReportEntry` (S4, exact union, discriminated by `kind`), `UsePath = string`. In `src/model/v4.ts`:
  `MatchV4 = Record<string, string | string[]>`. P1-01, P1-02, P1-04 and P1-07 import these types, so the four
  tasks of wave 1 share no file.

- [ ] Write `src/binding/report.test.ts`: `REPORT_KINDS` equals the list of kinds of S4, in the S4 order; a type
      test (`expectTypeOf`) that each kind has the fields of its S4 row.
- [ ] Run: `npx vitest run src/binding/report.test.ts --maxWorkers=4`. Expect FAIL. Write the types. Expect PASS.
- [ ] Gate: `npm run typecheck && npm run lint && npm run check:privacy`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-00 report and match types`.

Done: the types of S4 are in one module that every wave-1 task can import.

### Task P1-01: schema, item parse and class chain

- **Repo:** panel. **Spec:** S2.1–S2.3, S2.5 steps 1, 3, 4, S2.6, S4 (the type), S3.2 steps 1–2.
  **Depends on:** P1-00. **Parallel:** yes (wave 1).
- **Files:** modify `src/model/v4.ts` (from P1-00); create `src/model/v4.test.ts`, `src/binding/classes.ts`,
  `src/binding/classes.test.ts`, `src/fixtures/pilots-v4.ts` (the two configs of S8.1 and S8.2, demo names).
- **Interfaces:** Consumes `ReportEntry`, `UsePath` and `MatchV4` of P1-00. Produces, in `src/model/v4.ts`:
  `envelopeSchema`, `classSchema`, `overrideSchema` (its `match` schema is typed `z.ZodType<MatchV4>`), the types
  `ClassV4`, `OverrideV4`, `ConfigV4`, `RowV4`, `ChartV4`, `LowerBound`, `RangeMax`, `FreshnessPolicy`
  (same shape as the v3 type of `src/model/config.ts`), `LinkLabelMode`, and
  `parseConfig(raw: unknown): ParsedConfig` with
  `ParsedConfig = { config: ConfigV4 | null; invalidClasses: Map<string, ReportEntry[]>; invalidOverrides: Map<string, ReportEntry[]>; report: ReportEntry[] }`.
  In `src/binding/classes.ts`:
  `resolveClasses(parsed: ParsedConfig): Map<string, ResolvedClass>` and
  `effectiveClass(cls: ResolvedClass, override?: OverrideV4): ResolvedClass`, where
  `ResolvedClass = ClassV4 & { name: string; chain: string[]; rows: Array<RowV4 & { origin: string }>; abstract: boolean }`.

- [ ] Write `src/model/v4.test.ts`: both pilot configs parse; `version: 3` and `version: 2` give one
      `outdated-config` entry and `config: null`; an unknown key in one class makes that class invalid with a
      `schema` entry at `classes.<c>.<key>` and the other classes parse; an invalid override is invalid alone;
      `freshness` defaults to `3x`; `overrides` defaults to `{}`; the matcher regex of S2.2 rejects `key: "a b c"`.
- [ ] Write `src/binding/classes.test.ts`: rows append parent-first; `match`, `chart`, `capacity` replace as one
      field; a cycle gives `class-cycle` for each class in it; an unknown parent gives `class-unknown-parent`; a
      parent that did not parse gives `class-invalid-parent` for each descendant; an override appends rows and
      replaces other fields; a row keeps its `origin` (`classes.device.rows[0]`) through `extends`; a class with no
      `match` is `abstract`.
- [ ] Run: `npx vitest run src/model/v4.test.ts src/binding/classes.test.ts --maxWorkers=4`. Expect FAIL.
- [ ] Write the schema exactly as S2.2, the parse order of S2.5, and the chain of S2.3. Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint && npm run check:privacy`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-01 schema, item parse and class chain`.

Done: P1.1 (parse parts), P1.5 (extends, overrides, row match replaces), P1.12 (parse part) pass.

### Task P1-02: the matcher contract

- **Repo:** panel. **Spec:** S2.4 (all steps), S3.3 (A17: `${name:format}` in a matcher).
  **Depends on:** P1-00. **Parallel:** yes (wave 1).
- **Files:** create `src/binding/matcher.ts`, `src/binding/matcher.test.ts`.
- **Interfaces:** Produces
  `parseMatchBlock(block: MatchV4 | Record<string, string | string[]>, path: string): { ok: true; block: ParsedBlock } | { ok: false; errors: Array<{ path: string; message: string }> }`;
  `ParsedBlock = { matchers: ParsedMatcher[]; requiredAttrs: string[] }` (`requiredAttrs` holds `port`,
  `from.key`, and so on); `resolveBlock(block: ParsedBlock, attrs: (name: string) => string | undefined, cache: RegexCache): { ok: true; test: (labels: Labels) => boolean; equality?: Map<string, string>; resolved: Array<{ label: string; op: '=' | '!=' | '=~' | '!~'; value: string }> } | { ok: false; kind: 'missing-attr'; attr: string } | { ok: false; kind: 'matcher-error'; text: string; message: string }`;
  `createRegexCache(): RegexCache` (one per bind). It returns plain results; P1-09b maps them to `ReportEntry`.
  `resolved` holds each matcher after the `${…}` substitution, in the block order; the inspector of P3-05 shows it.

- [ ] Write `src/binding/matcher.test.ts` with the cases of P1.3: each form (bare, `=`, `!=`, `=~`, `!~`, a list);
      anchoring (`=~"a"` does not select `ab`); a value with `.`, `"` and `\` is regex-escaped; `entity=~"\\d+"`
      gives the body `\d+`; `"\d"` is a `schema` error; a leading `(?i)`; `(?P<n>…)`, `(?s)`, `(?i:…)`, a lookbehind,
      `\1`, `\k<n>`, `\A`, `\z`, `\Q…\E`, `\p{L}` each give `matcher-error` "not in the PromQL regex dialect";
      `instance=~"node-a\\z"` selects neither `node-a` nor `node-az`; `\-` and `\_` outside and inside a class are
      literals; `\y` gives `matcher-error`; `job!="x"`, `job=""` and `job=~".*"` pass on a series with no `job`,
      `job="x"` fails; `match: {}` and `{key: 'job!=""'}` are rejected ("match must read a cell attribute");
      `${labels.x}` and `${value}` in a matcher are `schema` errors; `${job:csv}` in a matcher is a `schema` error
      (A17); `${port}` on a cell with no `port` gives `missing-attr` with `port`, also when a dashboard variable
      `port` exists (the matcher has no access to variables); an empty attribute value counts as present;
      for `{instance: '${key}'}` on a cell with `key=sw-a`, `resolved` is
      `[{ label: 'instance', op: '=', value: 'sw-a' }]`.
- [ ] Run: `npx vitest run src/binding/matcher.test.ts --maxWorkers=4`. Expect FAIL.
- [ ] Write the eight steps of S2.4. The scan reads the body escape by escape. Compile with
      `new RegExp('^(?:' + body + ')$', flags)`, flags `u` plus `i`. Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-02 matcher contract`.

Done: P1.3 and the matcher part of P1.4 pass.

### Task P1-03: templates and the URL order (A17)

- **Repo:** panel. **Spec:** S3.3 (all), S2.6 (dropped roots), S4 (`template-unresolved`, the `${__…}` hint).
  **Depends on:** P0-G. **Parallel:** yes (wave 1).
- **Files:** modify `src/binding/template.ts` (add v4 functions beside the v3 ones), create
  `src/binding/template.v4.test.ts`, modify `src/interact/links.ts` (add `resolveUrlV4`), create
  `src/interact/links.v4.test.ts`.
- **Interfaces:** Produces `TemplateScopeV4 = { attr: (n: string) => string | undefined; from?: (n: string) => string | undefined; to?: (n: string) => string | undefined; labels?: Labels; value?: string }`;
  `checkTemplate(text: string, place: 'url' | 'title' | 'metadata'): Array<{ message: string }>` (the `schema`
  rules of S3.3); `resolveTemplateV4(text: string, scope: TemplateScopeV4, encode?: (v: string) => string): { text: string; missing: string[]; unresolved: string[] }`;
  `formatBareVariables(url: string): string` (step 2 of the URL order);
  `resolveUrlV4(url: string, scope: TemplateScopeV4, replaceVariables: (s: string, v?: ScopedVars) => string): string | null`
  (null when not shown).

- [ ] Write the unit tests of P1.4: the text that reaches a spy `replaceVariables` holds `${job:percentencode}` for
      `$job`, `$__url_time_range` as it is, `${job:queryparam}` and `${job:csv}` as they are, with no `schema`
      error; a cell with `job=cell-a` and the URL `/d/host?var-node=${job}&${job:queryparam}` substitutes `cell-a`
      for `${job}` and leaves `${job:queryparam}`; a `$` and a `${site:csv}` in a cell value reach the spy shielded
      and come back after `unshield`; `${job:csv}` in a metadata text is a `schema` error; `${job.x:csv}` and `${}`
      in a URL are `schema` errors; a URL that fails `isAllowedUrl` gives `null`; a title gets no step 2 and no
      encoding; a name with `-` (`${path-role}`) reads the attribute; `${cell.key}`, `${cellTitle}`, `${percent}`
      read the attributes `cell.key` (missing), `cellTitle`, `percent` (A5); `${__url_time_range}` gives
      `missing-attr` with the hint "write $__name for a Grafana variable"; `${labels.x}` with zero or many status
      series gives `template-unresolved`.
- [ ] Run: `npx vitest run src/binding/template.v4.test.ts src/interact/links.v4.test.ts --maxWorkers=4`. Expect FAIL.
- [ ] Write the functions. Keep `shield` and `unshield`. Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-03 templates and URL order`.

Done: the unit part of P1.4 passes. The real Grafana formats run in P1-18.

### Task P1-04: series index, frame merge, order, units and reduce

- **Repo:** panel. **Spec:** S3.1, S3.2 step 5 and 7, S3.6 (the series-level rows), S3.7 (order, rate units, units,
  format, the reduce table, updown alignment). **Depends on:** P1-00. **Parallel:** yes (wave 1).
- **Files:** create `src/query/seriesIndex.ts`, `src/query/seriesIndex.test.ts`; modify `src/binding/units.ts`
  (add `RATE_UNITS`), create `src/binding/units.v4.test.ts`; modify `src/query/reduce.ts` (add the cross-series
  reduce), create `src/query/reduce.v4.test.ts`; create `src/query/snapshot.ts` (move `QuerySnapshot` here from
  `src/query/types.ts` and re-export it from there, so v3 still compiles).
- **Interfaces:** Produces `Series = { refId: string; labels: Labels; field: Field; frameIndex: number; fieldIndex: number; times: number[]; values: Array<number | null> }`;
  `indexSeries(frames: DataFrame[], refId: string): { series: Series[]; report: ReportEntry[] }` (merge by
  timestamp, `many-fields`, `duplicate-series`, `invalid-series`, sorted by S3.7 order);
  `equalityKey(labels: Labels, names: string[]): string`;
  `RATE_UNITS: ReadonlySet<string>`, `defaultReduce(unit: string | undefined): 'sum' | 'max'`;
  `reduceAcross(series: Series[], how: 'sum' | 'max' | 'mean'): { value: number | null; unit: string | undefined } | { mismatch: string[] }`;
  `alignUpdown(series: Series[], how): { times: number[]; values: Array<number | null> }` (a gap where a member has
  no value).

- [ ] Write the tests of P1.9 (index and reduce part): the order by canonical label string, then frame, then field;
      `sum` for `bps`, `flowlpm`, `cpm`, `max` for `percent` and `rotrpm`; the full rate-unit table of S3.7 as a
      table test; 1 Mbit/s + 500 kbit/s = 1.5 Mbit/s; `bps` + `percent` gives a mismatch; two numeric fields in one
      frame give `many-fields`; a frame delivered twice adds nothing; a range frame at 0, 60, 120 s and an instant
      frame at 125 s with equal labels give four points in both frame orders; two different values at one
      timestamp give `duplicate-series` and the later frame wins; an updown member with no value at a timestamp
      gives a gap; an all-null series stays in the list (the status rule is in P1-05).
- [ ] Run: `npx vitest run src/query/seriesIndex.test.ts src/binding/units.v4.test.ts src/query/reduce.v4.test.ts --maxWorkers=4`.
      Expect FAIL.
- [ ] Write the code. Keep the field checks of `src/query/frames.ts:73-94` (call them). Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-04 series index and reduce`.

Done: the index, merge, order, unit and reduce parts of P1.9 pass.

### Task P1-05: status, colour, no data and the applier key

- **Repo:** panel. **Spec:** S3.4 (severity, worst of N, paint, repaint, link status), S3.6. **Depends on:** P1-04.
  **Parallel:** yes (wave 2).
- **Files:** create `src/binding/severity.ts`, `src/binding/severity.test.ts`; modify `src/binding/color.ts` (add
  `statusPaintV4`), create `src/binding/color.v4.test.ts`; create `src/binding/statusV4.ts`,
  `src/binding/statusV4.test.ts`; modify `src/types.ts` (optional `severity`, `color`, `text`, `refId` on the patch
  status); modify `src/render/applier.ts` (`applyKey`), modify `src/render/applier.test.ts`.
- **Interfaces:** Produces `severityOf(display: { text: string; color: string }, theme: GrafanaTheme2): 'down' | 'critical' | 'warning' | 'normal'`;
  `StatusV4 = { state; severity; color?: string; text?: string; refId?: string; reason?: string }`;
  `statusOfUse(snapshot: QuerySnapshot, series: Series[], opts: { missing: 'nodata' | 'down' }): StatusV4`
  (worst of N, the table of S3.6, coverage "1 of 2 series have no value");
  `statusPaintV4(status: StatusV4, theme): Paint | null` (`transparent` gives `null`).

- [ ] Write the tests of P1.6 (minus band and legend) and P1.7: `magenta`/`Offline` paints magenta; the severity
      table for both themes (named hues and nearest-hue hex); a mapping text `Down` gives `down`; worst of N with
      the S3.7 order as tie-break; `transparent` paints nothing; zero series is grey, `missing: down` gives `down`
      only for zero series of a ready query; a failed query, a first load and an all-null series never give
      `down`; NaN and ±Infinity give `missing` "No value"; coverage 1 of 2; a null → green special mapping does not
      apply; the text of a cell with no data is "–" (S3.6). Applier (Astra R1): same state and text with another colour gives a new `applyKey`, and
      `applyPatches` repaints green → blue; blue → `transparent` removes the paint; a change of each of `state`,
      `severity`, `color`, `text`, `refId`, `reason` alone gives a new key.
- [ ] Run: `npx vitest run src/binding/severity.test.ts src/binding/color.v4.test.ts src/binding/statusV4.test.ts src/render/applier.test.ts --maxWorkers=4`.
      Expect FAIL.
- [ ] Write the code. `applyKey` reads every status field that a write reads; this also fixes v3. Run again; expect
      PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-05 status, colour and applier key`.

Done: P1.6 (status, applier) and P1.7 pass.

### Task P1-06: freshness and the clock

- **Repo:** panel. **Spec:** S3.5 (all), A10. **Depends on:** P1-04. **Parallel:** yes (wave 2).
- **Files:** create `src/binding/freshness.ts`, `src/binding/freshness.test.ts`; modify
  `src/visuals/useSampleStale.ts` (add the deadline input for v4 patches; keep `useClock`), create
  `src/visuals/useSampleStale.v4.test.tsx`.
- **Interfaces:** Produces `cadenceOf(refId: string, request: DataQueryRequest | undefined, series: Series[]): number | undefined`;
  `freshnessMs(policy: string, cadence: number | undefined): number | undefined` (`5m` or `3x`);
  `staleCheck(series: Series[], ctx: { timeRange: TimeRange; request?: DataQueryRequest; freshnessMs?: number; instant: boolean }): { stale: boolean; deadline?: number; reason?: string }`;
  `useStaleStatusV4(patches: PatchMap): PatchMap` (the stale pass with the clock).

- [ ] Write the tests of P1.8: one stale series of six makes the cell stale; an instant target (`instant: true`,
      no `range`) is never stale; a `1m` target with a 15 s request interval has the cadence 60 s; no interval gives
      the median step, and fewer than two points gives no check; `raw.to: 'now'` with the same `PanelData` and
      `timeRange` objects and a fake clock step past `t + freshness` turns the cell stale through the hook with no
      new bind; `raw.to: 'now-1h'` gives a deadline with a lag of 1 h; an absolute range gives no deadline, the same
      clock step changes nothing, and the state comes from `timeRange.to`; a missing timestamp gives `missing`
      "Sample timestamp is missing"; freshness does not apply to capacity.
- [ ] Run: `npx vitest run src/binding/freshness.test.ts src/visuals/useSampleStale.v4.test.tsx --maxWorkers=4`.
      Expect FAIL.
- [ ] Write the code. Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-06 freshness and clock`.

Done: P1.8 passes.

### Task P1-07: link ends, direction and capacity

- **Repo:** panel. **Spec:** S3.8 (all), S5.5 (compressed page), A4. **Depends on:** P1-04.
  **Parallel:** yes (wave 2).
- **Files:** create `src/binding/edgeEnds.ts`, `src/binding/edgeEnds.test.ts`; modify `src/binding/capacity.ts`
  (add the v4 chain), create `src/binding/capacity.v4.test.ts`; create `src/binding/linkFeeds.ts`,
  `src/binding/linkFeeds.test.ts`. Do not change `src/adapter/portograph.ts`: `applyContract` runs inside
  `buildCellIndex` (`src/render/svgStage.ts:129`) with no XML, and a change there changes v3 (today it deletes
  `from`/`to` on a sheet with no `pg-schema`). The cut-over (P1-13c) changes `applyContract`.
- **Interfaces:** Produces `edgeEnds(xml: string | undefined, index: CellIndex): { ends: Map<string, { source?: string; target?: string }>; report: ReportEntry[] }`
  (it resolves the ends at bind time from the index and `Options.diagram.xml`; parse once per diagram hash;
  `no-edge-ends` "compressed page");
  `endAttr(cellId: string, end: 'from' | 'to', name: string, ctx): string | undefined` (port cell before node cell;
  parent chain up to the layer);
  `linkFeeds(at: string | undefined, up: string, down: string): { a2b: string; b2a: string }`;
  `capacityV4(input: { capacity?: string | { a2b: string; b2a: string }; cap?: string; series: (refId: string) => { snapshot; series: Series[] } }): { a2b?: number; b2a?: number; report: ReportEntry[] }`
  (bit/s; `capacity-fallback` with its reason; `bad-cap`).

- [ ] Write the tests of P1.10: a→b = `up`; `at=target` flips the feeds, and `at=source` is no change; capacity
      from one refId, from `{a2b, b2a}`, then `cap=1G`, then `cap=50M/10M`, then none; a speed of 0, a negative
      speed, two speed series and a failed speed query fall through with `capacity-fallback` and the reason;
      `cap=abc` gives `bad-cap`; `cap=50M/10M` with `at=target` and rx 8 Mbit/s gives a→b 8 Mbit/s and 16 %;
      `${from.key}` reads the port cell before the node cell; an ordinary draw.io edge reads its ends from the
      XML; `${from.key}` of an edge whose source is a shape inside a container reads `key` from the container; a
      compressed page gives `no-edge-ends` "compressed page".
- [ ] Run: `npx vitest run src/binding/edgeEnds.test.ts src/binding/capacity.v4.test.ts src/binding/linkFeeds.test.ts --maxWorkers=4`.
      Expect FAIL.
- [ ] Write the code. Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-07 link ends and capacity`.

Done: the unit part of P1.10 passes. P1-09b checks the card row and the label through the engine.

### Task P1-08: YAML writer and reader

- **Repo:** panel. **Spec:** S5.1 (the writer), S5.3 (parse options, `yaml` entries), A12, S2.3 (flow-style note).
  **Depends on:** P1-01. **Parallel:** yes (wave 2).
- **Files:** modify `package.json` and `package-lock.json` (add `yaml` 2.x, exact version); create
  `src/options/yamlConfig.ts`, `src/options/yamlConfig.test.ts`.
- **Interfaces:** Produces `writeYaml(cfg: unknown): string` (the key order of S5.1, `match` in block style, no
  anchors, no aliases) and
  `readYaml(text: string): { ok: true; value: unknown; doc: Document } | { ok: false; errors: Array<{ line: number; message: string }> ; doc: Document }`
  (`parseDocument` with `uniqueKeys: true`; an anchor or an alias is an error). Only the lazy option chunk (P1-14)
  and the split editor (P3) import this module.

- [ ] Write the tests of P1.2: for both pilot configs, `readYaml(writeYaml(cfg)).value` deep-equals `cfg`, and
      `writeYaml(readYaml(writeYaml(cfg)).value)` equals `writeYaml(cfg)`; a `match` value with `${` or `[` is in
      block style; a duplicate key, an anchor and an alias each give an error with its line.
- [ ] Run: `npx vitest run src/options/yamlConfig.test.ts --maxWorkers=4`. Expect FAIL.
- [ ] Write the code. Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`. Check
      `src/viewChunk.test.ts` stays green: no view-mode import of `yaml`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-08 YAML writer and reader`.

Done: P1.2 passes.

### Task P1-09a: validate

- **Repo:** panel. **Spec:** S2.5 steps 1–4, S2.4 steps 1–3, S3.3 (`checkTemplate`), S4 (`schema`).
  **Depends on:** P1-00, P1-01, P1-02, P1-03. **Parallel:** yes (wave 2; it does not need P1-04).
- **Files:** create `src/model/validate.ts`, `src/model/validate.test.ts`.
- **Interfaces:** Produces `validateConfig(raw: unknown): { parsed: ParsedConfig; classes: Map<string, ResolvedClass>; report: ReportEntry[] }`
  (S2.5 steps 1–4 with the matcher steps 1–3 and `checkTemplate`).

- [ ] Write `validate.test.ts`: the pilots validate with an empty report; a bad matcher is a `schema` entry at its
      YAML path and makes only its class invalid; an invalid override is invalid alone and keeps its class valid;
      `${job:csv}` in a metadata text is a `schema` entry; a `version: 3` config gives one `outdated-config` entry.
- [ ] Run: `npx vitest run src/model/validate.test.ts --maxWorkers=4`. Expect FAIL. Write the code. Expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-09a validate`.

Done: the validate parts of P1.1 and P1.12 pass.

### Task P1-09b: bind (the v4 engine and the match report)

- **Repo:** panel. **Spec:** S2.5 (full), S3.2 steps 3–12, S3.6, S3.7 (the reduce table, `many-series`), S3.8
  items 3 and 6, S4 (all). **Depends on:** P1-09a, P1-04, P1-05, P1-06, P1-07.
  **Parallel:** yes (wave 3, with P1-10 and P1-13a).
- **Files:** create `src/binding/bindV4.ts`, `src/binding/bindV4.test.ts`, `src/binding/uses.ts`,
  `src/binding/uses.test.ts`.
- **Interfaces:** Consumes `validateConfig` (P1-09a). Produces
  `listUses(cell: CellMeta, cls: ResolvedClass): Use[]` with
  `Use = { kind: 'status' | 'text' | 'row' | 'chart' | 'up' | 'down' | 'capacity'; refId: string; match: MatchV4; path: UsePath; row?: RowV4 }`;
  `bindV4(input: { index: CellIndex; xml?: string; validated: ReturnType<typeof validateConfig>; data: PanelData; ctx: BindContext }): { patches: PatchMap; uses: Map<string, Use[]>; series: Map<string, Map<string, Series[]>>; report: ReportEntry[]; deadlines: number[] }`.
  `series` is keyed by cell id, then by use path; P1-11a and P1-11b read it to build cards and charts.
  `Use.path` is the YAML path of the origin of the use: for a row that a class inherits through `extends`, it is
  the path in the class that declares the row (`classes.device.rows[0]`, the `origin` of P1-01), not a path in the
  child class. P3-01 relies on this.

- [ ] Write `uses.test.ts`: a child class of `device` lists the inherited row with
      `path = 'classes.device.rows[0]'`; an override row has its `overrides.<id>.rows[i]` path; a link class lists
      `up`, `down` and `capacity` uses.
- [ ] Write `bindV4.test.ts` with the report cases of P1.11, one test per entry kind of S4 (`class-no-match`,
      `unknown-class`, `unknown-override`, `missing-attr` with `from.key`, `matcher-error`, `template-unresolved`,
      `query-unavailable`, `unknown-ref`, `no-series`, `many-series` with counts, `orphan-series` with the cap of 50
      on a refId of 1000 series and "+N more", `many-fields`, `invalid-series`, `duplicate-series`,
      `unit-mismatch`, `capacity-fallback`, `bad-cap`, `no-edge-ends`, `unused-field` on a node class,
      `class-no-cells` not for an abstract class); the cells of an invalid class get `missing` "Binding is not
      valid"; a cell whose override is invalid is unavailable and the other cells of its class bind (S2.5 step 4,
      P1.1); an override that adds a query enters the series index (P1.5); a row match replaces the class match;
      an explicit `reduce` gives no `many-series` (P1.9); `at=target` flips the halves, the link label and the card
      row feed together (P1.10); `${from.key}` on an ordinary draw.io edge reads the end from `xml` (the ends come
      from `edgeEnds`, not from `applyContract`); a `version: 3` config binds nothing and gives one
      `outdated-config` (P1.12); uses with the same refId and match block share one index.
- [ ] Run: `npx vitest run src/binding/bindV4.test.ts src/binding/uses.test.ts --maxWorkers=4`. Expect FAIL.
- [ ] Write the code. Use equality first through the label-tuple map for blocks with only bare and `=` matchers.
      Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-09b bind`.

Done: P1.11 passes; the engine parts of P1.1, P1.5, P1.9, P1.10 and P1.12 pass.

### Task P1-10: legend and status band

- **Repo:** panel. **Spec:** S3.4 ("Text", "Legend"), S2.3 "Legend". **Depends on:** P1-05.
  **Parallel:** yes (wave 3, with P1-09b and P1-13a).
- **Files:** modify `src/legend/model.ts` (add `buildLegendV4`; keep `mappingEntries`), create
  `src/legend/model.v4.test.ts`; modify `src/components/StatusBand.tsx` (add the v4 row text behind a prop), modify
  `src/components/StatusBand.test.tsx`.
- **Interfaces:** Produces `buildLegendV4(patches: PatchMap, fields: Map<string, Field>, ctx: LegendContext): LegendBlock[]`
  (one block per status refId in use, title = display name, mapping entries then threshold steps, each with its
  exact colour, text and cells; then `stale` and `missing`; then the link load scale) and
  `bandRowsV4(patches: PatchMap): Array<{ text: string; refId: string; count: number; severity }>` (not normal only,
  worst first, `<text> · <refId>: <n> cells`).

- [ ] Write the tests of P1.6 (band and legend): the legend block of a refId with value mappings lists each mapping
      with its exact colour and the cells; a `stale` and a `missing` entry follow only when cells have them; the
      band text is `Offline · scrape_up: 2 cells`; normal rows are not in the band; order worst first.
- [ ] Run: `npx vitest run src/legend/model.v4.test.ts src/components/StatusBand.test.tsx --maxWorkers=4`. Expect FAIL.
- [ ] Write the code. Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-10 legend and status band`.

Done: the band and legend parts of P1.6 pass.

### Task P1-11a: cards and N lines

- **Repo:** panel. **Spec:** S3.7 ("Format", "N lines", "Updown with N series"), S3.5 step 6 (a stale row), S2.2
  (`min`/`max`), A9. **Depends on:** P1-09b. **Parallel:** no (wave 4; P1-13b can run beside it).
- **Files:** modify `src/interact/cardModel.ts`, `src/interact/Card.tsx`, `src/visuals/SparklineView.tsx`,
  `src/visuals/MirrorSparkline.tsx`; create `src/interact/cardModel.v4.test.ts`,
  `src/visuals/SparklineView.v4.test.tsx`. Do not change `src/visuals/domain.ts` logic.
- **Interfaces:** Consumes `bindV4(...).uses` and `.series`. Produces
  `buildCardV4(cellId: string, bound: ReturnType<typeof bindV4>, ctx: CardContext): CardModelV4` where a history
  row holds `lines: Array<{ label: string; color: string; times: number[]; values: Array<number | null>; noData: boolean }>`,
  `more: number`, `domain: [number, number]`, `stale: boolean`. `SparklineView` and `MirrorSparkline` take N lines
  with one shared `yDomain`. The v3 card builder stays until P1-13c; a one-line shim maps the v3 card model to one
  line, so `Card` and the two views keep one input type and v3 renders as today.

- [ ] Write the tests of P1.9 (N lines): 9 series give 8 lines and "+1 more"; after a frame reorder each line keeps
      its colour (`theme.visualization.palette` index) and label; a series with no finite value keeps its slot and
      shows "no data" in the tooltip model; two lines at 49 and 51 give the Y range `[0, 51]`; with `min: auto` the
      range is `[47.45, 52.55]` (the retained `yDomain`, S3.7, R8); a row `unit` or `decimals` builds a new display
      processor; an updown with N series reduces per timestamp with gaps; the pinned tooltip model lists all drawn
      lines at the hovered time, then "+N more"; a row whose series are stale shows "stale" (S3.5 step 6); a v3
      card through the shim renders the same text as before (the existing `cardModel.test.ts` stays green).
- [ ] Run: `npx vitest run src/interact/cardModel.v4.test.ts src/visuals/SparklineView.v4.test.tsx src/interact/cardModel.test.ts --maxWorkers=4`.
      Expect FAIL.
- [ ] Write the code. Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-11a cards and N lines`.

Done: the N-line parts of P1.9 pass, R8 included.

### Task P1-11b: chart regions

- **Repo:** panel. **Spec:** S3.9, S2.2 (`chart`), A9. **Depends on:** P1-11a. **Parallel:** no (wave 4; P1-13b can
  run beside it).
- **Files:** modify `src/visuals/ChartLayer.tsx`, `src/visuals/ChartHover.tsx`, `src/visuals/hoverSample.ts`,
  `src/visuals/tooltipPlace.ts`, `src/visuals/BarGaugeView.tsx`; create `src/visuals/ChartLayer.v4.test.tsx`. Do not
  change `src/visuals/domain.ts` logic.
- **Interfaces:** Produces `chartUsesV4(bound: ReturnType<typeof bindV4>): ChartUse[]` and the new
  `ChartLayerProps` (input from the `chart` uses). The v3 chart input stays through a shim until P1-13c.
  `src/editor/popup/DiagramStage.tsx` follows the new `ChartLayerProps` in P1-13c.

- [ ] Write the tests (P1.14 unit side): `chart: {kind: history}` draws in the cell box; `chart: {kind: value}`
      draws a bar gauge; `chart: {kind: updown}` uses the feeds of P1-07; the hover sample of a chart region with N
      lines lists each line; the existing `ChartLayer.test.tsx` and `ChartHover.test.tsx` stay green through the
      shim.
- [ ] Run: `npx vitest run src/visuals/ChartLayer.v4.test.tsx src/visuals/ChartLayer.test.tsx src/visuals/ChartHover.test.tsx --maxWorkers=4`.
      Expect FAIL.
- [ ] Write the code. Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-11b chart regions`.

Done: the unit side of the chart regions of P1.14 passes.

### Task P1-12: the harness export

- **Repo:** panel. **Spec:** S6.4. **Depends on:** P1-09b, P1-10, P1-11b. **Parallel:** no (wave 5).
- **Files:** create `src/harness.ts`, `src/harness.test.ts`.
- **Interfaces:** Produces the stable set of S6.4: `validateConfig`, `bind` (= `bindV4` with a plain input object:
  cells, config, `PanelData`, context → patches and report), `buildCellIndex`, `cellMetas`, `mountSvg`,
  `sanitizeSvg`, `buildCard` (= `buildCardV4`), `buildLegend` (= `buildLegendV4`), `historyOf` (the v4 history of
  one use), `compileMatcher` (= `parseMatchBlock` + `resolveBlock`), `fnv1a`. P3-02 adds `setCellAttrs`.

- [ ] Write `src/harness.test.ts`: `Object.keys(await import('./harness')).sort()` equals the pinned list; a smoke
      call of `validateConfig` and `bind` on the net-l2 pilot with an empty `PanelData` gives no `schema` entry.
- [ ] Run: `npx vitest run src/harness.test.ts --maxWorkers=4`. Expect FAIL.
- [ ] Write `src/harness.ts` (re-exports only). Run again; expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Tag the merge commit `v4-harness-rc1` (a local tag; P2-01 pins it). Commit:
      `feat(v4): P1-12 harness export`.

Done: P1.13 passes.

### Task P1-13a: delete the v3 popup and the v3 editor

- **Repo:** panel. **Spec:** S5.0 ("P1 has no popup"), S6.1 (the popup, editor and `useHeld` rows), S6.2 (rows for
  `CornerControls.tsx`, `DiagramEditor.tsx`, `DrawioMapPanel.tsx`: the popup state only). **Depends on:** P1-00.
  **Parallel:** yes (wave 3; it touches no file of P1-09 … P1-11).
- **Files:** delete `src/components/useHeld.ts`, `src/components/LazyBindingsPopup.tsx`, `src/editor/popup/index.ts`,
  `src/editor/history.ts`, the S6.1 rows of `src/editor/` (`BindingEditor.tsx` … `EditorLayout.tsx`,
  `bindingsModel.ts` … `editorHarness.tsx`) and of `src/editor/popup/` (`BindingsPopup.tsx` … `CardPreview.tsx`),
  and the unit tests of each, `src/editor/geometry.test.tsx` and `src/editor/multiSelect.test.tsx` (they render
  through `editorHarness`; move a case that checks a kept module, for example `DrawioModal`, to that module's test);
  modify `src/adapter/portograph.test.ts` (remove the cases that import `src/editor/draft`);
  modify `src/components/DrawioMapPanel.tsx` (remove the popup state and `useHeld`),
  `src/components/DrawioMapPanel.test.tsx`, `src/components/CornerControls.tsx` (remove `dmap-edit-bindings`),
  `src/options/DiagramEditor.tsx` (remove `dmap-edit-bindings-option`). Keep `PopupLayout.tsx`, `DiagramStage.tsx`
  and the popup frame of S6.3 with their tests.
- **Interfaces:** None new. The v3 view mode (bind, paint, cards, charts) is not changed. The warning badge keeps its
  count and opens nothing.

- [ ] Write the failing check first, in `src/components/DrawioMapPanel.test.tsx`: the panel renders no "Edit
      bindings" button in view mode and in edit mode, and the badge click opens nothing. Run:
      `npx vitest run src/components/DrawioMapPanel.test.tsx --maxWorkers=4`. Expect FAIL.
- [ ] Remove the popup state, the two buttons and `useHeld`. Delete the modules above and their tests.
- [ ] Run: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint && npm run check:imports && npm run check:privacy`.
      Expect PASS. The e2e specs of the popup fail until P1-15a deletes them; do not run them.
- [ ] Task review, then merge. Commit: `feat(v4): P1-13a delete the v3 popup and editor`.

Done: no popup and no v3 editor; the v3 view mode is green.

### Task P1-13b: the v4 demo configs

- **Repo:** panel. **Spec:** S6.2 (the demo configs row), S8.1, S8.2. **Depends on:** P1-09a.
  **Parallel:** yes (wave 3–4, beside P1-11a or P1-11b).
- **Files:** create `src/fixtures/demo-config.v4.ts`, `src/fixtures/authoring-config.v4.ts`,
  `src/fixtures/demo-config.v4.test.ts`. Do not change the v3 demo configs, `scripts/build-dashboard.ts` or
  `provisioning/`: v3 still renders the demo until the cut-over.
- **Interfaces:** Produces `demoConfigV4: ConfigV4` and `authoringConfigV4: ConfigV4` (demo names) with the same
  cells and the same visible behaviour as the v3 demo configs: link halves, a down node, a grey node with no data,
  a card with a history row, a chart region. P1-13c moves them into place.

- [ ] Write `demo-config.v4.test.ts`: both configs pass `validateConfig` with an empty report; each class of the v3
      demo has a v4 class; the configs use only demo names.
- [ ] Run: `npx vitest run src/fixtures/demo-config.v4.test.ts --maxWorkers=4`. Expect FAIL. Write the configs.
      Expect PASS.
- [ ] Gate: `npm run typecheck && npm run lint && npm run check:privacy`. Light review, then merge. Commit:
      `test(v4): P1-13b v4 demo configs`.

Done: the v4 demo configs are ready for the cut-over.

### Task P1-13c: cut-over (wire v4, delete the v3 runtime)

- **Repo:** panel. **Spec:** S6.1 (the other rows), S6.2 (rows for `engine.ts`, `status.ts`, `color.ts`,
  `legend/model.ts`, `StatusBand.tsx`, `capacity.ts`, `template.ts`, `links.ts`, `frames.ts`, `reduce.ts`,
  `panelSnapshot.ts`, `useSampleStale.ts`, `domain.ts`, the type-only rows, `useBoundDiagram.ts`,
  `DrawioMapPanel.tsx`, `portograph.ts`, `PopupLayout.tsx`, `DiagramStage.tsx`, the demo configs, `module.ts`,
  `types.ts`), S6.3, S7.3.5 (`Options.build`), D22. **Depends on:** P1-12, P1-13a, P1-13b. **Parallel:** no (wave 5).
  This is the atomic cut-over: one merge. If it runs past 4 h, stop at a green step group, commit, and go on in a
  second session on the same branch; merge once at the end.
- **Files:** delete the remaining modules of the S6.1 table (`src/model/config.ts`, `patterns.ts`, `select.ts`,
  `src/model/matcher.ts`, `resolve.ts`, the native query modules, `src/query/types.ts`) and their tests; modify the
  S6.2 files named above; modify `src/adapter/portograph.ts` (`applyContract`, `cellScope` and `endpointScope` give
  way to the scope of S3.3 and the end lookup of P1-07: the ends come from `edgeEnds` at bind time); modify
  `src/editor/popup/PopupLayout.tsx` and `DiagramStage.tsx` (the `ChartLayerProps` of P1-11b); move
  `src/fixtures/demo-config.v4.ts` to `demo-config.ts` and `authoring-config.v4.ts` to `authoring-config.ts` (and the
  test), modify `scripts/build-dashboard.ts`, regenerate the demo dashboards in `provisioning/`. Rewrite the unit
  tests of kept modules that import a deleted module: `src/binding/capacity.test.ts`,
  `src/adapter/portograph.test.ts`, `src/binding/status.test.ts`, `src/editor/revision.test.ts`,
  `src/fixtures/demo-config.test.ts`, `src/interact/cardModel.test.ts`, `src/query/frames.test.ts`,
  `src/query/history.bench.test.ts`, `src/components/DrawioMapPanel.test.tsx`, `src/visuals/ChartLayer.test.tsx`,
  `src/stage/useBoundDiagram.test.tsx`, `src/binding/engine.test.ts`. Move the behaviour tests of kept rules to the
  new modules (for example the coverage cases of `src/binding/status.test.ts`). Remove the v3 shims of P1-11a and
  P1-11b.
- **Interfaces:** After this task no `src/` file imports `src/model/config.ts`. `Options.config: unknown` (parsed by
  `validateConfig`), `Options.build?: string` (never read). The v4 names do not change (see "Names").

- [ ] Write the failing checks first: a test in `src/components/DrawioMapPanel.test.tsx` that the panel renders the
      v4 demo config with a link half colour and a grey no-data node; a test in the same file that a `version: 3`
      config shows one notice and binds nothing (P1.12); a test in `src/module.test.ts` that `Options.build` is kept
      through `onOptionsChange`. Run:
      `npx vitest run src/components/DrawioMapPanel.test.tsx src/module.test.ts --maxWorkers=4`. Expect FAIL.
- [ ] Wire `bindV4` into `src/stage/useBoundDiagram.ts` and `src/components/DrawioMapPanel.tsx`; the stale pass
      uses `useStaleStatusV4`.
- [ ] Delete the S6.1 modules. Move the type imports of S6.2 to `src/model/v4.ts`. Remove the v3 functions that P1
      tasks left beside the v4 ones, and the shims. Change `applyContract`.
- [ ] Rewrite the 12 test files above, one at a time; run each alone with `npx vitest run <file> --maxWorkers=4`.
- [ ] Move the v4 demo configs into place and run `npm run build:dashboard`.
- [ ] Run: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint && npm run check:imports && npm run check:privacy`.
      Expect PASS. `grep -rn "model/config" src` gives nothing.
- [ ] Task review (full round, then a targeted re-check), then merge. Commit:
      `feat(v4): P1-13c cut over to v4, delete the v3 runtime`.

Done: P1 typechecks with no v3 code and no popup; P1.12 passes in the panel.

### Task P1-14: the YAML option editor and the bundle checks

- **Repo:** panel. **Spec:** S5.0, S5.3 (the bundle checks), A11, A13 (Q15). **Depends on:** P1-13c.
  **Parallel:** yes (wave 6).
- **Files:** create `src/options/ConfigYamlEditor.tsx` (lazy body), `src/options/LazyConfigYamlEditor.tsx`,
  `src/options/ConfigYamlEditor.test.tsx` (with a `CodeEditor` mock); modify `src/module.ts` (`addCustomEditor` for
  `config`); modify `scripts/check-bundle.sh`.
- **Interfaces:** Consumes `writeYaml`, `readYaml` (P1-08) and `validateConfig` (P1-09a). The editor calls
  `onChange` with JSON only when the YAML parses and the envelope is valid; it shows markers through
  `monaco.editor.setModelMarkers` from `onEditorDidMount`.

- [ ] Write `ConfigYamlEditor.test.tsx`: on mount it shows the stored JSON as YAML; an item error shows a marker and
      still calls `onChange`; an envelope error and a YAML syntax error show markers and do not call `onChange`; a
      text that does not parse stays in local state.
- [ ] Write the bundle checks first, as two failing cases: touch a file in `src/` after a build and expect
      `npm run check:bundle` to fail with "stale build"; put the text `Map keys must be unique` into a temporary
      view-mode module and expect it to fail. Remove the temporary module.
- [ ] Run: `npx vitest run src/options/ConfigYamlEditor.test.tsx --maxWorkers=4`. Expect FAIL. Write the code.
      Expect PASS.
- [ ] Run: `npm run build && npm run check:bundle` (heavy). Expect PASS: the build is newer than `src/`, and
      `dist/module.js` holds neither `Implicit keys need to be on a single line` nor `Map keys must be unique`.
- [ ] Gate: `npx vitest run --changed binding-model-v4 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P1-14 YAML option and bundle checks`.

Done: the static part of P1.17 passes. P1-15a adds the browser check of `no-drawio`.

### Task P1-15a: e2e helpers, deletes and `no-drawio`

- **Repo:** panel. **Spec:** S6.5 (the deleted specs, the helpers), S5.0, S9 P1.17 (the browser part).
  **Depends on:** P1-13c, P1-14. **Parallel:** no (wave 6, after P1-14); heavy (e2e). Ports 3213 and 3212.
- **Files:** modify `tests/authoring-fixtures.ts`, `tests/authoring-controls.ts` (v4 builders; remove
  `openBindingsPopup`, `closeBindingsPopup`, `popupInspector`, `selectStageCell`); delete
  `tests/binding-editor.spec.ts`, `tests/bindings-list.spec.ts`, `tests/bindings-popup-inspector.spec.ts`,
  `tests/bindings-popup-selection.spec.ts`, `tests/editor-layout.spec.ts`, `tests/query.spec.ts`,
  `tests/bindings-popup.spec.ts`, and tests 1–2 of `tests/authoring-compat.spec.ts`; modify `playwright.config.ts`
  (`MATRIX_SPECS` loses `binding-editor` and `query`); modify `tests/no-drawio.spec.ts` (plus: view mode requests
  no YAML chunk).
- **Note:** `tests/authoring-fixtures.ts:4` type-imports `src/model/config`, which P1-13c deletes. Playwright
  erases type imports, so nothing breaks before this task. Replace the import with the v4 types of
  `src/model/v4.ts`.

- [ ] Rewrite the two helper files first. Run `npm run typecheck`.
- [ ] Delete the specs above. Run: `npx playwright test --list`; it lists no spec that imports a deleted helper or
      a deleted `src/` module.
- [ ] `tests/no-drawio.spec.ts`: edit, then run it alone with `--project=matrix` on 3213 (13.2) and on 3212 (12.4)
      (see "E2E in a panel worktree").
- [ ] Gate: `npm run typecheck && npm run lint && npm run check:privacy`.
- [ ] Light review, then merge. Commit: `test(v4): P1-15a e2e helpers and deletes`.

Done: the helpers are v4; the deleted specs are gone; the browser part of P1.17 passes.

### Task P1-15b: the other specs of the P1 column

- **Repo:** panel. **Spec:** S6.5 (the P1 column). **Depends on:** P1-15a. **Parallel:** yes (wave 7, inside the
  limit of two e2e tasks at one time); heavy (e2e). Ports 3243 and 3242.
- **Files:** rewrite the P1 column for `tests/options.spec.ts`, `tests/zoom.spec.ts` (:138-162),
  `tests/editor.spec.ts` (:125), `tests/editor-refresh.spec.ts` (entry "Diagram option" only),
  `tests/panel-edit-requests.spec.ts` (panel-edit part), `tests/refresh.spec.ts` (the panel-query part; mark :172
  as waiting for P3 with `test.fixme` and a comment "P3-08").

- [ ] Change one spec at a time. For each: edit, then run it alone on the worktree Grafana. Matrix specs
      (`options`, `editor`, `editor-refresh`, `panel-edit-requests`, `refresh`): `--project=matrix` on 3243 (13.2)
      and on 3242 (12.4). `zoom`: `--project=plugin` on 3243.
- [ ] `tests/editor.spec.ts`: geometry export through the Diagram option; `bind` and `key` survive the save and
      the reopen.
- [ ] Gate: `npm run typecheck && npm run lint && npm run check:privacy`.
- [ ] Light review, then merge. Commit: `test(v4): P1-15b the P1 column of the e2e specs`.

Done: P1.15 (these P1-column rows) passes.

### Task P1-16: e2e re-fixture, part 1

- **Repo:** panel. **Spec:** S6.5 ("Re-fixtured"). **Depends on:** P1-15a. **Parallel:** yes (wave 7, inside the
  limit of two e2e tasks at one time); heavy. Ports 3213 (13.2) and 3212 (12.4).
- **Files:** modify `tests/view.spec.ts`, `tests/legend.spec.ts`, `tests/links.spec.ts`,
  `tests/link-labels.spec.ts`, `tests/status-band.spec.ts`, `tests/hover-kinds.spec.ts`, `tests/color.spec.ts`
  (matrix), `tests/cursor.spec.ts`.
- [ ] For each spec: move it to a v4 config with the builders of P1-15a; keep each assertion of behaviour; run it
      alone (`--project=plugin` on 3213; `color` with `--project=matrix` on 3213 and on 3212). The legend and band assertions
      follow S3.4 (exact colour and text, the band text `<text> · <refId>: <n> cells`).
- [ ] Gate: `npm run typecheck && npm run lint && npm run check:privacy`. Light review, then merge. Commit:
      `test(v4): P1-16 re-fixture view specs, part 1`.

Done: these rows of P1.15 pass.

### Task P1-17: e2e re-fixture, part 2

- **Repo:** panel. **Spec:** S6.5 ("Rewritten", "Re-fixtured"), A9. **Depends on:** P1-15a. **Parallel:** yes (wave 7,
  inside the limit of two e2e tasks at one time); heavy. Ports 3223 (13.2) and 3222 (12.4).
- **Files:** modify `tests/card-tooltip.spec.ts`, `tests/sparkline-range.spec.ts`, `tests/editor-missing.spec.ts`,
  `tests/min-scale.spec.ts`, `tests/phone-sheet.spec.ts`, `tests/reset-corner.spec.ts` (the case :165 waits for
  P3: `test.fixme` with "P3-08"), `tests/visual-regions.spec.ts` (chart regions; "health becomes stale without
  another response"; test 3 of `authoring-compat` moves here); delete `tests/authoring-compat.spec.ts` and its
  helper files when it is empty.
- [ ] For each spec: v4 config, run it alone (`reset-corner` with `--project=matrix` on 3223 and on 3222; others
      `--project=plugin` on 3223).
- [ ] Gate: `npm run typecheck && npm run lint && npm run check:privacy`. Light review, then merge. Commit:
      `test(v4): P1-17 re-fixture view specs, part 2`.

Done: P1.15 passes for all P1-column rows.

### Task P1-18: new e2e for the v4 demo (P1.14)

- **Repo:** panel. **Spec:** S9 P1.14, S3.3 (A17), S3.7, S3.9, S7.3.5. **Depends on:** P1-15a.
  **Parallel:** yes (wave 7, inside the limit of two e2e tasks at one time; it starts when P1-16 or P1-17
  merges); heavy. Ports 3233 (13.2) and 3232 (12.4).
- **Files:** create `tests/binding-v4.spec.ts` (project `plugin`); modify `src/fixtures/demo-config.ts` and the demo
  dashboard only to add the cases below (demo names); modify `stack/metrics-gen/gen.py` (it writes one series per
  job today): add the series for a row with 9 series, a history row with 3 lines and a chart region (demo names).
- [ ] Extend `stack/metrics-gen/gen.py`: the new series are new metric names, and with `GEN_SET=v4` in the
      environment the script writes only them. The shared `metrics-gen` service mounts the main checkout, so start
      a second writer from the worktree beside it: `docker run -d --rm --name dmap-gen-P1-18 --network
      simnv-drawiomap-panel_default -e VM_URL=http://victoriametrics:8428 -e GEN_SET=v4
      -v "$PWD/stack/metrics-gen:/app:ro" python:3.12-alpine python -I /app/gen.py`. It does not write the series
      that P1-16 and P1-17 read. Check the new series in VictoriaMetrics before the spec runs. Stop the writer with
      the Grafana container. R-1 restarts the shared stack, which then writes all series.
- [ ] Write the spec with these tests, then run it on 3233 with `--project=plugin --workers 1`:
  - the demo dashboard: a link half colour, a down node, a grey node with no data, a card with a history row of 3
    lines on one axis, a chart region;
  - a card row with 9 series shows 8 lines and "+1 more"; the pinned tooltip lists the 8 lines at the hovered time;
  - a `chart: {kind: value}` region draws a bar gauge;
  - the YAML option saves a valid config; a panel with `build: "x"` still holds it after a save of the YAML option;
  - URL encoding with the real `replaceVariables`: `job=a&var-site=b` gives `var-job=a%26var-site%3Db`; `#` gives
    `%23`; the values `a` and `b` give `%7Ba%2Cb%7D` for `$job` (`percentencode`, Grafana docs "Variable syntax"); `$__url_time_range` gives `from=…&to=…` unencoded;
    `/d/host?${job:queryparam}` gives `/d/host?var-job=a&var-job=b`; a cell with `job=cell-a` and
    `/d/host?var-node=${job}&${job:queryparam}` gives `var-node=cell-a&var-job=a&var-job=b`.
- [ ] Run the `build` save test also on 12.4 (port 3232) with `--project=plugin --grep build` to check that 12.4
      keeps the key (S10.3).
- [ ] Gate: `npm run typecheck && npm run lint && npm run check:privacy`. Light review, then merge. Commit:
      `test(v4): P1-18 v4 demo e2e`.

Done: P1.14 passes.

### Task P1-19: bench of the v4 bind

- **Repo:** panel. **Spec:** S9 P1.16, S10.3. **Depends on:** P1-13c, P0-1. **Parallel:** yes (wave 6).
- **Files:** create `src/binding/bind.v4.bench.test.ts`; delete `src/binding/bind.v3.bench.test.ts` (P1-13c may
  already have deleted it with the v3 engine); modify `docs/acceptance.md`.
- [ ] Write the bench on `buildBenchFixture` with a v4 config of the same cells; plus a fixture with 300 distinct
      regexes and one with malformed matchers (the bind must finish and report).
- [ ] Run 3 times: `npx vitest run src/binding/bind.v4.bench.test.ts --maxWorkers=1`. Expect the median below the
      P0 number. Write the result next to the P0 row.
- [ ] Gate: `npm run typecheck && npm run lint`. Light review, then merge. Commit: `test(v4): P1-19 v4 bind bench`.

Done: P1.16 passes. If the median is not below the P0 number, stop and escalate.

### Task P1-20: P1 docs and the release note

- **Repo:** panel. **Spec:** S6.6, S8.4, S9 P2.8, Appendix A ("page 1 only"). **Depends on:** P1-13c, P1-19 (both
  edit `docs/acceptance.md`). **Parallel:** yes (wave 6, after P1-19).
- **Files:** modify `README.md` (a new section "Bindings (v4)" replaces lines 64–378; rewrite 412–425 and 477–621;
  the matcher contract and dialect, the template scope and the URL encoding with A17, the "Edit Data" route, the
  open-selector note, the generator-owned note, the note of Appendix A that the panel reads page 1 only),
  `docs/acceptance.md` (archive :75-331; a new v4 list with the P1
  items), `docs/adr/0002-*.md` (the note of S6.6), the PoC spec section 8 table (one row "Binding model v4"), the
  status lines of the specs 2026-10-18, 2026-10-23 and 2026-10-25 steps 2–4 ("superseded by v4"), `CHANGELOG.md`
  and `package.json` (`version`: the next minor; the note says "first version that reads v4; a v3 config binds
  nothing").
- [ ] Write the docs. Check each option name in the README against `src/model/v4.ts`. Check that the README has
      the "page 1 only" note.
- [ ] Gate: `npm run lint && npm run check:privacy`. Light review, then merge. Commit:
      `docs(v4): P1-20 README, acceptance and release note`.

Done: the P1 part of S6.6 is in; P2.8 has its panel half.

### Task P1-G: P1 gate

- **Depends on:** P1-00 … P1-20 (all splits). **Parallel:** no; heavy.
- [ ] Independent review of `git diff main...binding-model-v4 -- src scripts playwright.config.ts` against the
      spec and `CODING_STANDARDS.md` (a Codex worker through Orca). Fix the blocking findings in a task branch;
      then a targeted re-check.
- [ ] Run on `binding-model-v4`: `npm run typecheck && npm run lint && npm run test:affected && npm run check:privacy`.
- [ ] Run `npm run build && npm run check:bundle`.
- [ ] Check the coverage table at the end of this plan: each P1 item has a passing test or e2e run, with the
      command output in the task report.
- [ ] Tag the head `v4-p1-rc` (local tag). P2 pins it.

---

## P2: the generator and the 10 panels (consumer repository)

All P2 tasks run in the consumer worktree on the branch `drawiomap-v4` (created by P0-2). Each task works on a child
branch `drawiomap-v4/<task-id>` in its own worktree when it runs in parallel with a sibling, and merges back with
`git merge --no-ff`. The 10 panels: the mode A sheets `net-l2-dm`, `net-infra-dm`, `net-iot-dm`,
`net-geography-dm`, `net-l3-vpn-dm`, `cctv-path`, `mon-pipeline`; the mode B sheets `boiler-enclosure` and
`water-pump-enclosure` (dashboard `wb-enclosures`, panels 1 and 2); the smoke dashboard.

### Task P2-01: the harness rewrite and the RC pin

- **Repo:** consumer. **Spec:** S6.4, A11. **Depends on:** P1-12 (tag `v4-harness-rc1`); move to `v4-p1-rc` when
  P1-G finishes. **Parallel:** no (first P2 task).
- **Files (consumer):** modify `scripts/gen_drawiomap/pins.py` (`PANEL_SHA` = the commit of the tag),
  `scripts/gen_drawiomap/validate_config.mjs`, `plan.mjs`, `replay.mjs`, `panel_frames.mjs`, `hover.mjs`,
  `legend.mjs`, `bundle.mjs`, `tests/behaviour/regex_check.mjs`, `tests/behaviour/history.mjs`,
  `tests/behaviour/snapshot.mjs` (import only `src/harness.ts`; `tests/behaviour/matchers.mjs` stays); the tests of
  these scripts (`test_behaviour.py`, `test_plan_json.py`, `test_hover.py`, `test_legend.py`, `test_pins.py`,
  `test_bundle.py`).
- [ ] Write a failing test in `test_pins.py`: no `.mjs` file of `scripts/gen_drawiomap/` imports a panel path other
      than `src/harness.ts`. Run:
      `uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/test_pins.py -q -p no:cacheprovider -rs`.
      Expect FAIL.
- [ ] Move the pin. Rewrite each script against the harness names. Run the vendor step:
      `DRAWIOMAP_SRC=<panel main checkout> scripts/vendor-drawiomap-panel.sh` (heavy).
- [ ] Run the tests of the rewritten scripts one file at a time with the command above. Expect PASS; a test that
      checks v3 behaviour moves to v4 or goes with its script (name each in the commit message).
- [ ] Consumer review, then merge. Commit: `feat(drawiomap): P2-01 harness rewrite against src/harness.ts`.

Done: the consumer scripts import only `src/harness.ts`.

### Task P2-02: cell attributes and `at`

- **Repo:** consumer. **Spec:** S7.3.2, S7.3.3, S7.2, S8.1 (the cell attributes). **Depends on:** P2-01.
  **Parallel:** yes (waves 6–9: it fills a free heavy-job slot after P2-01).
- **Files (consumer):** modify `scripts/gen_drawiomap/cellmeta.py`, `scripts/gen_drawiomap/emit_pg.py`; modify
  `tests/test_cellmeta.py`, `tests/test_emit_pg.py`; create `tests/test_at_audit.py`.
- [ ] Write the failing tests of P2.1 (attribute part): a sheet gives `bind`, `key`, `port`, `cap` and `at`; no
      `bind_*` attribute remains; `cap` is `a/b` when the two directions differ; slots that disagree on one label
      write the second value into `<slot>`; the `at` audit over all panels fails on a link with no known key end
      and passes on the real sheets (net-l2 13 of 13 at the source; cctv-path, mon-pipeline, net-geography-dm and
      net-l3-vpn-dm from their catalogue family).
- [ ] Run: `uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/test_cellmeta.py scripts/gen_drawiomap/tests/test_emit_pg.py scripts/gen_drawiomap/tests/test_at_audit.py -q -p no:cacheprovider -rs`.
      Expect FAIL. Write the code. Expect PASS.
- [ ] Consumer review, then merge. Commit: `feat(drawiomap): P2-02 bind, key, port, cap and at`.

### Task P2-03: the v4 config, targets, mappings and editable dashboards

- **Repo:** consumer. **Spec:** S7.3.1, S7.3.4, S7.3.8 (`dashboard.py`), A13 (`linkLabel: percent`), A14, S8.1.
  **Depends on:** P2-01. **Parallel:** yes (waves 6–9: it fills a free heavy-job slot after P2-01).
- **Files (consumer):** modify `scripts/gen_drawiomap/config.py`, `scripts/gen_drawiomap/catalogue.py`,
  `scripts/gen_drawiomap/dashboard.py`, `scripts/gen_drawiomap/smoke_dashboard.py`; modify `tests/test_config.py`,
  `tests/test_config_simple.py`, `tests/test_dashboard.py`, `tests/test_smoke_dashboard.py`.
- [ ] Write the failing tests: `config.build` writes `version: 4`, one class per catalogue family, `linkLabel:
      percent` on link classes; one fan-out target per metric with refId = query name; field overrides match
      `byFrameRefID`; each healthy mapping ("up", "normal", "no fault") has the colour `transparent`; the config of
      net-l2-dm equals the shape of S8.1 (classes, matches, rows); `validate_config.mjs` on the result gives no
      `schema` entry; dashboards are `editable: true` with the note of S7.3.8; the smoke dashboard is v4.
- [ ] Run: `uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/test_config.py scripts/gen_drawiomap/tests/test_config_simple.py scripts/gen_drawiomap/tests/test_dashboard.py scripts/gen_drawiomap/tests/test_smoke_dashboard.py -q -p no:cacheprovider -rs`.
      Expect FAIL. Write the code. Expect PASS.
- [ ] Consumer review, then merge. Commit: `feat(drawiomap): P2-03 v4 classes, targets and mappings`.

### Task P2-04: build id, `base.drawio` and `options.build`

- **Repo:** consumer. **Spec:** S7.3.5 ("The build id"), S7.3.7 (`inject.py`), S7.4 steps 1 and 7.
  **Depends on:** P2-01. **Parallel:** yes (waves 6–9: it fills a free heavy-job slot after P2-01).
- **Files (consumer):** modify `scripts/gen_drawiomap/run.py`, `scripts/gen_drawiomap/inject.py`,
  `scripts/gen_drawiomap/manifest.py`; modify `tests/test_inject.py`, `tests/test_manifest.py`; create
  `tests/test_build_id.py`.
- [ ] Write the failing tests: mode A writes `topology/drawiomap/<sheet>/base.drawio` (the unmerged XML) next to
      `diagram.drawio`; the build id is `git hash-object -w` of those bytes and the blob is in the repository; the
      panel holds `options.build` = that id; mode B uses the source `.drawio`; `inject.py` writes `options.build`;
      the manifest lists `base.drawio` as an output; `run.py --check` stays green on an unchanged tree.
- [ ] Run: `uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/test_build_id.py scripts/gen_drawiomap/tests/test_inject.py scripts/gen_drawiomap/tests/test_manifest.py -q -p no:cacheprovider -rs`.
      Expect FAIL. Write the code. Expect PASS.
- [ ] Consumer review, then merge. Commit: `feat(drawiomap): P2-04 build id and base.drawio`.

### Task P2-05: `gen_drawiomap pull`

- **Repo:** consumer. **Spec:** S7.3.5 (all, N1 included), A2, A15 (the token rules), S10.3 ("`options.build` and
  Grafana"). **Depends on:** P2-04. **Parallel:** yes (waves 6–9, after P2-04 merges).
- **Files (consumer):** create `scripts/gen_drawiomap/pull.py`, `scripts/gen_drawiomap/grafana_api.py`,
  `scripts/gen_drawiomap/delta.py`; modify `scripts/gen_drawiomap/run.py` (the sub-command); create
  `tests/test_pull.py`, `tests/fake_grafana.py` (a local `http.server` fixture).
- **Interfaces:** Produces `pull(sheets, base: str | None, check: bool) -> int` (exit code) and
  `delta(deployed_xml: str, base_xml: str) -> dict[str, dict[str, str | None]]`. The URL and the token come from
  environment variables (name them in `pull.py --help`); the token never reaches the output.
- [ ] Write the failing tests of P2.2 against the fake Grafana: one snapshot (`GET /api/dashboards/uid/<uid>`) for
      the two panels of `wb-enclosures`; 401, 403, 5xx, a network error and malformed JSON or XML stop with no
      file; 404 prints "first deployment" and writes no file; the token is not in stdout or stderr; `HEAD` holds a
      newer build that is not deployed, and `pull` reads the base of `options.build`; a changed `options.config`
      or target prints "generator-owned: the next build overwrites it" and goes on; a build id not in the
      repository stops with "not in this repository"; `--base <commit>` then reads that base; N1: a panel with
      `version: 3` and no `options.build` gives a file with no cells and "no v4 build deployed"; a panel with
      `version: 4`, edited attributes and no `options.build` exits non-zero, prints "the deployed panel has no build
      id; pass --base <commit>", and the existing `.cells.yml` keeps the same bytes (compare a sha256 before and after); the same panel with
      `--base <commit>` writes the delta with the edited attributes; a removed attribute gives `null`; the file
      always replaces the old file as a whole; a compressed page and a duplicated cell id stop; a missing panel and
      a wrong panel type stop; a difference of geometry or style in the XML prints a warning and goes on (S7.3.5).
- [ ] Run: `uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/test_pull.py -q -p no:cacheprovider -rs`.
      Expect FAIL. Write the code. Expect PASS.
- [ ] Consumer review, then merge. Commit: `feat(drawiomap): P2-05 pull`.

Done: P2.2 passes.

### Task P2-06: merge, ownership and the build order

- **Repo:** consumer. **Spec:** S7.3.6, S7.4 (steps 1–7), A3. **Depends on:** P2-02, P2-03, P2-04, P2-05 (both
  edit `run.py`). **Parallel:** yes (wave 10).
- **Files (consumer):** create `scripts/gen_drawiomap/merge.py`, `tests/test_merge.py`, `tests/test_build_order.py`;
  modify `scripts/gen_drawiomap/run.py` (the order of S7.4, `--accept-topology`), `scripts/gen_drawiomap/bundle.py`.
- [ ] Write the failing tests of P2.3 (without the repeat cycles) and P2.4: a file value on a cell that the topology
      does not set is kept; an equal value is quiet; a different topology value and a `null` against a value exit
      non-zero and print the sheet, cell, attribute and both values; an inferred default such as `at=source` counts
      as a topology value in a conflict (S7.3.6); `--accept-topology` lets the topology win; an
      orphan cell exits non-zero; two panels with equal cell ids keep their own values; a uid, panel or page that
      does not match stops; a kept `bind` to a missing class stops at step 5 (`unknown-class`); a second build with
      no change gives the same bytes; the exported SVG holds the merged `data-meta-*` values and the hash covers
      them (read the SVG, not only the XML); step 5 reads the cells through `buildCellIndex(mountSvg(sanitizeSvg(svg)))`
      and stops on `schema`, `unknown-class`, `missing-attr`, `class-no-match`, `unknown-ref`.
- [ ] Run: `uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/test_merge.py scripts/gen_drawiomap/tests/test_build_order.py -q -p no:cacheprovider -rs`.
      Expect FAIL. Write the code. Expect PASS.
- [ ] Consumer review, then merge. Commit: `feat(drawiomap): P2-06 merge and build order`.

### Task P2-07: mode B sources and the enclosure dashboard

- **Repo:** consumer. **Spec:** S7.3.7, S7.3.8 (A16), S8.2, A14. **Depends on:** P2-03, P2-04.
  **Parallel:** yes (wave 10).
- **Files (consumer):** modify `docs/diagrams/gen_boiler.py`, `docs/diagrams/gen_diagram.py` (the water-pump
  sheet), `docs/diagrams/boiler-enclosure.drawio`, `docs/diagrams/water-pump-enclosure.drawio` (regenerated),
  `topology/drawiomap/boiler-enclosure.bindings.yml`, `topology/drawiomap/water-pump-enclosure.bindings.yml` (v4
  classes and targets: S8.2 for the boiler; the same mapping for the water pump), `scripts/gen_drawiomap/bindings.py`,
  `dashboards/Home & IoT/wb-enclosures.json` (`"editable": true` by hand); modify `tests/test_bindings.py`,
  `tests/test_enclosure_sources.py`. Do not change `docs/diagrams/drawio_helpers.py`: the consumer `main` checkout
  holds uncommitted edits of the owner in it, and a change there stops the overlap check of R-2. If the sources
  need a new helper, put it in `gen_boiler.py` or `gen_diagram.py`.
- [ ] Write the failing tests of P2.10: the regenerated `boiler-enclosure.drawio` has the same cell ids as the
      committed one (compare the id sets); its bound cells carry `bind`, `key`, `port` of S8.2; the S8.2 config
      validated against the exported SVG gives no `missing-attr`; the water-pump sheet keeps its cell ids too and
      binds with no `missing-attr`; `wb-enclosures.json` has `"editable": true`.
- [ ] Run: `uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/test_bindings.py scripts/gen_drawiomap/tests/test_enclosure_sources.py -q -p no:cacheprovider -rs`.
      Expect FAIL. Write the code. Expect PASS.
- [ ] Consumer review, then merge. Commit: `feat(drawiomap): P2-07 mode B sources bind with v4`.

Done: P2.10 passes.

### Task P2-08: the deploy gate

- **Repo:** consumer. **Spec:** S7.4 ("The deploy gate", the table, N1), A15. **Depends on:** P2-05.
  **Parallel:** yes (wave 10).
- **Files (consumer):** modify `scripts/deploy.sh` (step 0: `gen_drawiomap pull --check` with the URL and token from
  the environment; `--base "$DRAWIOMAP_PULL_BASE"` when set; before the archive and the copy), `scripts/dm`
  (`gates` runs it too); modify `tests/test_deploy_gates.py`.
- [ ] Write the failing tests of P2.9, one per row of the gate table, against the fake Grafana: delta equals the
      file: pass; differs: stop "pull again"; no `.cells.yml` and empty delta: pass; no `.cells.yml` and a delta:
      stop "pull first"; 404: pass; `version: 3` and no `options.build`: pass; `version: 4` and no `options.build`:
      stop "no build id; pass --base", no file copied, `.cells.yml` keeps the same bytes; the same with
      `DRAWIOMAP_PULL_BASE` set and a delta equal to the file: pass; network error, 401, 403, 5xx, no token: stop;
      a provisioning that increments the dashboard version with no cell edit: pass. A test runs `scripts/deploy.sh`
      with a stub `ssh`/`scp` on `PATH` and checks that step 0 stops before any copy.
- [ ] Run: `uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/test_deploy_gates.py -q -p no:cacheprovider -rs`.
      Expect FAIL. Write the code. Expect PASS.
- [ ] Consumer review, then merge. Commit: `feat(drawiomap): P2-08 deploy gate`.

Done: P2.9 passes.

### Task P2-09: the repeat-pull cycle test

- **Repo:** consumer. **Spec:** S7.3.5 ("No lost edits"), S9 P2.3 (repeat pulls, Astra R3). **Depends on:** P2-05,
  P2-06. **Parallel:** yes (wave 11).
- **Files (consumer):** create `tests/test_pull_cycles.py` (a temporary git repository with a tiny sheet and the
  fake Grafana).
- [ ] Write the test: the base lacks `key`; the author sets `key=demo-key`; pull, build, commit, deploy (the fake
      Grafana takes the new dashboard); a second pull with no new edit still writes `key=demo-key`; the next build
      keeps it; the author removes `key`; the next pull writes no `key`; the next build has none.
- [ ] Run: `uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/test_pull_cycles.py -q -p no:cacheprovider -rs`.
      Expect PASS (P2-05 and P2-06 implement it); a failure is a bug in them: fix it there, in this branch.
- [ ] Consumer review, then merge. Commit: `test(drawiomap): P2-09 repeat pull cycles`.

Done: P2.3 passes in full.

### Task P2-10: regenerate the 10 panels and compare with P0

- **Repo:** consumer. **Spec:** S9 P2.5, P2.6, P2.7, S1.1 (the size table). **Depends on:** P2-02 … P2-09.
  **Parallel:** no (wave 11); heavy.
- **Files (consumer):** the generated artefacts of all sheets, `topology/drawiomap/manifest.json`, the 10
  dashboards; create `scripts/gen_drawiomap/tests/test_v4_parity.py`; create
  `scripts/gen_drawiomap/tests/fixtures/behaviour/v4-parity-expected-diff.md` (the list of each other expected
  difference).
- [ ] `scripts/dm regen` (all sheets). Then `scripts/dm tests` (heavy). Expect PASS.
- [ ] Write `test_v4_parity.py`: for net-l2-dm and boiler-enclosure, replay the v4 frame file of P0-2 through the
      harness; each cell has the same severity as the P0 record, each link half the same colour and percent; a
      normal cell paints nothing (`transparent`); each difference is in the expected-difference list. Run:
      `uv run --with pyyaml,pytest pytest scripts/gen_drawiomap/tests/test_v4_parity.py -q -p no:cacheprovider -rs`.
- [ ] Check P2.5: for each of the 10 panels, `validate_config.mjs` and the bind of step 5 give no `schema` and no
      `unknown-ref` entry (print the counts).
- [ ] Check P2.7: print the size of each `options` object next to the v3 size; each is smaller.
- [ ] `uv run --with pyyaml scripts/gen_drawiomap/run.py --check`. Expect PASS.
- [ ] Commit: `feat(drawiomap): P2-10 regenerate the 10 panels with v4`.

Done: P2.5 (offline), P2.6 and P2.7 pass. R-3 checks P2.5 on the live Grafana.

### Task P2-G: P2 gate

- **Depends on:** P2-01 … P2-10, P1-G. **Parallel:** no; heavy.
- [ ] Move the pin to the commit of `v4-p1-rc` if P2 started on `v4-harness-rc1`; vendor; `scripts/dm regen`;
      `scripts/dm tests`.
- [ ] Independent review of `git diff main...drawiomap-v4` in the consumer worktree against spec section 7 and the
      decisions (a Codex worker through Orca). Fix the blocking findings; then a targeted re-check.
- [ ] `scripts/dm gates` with the Grafana URL and token in the environment (read-only against the live Grafana).
      The pull gate must pass: the live panels are v3 deployments with no `options.build`.

---

## R: release of the P1+P2 change set (A11)

The panel release and the regenerated dashboards ship together (P2.8). Do R-1 to R-3 in one session, so no live edit
can come in between the drift checks. Ask the coordinator for the owner's approval before R-1 step "push", before
the merge of R-2 and before R-3 "deploy".

### The release drift rule

`scripts/drift-check.sh` of the consumer compares the live files of the deploy target with the files of the checkout
that it runs from. It does not know the direction of a difference: it prints `DRIFT (live≠repo): <path>` for each
`.json`, `.yml`, `.yaml`, `.conf` or `.tmpl` file whose live copy differs, `LIVE-ONLY (in <target dir>, not in repo):
<path>` for a live file that the checkout does not have, and `UNREACHABLE` for a host that did not answer. It exits 1
on any of these lines. A release changes files on purpose, so between the merge and the deploy the check prints a
line for each changed file. The rule below accepts only those lines. R-3, R-4, P3-R and P3-11 use it.

1. **Clean worktrees.** Run the drift check and the deploy only in a clean detached worktree of the consumer
   repository, never in the owner's `main` checkout: `scripts/deploy.sh` archives the files of the current
   directory, and that checkout holds uncommitted edits of the owner.
   `git -C <consumer main checkout> worktree add --detach <path> <sha>`; remove it after the task.
2. **Baseline.** Before the merge, record `PRE` = the consumer `main` head (`git rev-parse main`). Run
   `scripts/drift-check.sh` in a clean worktree at `PRE`. Expect `CLEAN` and exit 0. Any line stops the release:
   a live edit must go into the repository first (the owner decides how). An uncommitted edit of the owner that is
   already live shows here as `DRIFT`; that is correct, because the deploy would overwrite it.
3. **Range.** After the merge, record `REL` = the new `main` head. The release range is `PRE..REL`. If the range
   touches `infra/wb-rules/`, stop: this rule does not cover the wb check.
4. **Before the deploy.** In a clean worktree at `REL`, run the check and filter it (`A=PRE`, `B=REL`):

   ```sh
   T="$(mktemp -d)"
   scripts/drift-check.sh >"$T/drift.txt" 2>&1 || true          # exit 1 is expected here
   git diff --name-only "$A" "$B" >"$T/changed.txt"
   git diff --name-only --diff-filter=D "$A" "$B" >"$T/deleted.txt"
   {
     sed -n 's/^  DRIFT ([^)]*): //p' "$T/drift.txt" | grep -vxFf "$T/changed.txt"
     sed -n 's/^  LIVE-ONLY (in [^,]*\/\([^/,]*\), not in repo): /\1\//p' "$T/drift.txt" | grep -vxFf "$T/deleted.txt"
     grep 'UNREACHABLE' "$T/drift.txt"
   } >"$T/stop.txt"
   [ ! -s "$T/stop.txt" ] && scripts/deploy-wb-rules.sh check && echo RELEASE-DRIFT-OK
   ```

   Go on only when the last line is `RELEASE-DRIFT-OK`. Else `stop.txt` lists the lines that stop the release: a
   `DRIFT` on a path that the range does not change, a `LIVE-ONLY` file that the range does not delete, an
   unreachable host, or a wb drift. Put `drift.txt` and `stop.txt` in the task report.
5. **After the deploy.** Run `scripts/drift-check.sh` again in the same worktree. Expect `CLEAN` and exit 0. A line
   here means that the deploy did not land: stop and report.

### Task R-1: panel to `main`

- **Repo:** panel. **Depends on:** P1-G, P2-G. **Parallel:** no; heavy.
- **Release:** R-1 is a panel release: P1-20 sets the next minor version. With the owner's approval at the push, R-1
  tags the merge commit `v<version of package.json>`. CLAUDE.md asks for `npm run e2e:release` before a release tag,
  so R-1 runs it (it includes the matrix runs and the WebKit check).
- [ ] On the panel main checkout: check that `git status --short` is empty, then `git merge --no-ff binding-model-v4`.
- [ ] `npm ci` (P1-08 adds `yaml`; the task worktrees used a symlink to the `node_modules` of this checkout).
- [ ] `npm run typecheck && npm run lint && npm test` (the full suite, once).
- [ ] `npm run build && npm run check:bundle`.
- [ ] `npm run stack:up` (the shared stack mounts the new `dist/` and restarts `metrics-gen` with the series of
      P1-18), then `npm run e2e:release` (12.4 matrix and plugin; 13.2 matrix and plugin; WebKit).
- [ ] `npm run check:privacy`. With the owner's approval: tag `v<version>`, push the branch and the tag (the pre-push
      hook runs `npm test` again). Note the merge commit SHA.

### Task R-2: the consumer pin, vendor, regenerate, merge

- **Repo:** consumer, worktree `drawiomap-v4`. **Depends on:** R-1. **Parallel:** no; heavy.
- [ ] Set `PANEL_SHA` in `scripts/gen_drawiomap/pins.py` to the merge commit of R-1.
- [ ] `DRAWIOMAP_SRC=<panel main checkout> scripts/vendor-drawiomap-panel.sh`.
- [ ] `scripts/dm regen` (the 10 panels), `scripts/dm tests`, `uv run --with pyyaml scripts/gen_drawiomap/run.py --check`.
- [ ] Commit: `feat(drawiomap): binding model v4 with panel <short sha>`.
- [ ] Record `PRE` and run the baseline of the release drift rule (step 2). On a line, stop before the merge.
- [ ] Integration into the consumer `main`: the owner merges, or a worker merges with the owner's approval. Ask for
      `git merge --no-ff drawiomap-v4` (a readable history); R-4 does not depend on it, and a fast-forward or a
      squash also works. Before the merge, check that the files of `git diff --name-only main...drawiomap-v4` and the
      files of `git -C <consumer main checkout> status --porcelain` do not overlap; on an overlap, stop and ask the
      owner. Never stash, reset or commit the owner's uncommitted edits.
- [ ] Record `REL` (the `main` head after the merge). Write `PRE` and `REL` into the task report; R-3 and R-4 use
      them.

### Task R-3: drift check, deploy, live checks

- **Repo:** consumer, a clean detached worktree at `REL` (the release drift rule, step 1). **Depends on:** R-2.
  **Parallel:** no.
- [ ] The release drift rule, step 4, with `A=PRE` and `B=REL`. Without `RELEASE-DRIFT-OK`, stop.
- [ ] `scripts/dm gates` with the Grafana URL and token in the environment. Expect PASS (v3 live panels).
- [ ] From the root of the release worktree: `scripts/dm deploy` (runs `scripts/deploy.sh` with the environment).
      The pull gate of step 0 runs first.
- [ ] The release drift rule, step 5: expect `CLEAN`.
- [ ] Live checks, about 1 minute after the deploy (provisioning reloads every 10 s):
  - for each of the 10 panels, fetch `GET /api/dashboards/uid/<uid>` and check `options.config.version == 4` and
    `options.build` equal to the built id;
  - render each panel through the Grafana image renderer (`/render/d-solo/<uid>?panelId=<id>&width=1600&height=900`)
    or `scripts/dm browser-check <sheet> <cells> v4`, and look at each image: cells painted, no notice with
    `schema` or `unknown-ref` entries, link halves coloured, grey only where the data is absent;
  - `gen_drawiomap pull --check` passes for all sheets (the delta is empty right after the deploy);
  - net-l2-dm and boiler-enclosure: compare five cells by eye with the P0 record (severity and link colours).
- [ ] Report the results to the coordinator with the image paths (in the gitignored `local/` folder of the panel
      repository, or the consumer's own scratch folder).

### Task R-4: rollback (only on a failed R-3)

- The rollback unit is the pair of the previous panel pin and the previous dashboards (spec Appendix A). The
  rollback reverses the release range `PRE..REL` as one patch, so it does not need a merge commit: it works after a
  `--no-ff` merge, a fast-forward or a squash.
- [ ] If an author saved cell edits in the live Grafana after R-3, run `gen_drawiomap pull` first and copy the
      `.cells.yml` files to a safe place outside the repository. The next roll-forward commits them again.
- [ ] In a clean worktree on a new branch `drawiomap-v4-rollback` from the consumer `main` head:
      `git diff --binary "$PRE" "$REL" | git apply -R --index`, then commit
      `revert(drawiomap): roll back binding model v4 (<PRE short>..<REL short>)`. The pin, the vendored panel, the
      regenerated dashboards and the v4 generator go back together; the pull gate of step 0 goes too. If the patch
      does not apply (a later commit on `main` changed the same lines), stop and ask the owner. Run
      `uv run --with pyyaml scripts/gen_drawiomap/run.py --check`.
- [ ] Integrate the branch into the consumer `main` as in R-2 (the owner's approval, the overlap check). Record
      `ROLL` = the new `main` head. If `main` has commits after `REL` other than the rollback, list them in the
      report and ask the owner before the deploy: the deploy ships them too.
- [ ] In a clean detached worktree at `ROLL`: the release drift rule, step 4, with `A=REL` and `B=ROLL` (now the
      live files are the v4 ones, and the files that the release added are `LIVE-ONLY`, which the rollback deletes).
      Then `scripts/dm deploy`, step 5, and the live checks of R-3 with v3 expectations
      (`options.config.version == 3`).
- [ ] The panel `main` keeps the v4 merge; do not revert it. Write the cause into the task report.

---

## P3: the split editor (panel repository)

P3 starts after R-3. It works on the integration branch `binding-model-v4-p3` from the panel `main`, with child
branches `v4p3/<task-id>`.

### Task P3-01: the path at an offset, the cell sets and `fitCells`

- **Repo:** panel. **Spec:** S5.3 ("The path at an offset", "The cells of a path", "Reuse"), S4 (the counts per
  class and per use). **Depends on:** R-1. **Parallel:** yes (with P3-02, P3-03).
- **Files:** create `src/editor/split/yamlPath.ts`, `src/editor/split/yamlPath.test.ts`,
  `src/editor/split/cellsForPath.ts`, `src/editor/split/cellsForPath.test.ts`, `src/editor/split/reportCounts.ts`,
  `src/editor/split/reportCounts.test.ts`; modify `src/render/zoom.ts` (add `fitCells`), modify
  `src/render/zoom.test.ts`.
- **Interfaces:** `pathAt(doc: Document, text: string, offset: number): string | null`;
  `cellsForPath(path: string, bound: ReturnType<typeof bindV4>, classes: Map<string, ResolvedClass>): { cells: string[]; lighter: string[]; badges: Map<string, { count: number; red: boolean }> }`;
  `fitCells(index: CellIndex, ids: string[], base: ViewBox, margin: number): ViewBox`;
  `reportCounts(bound: ReturnType<typeof bindV4>, classes: Map<string, ResolvedClass>): { perClass: Map<string, { cells: number; zero: number; one: number; many: number }>; perUse: Map<UsePath, { zero: number; one: number; many: number }> }`
  (the counts of S4: per class and per use, the cells with 0, 1 and more series). It reads `bound.uses` and
  `bound.series`; `Use.path` is the origin path (P1-09b), so a row of a base class counts the cells of each child
  class under the base path.
- [ ] Write the tests of P3.1: the path on a key, on a value, on a blank line, after a value, on an incomplete
      `query:`, during a parse error; a duplicate key and an alias give a `yaml` entry; the cell set of each path
      kind of the S5.3 table; a row of a base class lights the cells of each child class with its own count; a
      link-only class has a `match` badge from `up`; `fitCells` of two boxes includes both with the margin;
      `reportCounts` gives per class the number of cells, and per use the cells with 0, 1 and more series (a class
      with 3 cells, one with no series and two with 2 series, gives `zero: 1, many: 2`).
- [ ] Run: `npx vitest run src/editor/split/yamlPath.test.ts src/editor/split/cellsForPath.test.ts src/editor/split/reportCounts.test.ts src/render/zoom.test.ts --maxWorkers=4`.
      Expect FAIL. Write the code. Expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4-p3 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P3-01 YAML path and cell sets`.

### Task P3-02: `setCellAttrs` and the sanitiser round trip

- **Repo:** panel. **Spec:** S5.5, S6.4 (`setCellAttrs` in the harness), S10.3 ("Writes into the SVG").
  **Depends on:** R-1. **Parallel:** yes.
- **Files:** create `src/editor/setCellAttrs.ts`, `src/editor/setCellAttrs.test.ts`; modify `src/harness.ts` and
  `src/harness.test.ts` (add `setCellAttrs` to the pinned names).
- [ ] Write the tests of P3.2 and P3.3: the XML and the SVG change; other attributes and `data-meta-label` stay; a
      bare `mxCell` gets an `<object id label>` wrapper and keeps `source`, `target`, `parent`, `style`, `vertex`,
      `edge` and its children; `null` removes an attribute; a compressed page, a duplicate id, an unknown id, a
      reserved name (`pg-x`, `id`, `label`, `placeholders`, `xmlns`) and a parser error are refused; two runs give
      the same output; the hash is `fnv1a(svg + xml)`; `sanitizeSvg(setCellAttrs(d).svg)` keeps the new
      `data-meta-*` attributes, and a second `sanitizeSvg` gives the same text.
- [ ] Run: `npx vitest run src/editor/setCellAttrs.test.ts src/harness.test.ts --maxWorkers=4`. Expect FAIL. Write
      the code. Expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4-p3 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P3-02 setCellAttrs`.

### Task P3-03: the completion provider

- **Repo:** panel. **Spec:** S5.6, S5.2 (the provider notes), Appendix A (completion ranges). **Depends on:** R-1.
  **Parallel:** yes.
- **Files:** create `src/editor/split/completion.ts`, `src/editor/split/completion.test.ts`.
- **Interfaces:** `registerCompletion(monaco: typeof monacoTypes, modelId: string, source: () => CompletionSource): IDisposable`;
  `itemsAt(path: string, text: string, offset: number, source: CompletionSource): Array<{ label: string; insertText: string; range: { startColumn: number; endColumn: number } }>`.
- [ ] Write the tests of P3.4: the items at each place of the S5.6 table; label values after `="` are escaped for a
      PromQL string; an item with `{`, `}`, `[`, `]` or `,` in a flow mapping is in single quotes; the replacement
      range covers the word under the cursor; two providers for two model ids do not answer for each other; dispose
      removes the provider.
- [ ] Run: `npx vitest run src/editor/split/completion.test.ts --maxWorkers=4`. Expect FAIL. Write the code. Expect
      PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4-p3 --maxWorkers=4 && npm run typecheck && npm run lint`.
- [ ] Task review, then merge. Commit: `feat(v4): P3-03 completion`.

### Task P3-04: the split editor shell

- **Repo:** panel. **Spec:** S5.0 (last line), S5.1 (with "Below: the match report"), S5.2, S5.3 (cursor,
  highlight, zoom, 150 ms; "a click on a report entry uses the same path"), S4 (the report, its counts, "a click on
  an entry highlights its cells and moves the cursor"), S6.2 (popup rows). **Depends on:** P3-01, P3-03.
  **Parallel:** no.
- **Files:** create `src/components/LazyBindingsPopup.tsx`, `src/editor/popup/index.ts`,
  `src/editor/popup/SplitEditor.tsx`, `src/editor/popup/SplitEditor.test.tsx`, `src/editor/popup/MatchReport.tsx`,
  `src/editor/popup/MatchReport.test.tsx`; modify
  `src/editor/popup/PopupLayout.tsx`, `src/editor/popup/DiagramStage.tsx`, `src/components/CornerControls.tsx`,
  `src/options/DiagramEditor.tsx`, `src/components/DrawioMapPanel.tsx` (the popup state again).
- [ ] Write `SplitEditor.test.tsx` (with a `CodeEditor` mock that gives a fake Monaco): the stored JSON shows as
      YAML; an edit binds the live diagram with the per-class result; invalid YAML keeps the last valid draft and
      shows markers; a cursor move waits 150 ms, then highlights the cells and calls `setView` with `fitCells`; no
      zoom when the cell set is the same; the provider is registered for the model id and disposed on unmount.
- [ ] Write `MatchReport.test.tsx`: the report pane below the code box lists the entries of `bindV4(...).report`
      grouped by class, with the counts of `reportCounts` per class and per use; an edit that changes the result
      updates the pane; a click on an entry highlights its cells and moves the cursor to its path (the same path
      as a cursor move, S5.3); an entry with no cells moves the cursor only.
- [ ] Run: `npx vitest run src/editor/popup/SplitEditor.test.tsx src/editor/popup/MatchReport.test.tsx --maxWorkers=4`.
      Expect FAIL. Write the code. Expect PASS.
- [ ] Gate: `npx vitest run --changed binding-model-v4-p3 --maxWorkers=4 && npm run typecheck && npm run lint && npm run build && npm run check:bundle`.
      `src/viewChunk.test.ts` stays green (view mode loads no Monaco and no YAML).
- [ ] Task review, then merge. Commit: `feat(v4): P3-04 split editor shell`.

### Task P3-05: the inspector and the writes

- **Repo:** panel. **Spec:** S5.4, S5.5 (the three writes), S7.3.6 (the generated-panel note). **Depends on:**
  P3-02, P3-04. **Parallel:** no.
- **Files:** create `src/editor/popup/InspectorV4.tsx`, `src/editor/popup/InspectorV4.test.tsx`; modify
  `src/editor/popup/SplitEditor.tsx`.
- [ ] Write the tests: a click shows the id, `bind`, `key`, all attributes, the chain and the override, and per use
      the refId, the matchers as written and as resolved for this cell (`resolved` of `resolveBlock`, P1-02), the
      count, 8 label sets and the value; the cursor goes to `overrides.<id>`, else
      `classes.<bind>`, else the end of `classes`; on an edge, the source and target end, the end that the key
      names, the arrows, and "key is at the target" sets `at=target` (the label then says "key is at the source");
      on a generated panel the note shows next to the button; a multi-select and "assign class" set `bind` on each
      cell and keep each `key`.
- [ ] Run: `npx vitest run src/editor/popup/InspectorV4.test.tsx --maxWorkers=4`. Expect FAIL. Write the code.
      Expect PASS.
- [ ] Gate as P3-04, without the build. Task review, then merge. Commit: `feat(v4): P3-05 inspector and writes`.

### Task P3-06: draft, Apply, conflict, discard and undo

- **Repo:** panel. **Spec:** S5.7. **Depends on:** P3-05. **Parallel:** no.
- **Files:** create `src/editor/history.ts`, `src/editor/history.test.ts`; modify `src/editor/popup/SplitEditor.tsx`;
  keep `src/editor/revision.ts`.
- [ ] Write the tests: Apply writes `{...options, config, diagram}` in one `onOptionsChange` and keeps `build`;
      Apply is off while the YAML does not parse or the envelope fails; item errors do not block it; a changed
      saved revision shows "The saved panel changed" with "Reload" and "Keep my draft"; Escape with a dirty draft
      (also a text that does not parse) asks to discard; the diagram stack holds at most 50 versions; Ctrl+Z goes
      to Monaco when the code box has the focus, else to the diagram stack.
- [ ] Run: `npx vitest run src/editor/history.test.ts src/editor/popup/SplitEditor.test.tsx --maxWorkers=4`. Expect
      FAIL. Write the code. Expect PASS.
- [ ] Gate as P3-04, without the build. Task review, then merge. Commit: `feat(v4): P3-06 draft and undo`.

### Task P3-07: e2e `split-editor.spec.ts`

- **Repo:** panel. **Spec:** S9 P3.5–P3.9, S6.5 (`bindings-popup.spec.ts:251-365` moves here). **Depends on:**
  P3-06. **Parallel:** yes (with P3-08 on a second container); heavy.
- **Files:** create `tests/split-editor.spec.ts`; modify `tests/authoring-controls.ts` (the split-editor helpers);
  modify `playwright.config.ts` (`MATRIX_SPECS` gets `split-editor`).
- [ ] Write the tests of P3.5–P3.8 and the moved cases (conflict, dirty Escape, nested popup focus, undo ownership,
      refresh while open); plus: a click on a match-report entry highlights its cells and moves the cursor. P3.7 checks the stored XML wrapper and a draw.io save with no change.
- [ ] P3.9: run `--project=matrix` on 3213 (13.2) and 3212 (12.4), `--workers 1`: the code box loads, completion
      opens above the modal (no clipping in `PluginDialog`), the cursor events fire.
- [ ] Gate: `npm run typecheck && npm run lint && npm run check:privacy`. Light review, then merge. Commit:
      `test(v4): P3-07 split editor e2e`.

### Task P3-08: e2e P3 column of 6.5

- **Repo:** panel. **Spec:** S6.5 (the P3 column). **Depends on:** P3-06. **Parallel:** yes (with P3-07); heavy.
- **Files:** modify `tests/editor-refresh.spec.ts` (entry `geometry` through the split editor), `tests/editor.spec.ts`
  (chart assignment through the split editor), `tests/options.spec.ts` (with the button), `tests/zoom.spec.ts` (with
  the button), `tests/reset-corner.spec.ts` (:165, remove `test.fixme`), `tests/refresh.spec.ts` (:172, remove
  `test.fixme`), `tests/panel-edit-requests.spec.ts` (the popup part).
- [ ] For each spec: edit, run it alone; the matrix specs on 3223 and 3222 with `--project=matrix`, the others on
      3223 with `--project=plugin`.
- [ ] Gate: `npm run typecheck && npm run lint && npm run check:privacy`. Light review, then merge. Commit:
      `test(v4): P3-08 P3 column of the e2e specs`.

### Task P3-09: isolation, phone and screenshots

- **Repo:** panel. **Spec:** S9 P3.11, P3.12, P3.13; CLAUDE.md "layout change". **Depends on:** P3-07.
  **Parallel:** no; heavy.
- **Files:** modify `tests/split-editor.spec.ts` (a phone test at the iPhone 13 viewport of
  `tests/phone-sheet.spec.ts`); modify `docs/acceptance.md` (the table "Isolation variants").
- [ ] Start the isolation services with the worktree `dist/`: two containers as in "E2E in a panel worktree" with
      the env of `grafana13-csp` (`GF_SECURITY_CONTENT_SECURITY_POLICY=true`) and `grafana13-sandbox-csp` (plus
      `GF_SECURITY_ENABLE_FRONTEND_SANDBOX_FOR_PLUGINS=simnv-drawiomap-panel`,
      `GF_FEATURE_TOGGLES_ENABLE=pluginsFrontendSandbox`), on ports 3233 and 3243. Run the P3.9 test on each with
      `--workers 1`. Write the result into the isolation table.
- [ ] P3.13: the phone test: the split view opens; code box, diagram and report reachable with no horizontal page
      scroll; focus starts in the code box and stays in the dialog through Tab and Shift+Tab; Escape closes.
- [ ] Take the screenshots of the split view (1440×900) and the phone view (`DMAP_SCREENSHOTS=docs/images`). Open
      each image and look at it before you call the task done (P3.11). Demo names only.
- [ ] Gate: `npm run check:privacy`. Light review, then merge. Commit: `test(v4): P3-09 isolation, phone, screenshots`.

### Task P3-10: P3 docs

- **Repo:** panel. **Spec:** S6.6, S5.5 (the "Edit Data" route), S5.4. **Depends on:** P3-06. **Parallel:** yes.
- **Files:** modify `README.md` (the split editor, the inspector, the writes, the generated-panel rule),
  `docs/acceptance.md` (the P3 items of the v4 list), `CHANGELOG.md`, `package.json` (`version`: the next minor).
- [ ] Write the docs. Gate: `npm run lint && npm run check:privacy`. Light review, then merge. Commit:
      `docs(v4): P3-10 split editor docs`.

### Task P3-G: P3 gate

- **Depends on:** P3-01 … P3-10. **Parallel:** no; heavy.
- [ ] Independent review of `git diff main...binding-model-v4-p3` (a Codex worker through Orca). Fix; re-check.
- [ ] `npm run typecheck && npm run lint && npm run test:affected && npm run check:privacy`.

### Task P3-R: release of P3

- **Repo:** both. **Depends on:** P3-G. **Parallel:** no; heavy.
- [ ] Panel, on `main`: merge `binding-model-v4-p3`; `npm ci`; `npm test`; `npm run build && npm run check:bundle`;
      `npm run stack:up && npm run e2e:release` (P3-10 sets the next minor version; with the owner's approval, tag
      `v<version>`); push.
- [ ] Consumer, in a new worktree branch `drawiomap-v4-p3` from the consumer `main` head: move `PANEL_SHA`; vendor;
      `scripts/dm regen` (the manifest pins the panel); `scripts/dm tests`; `run.py --check`; commit. Record `PRE`
      and run the baseline of the release drift rule; then the owner merges (the overlap check of R-2). Record `REL`.
- [ ] In a clean detached worktree at `REL`: the release drift rule, step 4 (`A=PRE`, `B=REL`); `scripts/dm gates`;
      `scripts/dm deploy`; step 5; the live checks of R-3, plus: open the split editor on net-l2-dm in the live
      Grafana and check that it loads (no Apply).
- [ ] Rollback: as R-4, with the `PRE` and `REL` of this task.

### Task P3-11: the pilot round trip on boiler-enclosure

- **Repo:** consumer (live Grafana; the panel is read-only here). **Spec:** S8.2 ("The round trip in P3"), S9 P3.10,
  S7.3.6. **Depends on:** P3-R. **Parallel:** no.
- [ ] In the live Grafana, open `wb-enclosures` panel 1 in the split editor. Bind the 24 V supply block (a bare
      `<mxCell>`): `bind=controller`, `key=<the controller job>`. Apply. Save the dashboard.
- [ ] In a consumer worktree branch `drawiomap-v4-pilot`: `gen_drawiomap pull --sheet boiler-enclosure`. Expect the
      two attributes in `boiler-enclosure.cells.yml`. `scripts/dm regen --sheet boiler-enclosure`. Expect the build
      to keep them. Commit. Record `PRE`, run the baseline of the release drift rule, the owner merges, record `REL`;
      in a clean detached worktree at `REL`: the rule, step 4, `scripts/dm deploy`, step 5. Reload: the supply shows
      the controller status.
- [ ] Conflict check: change the `key` of one relay chip in the editor; Apply; save; `pull`; expect the chip value in
      the file; `scripts/dm regen --sheet boiler-enclosure` exits non-zero and prints both values; with
      `--accept-topology` the chip gets its source value again. Do not deploy the conflict state; pull again after
      the accepted build, so the gate passes.
- [ ] Report P3.10 with the command outputs.

---

## Coverage: spec acceptance → task

| Spec acceptance | Task(s) |
|---|---|
| P0.1 bench | P0-1 |
| P0.2 colour parity | P0-2 |
| P1.1 parse, invalid class, invalid parent, invalid override (the cell is unavailable) | P1-01, P1-09a, P1-09b |
| P1.2 YAML round trip, block style | P1-08 |
| P1.3 matcher forms and dialect | P1-02 |
| P1.4 `missing-attr`, shield, `isAllowedUrl`, URL encoding, A17 (unit) | P1-02, P1-03 |
| P1.5 extends, overrides, override query in the index, row match | P1-01, P1-09b |
| P1.6 status, colour, severity, `transparent`, band, legend, applier | P1-05, P1-10 |
| S4 report types and kinds | P1-00 (types), P1-09b (entries) |
| P1.7 no data, the cell text "–" | P1-05 |
| P1.8 freshness and the clock, the "stale" row | P1-06, P1-11a |
| P1.9 several series, frame merge, N lines, R8 | P1-04, P1-09b, P1-11a |
| P1.10 links, capacity, ends | P1-07, P1-09b |
| P1.11 report entry kinds, orphan cap | P1-09b |
| P1.12 `version: 3` binds nothing, one notice | P1-01, P1-09a, P1-09b, P1-13c |
| P1.13 harness names | P1-12 |
| P1.14 e2e v4 demo, `build` kept, URL encoding with real formats (A17) | P1-18 (unit side: P1-11b, P1-14; demo configs: P1-13b) |
| P1.15 re-fixtured specs, P1 column; no popup | P1-13a, P1-15a, P1-15b, P1-16, P1-17 |
| P1.16 bench faster than P0 | P1-19 (with P0-1) |
| P1.17 fresh build, bundle checks, no YAML chunk in view mode | P1-14, P1-15a |
| P2.1 classes, `bind`/`key`/`at`, no `bind_*`, `at` audit | P2-02, P2-03 |
| P2.2 `pull` (snapshot, failures, token, deployed build, `--base`, N1, geometry and style warnings, missing panel, wrong type) | P2-05 |
| P2.3 merge rules (an inferred `at=source` is a topology value) and repeat pulls | P2-06, P2-09 |
| P2.4 order: exported SVG holds merged values, hash covers them | P2-06 |
| P2.5 10 panels with no `schema` and no `unknown-ref` | P2-10, R-3 |
| P2.6 parity with P0 at the same frames | P2-10 (with P0-2) |
| P2.7 options smaller than v3 | P2-10 |
| P2.8 release note (with the "page 1 only" note) and dashboards in one change set | P1-20, R-1, R-2 |
| P2.9 deploy gate rows, step 0, token, version increment, N1 | P2-08 |
| P2.10 boiler cell ids and attributes | P2-07 |
| P3.1 path at offset, cell sets, report counts | P3-01 |
| P3.2 `setCellAttrs` | P3-02 |
| P3.3 sanitiser keeps `data-meta-*`, idempotent | P3-02 |
| P3.4 completion items and quoting | P3-03 |
| P3.5 cursor highlights and zooms; row counts; the match-report pane and its click (S4, S5.1, S5.3) | P3-07 (code: P3-01, P3-04) |
| P3.6 click opens the inspector (resolved matchers); `at=target` | P3-07 (code: P1-02, P3-05) |
| P3.7 multi-select, assign class, wrapper, draw.io save | P3-07 (code: P3-05) |
| P3.8 markers, invalid YAML, discard, conflict, Apply, undo | P3-07 (code: P3-06) |
| P3.9 Monaco on 12.4 and 13.2 (`matrix`) | P3-07 |
| P3.10 pilot round trip and conflict | P3-11 |
| P3.11 screenshot checked by eye | P3-09 |
| P3.12 isolation services | P3-09 |
| P3.13 phone | P3-09 |
| Phase gates of S9 (typecheck, lint, affected tests, review, privacy) | P0-G, P1-G, P2-G, P3-G |
| Before the push: full `npm test`, `npm run e2e:release` (it includes the matrix) | R-1, P3-R |
| Release drift rule: baseline, release range, clean after the deploy; rollback of the range | R-2, R-3, R-4, P3-R, P3-11 |

## Plan review fixes

The plan review of 2026-10-29 (blockers B1–B2, majors M1–M8, minors m1–m10) changed these tasks.

| Finding | Change | Tasks |
|---|---|---|
| B1 drift rule blocks every release | New section "The release drift rule": baseline at `PRE` before the merge; between merge and deploy, accept only `DRIFT` on paths of `PRE..REL` and `LIVE-ONLY` on paths the range deletes; `CLEAN` after the deploy; clean detached worktrees for the check and the deploy | R (new section), R-2, R-3, R-4, P3-R, P3-11 |
| B2 no merge commit to revert | R-2 records `PRE` and `REL` and asks for `--no-ff`; R-4 reverses the range `PRE..REL` as one patch (`git diff --binary PRE REL \| git apply -R --index`), so it works after a fast-forward or a squash too | R-2, R-4, P3-R |
| M1 wave 1 not parallel | New task P1-00 (`ReportEntry`, `UsePath`, `REPORT_KINDS`, `MatchV4`) merges before wave 1 | P1-00, P1-01, P1-02, P1-04 |
| M2 P1-13 too large | Split: P1-13a deletes the v3 popup and editor (wave 3); P1-13b writes the v4 demo configs beside v3; P1-13c is the atomic cut-over with the 12 test rewrites. The review named the cut-over P1-13b; here the demo configs come first, so each merge typechecks. The V4 renames are dropped (global "Names") | P1-13a, P1-13b, P1-13c, global constraints |
| M3 wave 7 ports | A port pair per e2e task; at most two e2e tasks at one time | global constraints, E2E section, P1-15a, P1-15b, P1-16, P1-17, P1-18 |
| M4 no task for the match-report pane | `reportCounts` in P3-01; the report pane and its click in P3-04; an e2e case in P3-07 | P3-01, P3-04, P3-07 |
| M5 P1-15 too large | Split: P1-15a helpers, deletes, `--list`, `no-drawio`; P1-15b the other P1-column specs (wave 7) | P1-15a, P1-15b |
| M6 P1-11 too large | Split: P1-11a cards and N lines with a v3 shim; P1-11b chart regions; sequential | P1-11a, P1-11b |
| M7 P1-09 critical path, P3 contracts | `validateConfig` moves to P1-09a (wave 2); P1-09b states `Use.path` = origin path; `resolveBlock` returns `resolved` | P1-02, P1-09a, P1-09b, P3-05 |
| M8 P1-07 changes `applyContract` | P1-07 does not touch `portograph.ts`; ends come from `edgeEnds` at bind time; P1-13c changes `applyContract` | P1-07, P1-09b, P1-13c |
| m1 | P1-20 depends on P1-19 | P1-20 |
| m2 | P2-06 depends on P2-05 | P2-06 |
| m3 | P2-02 … P2-05 fill free slots in waves 6–8 | wave table, P2-02 … P2-05 |
| m4 | `--maxWorkers=2` when four tasks run | global constraints |
| m5 | R-1 runs `npm ci`, `npm run e2e:release` and tags the release with the owner's approval | R-1, P3-R |
| m6 | P1-18 extends `stack/metrics-gen/gen.py` | P1-18 |
| m7 | New test cases: invalid override (P1-09b), "stale" row (P1-11a), "–" text (P1-05), `pull` warnings and stops (P2-05), inferred `at=source` (P2-06), "page 1 only" (P1-20) | P1-05, P1-09b, P1-11a, P1-20, P2-05, P2-06 |
| m8 | The render tests go in `DrawioMapPanel.test.tsx` | P1-13a, P1-13c |
| m9 | P2-07 must not change `docs/diagrams/drawio_helpers.py` | P2-07 |
| m10 | P0-G reviews P0-1 and P0-2 before the merge | P0-G |
