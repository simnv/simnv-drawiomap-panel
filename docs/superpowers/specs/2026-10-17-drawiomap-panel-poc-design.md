# simnv-drawiomap-panel: PoC design

Date: 2026-10-17. Status: approved for PoC.

Background research:
- `docs/research/grafana-drawio-plugin.md`: toolchain, editor embedding, renderer choice, prior art.
- `docs/research/references.md`: portograph output and the demo-lab metric labels.
- `docs/research/portograph-contract.md`: the cell attribute contract. The portograph worker writes this file.

## 1. Goal

A Grafana panel plugin that shows a draw.io diagram as a network weathermap:

- Links show traffic for each direction. The colour and width follow the load relative to capacity.
- Shapes show state. For example, the fill is red when a host is down.
- Sparklines show near shapes and in hover tooltips.
- When you click an element, it opens Grafana data links or URL templates. Cell attributes and series labels fill these links.
- In edit mode, the real draw.io editor opens in a near-full-page modal.
- In view mode, the panel loads no draw.io code and is as small and fast as possible.

Target pipeline: portograph YAML → `.drawio` → import into the panel → bind to the panel queries.

## 2. Fixed decisions

| Topic | Decision |
|---|---|
| Grafana | Support the latest 12.x and 13.x. `grafanaDependency: ">=12.4.0"`. Build against `@grafana/* 12.4.x`. Do not bundle React. |
| Signing | The plugin is unsigned for the PoC. Load it with `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=simnv-drawiomap-panel`. |
| Diagram storage | Inline in panel options as `options.diagram = { xml, svg, hash, updatedAt }`. Import a `.drawio` file by paste or upload, and the panel produces the SVG through the editor. |
| Editor | draw.io embed mode (`embed=1&proto=json&configure=1&spin=1`) in an iframe in a ~95vw×90vh modal. The editor URL is a plugin option. The default is the self-hosted `jgraph/drawio` from compose. `embed.diagrams.net` is the fallback. On save, request `export` format `xmlsvg` and store the XML and the SVG. |
| View renderer | Insert draw.io's exported SVG once (memoised by hash). Index cells by `data-cell-id` and `data-meta-*`. Apply style patches directly to the DOM. Draw the extra elements in an overlay `<g>`. No draw.io viewer, no maxGraph. |
| Data | Only the panel queries (any datasource; VictoriaMetrics/PromQL in the lab). Rules match series by `refId` and label matchers. |
| Rules home | `options.rules` in the panel JSON. Edit them in a form UI and in a YAML tab. The `pg-rules` root attribute is reserved in the portograph contract for later embedding. |
| Link style | Two halves, weathermap style. The A→mid half is coloured by the A→B series and the B→mid half by the B→A series. Each half has an arrowhead at the midpoint and its own label. A link with one series colours the whole edge. |
| Label | The default is rate and % of capacity, for example `412 Mb/s · 41%`. The colour follows % when the link has a capacity. If it has none, the colour follows absolute thresholds. Each rule can set a template. |
| No data | A missing series shows as grey "no data". It must never show as green. |
| Theme | One adaptive SVG. Set `color-scheme` from the Grafana theme so the `light-dark()` styles adapt. Data-driven colours replace the original colours. |
| Sparklines | Inside or near shapes, and in the hover tooltip. Sparklines on links are out of scope. |
| Zoom | Modes: `fit` (default), `fit-width`, `original`, `custom %`. Optional wheel zoom and drag pan, off by default. Implement zoom with `viewBox` and transform, without a re-render. |

## 3. Binding model

Rules are an ordered list. A later rule overrides an earlier rule for the same property of the same cell.

```yaml
- name: uplinks
  select: { kind: link, attrs: { kind: wan } }   # selectors: ids, kind, attrs, label (regex), between: [a, b]
  link:
    a2b: { refId: A, match: { job: "node-${from.node}", device: "${from.port}" } }
    b2a: { refId: B, match: { job: "node-${to.node}",   device: "${to.port}" } }
    capacity: "${cell.capacity}"                  # bit/s; a number or a template
  reducer: last                                  # last | mean | max | min
  label: "${value} · ${percent}"
  thresholds: { mode: percent, steps: [[0, green], [60, yellow], [85, red]] }  # optional; else use field config
  url: "https://grafana/d/iface?var-host=${from.node}&var-if=${from.port}"
- name: hosts up
  select: { kind: node }
  shape:
    series: { refId: C, match: { job: "node-${cell.pg-id}" } }
    fill: true            # also: stroke, text
    sparkline: { refId: D, match: { job: "node-${cell.pg-id}" }, position: bottom }
```

- Template scope: `${cell.<attr>}` is any object attribute of the cell. For links, `${from.node}`, `${from.port}`, `${to.node}` and `${to.port}` come from `pg-from` and `pg-to`. In URLs, the series labels are `${labels.<name>}`, and Grafana dashboard variables also resolve (`replaceVariables`).
- Matchers: an exact string, or `/regex/`. A template that does not resolve makes the binding "unbound" (grey, with a warning in the edit mode).
- Colour, unit, decimals, value mappings and thresholds come from Grafana field config (`getDisplayProcessor` / `getFieldDisplayValues`) unless the rule sets them.
- Data links: the field config data links show in `DataLinksContextMenu` together with the rule `url`.
- Cell identity: the portograph `pg-*` attributes when they exist. For hand-drawn diagrams, use `id` and the label text.

