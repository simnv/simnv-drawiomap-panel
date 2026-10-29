# Coding standards

Read this file when you review a diff. Each rule needs judgement. Mechanical rules are in the linters, `tsc` and the git hooks.

## Grafana first

- Use the Grafana model before a custom option: field config, thresholds, colour schemes, overrides, units, data links, `replaceVariables`. Add a panel option only when Grafana has no equivalent. `docs/adr/0002-grafana-native-colours.md` gives the colour reasoning.
- Use `@grafana/ui` components and theme tokens (`useTheme2`), not hand-made widgets or fixed colours.
- Keep `grafanaDependency` and the APIs compatible with Grafana 12.4 and 13. A new API must exist in both versions.

## One concept, one function

- Each concept has one shared function. All callers use it. Examples: `yDomain` and `combinedTop` (`src/visuals/domain.ts`) for chart ranges; `capacityV4` and `inFieldUnit` (`src/binding/capacity.ts`) for every capacity, and `halfState` (`src/binding/engine.ts`) for the state of a link half and of a card direction. A diff that computes the same thing a second time inline is a finding.
- Binding, template, reduction and range logic is pure and has unit tests next to it. Components only show the result.

## State and data

- A value that is missing shows as "no data" in grey. It must never show as a good state (green, 0 %).
- On refresh, keep the last good render until the new data arrives. A refresh must not reset zoom, a pinned card or the open editor.
- Old saved panel options must still load. Ignore or migrate a removed option (for example `editorUrl`); do not fail on it. For the bindings config (`options.config`) the "migrate" clause is suspended until 1.0: a config of an older version loads without a failure, binds nothing and shows one note (`outdated-config`); there is no migration code.
- Graphs start at zero by default. A change to the Y range goes through `yDomain`.

## View mode and the editor

- View mode loads no draw.io code. Only the editor modal loads `dist/drawio`.
- The editor runs in the opaque-origin iframe and talks only through the MessagePort with the token. A change that weakens this needs an ADR update. See `docs/adr/0001-bundled-editor-opaque-origin.md` and `docs/security.md`.
- The SVG sanitiser output is idempotent: sanitising twice gives the same string.

## Rendering and layout

- Link colour overlays stay below the link labels and inside the edge's own z-order.
- Cards and controls must work on a phone: tap to pin, the sheet fixed to the viewport, no hover-only actions.
- For a layout change, the author attaches or inspects a screenshot. A layout claim with no screenshot is a finding.

## Privacy

- Fixtures, screenshots, tests, docs and commit messages use only the synthetic demo network. A real hostname, address, ISP, private repo name or home path is a blocking finding, even when the hooks do not catch it.

## Docs

- A change to an option updates its README section in the same diff. A change to a field of the config (`src/model/v4.ts`), to the matcher, to a template or to a report entry updates the README section "Bindings (v4)" in the same diff.
- A change to a decision in the spec adds a row to the "Superseded decisions" table or an ADR.
