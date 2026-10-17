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
    card: { title: '${from.node} ↔ ${to.node}' }
  reducer: last
  url: '/d/drawiomap-demo?var-job=node-${from.node}&var-device=${from.port}'
  urlTitle: 'Traffic of ${from.node}:${from.port}'
- name: lan by port speed
  select: { kind: link, attrs: { pg-to: '/:br-lan$/' } }
  link:
    capacity: { refId: S, match: { job: 'node-${to.node}', device: '${to.port}' } }
- name: wan uplinks
  select: { kind: link, attrs: { pg-to: '/^(dm|hm)-wrt:(wan1|wan2|lte|pppoe)$/' } }
  link:
    a2b: { refId: W, match: { job: 'node-${from.node}', device: '${from.port}' } }
    b2a: { refId: W, match: { job: 'node-${to.node}', device: '${to.port}' } }
- name: tunnels 100M
  select: { kind: link, attrs: { pg-to: '/:(ts0|in-3088|in-3089)$/' } }
  link: { capacity: 100000000 }
- name: node up
  select: { kind: node }
  shape:
    series: { refId: C, match: { job: 'node-${cell.pg-id}' } }
    target: icon
    card:
      - { title: state, refId: C, match: { job: 'node-${cell.pg-id}' } }
      - { title: load 1m, refId: D, match: { job: 'node-${cell.pg-id}' } }
  url: '/d/drawiomap-demo?var-job=node-${cell.pg-id}'
  urlTitle: 'Host ${cell.pg-id}'
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

Rules are an ordered list. A later rule overrides an earlier rule for the same property of the same cell. In the example, the `lan by port speed` rule adds a capacity to the LAN links. The `wan uplinks` rule changes the series of the WAN links to query `W`. The last rule replaces the card rows of the two routers. The `series` and the `target` of the `node up` rule stay.

