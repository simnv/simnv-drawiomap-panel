## Project knowledge

This repository contains a **Grafana plugin**. You must Read @./.config/AGENTS/instructions.md before doing changes.

**Privacy.** This repo and its history are public. Use only the synthetic demo network (`fixtures/demo/`). Real-network diagrams, screenshots and notes go in the gitignored `local/` folder. `npm run check:privacy` and the git hooks (`npm run hooks:install`) block denylisted terms, home paths, MAC addresses and private IPs outside the demo ranges.

## Read on demand

- `docs/superpowers/specs/2026-10-17-drawiomap-panel-poc-design.md`, section 8: read before you rely on the spec. The "Superseded decisions" table overrides the earlier sections.
- `docs/adr/`: read before you change the editor frame (0001) or the colour and capacity model (0002).
- `docs/security.md`: read before you change the sanitiser, the editor iframe, the MessagePort protocol or URL templates.
- `docs/research/portograph-contract.md`: read before you change how the panel reads `pg-*` cell attributes.
- `docs/acceptance.md`: read before you claim a feature is done. It lists the checks and the Grafana versions.
- `docs/guide/`: the user-facing option reference, one page for each area (see `docs/guide/index.md`). Update the matching page when you change an option. `README.md` is the short catalogue page: keep it short.
- `CONTRIBUTING.md`: development commands, test suites, hooks and CI.
- `CODING_STANDARDS.md`: read when you review a diff.