## 4. Components

```
src/
  module.ts               PanelPlugin + options builder
  types.ts                Options, Rule, Diagram types; zod schema for rules
  binding/                pure: resolve templates, select cells, match series, reduce, compute patches
  render/svgStage.ts      insert/sanitise the SVG, build the cell index, viewBox zoom
  render/applier.ts       diff and apply patches (fill/stroke/width/text/class)
  render/overlay.ts       split links (getPointAtLength), arrows, labels, sparklines
  interact/               click → menu/URL, tooltip with sparkline
  editor/DrawioModal.tsx  iframe protocol, import, save → {xml, svg}
  options/                DiagramEditor (open modal, import), RulesEditor (form + YAML), Zoom
```

Each binding module is a pure function and has unit tests. The SVG code is tested with jsdom on real draw.io SVG fixtures.

## 5. Dev and test environment

`docker-compose.yaml` (OrbStack):
- `grafana12` (`grafana/grafana:12.4.x`, port 3012) and `grafana13` (`grafana/grafana:13.2.x`, port 3013). Both mount `dist/` and the provisioning directory.
- `drawio` (`jgraph/drawio`, port 8080).
- `victoriametrics` and a small `metrics-gen` service. It writes synthetic `node_network_{transmit,receive}_bytes_total{job,device}` and `up`-style series that match the demo-lab labels.
- A provisioned datasource and a demo dashboard that uses the portograph `demo-lab` fixture.

Tests:
- Vitest for the binding engine and for the SVG stage, applier and overlay.
- Playwright with `@grafana/plugin-e2e` on Grafana 12 and 13: the panel renders, a link gets the expected colour, the click menu opens, and the editor modal opens and saves.

## 6. PoC acceptance

1. `npm run build`, `npm run typecheck`, `npm run lint` and `npm test` pass.
2. `docker compose up` starts both Grafana versions. The demo dashboard shows the demo-lab diagram, links coloured by synthetic traffic, a node in red when its synthetic `up` is 0, and sparklines.
3. Edit mode: the modal opens the self-hosted draw.io with the diagram, edits save, and the view updates.
4. Clicking a link opens a menu with the rule URL and the field data links.
5. Playwright e2e passes on both Grafana versions.
6. View mode loads no draw.io scripts (check the network panel or the bundle).

## 7. Out of scope for the PoC

- Signing and the catalogue.
- Rules embedded in the diagram (`pg-rules`).
- Click-to-bind in the diagram.
- Sparklines on links.
- Animated flow.
- Diagrams loaded from a URL.
- Multi-page diagrams. Render page 1 and warn.

## 8. Superseded decisions

Date: 2026-10-17. The implementation changed these decisions of sections 2, 5 and 6. The rows below take
precedence over the text above. `docs/acceptance.md` has the current results.

| Topic | Decision above | Current decision | Reason | Record |
|---|---|---|---|---|
| Editor | The editor URL is a plugin option. Default: the self-hosted `jgraph/drawio` from compose; fallback `embed.diagrams.net`. | The plugin bundles draw.io in `dist/drawio`. The editor runs only from the bundle, in an opaque-origin iframe. No editor URL option; an old `editorUrl` value is ignored. | A diagram can run script in the editor frame. An editor on the Grafana origin or on an external host gets the session of the user. The bundle also works offline. | `docs/adr/0001-bundled-editor-opaque-origin.md`, `docs/security.md` |
| Label | Each link half has a label on the canvas, for example `412 Mb/s · 41%`. A rule can set a template. | The canvas shows colours only. The values show in a hover card; a click or a tap pins it. | Labels on the canvas covered the diagram on dense maps and on phones. | README, "Hover card" |
| Thresholds | A rule can set `thresholds` (mode and steps). Else the field config applies. | Rules set no colours. The colours, thresholds, Max and overrides come from the Grafana field config. The link capacity has four sources: a series, a cell attribute, a number, the field Max. | One colour model, the same as in all Grafana panels. Overrides give each kind of link its own scale. | `docs/adr/0002-grafana-native-colours.md`, README, "How colours and thresholds work" |
| Dev stack | The compose stack has a self-hosted `drawio` service (`jgraph/drawio`, port 8080). | No `drawio` service. The bundled editor needs no server. | See the row "Editor". | `docker-compose.yaml` |
| Sparklines | Sparklines show inside or near shapes, and in the hover tooltip. | Sparklines show in the hover card only, at the full card width, with min and max. | Same reason as the row "Label". | README, "Hover card" |
| Contract version | (not in the spec) | The panel reads `pg-schema="1"` from the root cell. No `pg-schema`: generic cells. A higher version: a warning in the Diagram options, and the cells are read as version 1. | A reader must not misread a later contract without a sign to the editor. | `src/adapter/portograph.ts` |
