@AGENTS.md

## Process

- Gate first: `npm run typecheck`, `npm run lint` and `npm test`. Run `npm run e2e:matrix` when a change touches the rendered panel or the editor. The e2e run needs the compose stack and an awake Mac.
- Every diff in `src/` gets an adversarial review against `CODING_STANDARDS.md` (Codex, or a fresh agent). Correctness and privacy findings block. Do one full round, then a targeted re-check.
- Docs, tests and fixtures get a lighter review.
- For a layout change, open the screenshot and look at it before you call the change done.