The rules do not set colours. The colours come from the field config of the panel. See [How colours and thresholds work](#how-colours-and-thresholds-work).

### Rule fields

| Field        | Meaning                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | Name of the rule. The rule editor and the warnings show it.                                                                                         |
| `select`     | Which cells the rule applies to. See below.                                                                                                         |
| `link`       | For links. `a2b` and `b2a` select one series for each direction. `capacity` is in bit/s (see [Capacity](#capacity)). `card` sets the card of links. |
| `shape`      | For shapes. See below.                                                                                                                              |
| `reducer`    | `last` (default), `mean`, `max` or `min`. Reduces the series to one value. The card rows use it too.                                                |
| `label`      | Template of the text that `shape.text` writes into the node label. The default is `${value}`. Links ignore it (the panel shows a warning).          |
| `thresholds` | Removed. A rule with it still loads, but the panel ignores it and shows a warning. Set **Thresholds** in the field config.                          |
| `url`        | Link in the card footer, and the click target of card rows without their own URL. It can use templates and dashboard variables.                     |
| `urlTitle`   | Title of the `url` link in the card footer (a template). The default is `Open dashboard` for a `/d/<uid>` URL, else `Open <card title>`.            |

A series selector has `refId` (the query), `name` and `match` (a map of label name to matcher).

#### `shape`

| Field    | Meaning                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `series` | The series that sets the state colour.                                                                                                                                          |
| `target` | What the colour changes: `icon` (default), `shape` (the fill of the whole shape) or `stroke` (the outline). Without an icon, or with a bitmap icon, `icon` colours the outline. |
| `text`   | `true` writes the value into the node label (see `label`).                                                                                                                      |
| `card`   | A list of card rows. Without it, the card has one row for `series`.                                                                                                             |

The icon of a node is the cell with `pg-kind="node-icon"` and `pg-of="<node pg-id>"`. Older portograph exports have no such tag. Then the panel uses the cell `pg-icon~<pg-id>`. Some icons are a white glyph on a tile (`pg-iconTile~<pg-id>`). Then the tile takes the colour. A hover on the icon or on the node description opens the card of the node.

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

Unit, decimals, value mappings and data links come from the Grafana field config.

## How colours and thresholds work

The panel has no colour settings of its own. It uses the standard field config of Grafana, as all Grafana panels do:

- **Standard options → Color scheme**: for example **From thresholds**, **Single color**, **Classic palette** or a continuous scheme such as **Green-Yellow-Red (by value)**.
- **Thresholds**: the steps and their colours.
- **Standard options → Max**: a capacity for links (see [Capacity](#capacity)).
- **Overrides**: each of these settings for one query (**Fields returned by query**), one series name, or a regex. Use overrides to give each kind of link its own scale, for example a continuous scheme for the WAN query and thresholds for the LAN query.

For each link half and each shape, the panel finds the matched series. Then it uses the field config of that series, with the overrides applied:

```text
matched series ─▶ field config (defaults + overrides)
                        │
        link half with a capacity?
          │ yes                                   │ no (and all shapes)
          ▼                                       ▼
  percent = value in bit/s / capacity × 100       the display colour of the raw value:
          │                                       value mappings, then thresholds
          ├─ From thresholds: the steps are       and Color scheme (like a Stat panel)
          │  percent (in Absolute and in
          │  Percentage mode)
          ├─ continuous scheme: percent / 100
          │  is the position on the scale (0..1)
          └─ other schemes: the colour of the scheme
```

- A link half with a capacity: the colour input is the utilisation, 0 to 100 %. A step at 85 means 85 % of the capacity. Values above 100 % get the end colour of a continuous scheme. The line width also follows the percent (option **Link width**).
- A link half without a capacity, and every shape: the colour is the normal display colour of the raw value, as in any Grafana panel. For example, an `up` query with the thresholds base red and 1 green colours a node green when it is up.
- No data: always grey, never green.

The overlay attribute `data-dmap-step` is the index of the active threshold step.

### Capacity

The panel gives each link half a capacity in bit/s. It uses the first source that gives a value:

| Order | Source            | Example                                                                                         | Notes                                                                                                                              |
| ----- | ----------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1     | A series          | `capacity: { refId: S, match: { job: 'node-${to.node}', device: '${to.port}' }, reducer: max }` | For example `node_network_speed_bytes`. The unit of the field converts the value to bit/s (`Bps` multiplies by 8). Templates work. |
| 2     | A cell attribute  | `capacity: '${cell.capacity}'`                                                                  | The `capacity` attribute of the cell, for example `meta: { capacity: 1e9 }` in a portograph YAML file.                             |
| 3     | A number          | `capacity: 1000000000`                                                                          | bit/s.                                                                                                                             |
| 4     | The field **Max** | **Standard options → Max** of the traffic series, or an override for one query                  | In the unit of the field, for example Max `100000000` with the unit `bits/sec(SI)`.                                                |

The series source uses the rule `reducer` when the selector has no `reducer`. If the capacity series is missing, the field **Max** applies and the panel shows a warning in edit mode. A template that does not resolve makes the link unbound (grey, with a warning).

The hover card shows the capacity of each half, for example `41 Mb/s · 41% of 100 Mb/s`. Without a capacity, it shows only the value.

The units are the data-rate units of Grafana: `bps`, `Kbits` … `Pbits`, `Bps`, `KBs` … `PBs`, and the binary (IEC) forms. A field without a unit is in bit/s. A unit that is not a data rate gives a warning, and the panel uses the raw value as bit/s.

The demo dashboard uses all four sources: LAN links get the port speed series `S`, WAN links the **Max** of an override of query `W`, tunnels a number, and the hand-drawn panel the `capacity` attribute of its cells.

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

A card row has a head line and a sparkline below it. The head line has a colour dot, the title and the current value with its unit (for example `wan1 → rtr-a   41 Mb/s · 41%`). The sparkline has the full width of the card. Its time axis is the part of the dashboard time range that has data, so the line goes from edge to edge also when the series starts late. Below the sparkline, muted text shows the min and the max of the series.

The footer has the rule URL (title: `urlTitle`) and the data links of the field config (title: the data link title). A link that opens in a new tab has an external-link icon.

The pinned card is a dialog (`role="dialog"`) and gets the focus. The ✕ button is a normal button. Each bound cell is a button for the keyboard (`tabindex="0"`). The panel builds the card only when it opens, and only for one cell.

## Zoom options

In the **View** group of the panel options:

| Option               | Meaning                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zoom: Fit            | The whole diagram fits in the panel. This is the default.                                                                                                                       |
| Zoom: Fit width      | The diagram has the panel width. The panel scrolls vertically.                                                                                                                  |
| Zoom: Original       | The diagram has its original size.                                                                                                                                              |
| Zoom: Custom, Zoom % | The diagram has the size that you set in percent.                                                                                                                               |
| Align                | Fit only. **Top** (default): when the panel is taller than the diagram, the diagram is at the top. **Center**: it is in the middle. The diagram is always centred horizontally. |
| Wheel zoom           | The mouse wheel zooms the view. Off by default.                                                                                                                                 |
| Drag pan             | A mouse drag moves the view. Off by default.                                                                                                                                    |
| Link width min, max  | The range of the link width in pixels. The width grows with the load.                                                                                                           |

### Live zoom

You can zoom and pan the view of the panel. The live zoom does not change the saved panel options.

| Gesture                            | Result                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Pinch with two fingers             | Zooms around the point between the fingers. A move of the two fingers pans. |
| One finger, at the configured zoom | Scrolls the page. A tap opens the card.                                     |
| One finger, when zoomed            | Pans the view. A tap (less than 6 px of movement) opens the card.           |
| Trackpad pinch (Ctrl+wheel)        | Zooms around the pointer. This is always on.                                |
| Mouse wheel                        | Zooms only when **Wheel zoom** is on.                                       |
| Mouse drag                         | Pans when the view is zoomed, or at all times when **Drag pan** is on.      |

The scale stays between 0.2× and 10× of the configured zoom. When the view is not at the configured zoom, a **Reset zoom** button shows in the top-right corner of the panel, above the warning badge. Click or tap it to go back to the configured zoom. A new panel size or a new **Zoom** option also resets the view.

The panel sets `touch-action: pan-x pan-y` at the configured zoom: one finger scrolls the page, and the browser does not pinch-zoom the page over the panel. When the view is zoomed, the panel sets `touch-action: none` and takes all touches. A two-finger `touchmove` calls `preventDefault()`, so the page does not scroll while you pinch.

![Zoomed view with the reset button](docs/screenshots/zoomed-reset-button.png)

## Editor

The plugin includes the draw.io editor (`dist/drawio`). Edit mode opens it in an iframe inside a modal, in embed mode. The iframe has an opaque origin, so the editor cannot reach the Grafana page (see `docs/security.md` and `docs/adr/0001-bundled-editor-opaque-origin.md`). The editor works with and without the Grafana frontend sandbox, with `content_security_policy = true`, and with `app_sub_url`. The plugin has no option for another editor URL. An `editorUrl` value that an older version saved is ignored. No draw.io code loads in view mode.

![Diagram options](docs/screenshots/options-diagram.png)

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
npm run stack:wait        # wait for the demo series, Grafana health and the plugin (bounded, no fixed sleep)
npm run package           # artifacts/simnv-drawiomap-panel-<version>.zip (run npm run build first)
npm run ci:local          # all CI steps in order: install, checks, build, package, e2e on both versions
npm run build:dashboard   # rebuild provisioning/dashboards/drawiomap-demo.json
./scripts/export-fixtures.sh   # export fixtures/**/*.drawio to fixtures/svg/*.svg
```

The acceptance results are in `docs/acceptance.md`. The decision records are in `docs/adr/`.

### CI

`.forgejo/workflows/ci.yml` runs on Forgejo Actions:

1. `build-test`: `npm ci`, typecheck, lint, unit tests, build, `check:bundle`, `package`. It caches `.drawio/cache` (the draw.io release file) with a key from `DRAWIO_VERSION` and `DRAWIO_SHA256` in `scripts/vendor-drawio.sh`. It uploads `dist/` and the plugin zip as artifacts.
2. `e2e`: one job for each Grafana version (12.4.13, 13.2.4). It starts the compose stack with `docker compose up -d --force-recreate --wait`, runs `scripts/wait-stack.sh`, and then Playwright. When a test fails, it uploads the Playwright report.

The jobs use the runner label in the Actions variable `CI_RUNNER` (default `docker`). The e2e job needs the docker CLI with compose v2 in the job, bind mounts of the workspace, and the published ports on `localhost` (for example, a runner in host mode). The actions come from the `https://data.forgejo.org/actions/...` mirrors, so the jobs do not need github.com.

`npm run ci:local` runs the same steps on your machine, without the caches and the uploads. `SKIP_INSTALL=1` keeps `node_modules`. `SKIP_E2E=1` stops after the package step. The e2e steps stop the compose stack at the end (`docker compose down -v`).

## Known limits (out of scope for the PoC)

Baseline: 2026-10-17. The results are in `docs/acceptance.md`.

- No signing and no catalogue entry.
- No rules embedded in the diagram (`pg-rules`).
- No click-to-bind in the diagram.
- No sparklines on the canvas. Sparklines show in the hover card only.
- No animated flow.
- No diagrams loaded from a URL.
- No multi-page diagrams. The panel renders page 1 and shows a warning.
- The panel reads the portograph contract version 1 only (`pg-schema="1"` on the root cell). A diagram with a higher version shows a warning in the **Diagram** options; the panel reads its cells as version 1. A diagram without `pg-schema` is not a portograph export: the panel ignores its `pg-kind`, `pg-id`, `pg-from` and `pg-to` attributes, and rules select its cells by id, label and other attributes.
- With the Grafana frontend sandbox on, one e2e test fails: on a phone viewport, the fitted diagram fills the full panel height (no gap below the diagram). All other e2e tests pass in the sandbox, the editor tests too.

## Licence

Apache-2.0. See `LICENSE`.
