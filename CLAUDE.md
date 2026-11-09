@AGENTS.md

## Process

- Gate first: `npm run typecheck`, `npm run lint` and `npm run test:affected` (the tests related to the files changed since `main`, 4 workers). The full `npm test` runs once, on main, before the push (the pre-push hook). The e2e run needs the compose stack and an awake Mac.
- Which suite runs where. Worker in a worktree: only the affected e2e specs, one spec at a time (`GRAFANA_URL=http://localhost:3013 npx playwright test tests/<spec>.spec.ts`). Before the push, on main, when a change touches the rendered panel or the editor: `npm run e2e:matrix`. It runs the Playwright project `matrix` on Grafana 12.4 (`e2e:12`) and both projects, `matrix` and `plugin`, on 13.2 (`e2e:13`). Before a release tag: `npm run e2e:release`, which runs everything on both versions and the WebKit check. A new e2e test goes in `plugin` by default. It goes in `matrix` only when it depends on a surface that differs between Grafana versions (see CONTRIBUTING.md, section "E2E suites").
- Every diff in `src/` gets an adversarial review against `CODING_STANDARDS.md` (Codex, or a fresh agent). Correctness and privacy findings block. Do one full round, then a targeted re-check.
- Docs, tests and fixtures get a lighter review.
- For a layout change, open the screenshot and look at it before you call the change done.
