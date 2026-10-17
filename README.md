# draw.io map panel for Grafana

A Grafana panel plugin (`simnv-drawiomap-panel`). It shows a draw.io diagram as a network weathermap.

"draw.io" is a trademark of JGraph Ltd. This plugin is not affiliated with JGraph Ltd or with the draw.io project.

## What it does

- It colours each link by traffic, for each direction. Each half of the link has its colour and an arrow. The canvas shows no value labels.
- It colours the node icon by state (for example, `up`). A rule can colour the whole shape or the outline instead.
- A hover card shows the values and sparklines of the cell under the pointer. A click or a tap pins the card. The pinned card has links to more dashboards. See [Hover card](#hover-card).
- The real draw.io editor opens in a modal.

View mode loads no draw.io code. The panel stores the diagram XML and the SVG that draw.io exported. The panel shows the SVG and writes colours into it.

## Requirements

- Grafana 12.4 or later (`>=12.4.0`). Tested on 12.4.13 and 13.2.4.
- The plugin is not signed. Set `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=simnv-drawiomap-panel` (or `allow_loading_unsigned_plugins` in `grafana.ini`).
- A draw.io editor URL for edit mode. Use the self-hosted `jgraph/drawio` image (the compose stack starts one) or `https://embed.diagrams.net`.
- A data source with time series. The demo uses VictoriaMetrics.

## Quick start

You need Node.js and Docker.

```bash
npm install
npm run build
npm run stack:up
npm run stack:smoke
```

The stack starts these services:

| Service         | URL                   |
| --------------- | --------------------- |
| Grafana 12.4.13 | http://localhost:3012 |
| Grafana 13.2.4  | http://localhost:3013 |
| draw.io editor  | http://localhost:8080 |
| VictoriaMetrics | http://localhost:8428 |

A generator pushes synthetic traffic series. Open the demo dashboard: http://localhost:3012/d/drawiomap-demo (or port 3013). Anonymous access is on, with the Admin role.

You see the demo-lab diagram. The links have colours from the synthetic traffic. The icon of the `lte` node is red because its `up` series is 0. Move the pointer on a link to see the traffic in each direction. Move it on `rtr-a` or `rtr-b` to see the CPU sparkline.

Stop the stack with `npm run stack:down`. This command also deletes the volumes.

## Diagram import

Open the panel editor and go to **Diagram**. There are three ways to add a diagram:

1. **Import .drawio.** Choose a `.drawio` file, for example a portograph export. The panel loads the file in the editor modal. The editor exports the SVG and the modal closes. The panel stores the XML and the SVG.
2. **Paste draw.io XML.** Paste the XML (from **Extras > Edit Diagram** in draw.io) and select **Apply pasted XML**. The panel accepts an `<mxfile>`, an `<mxGraphModel>`, or an SVG that has an embedded copy of the diagram.
3. **Open editor.** Draw or change the diagram in the real draw.io editor. **Save** and **Save & Exit** store the XML and the SVG.

The panel uses these cell attributes to find cells:

- Portograph diagrams use the `pg-*` attributes (`pg-id`, `pg-kind`, `pg-from`, `pg-to`). The contract is in `docs/research/portograph-contract.md`.
- For a hand-drawn diagram, a cell has its draw.io `id` and its label text. See `demo/rules-hand.yaml`.

Only page 1 of a multi-page diagram is shown. The panel shows a warning.

## Rules

Rules are in the panel option **Rules**. Use the form or the YAML tab. Copy `demo/rules.yaml` as a start:

```yaml
- name: links
  select: { kind: link }
  link:
    a2b: { refId: A, match: { job: 'node-${from.node}', device: '${from.port}' } }
    b2a: { refId: A, match: { job: 'node-${to.node}', device: '${to.port}' } }
    capacity: 1000000000
    card: { title: '${from.node} ↔ ${to.node}' }
  reducer: last
  url: '/d/drawiomap-demo?var-job=node-${from.node}&var-device=${from.port}'
- name: wan uplinks 100M
  select: { kind: link, attrs: { pg-to: '/^rtr-a:(wan1|wan2|lte)$/' } }
  link: { capacity: 100000000 }
  thresholds: { mode: percent, steps: [[0, green], [60, yellow], [85, red]] }
- name: node up
  select: { kind: node }
  shape:
    series: { refId: C, match: { job: 'node-${cell.pg-id}' } }
    target: icon
    card:
      - { title: state, refId: C, match: { job: 'node-${cell.pg-id}' } }
      - { title: load 1m, refId: D, match: { job: 'node-${cell.pg-id}' } }
  thresholds: { mode: absolute, steps: [[0, red], [1, green]] }
  url: '/d/drawiomap-demo?var-job=node-${cell.pg-id}'
- name: router cpu
  select: { ids: [rtr-a, rtr-b] }
  shape:
    card:
      - title: CPU
        refId: E
        match: { job: 'node-${cell.pg-id}' }
        unit: percent
        decimals: 0
        url: '/d/drawiomap-demo?var-job=node-${cell.pg-id}&var-metric=cpu'
      - { title: state, refId: C, match: { job: 'node-${cell.pg-id}' } }
```

Rules are an ordered list. A later rule overrides an earlier rule for the same property of the same cell. In the example, the second rule changes the capacity and the thresholds of the WAN links. The last rule replaces the card rows of the two routers. The `series` and the `target` of the `node up` rule stay.

### Rule fields

| Field        | Meaning                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | Name of the rule. The card footer shows it as the title of the rule URL.                                                                          |
| `select`     | Which cells the rule applies to. See below.                                                                                                       |
| `link`       | For links. `a2b` and `b2a` select one series for each direction. `capacity` is in bit/s (a number or a template). `card` sets the card of links.  |
| `shape`      | For shapes. See below.                                                                                                                            |
| `reducer`    | `last` (default), `mean`, `max` or `min`. Reduces the series to one value. The card rows use it too.                                              |
| `label`      | Template of the text that `shape.text` writes into the node label. The default is `${value}`. Links ignore it (the panel shows a warning).        |
| `thresholds` | `mode: percent` or `absolute`. `steps` is a list of `[threshold, colour]`, ascending. If you omit it, the panel uses the field config of Grafana. |
| `url`        | Link in the card footer, and the click target of card rows without their own URL. It can use templates and dashboard variables.                   |

A series selector has `refId` (the query), `name` and `match` (a map of label name to matcher).

#### `shape`

| Field    | Meaning                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `series` | The series that sets the state colour.                                                                                                                                          |
| `target` | What the colour changes: `icon` (default), `shape` (the fill of the whole shape) or `stroke` (the outline). Without an icon, or with a bitmap icon, `icon` colours the outline. |
| `text`   | `true` writes the value into the node label (see `label`).                                                                                                                      |
| `card`   | A list of card rows. Without it, the card has one row for `series`.                                                                                                             |

The icon of a node is the cell with `pg-kind="node-icon"` and `pg-of="<node pg-id>"`. Older portograph exports have no such tag. Then the panel uses the cell `pg-iconTile~<pg-id>` (the tile behind a glyph), else `pg-icon~<pg-id>`.

The old keys `fill: true` and `stroke: true` still work: they are the same as `target: shape` and `target: stroke`. The panel ignores the removed key `shape.sparkline` and shows a warning.

#### Card rows (`shape.card`)

Each row is a series selector with these extra fields:

| Field      | Meaning                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `title`    | Row title (a template). The default is the series name.                                                                    |
| `unit`     | A Grafana unit id, for example `percent`. The default is the unit of the field config.                                     |
| `decimals` | Number of decimals. The default comes from the field config.                                                               |
| `url`      | Click target of the row (a template). `${labels.<name>}` uses the labels of the row series. The default is the rule `url`. |

#### Link card (`link.card`)

| Field   | Meaning                                                                               |
| ------- | ------------------------------------------------------------------------------------- |
| `title` | Card title (a template). The default is the label text of the link, else its `pg-id`. |
| `url`   | Click target of the `a2b` and `b2a` rows (a template). The default is the rule `url`. |

The card of a link always has one row for each bound direction: the current value, the percent of capacity and a sparkline.

### Cell selectors (`select`)

| Key       | Meaning                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `kind`    | `node`, `port`, `link`, `link-label`, `other` or `any`.                        |
| `ids`     | A list of cell ids or `pg-id` values.                                          |
| `attrs`   | A map of attribute name to matcher (the `data-meta-*` attributes of the cell). |
| `label`   | A matcher for the label text.                                                  |
| `between` | `[a, b]`. A link between two nodes, in any direction.                          |

A matcher is an exact string, or a regular expression between slashes: `/^rtr-a:(wan1|lte)$/`.

### Templates

| Template                       | Value                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `${cell.<attr>}`               | Any attribute of the cell, for example `${cell.pg-id}` or `${cell.capacity}`. |
| `${from.node}`, `${from.port}` | The first end of a link (from `pg-from`).                                     |
| `${to.node}`, `${to.port}`     | The second end of a link (from `pg-to`).                                      |
| `${labels.<name>}`             | A label of the matched series. Use it in `url`.                               |
| `${value}`                     | The value, formatted with the unit and decimals of the field config.          |
| `${percent}`                   | The value as a percent of the capacity.                                       |

`${value}` and `${percent}` are for `label`. Grafana dashboard variables also resolve in all URLs. If a template in a series selector does not resolve, the cell is "unbound". It is grey and the panel shows a warning.

A missing series gives a grey "no data" state. It is never green.

Colour, unit, decimals, value mappings and data links come from the Grafana field config. A rule `thresholds` setting overrides the colour.

## Hover card

The canvas shows only colours. The values show in a card:

| Action                             | Result                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Move the mouse on a link or a node | The card shows near the pointer. It goes away when the pointer leaves the cell.                      |
| Click a cell                       | The card stays (it is pinned). It has a close button (✕), clickable rows and the footer links.       |
| Click another cell                 | The pinned card moves to that cell.                                                                  |
| Esc, ✕, or a click outside         | The pinned card closes.                                                                              |
| Tap a cell (phone, tablet)         | The card opens pinned. Devices without hover (`(hover: none)`) do not open a card on a pointer move. |
| Click or tap a row or a sparkline  | Opens the URL of the row in a new tab (see `shape.card[].url` and `link.card.url`).                  |
| Tab to a cell, then Enter or Space | The card opens pinned. Esc closes it and the focus goes back to the cell.                            |

The card stays inside the panel. It scrolls when it is too long. In a panel narrower than 480 px, the card is a sheet at the bottom of the panel.

A card row has a title, the current value with its unit (for example `wan1 → rtr-a   41 Mb/s · 41%`) and a sparkline over the dashboard time range. The footer has the rule URL and the data links of the field config.

The pinned card is a dialog (`role="dialog"`) and gets the focus. The ✕ button is a normal button. Each bound cell is a button for the keyboard (`tabindex="0"`). The panel builds the card only when it opens, and only for one cell.

## Zoom options

In the **View** group of the panel options:

| Option               | Meaning                                                               |
| -------------------- | --------------------------------------------------------------------- |
| Zoom: Fit            | The whole diagram fits in the panel. This is the default.             |
| Zoom: Fit width      | The diagram has the panel width. The panel scrolls vertically.        |
| Zoom: Original       | The diagram has its original size.                                    |
| Zoom: Custom, Zoom % | The diagram has the size that you set in percent.                     |
| Wheel zoom           | The mouse wheel zooms the view. Off by default.                       |
| Drag pan             | A mouse drag moves the view. Off by default.                          |
| Link width min, max  | The range of the link width in pixels. The width grows with the load. |

## Editor URL option

**Diagram > Editor URL** sets the draw.io editor for edit mode. The default is `http://localhost:8080` (the self-hosted editor in the compose stack). You can use `https://embed.diagrams.net` or your own server.

The panel opens the editor in an iframe inside a modal, in embed mode. No draw.io code loads in view mode. The editor is the only place that has an iframe. A browser must reach the editor URL.

## Grafana 12 and 13

The plugin targets Grafana `>=12.4.0` and builds against `@grafana/*` 12.4.x. React comes from Grafana (it is not bundled). The same `dist/` runs on Grafana 12.4.13 and 13.2.4. Playwright tests pass on both versions: see `docs/acceptance.md`.

## Development

```bash
npm run dev               # webpack in watch mode
npm test                  # Vitest unit tests (jsdom, real SVG fixtures)
npm run typecheck && npm run lint
npm run check:bundle      # fails if draw.io runtime code is in the bundle
npm run e2e:12            # Playwright on Grafana 12 (the stack must run)
npm run e2e:13            # Playwright on Grafana 13
npm run e2e:matrix        # both
npm run build:dashboard   # rebuild provisioning/dashboards/drawiomap-demo.json
./scripts/export-fixtures.sh   # export fixtures/**/*.drawio to fixtures/svg/*.svg
```

The acceptance results are in `docs/acceptance.md`.

## Known limits (out of scope for the PoC)

- No signing and no catalogue entry.
- No rules embedded in the diagram (`pg-rules`).
- No click-to-bind in the diagram.
- No sparklines on the canvas. Sparklines show in the hover card only.
- No animated flow.
- No diagrams loaded from a URL.
- No multi-page diagrams. The panel renders page 1 and shows a warning.
- The editor does not work with the Grafana frontend sandbox (see `docs/acceptance.md`). View mode works in the sandbox.
- HTML labels (`foreignObject`) make the SVG big (about 180 KB for the demo). Set `convertToSvg=1` on labels in the generator for a smaller SVG.

## Licence

Apache-2.0. See `LICENSE`.
