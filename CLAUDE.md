@AGENTS.md

## Process

- Gate first: `npm run typecheck`, `npm run lint` and `npm run test:affected` (the tests related to the files changed since `main`, 4 workers). A worker in a worktree runs only that and the affected e2e specs. The full `npm test` runs once, on main, before the push (the pre-push hook). Run `npm run e2e:matrix` on main when a change touches the rendered panel or the editor. The e2e run needs the compose stack.
- Every diff in `src/` gets an adversarial review against `CODING_STANDARDS.md` (Codex, or a fresh agent). Correctness and privacy findings block. Do one full round, then a targeted re-check.
- Docs, tests and fixtures get a lighter review.
- For a layout change, open the screenshot and look at it before you call the change done.
