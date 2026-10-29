# draw.io map panel for Grafana

A Grafana panel plugin (`simnv-drawiomap-panel`). It shows a draw.io diagram as a network weathermap.

"draw.io" is a trademark of JGraph Ltd. This plugin is not affiliated with JGraph Ltd or with the draw.io project.

## What it does

- It colours each link by traffic, for each direction. Each half of the link has its colour and an arrow. The canvas shows no value labels.
- A cell gets its colour and its text from a status query, with the colours and the value mappings of the field config. The hover card and the status band say the reason. A healthy value can keep the drawn colour (`transparent`).
- Classes in the panel options bind the cells to the panel queries: values and histories in the hover card (a click or tap pins it), and chart rectangles with trends or bar gauges.
- The real draw.io editor opens in a modal.

View mode loads no draw.io code. The panel stores the diagram XML and the SVG that draw.io exported. The panel shows the SVG and writes colours into it.

The panel removes every `<style>` element from the SVG. It keeps only the `--ge-*` colour variables of the draw.io auto theme (for example the label background), so they follow the Grafana light or dark theme. See [Theme variables](docs/security.md#theme-variables-of-the-svg).

## Requirements

- Grafana 12.4 or later (`>=12.4.0`). Exact tested releases, sandbox modes and the development build are in the [compatibility matrix](docs/research/authoring-compatibility.md).
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
- For a hand-drawn diagram, a cell has its draw.io `id`, its label text and the attributes that you add (see [Cell attributes](#cell-attributes)). See `handDrawnConfigV4` in `src/fixtures/demo-config.ts`.

Only page 1 of a multi-page diagram is shown, and only page 1 is bound. The **Diagram** options show a warning when you import or paste a file with several pages.

## Bindings (v4)

A binding joins a cell of the diagram to the series of the panel queries. The config has **classes**. A class says what its cells show: a status, a text, hover rows, a chart, and for a link the two directions and the capacity. A cell joins a class with its attribute `bind`. Its other attributes (`key`, `port`, and so on) tell which series belong to the cell.

The config is version 4. This is the first panel version that reads it. A config of version 3 or older binds nothing (see [Old configs](#old-configs)).

The queries are the targets of the panel. A class names a target by its **refId** (`A`, `up`, `lan_tx`). The panel runs no query of its own.

```yaml
version: 4
freshness: 3x
classes:
  node-up:
    match:
      key: job
    status: up
    rows:
      - kind: history
        label: load 1m
        query: load
    url: /d/drawiomap-demo?var-job=${key}
  lan-speed:
    match:
      key: job
      port: device
    up: lan_tx
    down: lan_rx
    capacity: speed
    linkLabel: percent
    rows:
      - kind: updown
        label: Traffic
        up: lan_tx
        down: lan_rx
overrides:
  pg-node~proxy-b:
    match:
      key: job="${key}-no-data"
```

A cell with `bind=node-up` and `key=node-rtr-a` shows the series of the target `up` that have the label `job="node-rtr-a"`. A link with `bind=lan-speed`, `key=node-rtr-a` and `port=br-lan` takes the series of the targets `lan_tx` and `lan_rx` that have `job="node-rtr-a"` and `device="br-lan"`. `src/fixtures/demo-config.ts` holds the full demo config; the demo dashboard uses it.

### Edit the config

The option **Bindings** (group **Bindings**) is a YAML editor. The panel stores the config as JSON in the dashboard. The editor shows the same data as YAML in a fixed key order.

- A YAML comment is not kept. The editor writes the config from the data on each load.
- An error shows as a marker on its line. A YAML syntax error and an error in the top level (`version`, `freshness`, `classes`, `overrides`) stop the save: the editor keeps your text and stores nothing. An error inside one class or one override does not stop the save. The panel shows the cells of that class or override as **unavailable**: grey, with the reason "Binding is not valid".
- The editor loads in a separate chunk. View mode and the dashboard do not load the YAML parser.
- The option `build` of the panel JSON is never read by the panel. A generator can write it. The editor keeps it.

### Split editor

In panel edit, select **Edit bindings** in the Diagram options or on the panel. The split editor shows YAML on the left, a live diagram on the right, and the match report below. On a narrow screen, use the Code, Diagram and Report tabs. Drag the handles to resize the panes. The panel keeps their sizes in the browser.

The preview follows a valid draft. Move the cursor in YAML to highlight the affected cells; select a report entry to move to its YAML path and highlight its cells. Select a cell to open its inspector and move the cursor to its override or class. The inspector shows its attributes, class chain, override, and, for each use, the query, matchers, series count and up to eight label sets and values. For an edge it also shows the ends and the direction of each half.

Set `bind` and `key` for one cell with **Set bind and key**. An empty field removes that attribute. Shift-click cells or drag a selection box with Shift, then use **Assign class** to set `bind` on all selected cells; their keys stay. For an edge, use **key is at the target** or **key is at the source** to set or clear `at=target`. On a generated panel the inspector says that the generator writes `at` again at the next build; change the link in the catalogue family of the generator source. These writes change page 1 of the draft diagram in both XML and SVG. If the page is compressed, open it in draw.io and save it once before a write.

Use **Undo** and **Redo** for diagram writes. Ctrl+Z (Cmd+Z on a Mac) undoes the text when the code box has the focus; in other places it undoes the last diagram write. **Apply** saves the valid YAML and diagram draft to the panel options; save the dashboard to keep the changes. **Apply** is off while the YAML does not parse. An error in one class or one override does not turn it off. Closing with an unapplied draft asks for confirmation. If the saved panel changes while the editor is open, choose **Reload** to discard the draft or **Keep my draft** before applying it.

### Cell attributes

A cell has attributes: the `data-meta-*` attributes of the exported SVG, written by draw.io, or by portograph from the `meta` of a node. The panel reads page 1 only.

Cell attribute names use ASCII lowercase; `setCellAttrs` lowercases written names, replaces case variants, and removes all variants for `null`.

| Attribute | Use                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `bind`    | The name of the class of the cell. No `bind`: no binding. A `bind` that names no class gives `unknown-class`.                              |
| `key`     | The main identity of the cell, for example a host name or an interface name. The class `match` and the templates read it.                  |
| `port`    | A second identity, for example the interface of a host. Use any other name for a third one.                                                |
| `at`      | A link only. `at=target` tells that `key` and `port` name the target end of the link. Else they name the source end (see [Links](#links)). |
| `cap`     | A link only. The capacity when the class has no `capacity` series: `1G`, or `50M/10M` for a→b/b→a (see [Capacity](#capacity)).             |
| `id`      | The draw.io cell id. Read it as `${id}`.                                                                                                   |
| `label`   | The label of the cell. Read it as `${label}`.                                                                                              |
| other     | Any name of letters, digits, `_` and `-`. The names `pg-*` belong to portograph.                                                           |

The inspector can write `bind` and `key`, and can set or clear `at=target` on an edge. For other attributes:

- The generator or the `meta` of the portograph source writes them.
- You set them in draw.io with **Edit Data** (Ctrl+M) in the embedded editor: **Diagram → Open editor**, select the cell, press Ctrl+M, add the attribute, then **Save**.

A dashboard that a generator wrote is **generator-owned**. The generator writes its classes, its overrides and its attributes again at each build. A hand edit of them in the panel is lost at the next deploy, unless the generator reads it back first (its `pull` step). Change a generated panel in the generator source.

**Page 1 only.** A diagram with several pages shows page 1, and v4 binds page 1 only. A cell on another page stays unbound. A diagram whose page is compressed gives no ends for ordinary links (`no-edge-ends`): open it in draw.io once and save it.

### Classes

A class is a map. Every field is optional.

| Field        | Meaning                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extends`    | The name of one parent class. See [Extends and overrides](#extends-and-overrides).                                                                                                                       |
| `match`      | Which series belong to a cell: a map from a cell attribute to a series label. See [Match](#match). A class with no `match` is **abstract**: a base for other classes. A cell that binds it gets no data. |
| `status`     | The refId whose value gives the colour and the text of the cell (see [Status, colour and text](#status-colour-and-text)).                                                                                |
| `missing`    | `nodata` (the default, grey) or `down`. What a cell shows when the status query is ready and has no series for the cell.                                                                                 |
| `text`       | `{ query, match, reduce, label, unit, decimals }`. Writes the formatted value on the cell. `query` is a refId.                                                                                           |
| `rows`       | The rows of the hover card (see [Rows](#rows)).                                                                                                                                                          |
| `chart`      | A chart in the box of the cell (see [Chart regions](#chart-regions)).                                                                                                                                    |
| `freshness`  | When a result is stale: `5m`, or `3x` for three times the cadence of the query. The top-level `freshness` is the default; the panel default is `3x`.                                                     |
| `url`        | The main link of the card. A template. `urlTitle` is its title.                                                                                                                                          |
| `up`, `down` | A link only. The refIds of the transmit and the receive counter.                                                                                                                                         |
| `capacity`   | A link only. A refId of the port speed, or `{ a2b, b2a }` for one refId for each direction.                                                                                                              |
| `linkLabel`  | A link only. `none` (the default), `value` or `percent` (see [Link value labels](#link-value-labels)).                                                                                                   |

`up`, `down`, `capacity` and `linkLabel` on a class whose cells are not links give one `unused-field` entry.

### Extends and overrides

`extends` names one parent. The chain resolves from the root. `rows` append: the rows of the parent come first. Each other field replaces the field of the parent as a whole, so `match`, `chart` and `capacity` are each one field. A cycle, an unknown parent and a parent that is not valid make the class invalid, and the classes below it.

`overrides` change one cell. The key is the draw.io cell id. An override has the fields of a class, except `extends`. It applies after the class chain, with the same rule: rows append and the other fields replace. Use it for the rare exception. An override for a cell id that the diagram does not have gives `unknown-override`. An invalid override makes its cell unavailable.

An invalid class, and the classes below it, make their cells unavailable. The other classes bind as usual.

### Match

`match` is a map. The key is a **cell attribute**. The value says which series label must agree with it.

| Form                                       | Meaning                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `key: job`                                 | The series label `job` equals the attribute `key` of the cell.                      |
| `key: instance=~"${key}:.*"`               | The label `instance` matches the regular expression `^(?:<value of key>:.*)$`.      |
| `port: device`                             | A second pair: the label `device` equals the attribute `port`.                      |
| `key: entity="switch.${key}_k${port}"`     | A template. It reads any attribute of the cell; each one that it reads is required. |
| `key: [instance=~"${key}:.*", job="node"]` | A list. All matchers must pass.                                                     |

A row, `text` and `chart` can have their own `match`. It replaces the `match` of the class as a whole; it does not add to it. A filter that does not depend on a cell belongs in the query, not in `match`.

In YAML flow style (`{…}`, `[…]`) a plain value cannot hold `{`, `}`, `[`, `]` or `,`. Write `match` in block style, as above, or in single quotes. The editor writes block style.

#### The matcher contract

The panel runs one matcher in these steps.

1. **Parse.** The text is `<label>` or `<label><op>"<string>"`. `<label>` is `[A-Za-z_][A-Za-z0-9_]*`. `<op>` is `=`, `!=`, `=~` or `!~`. Only double quotes are allowed. Space around the parts is allowed. A text that does not parse is a `schema` entry.
2. **Unescape.** The string uses the Go escapes of PromQL: `\\`, `\"`, `\n`, `\t`. Another backslash sequence is a `schema` entry. Thus `entity=~"\\d+"` gives the body `\d+`, and `"\d"` is an error, as in PromQL.
3. **Find the placeholders.** A matcher reads `${name}`, `${from.name}` and `${to.name}`. Each one is a required attribute. `${labels.x}`, `${value}` and a dashboard variable (`${name:format}`) are a `schema` entry in a matcher. A matcher reads no dashboard variable: put such a filter in the query.
4. **Required attributes.** The record keys and the placeholders are required. A cell that lacks one gets `missing-attr`, and that use selects no series for the cell. An empty value counts as present.
5. **Substitute.** `=` and `!=` take the value as it is. `=~` and `!~` regex-escape it first. A quote or a backslash in a cell value cannot change the matcher.
6. **Compile.** The regex dialect is the part of RE2 (PromQL) and JavaScript that means the same in both. The panel rejects, with `matcher-error`: `\A`, `\z`, `\Q…\E`, `\C`, `\p`, `\P`, `(?P<`, a flag group other than one leading `(?i)`, lookaround, and backreferences. A `\` and an ASCII punctuation character is that literal character (`\-`, `\_`, `\:`). Another unknown escape (for example `\y`) is a `matcher-error`. A regex is anchored: `^(?:…)$`. `.` does not match a line break.
7. **Test.** The test reads the whole label value. An absent label is the empty string, as in PromQL: `job!="x"` and `job=""` pass on a series with no `job`; `job="x"` fails.
8. **Combine.** All matchers of a block must pass.

A block must read the cell: a bare matcher, or a placeholder. `match: {}` and `match: { key: job!="" }` are `schema` entries, because they select the same series for every cell.

When the result of a query has no label that names the cell, change the query so that it keeps one, for example `min by (entity) (…)`.

### Templates

A template is the text of `url`, `urlTitle`, a `metadata` row and a `drilldown` row, and the string of a matcher. The scope:

| Placeholder                  | Value                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `${name}`                    | The attribute `name` of the cell. `${id}` is the cell id. `${label}` is the attribute `label`. |
| `${from.name}`, `${to.name}` | An attribute of the cell at that end of a link (see [Links](#links)).                          |
| `${labels.name}`             | A label of the status series of the cell. Only when the status use selects exactly one series. |
| `${value}`                   | The formatted status value. The same condition.                                                |

`${name}` is always a cell attribute. There is no `cell.` prefix. A missing attribute is a `missing-attr` entry, never a dashboard variable: the item is not shown. `${labels.x}` and `${value}` with no series or many series give `template-unresolved`. A `${` that starts none of the forms here and no `${name:format}` is a `schema` entry in a URL, a `metadata` text and a `drilldown`. `${__name}` is a cell attribute; write `$__name` for a Grafana variable.

**Dashboard variables.** The panel does not substitute them. Grafana does (`replaceVariables`), and only in a URL and in a title (`urlTitle`, the label of a `drilldown`).

| Form               | Meaning                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$name`, `$__name` | A dashboard variable, or a Grafana global variable.                                                                                                               |
| `${name:format}`   | A dashboard variable with a Grafana format: `csv`, `pipe`, `regex`, `queryparam`, `percentencode`, `raw`, `text`, and so on. The panel does not check the format. |

A `${name:format}` in a `metadata` text is a `schema` entry: a `metadata` text reads no dashboard variable.

**The URL encoding.** For a URL the panel works in this order:

1. It replaces each placeholder of the scope table with the value, encoded with `encodeURIComponent`. A `$` in a cell value is shielded, so `replaceVariables` does not expand an attribute that holds `${site}`.
2. It writes each bare variable `$name` as `${name:percentencode}`. A name that starts with `__` stays as it is: `$__url_time_range` gives `from=…&to=…`, unencoded. A `${name:format}` keeps its format.
3. `replaceVariables` runs. Then the panel removes the shield and checks the final text. A URL that is not relative and not `http` or `https` is not shown.

Thus `/d/host?var-job=$job` with the value `a&var-site=b` gives `var-job=a%26var-site%3Db`. A multi-value variable in the bare form gives one encoded value, not several parameters; the exact text is the output of the Grafana format `percentencode`. To get repeated parameters write `/d/host?${job:queryparam}`: the result is `var-job=a&var-job=b`. A cell attribute `job` and the variable `job` do not clash: `${job}` is the attribute, `$job` and `${job:queryparam}` are the variable.

### Status, colour and text

`status` names a refId. The field config of that refId in the panel (thresholds, value mappings, colour scheme, unit) gives the colour and the text of the cell. The cell shows the **exact** colour and text of its series. A value mapping that maps `1` to the text `Offline` in magenta paints the cell magenta with the text `Offline`.

- **Severity** decides only three things: the worst of N series, the status band and the legend. A mapping text `down` (any case) gives `down`. Else the colour name decides: `red*` is critical, `orange*` and `yellow*` are warning, the rest is normal. A hex colour goes to the nearest hue of the Grafana palette.
- **Worst of N.** A cell with several series shows the worst by this rank: down, critical, warning, stale, missing, normal. At one rank, the first series in the [fixed order](#several-series) wins.
- **Transparent.** A field config can map a value to the colour `transparent`. Then the panel paints nothing and the cell keeps its drawn colour. A generator writes `transparent` for each healthy value. A hand author can choose green.
- **Text.** The hover card and the status band show the text. A cell without a value has the text `–`; its reason shows in place of it.

The paint itself is in [Status paint](#status-paint).

### Missing data

The state of a use comes from the result of its refId.

| Result                                                          | The cell shows                              | `missing: down` |
| --------------------------------------------------------------- | ------------------------------------------- | --------------- |
| The query failed, or the whole request failed                   | grey, "Query failed" (`query-unavailable`)  | does not apply  |
| First load, no series yet                                       | grey, "Loading data"                        | does not apply  |
| A refresh is loading                                            | the last series (Grafana keeps them)        | as ready        |
| A refId that no panel target has                                | grey, "Unknown query" (`unknown-ref`)       | does not apply  |
| Ready, zero series for the cell                                 | grey, "no data"                             | `down`          |
| Ready, a series with no finite value (all null, NaN, ±Infinity) | that series is `missing`, "No value"        | does not apply  |
| Ready, a field that fails the frame checks                      | that series is `missing` (`invalid-series`) | does not apply  |

A missing value never shows as a good state. A special-value mapping of Grafana (null → green) does not apply. With two series, one with the value 1 and one with no value, the cell is `missing` with the reason "1 of 2 series have no value". `missing: down` applies only to zero series of a ready query. A module with 5 of 6 series shows the worst of the 5.

### Freshness

A series is **stale** when its last non-null value is older than the freshness. A cell is stale when one of its series is stale.

- `5m` is a fixed time. `3x` is three times the cadence of the query. The cadence is the larger of the request interval and the minimum interval of the target; without both, it is the median step of the series. A series with fewer than two points then has no stale check.
- A target with `instant: true` and no `range: true` is never stale. A dead exporter goes to no data through the lookback of the data source.
- On a relative time range (`now`, `now-1h`) a cell turns stale at its time with no new data. The age counts from the clock, less the lag of the range end. On an absolute range the age counts from the end of the range, and the state does not change with the clock.
- Freshness applies to the status and to the rows (a row shows "stale"). It does not apply to the capacity.

### Several series

A use can select more than one series.

**Order.** The series of a use are in one fixed order: by the label string (`k="v"` pairs, keys sorted), then by frame order, then by field index. "First", "+N more" and the colour of a line use this order. A frame with more than one numeric field gives `many-fields`. Two frames with equal labels and field name are one series: the panel merges their samples by time, so a target with `instant` and `range` gives the range points and then the instant point. Two different values at one time give `duplicate-series`.

| Use                          | With N series                                                        |
| ---------------------------- | -------------------------------------------------------------------- |
| `status`                     | the worst state                                                      |
| `text`, `value` row or chart | reduce across the series; `many-series` unless the use sets `reduce` |
| `history` row or chart       | up to 8 lines, then "+N more"                                        |
| `updown` row or chart        | reduce each direction; `many-series` unless the use sets `reduce`    |
| `up`, `down` of a link       | reduce with the default; `many-series`                               |
| `capacity`                   | not used, falls through; `many-series`                               |

**`reduce`.** `sum`, `max` or `mean`. The default is `sum` when the unit is a rate unit (`bps`, `Bps`, `pps`, `cpm`, `flowlpm`, and the other units of the Grafana categories "Data rate", "Throughput" and "Flow"), else `max`. An explicit `reduce` says that N series are expected, so the report stays quiet.

**Units.** When the units of the series differ and all are bit or byte rates, the panel converts to the unit of the first series: 1 Mbit/s and 500 kbit/s sum to 1.5 Mbit/s. Other mixed units give `missing` with "Mixed units" and `unit-mismatch`.

**N lines.** A `history` row or chart draws up to 8 lines in one chart with one Y range. A line shows only the labels that differ between the lines; when no label differs, it shows the display name of the field. The 8 lines have 8 distinct colours of the Grafana classic palette (slots 0–5, 26 and 30), in the fixed order. A series with no value keeps its place and colour and shows "No data" in the tooltip.

### Rows

`rows` is a list. A row is one line of the hover card.

| `kind`      | Fields                                                       | Meaning                                                               |
| ----------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `history`   | `query`, `match`, `label`, `unit`, `decimals`, `min`, `max`  | A value and a sparkline. `min` is a number or `auto`; `max` a number. |
| `value`     | `query`, `match`, `reduce`, `label`, `unit`, `decimals`      | A reduced value.                                                      |
| `updown`    | `up`, `down`, `match`, `reduce`, `label`, `unit`, `decimals` | Two directions of one subject in one chart (see below).               |
| `metadata`  | `label`, `text`                                              | A text from a template. It reads no dashboard variable.               |
| `drilldown` | `label`, `url`                                               | A link in the footer of the card.                                     |

The label, unit and decimals come from the field config of the refId. A row can override them. Rows of different units can share one card.

An `updown` row draws the two directions in one chart: up above a zero line, down mirrored below it, in one symmetric range. The colour and the text of each direction follow the rules of a link half (see [Links](#links)).

### Sparkline Y range

All sparklines use one Y range: card rows and chart regions. A series without negative values starts at 0, so a small change on a flat series does not look like a big climb. The top is the largest value, the capacity, or 100 for the unit `percent` (1 for `percentunit`), whichever is largest. A series with negative values uses its own min and max. The lines of one chart share one range.

Each bound uses the first source that has a value:

1. `min` and `max` of the row or the chart.
2. **Min** and **Max** of the Grafana field config.
3. The default above.

The bounds are soft: the range always holds all values. Set `min: auto` to use the data range instead of the zero baseline. The span is then at least 10% of the largest value, centred on the data.

```yaml
rows:
  - kind: history
    label: PoE power
    query: poe
    min: auto
```

### Chart regions

The class field `chart` draws a chart in the box of each of its cells. It has the fields and the rules of a row of the kind `history`, `value` or `updown`. A `value` chart is a bar gauge. Draw a rectangle in the diagram, give it `bind` and `key`, and bind a class with a `chart`.

```yaml
classes:
  cpu-chart:
    match:
      key: job
    chart:
      kind: history
      query: cpu
      unit: percent
```

### Links

A class with `up`, `down` or `capacity` applies to a link (an edge cell).

- **Ends.** The ends of a portograph link come from `pg-from` and `pg-to`. An ordinary draw.io edge has its ends in the `source` and `target` of its cell in page 1 of the stored XML. An attribute on the port cell wins over the same attribute on the node cell. When the end cell has no such attribute, the panel looks in its parents up to the layer (a shape inside a container). `${from.key}` and `${to.key}` read the attribute at an end.
- **Direction.** The half at the start of the drawn path is **a→b**. The `key` and the other matched attributes name the interface at the source end. a→b takes `up` (transmit) and b→a takes `down` (receive). With `at=target` the attributes name the target end, and a→b takes `down`. The stroke of each half, the link value label and the `updown` row of the card follow the same rule.
- **Colour and width.** With a capacity, the colour input is the percent of the capacity. Without one, it is the raw value. See [How colours and thresholds work](#how-colours-and-thresholds-work).
- **Capacity.** See [Capacity](#capacity).

### The match report

On each bind the panel collects a **report**. In view mode the warning badge in the corner shows the count, and its tooltip lists the entries. In panel edit, use **Edit bindings** to open the split editor and its report. The YAML option shows the entries of the parse as markers on their lines. Each entry names a YAML path, a set of cells, or both.

| Entry                                                         | Meaning                                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `schema`                                                      | A field has a wrong name, type or form. The entry gives the YAML path.                  |
| `yaml`                                                        | A YAML syntax error. The editor only.                                                   |
| `outdated-config`                                             | The config has version 3 or older.                                                      |
| `class-no-match`                                              | Cells bind a class that has no `match`.                                                 |
| `class-cycle`, `class-unknown-parent`, `class-invalid-parent` | The chain of `extends` has an error. The class and the classes below it are invalid.    |
| `unknown-ref`                                                 | No panel target has this refId.                                                         |
| `unknown-class`                                               | Cells have a `bind` that names no class.                                                |
| `unknown-override`                                            | An override names a cell id that the diagram does not have.                             |
| `missing-attr`                                                | A cell lacks an attribute that the match or a template reads.                           |
| `matcher-error`                                               | A regex is not in the dialect, or does not compile.                                     |
| `template-unresolved`                                         | `${labels.x}` or `${value}` found zero or many series.                                  |
| `query-unavailable`                                           | A query failed or is loading.                                                           |
| `no-series`                                                   | Cells have no series for a use.                                                         |
| `many-series`                                                 | A use found more than one series where one is expected.                                 |
| `orphan-series`                                               | Series that no cell selects. The entry lists 50 label sets at most, then "+N more".     |
| `many-fields`, `invalid-series`                               | A frame has more than one numeric field, or a field fails the checks.                   |
| `duplicate-series`                                            | Two frames hold different values at one time for equal labels.                          |
| `unit-mismatch`                                               | The units of the series cannot convert to one unit.                                     |
| `capacity-fallback`                                           | The capacity series cannot give a value (the reason says why); the next source applies. |
| `bad-cap`                                                     | The attribute `cap` does not parse.                                                     |
| `no-edge-ends`                                                | The ends of an ordinary edge are not readable (a compressed page).                      |
| `unused-field`                                                | A link field on a class whose cells are not links.                                      |
| `class-no-cells`                                              | No cell binds this class or a class that extends it. An abstract class gives none.       |

`no-series` and `orphan-series` are how you find a wrong `match`.

### Hand-authored panels

A generator writes an explicit list of hosts in each query (`job=~"node-rtr-a|node-hv-a|node-ctl-a"`). By hand, a new host would need an edit of every target. A hand-authored panel uses **open selectors** instead (`job=~"node-.*"`) and relies on the report. `orphan-series` shows a series that has no cell, and `no-series` a cell that has no series. The cap of 8 lines and of 50 orphan label sets keeps an open selector safe.

### Supported query results

Finite Grafana data frames with one numeric field per series support histories. Null gaps keep their meaning. Empty, single-sample, failed and stale histories show text. Logs, traces, legacy datapoint objects, streaming or partial frames, ambiguous numeric fields and invalid timestamps give a report entry. A query result does not inherit panel transformations or field overrides of other panels: use the field config of this panel.

Only the Prometheus and TestData plugins of the [tested matrix](docs/research/authoring-compatibility.md) have browser evidence.

### Old configs

This plugin has no migration code.

- **Version 3 and older.** A config with `"version": 3` or lower loads, the diagram renders, the panel binds nothing and shows one note: `This configuration has version 3. The panel reads version 4 only: write the config again as version 4.` Write the config again as version 4, or regenerate it.
- **Rules of version 1.** The option `rules` of version 1 is gone. A dashboard that still has it loads. The panel ignores the rules and shows one warning: `The panel ignores N rules of version 1. Write the bindings again as a version 4 config.` The saved value stays in the dashboard JSON until you remove it.
- **`editorUrl`.** An old value is ignored (see [Editor](#editor)).

Back up the dashboard JSON before you change a config.

## How colours and thresholds work

The panel has no colour settings of its own. It uses the standard field config of Grafana, as all Grafana panels do:

- **Standard options → Color scheme**: for example **From thresholds**, **Single color**, **Classic palette** or a continuous scheme such as **Green-Yellow-Red (by value)**.
- **Thresholds**: the steps and their colours.
- **Standard options → Min** and **Max**: the Y range of the charts (see [Sparkline Y range](#sparkline-y-range)). The field **Max** is not a link capacity (see [Capacity](#capacity)).
- **Overrides**: each of these settings for one query (**Fields returned by query**), one series name, or a regex. Use overrides to give each kind of link its own scale, for example a continuous scheme for the WAN query and thresholds for the LAN query.

For each link half and each status, the panel finds the matched series. Then it uses the field config of that series, with the overrides applied:

```text
matched series ─▶ field config (defaults + overrides)
                        │
        link half with a capacity?
          │ yes                                   │ no (and all statuses)
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
- A link half without a capacity, and every status: the colour is the normal display colour of the raw value, as in any Grafana panel. For example, an `up` query with the thresholds base red and 1 green colours a node green when it is up.
- No data: always grey, never green.

The overlay attribute `data-dmap-step` is the index of the active threshold step.

### Status band

A band above the diagram has one row for each status cause: the text of the status, the query and the number of cells, for example `Offline · up: 3 cells`. A cell with no value (text `–`) gives its reason in place of the text, for example `No data · up: 26 cells`. Cells with the same severity, text and query share one row. The most severe cause is first (down, critical, warning, stale, missing), then the cause with the most cells. Normal cells do not show in the band.

The band has at most **Status summary rows** rows (default 3), and at most half of the panel height. When there are more causes, the last row is `+N more (M elements)` (with one row: `N causes (M elements)`). Click it to show all causes; **Show less** collapses the band again. The band takes its own height above the diagram, so it never covers the diagram. The diagram fits into the remaining height. Set **Status summary rows** to 0 to hide the band. The paint of the cells stays.

### Status paint

The status of a cell paints the cell. The colour is the exact colour of the value in the field config of the `status` query (see [Status, colour and text](#status-colour-and-text)). Two states have the colour of the theme: `stale` is the palette orange and `missing` the grey of "no data". A `down` with no value (`missing: down`) is the palette red. The status band and the colour legend use the same colours.

- A device gets a border in the status colour, 1.5 times the stroke width the shape had and at least 2 units (in the units of the shape, which are the root units of a draw.io export), and a light tint of its fill: the fill the shape shows now, mixed with one fifth of the status colour. A fill that is not an opaque colour (none, a gradient, a transparent colour) keeps its fill; the border alone shows the status. The icon keeps its colour.
- A link takes the status colour on its stroke: both halves and their arrow heads, and the end dots, whatever the binding colours say. One exception: a `missing` status on a link with halves leaves the halves alone, because each half shows its own state (a half with no data is grey; the other keeps the colour of its value).
- A value that the field config maps to the colour `transparent` paints nothing. The cell keeps its drawn colour. A normal status with no colour paints nothing too.
- Limit: a link with no `up` or `down` (only a status) paints its stroke and end dots; the arrow heads that draw.io drew into the edge keep their colour. A device drawn as a bitmap (an `<image>`) gets the border only, as a rectangle around the image, and no tint.
- A theme change paints every cell again. When the status changes, or the cell leaves the bindings, the panel puts the drawn colours back. The panel repaints a cell when any of the colour, the text, the state, the severity, the query or the reason changes. A mapping that changes from green to blue with the same text repaints.

### Text on a cell

The class field `text` writes a formatted value into the label of the cell, with the unit and decimals of the field config (or the `unit` and `decimals` of the field). It changes no colour. A cell with no value shows `–`.

The icon of a node is the cell with `pg-kind="node-icon"` and `pg-of="<node pg-id>"`. Older portograph exports have no such tag. Then the panel uses the cell `pg-icon~<pg-id>`. Some icons are a white glyph on a tile (`pg-iconTile~<pg-id>`). Then the tile takes the status paint. A hover or a click on the icon or on the node description opens the card of the node. A hover on a link label (`pg-kind="link-label"` with `pg-of`, or `pg-linkLabel~<link pg-id>`) opens the card of the link. Each other cell with `pg-of` belongs to the node or link with that `pg-id`. Such sub-cells never open a card of their own.

### Colour legend

A small legend in a corner of the panel shows each colour that the bound cells can show now, with its threshold or its text. The panel makes it from the colour settings above. You do not configure the scales.

![Colour legend of the demo network](docs/images/colour-legend.png)

- One block for each status query in use, in the order of first use. The title is the **Display name** of the field, else the name of the query. The entries are the value mappings of the field config, then its threshold steps, each with its exact colour and text, and with the cells that show it. Then the blocks of the link scales: **Link load %** for links with a capacity, else the query name and the unit symbol, for example `PoE W`. Two different scales with the same title get their queries in brackets.
- **From thresholds**: one swatch for each step, from low to high: `< 60%`, `≥ 60%`, `≥ 85%`. Links with a capacity show percent. Other values show the field unit.
- A continuous scheme: a gradient bar from `0%` to `100%` for links with a capacity, else from the field **Min** to **Max**.
- **Single color** and **Shades**: one swatch, `All values`.
- Value mappings with a colour: one swatch with the mapping text, before the threshold swatches. A link with a capacity takes its colour from the percent, so its mappings do not show. A mapping with a colour and no text that shares the colour of a threshold step shows its cells under the step.
- **Classic palette** (a colour for each series): no block, because the colour does not tell a value.
- **State**: the block that follows the status blocks. It has `Down, no data` (the theme red of a cell with `missing: down` and no value), `Stale` and `No data`, each with the cells that are in that state.
- Identical scales merge into one block, also when they come from different queries. An override that changes the thresholds or the scheme of one query gives that query its own block.

Move the pointer on a swatch or a gradient bar, or focus it with Tab: the elements in that band stay visible and the other elements of the legend dim. Move the pointer away, or move the focus, to show all elements again. On a phone, which has no hover, tap an entry to show its elements. Tap the same entry again, or tap anywhere else, to show all elements again. The dim uses one CSS class on the diagram, so it is cheap on a large diagram. It does not change a pinned card or the link colour overlays.

**Legend rows inside the diagram.** A portograph diagram draws its own legend with one row for each node symbol (for example `router`). The panel links such a row to its nodes when the node cells carry the attribute `data-meta-pg-symbol` with the same symbol name as the row (`pg-legendRow~symbol:router` matches `data-meta-pg-symbol="router"`). Then the pointer, the keyboard focus (Tab) or a tap on the row, its swatch or its tile shows the nodes of that symbol, with their icons and descriptions, and dims the other nodes that have a symbol. A diagram without the attribute does not change: its rows do nothing. In the demo network, the provider and proxy nodes of the L3 diagram carry it.

![Elements below 60 % load highlighted](docs/images/legend-highlight.png)

The legend starts as a small chip with a colour swatch and the word **Legend**. Click or tap the chip, or focus it and press Enter or Space, to open the full legend. Click the **Legend** header again to close it. The pictures above show the open legend.

You can move the legend, closed or open, to any place in the panel:

- Drag the header with the mouse or a finger. A move of less than 4 px is a click. A drag does not open or close the legend, does not pan or zoom the diagram and does not open a card.
- With the focus on the legend, the arrow keys move it by 10 px. Shift with an arrow key moves it by 50 px.
- Double-click the header, or press Home, to put it back in its corner.

The legend never leaves the panel, also when you make the panel smaller. The **Corner** option sets the place where it starts. The place and the open or closed state are not saved: a reload shows the legend again as the options say.

The legend stays in its place when you zoom, pan or scroll the diagram. In the top-left corner, it starts below the **Reset zoom** button and the warning badge, and below the status band. In the top-right corner, it starts below the area of the Grafana panel menu button. It catches the pointer only inside its own box. It is above the diagram and below the hover cards.

The options are in the **Legend** group:

| Option          | Path               | Meaning                                                                    |
| --------------- | ------------------ | -------------------------------------------------------------------------- |
| Show legend     | `legend.show`      | Default on.                                                                |
| Corner          | `legend.corner`    | `bottom-right` (default), `bottom-left`, `top-left` or `top-right`.        |
| Maximum scales  | `legend.maxBlocks` | The legend shows at most this number of blocks, then `+N more`. Default 4. |
| Start collapsed | `legend.collapsed` | Default on: the legend starts as a chip. Off: it starts open.              |

A saved panel without `legend.collapsed` starts collapsed.

In the panel JSON:

```json
{ "legend": { "show": true, "corner": "bottom-right", "maxBlocks": 4, "collapsed": true } }
```

### Capacity

A link has a capacity for each geometric direction, a→b and b→a. For each direction the panel uses the first source that gives a value:

| Order | Source                | Example                   | Notes                                                                                                                                                  |
| ----- | --------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | A series (`capacity`) | `capacity: speed`         | A refId, or `{ a2b: speed_a, b2a: speed_b }`. The class `match` selects the series. The unit of the field converts the value to bit/s (`Bps` times 8). |
| 2     | The attribute `cap`   | `cap=1G` or `cap=50M/10M` | `1G` is 10⁹ bit/s for both directions. `50M/10M` is 50 Mbit/s a→b and 10 Mbit/s b→a.                                                                   |
| 3     | None                  |                           | The half shows the raw rate and no percent.                                                                                                            |

The panel uses a `capacity` series only when its query is ready and exactly one series gives a finite value above 0 in a rate unit. Else it falls through to `cap` and the report has `capacity-fallback` with the reason: no series, many series, not positive, not finite, not a rate, query failed. A `cap` that does not parse gives `bad-cap` and no capacity for that cell. One value is a number with an optional `k`, `K`, `M`, `G` or `T` (SI, decimal): `^\d+(\.\d+)?[kKMGT]?$`.

The capacities follow the geometry. `at=target` changes only which counter feeds which direction, not the capacities. Example: `cap=50M/10M`, `at=target`, rx 8 Mbit/s: a→b shows 8 Mbit/s and 16 %. The field **Max** is not a capacity.

The hover card shows the capacity of each half in the unit of the value field, for example `41 Mb/s · 41% of 100 Mb/s`; a field in `Bps` with a capacity of 1 Gb/s shows `… of 125 MB/s`. The percent is a whole number: a load above 0 and under 0.5 % reads `<1%` (never `0%`), a real 0 reads `0%`, a load above 999 % reads `>999%`. The percent and the colour do not depend on the unit. Without a capacity, the card shows only the value. A direction without a value is grey "no data", also with a capacity: a capacity never produces a value or a percent on its own.

The units are the data-rate units of Grafana: `bps`, `Kbits` … `Pbits`, `Bps`, `KBs` … `PBs`, and the binary (IEC) forms. A field without a unit is in bit/s. A `capacity` series in a unit that is not a data rate falls through (`capacity-fallback`, "not a rate").

A direction with no series is its own grey half, "no data"; the other half keeps its colour.

The demo dashboard uses both sources: the LAN links take the port speed series `speed`, and the WAN and tunnel links carry `cap=100M`.

### Link value labels

Each link half can show its load as a small text beside the stroke, in the middle of its own half, turned to follow the edge. The text is the one the hover card shows for that direction. The labels are off by default; the class field `linkLabel` turns them on:

```yaml
classes:
  lan:
    linkLabel: percent
```

| Mode      | Half with a capacity               | Half without a capacity | No data  |
| --------- | ---------------------------------- | ----------------------- | -------- |
| `percent` | the percent of its capacity, `41%` | the value, `3.1 Mb/s`   | no label |
| `value`   | the value in the unit of its field | the value               | no label |
| `none`    | no label (the default when absent) | no label                | no label |

`linkLabel` is one field: a subclass or an override replaces the mode, and an override with `linkLabel: none` switches one link off. A generator sets `percent` on its link classes. There is no panel option.

Placement: the label stands first on its own stroke, in the middle of its half. The stroke stops under the text: the panel cuts the stroke of the link (its halves and arrow heads) with an SVG mask, a hole as long as the text (plus 1.5 units on each end) and as wide as the drawn width plus 1 unit on each side. The cut shows whatever lies behind the stroke, so it needs no colour and it is the same in every theme; no box is drawn. When the stroke is not free on the whole half, the label stands beside it, with the near edge of its box 2 units beyond the stroke edge at its widest (`linkWidth.max`); a chip or a pill that is wider than the stroke can need 4 units, and the label takes 4 then. A label has a thin halo (1 unit outside the glyphs, behind them) in the background colour of the diagram: the computed `background-color` of the svg root, resolved for the colour scheme of the panel, else the canvas colour of the Grafana theme when the diagram has no background. The stroke of its own half is cut under it. The frame line of a group is not an obstacle: the halo keeps the text readable over it. The top side is the side the tops of the letters face: above a horizontal edge, to the left of a vertical one (the text reads bottom to top), and on a diagonal edge the side of the text top (the text is never upside down). Both halves of a link stand in one place: first both on their strokes, then both on the top side, then both on the bottom side, and only when no single place holds both, each half takes its own. A label moves along its half, away from the arrow heads first, when a node, a plain text cell, the text of an edge (its own value text or an edge label cell, also of the edge that the label belongs to), a port pill, a portograph label chip, an end dot, an arrow head (at the size it has at `linkWidth.max`, so a wider half on a refresh never grows its head under a label), another edge (or a crossing run of its own edge) or another label is in its way; only the stroke of its own half is not in its way, never the text of its edge. As a last resort, a half that fits nowhere can stand beside a bend, with its centre on a straight run and the box over the end of the run, if the label is clearly nearer to its own stroke than to any other link. On a link so short that every spot beside the stroke meets an arrow head at its widest, the label stands farther out, 4 units beyond the wings of the widest head. It is dropped when its half is too short or every spot is taken. Backgrounds are not in the way: the portograph canvas and groups (but the title text of a group or container is), and in a plain draw.io diagram a vertex whose body holds two or more other vertices (a container or a swimlane; a device with one badge inside stays in the way). The placement runs once per diagram: a data refresh changes the text only. A percent label keeps one slot from `<1%` to `>999%`; a value label can move when its text grows past a 4-unit step, and only that label moves.

On a phone or a small panel the labels hide when a glyph would be smaller than 7 CSS px (a 1900 px sheet fitted into a 390 px screen), and show again after a pinch. A **Minimum scale** of 1.3 or more shows them at load. A tap on a label opens the card of its link.

## Hover card

The canvas shows only colours. The values show in a card:

| Action                             | Result                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Move the mouse on a link or a node | The card shows near the pointer. It goes away when the pointer leaves the cell.                      |
| Click a cell                       | The card stays (it is pinned). It has a close button (✕), clickable rows and the footer links.       |
| Click another cell                 | The pinned card moves to that cell.                                                                  |
| Esc, ✕, or a click outside         | The pinned card closes.                                                                              |
| Tap a cell (phone, tablet)         | The card opens pinned. Devices without hover (`(hover: none)`) do not open a card on a pointer move. |
| Tab to a cell, then Enter or Space | The card opens pinned. Esc closes it and the focus goes back to the cell.                            |
| Move over a chart in a pinned card | A crosshair and the Grafana tooltip show the time and the value of each series (see below).          |

**Chart tooltip.** In a pinned card, move the pointer over a chart: a crosshair follows the pointer and the standard Grafana tooltip shows the time of the nearest sample, and the colour, name and value of each series. The values use the unit and decimals of the field. A gap shows "–". An `updown` row shows both directions in one tooltip. A row with N lines lists the lines (at most 8) and then "+N more"; a line with no value shows "No data". On a phone, tap or drag on a chart in the sheet; the tooltip stays until you tap outside the chart. With the keyboard, Tab to the chart in a pinned card, then use the left and right arrow keys to move the sample; Esc hides the tooltip (a second Esc closes the card). The tooltip does not change the Y range. The hover card that is not pinned shows no tooltip.

The card stays inside the panel. It scrolls when it is too long. In a panel narrower than 480 px (a phone), the card is a sheet at the bottom of the screen, with the width of the panel. The sheet stays visible also in a panel that is taller than the screen. It is at most 60% of the screen height, scrolls when it is too long, and keeps clear of the home indicator (the safe-area inset). The sheet is above the Grafana menus. ✕, Esc or a tap outside the panel and the sheet closes it. The page does not move when the sheet opens.

### Which cells open a card

A cell opens a card only when both conditions are true:

- The kind of the cell is in the **Hover kinds** panel option (group **View**, option path `hover.kinds`). The default is `node`, `link`, `port` and `other`.
- The card has content: at least one row (a status, a value, a history or a metadata row) or one footer link (the `url` of the class, a `drilldown` row, or a data link of the field config).

Thus by default the empty background (`pg-canvas`), the layers, groups (`pg-group~…`, `pg-groupTitle~…`), the legend (`pg-legend…`) and cells without bound rows or links open nothing.

Only the cells that open a card show the hand cursor and are in the Tab order. Their parts (the icon, the description and the link label) also show the hand cursor, because they open the card of their node or link. All other cells show the default cursor.

| Kind         | Cells                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `node`       | `pg-kind="node"`. In a plain draw.io diagram (no `pg-schema`): each vertex.                            |
| `link`       | `pg-kind="link"`. In a plain draw.io diagram: each edge.                                               |
| `port`       | `pg-kind="port"`.                                                                                      |
| `link-label` | `pg-kind="link-label"`.                                                                                |
| `group`      | `pg-group~…` and `pg-groupTitle~…`.                                                                    |
| `canvas`     | `pg-canvas`, `pg-layer~…`, and the draw.io root and layers (cells that draw nothing of their own).     |
| `legend`     | `pg-legend…`.                                                                                          |
| `other`      | Other `pg-` cells and cells with another `pg-kind`, for example a chart anchor with `pg-kind="other"`. |

In the panel JSON, the option is:

```json
"options": { "hover": { "kinds": ["node", "link", "port", "other"] } }
```

To remove the card of one cell, give it a class (or an override) with no `rows`, no `url` and no `status`.

**Card title.** The card, the keyboard label of the cell and the lists in the editor use one readable title for each cell. In a portograph export (a diagram with `pg-schema`):

| Cell | Title                                                                                                                                                                                                                                                                                          | Example              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Node | The label.                                                                                                                                                                                                                                                                                     | `Switch-A`           |
| Port | The label of the node and the label of the port.                                                                                                                                                                                                                                               | `Switch-A p9`        |
| Link | The two ends, each as a node label plus a port label (a port end) or a node label (a node end). The label of the link is not part of the title, unless both ends read the same. Then it follows in parentheses (`A ↔ A (ch1)`), or, without a label, the two end ids (`A (e-cam) ↔ A (c-ch)`). | `Switch-A p9 ↔ AP-1` |

A part or a structure cell of a portograph export uses the caption that the diagram shows:

| Cell                                       | Title, first match wins                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Icon, icon tile, node description          | The title of their node (`pg-of`, else the id after `pg-icon~`, `pg-iconTile~`, `pg-nodeDescription~`). |
| Group (`pg-group~X`)                       | Its own label, else the label of `pg-groupTitle~X`, else the readable id.                               |
| Group title (`pg-groupTitle~X`)            | Its label, else the label of `pg-group~X`, else the readable id.                                        |
| Legend body, tile, swatch (`pg-legend…~X`) | The label of `pg-legendRow~X`, else the readable id. A legend row uses its own label.                   |
| Layer, legend frame                        | Its label (layers draw none), else the readable id.                                                     |

A missing label falls back to the node id and the port name (`pg-node`, `pg-port`), then to the `pg-id` as written, or the cell id without its `pg-…~` prefix when the cell has no `pg-id`. A cell that is not in a portograph export (no `pg-schema`) has its label, else its id. The title is not configurable. A cell attribute named `title` does not change it.

A card row has a head line and a sparkline below it. The head line has a colour dot, the title and the current value with its unit (for example `isp-a → rtr-a   41 Mb/s · 41%`). The title of a row is its `label`, else the display name of the field, else the refId. The sparkline has the full width of the card. Its Y range starts at 0 for a series without negative values (see [Sparkline Y range](#sparkline-y-range)). Its time axis is the part of the dashboard time range that has data, so the line goes from edge to edge also when the series starts late. Below the sparkline, muted text shows the min and the max of the series.

The first row of a cell whose status is not `normal` is the state and its reason, for example `warning   probe delay ≥ 400 ms`. The state word has a text-safe colour of its status (red for down and critical, orange for warning and stale, grey for missing). A `normal` status adds no row to a card that has other rows. Then come the rows of the class in their order. The footer has the `url` of the class (title: `urlTitle`), then the data links of the field config of the series of the cell (title: the data link title), then the `drilldown` rows. A data link takes the last value in the frame of its series as its context (`${__value.text}`). A link with the same `href` as an earlier link shows once. A link that opens in a new tab has an external-link icon.

The pinned card is a dialog (`role="dialog"`) and gets the focus. The ✕ button is a normal button. Each bound cell is a button for the keyboard (`tabindex="0"`). The panel builds the card only when it opens, and only for one cell.

## Zoom options

In the **View** group of the panel options:

| Option               | Meaning                                                                                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zoom: Fit            | The whole diagram fits in the panel. This is the default.                                                                                                                                                                                    |
| Zoom: Fit width      | The diagram has the panel width. The panel scrolls vertically.                                                                                                                                                                               |
| Zoom: Original       | The diagram has its original size.                                                                                                                                                                                                           |
| Zoom: Custom, Zoom % | The diagram has the size that you set in percent.                                                                                                                                                                                            |
| Minimum scale        | Fit and Fit width only. Do not shrink below this scale in Fit modes; the panel scrolls instead. 1 = 100%. Default 0: off. See [Minimum scale](#minimum-scale).                                                                               |
| Align                | Fit only. **Top** (default): when the panel is taller than the diagram, the diagram is at the top. **Center**: it is in the middle. The diagram is always centred horizontally.                                                              |
| Wheel zoom           | The mouse wheel zooms the view. Off by default.                                                                                                                                                                                              |
| Drag pan             | A mouse drag moves the view. Off by default.                                                                                                                                                                                                 |
| Link width min, max  | The range of the link width in pixels. The width grows with the load. The arrow head grows with the width: 8 by 8 units up to a 2-unit half; above, each unit of width adds 2 to its base and 0.5 to its length (24 wide and 12 long at 10). |
| Hover kinds          | The cell kinds that open a card (see [Which cells open a card](#which-cells-open-a-card)). Default: node, link, port, other.                                                                                                                 |
| Status summary rows  | The maximum number of rows in the status band above the diagram (see [Status summary](#status-band)). Default 3. 0 hides the band.                                                                                                           |

### Live zoom

You can zoom and pan the view of the panel. The live zoom does not change the saved panel options.

| Gesture                            | Result                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Pinch with two fingers             | Zooms around the point between the fingers. A move of the two fingers pans.                                                       |
| One finger, at the configured zoom | Scrolls the page, or the panel when it scrolls. A tap opens the card.                                                             |
| One finger, when zoomed            | Pans the view. A tap (less than 6 px of movement) opens the card. On a chart region, it reads the chart values and does not pan.  |
| Trackpad pinch (Ctrl+wheel)        | Zooms around the pointer. This is always on.                                                                                      |
| Mouse wheel                        | Zooms only when **Wheel zoom** is on. Else it scrolls the panel or the page.                                                      |
| Mouse drag                         | Pans when the view is zoomed, or at all times when **Drag pan** is on. This also applies to a drag that starts on a chart region. |

The scale stays between 0.2× and 10× of the configured zoom. When the view is not at the configured zoom, a **Reset zoom** button shows in the top-left corner of the panel, below the status band and above the legend (top-left corner). The top-right corner stays free for the Grafana panel menu button. The warning badge is next to the button. Click or tap it to go back to the configured zoom; a panel that scrolls goes back to its top-left corner. A new panel size or a new **Zoom** option also resets the view.

The panel sets `touch-action: pan-x pan-y` at the configured zoom: one finger scrolls the page, and the browser does not pinch-zoom the page over the panel. When the view is zoomed, the panel sets `touch-action: none` and takes all touches. A two-finger `touchmove` calls `preventDefault()`, so the page does not scroll while you pinch.

![Zoomed view with the reset button](docs/images/zoomed-reset-button.png)

### Minimum scale

A large sheet in a narrow panel can make the labels too small to read. For example, a 1900 px sheet in an 860 px panel shows 11 px labels at 5 px. Set **Minimum scale** to keep the labels readable:

```json
{ "zoom": { "mode": "fit-width", "minScale": 1.3 } }
```

- The panel calculates the Fit or Fit width scale as usual. When that scale is less than **Minimum scale**, the panel uses **Minimum scale**.
- When the diagram is then larger than the panel, the panel scrolls horizontally, vertically or in the two directions. The diagram starts at the top-left corner. When the diagram is narrower than the panel, it stays centred horizontally.
- Fit width with a minimum scale: the diagram height is the sheet height × the scale.
- The status band stays above the area that scrolls. Cards open at the pointer also after a scroll.
- At the configured zoom, the mouse wheel and one finger scroll the panel. At the end of the panel, the page scrolls. The live zoom works as before: the **Reset zoom** button goes back to the minimum scale view.
- 0 (the default) turns the option off.

## Editor

The plugin includes the draw.io editor (`dist/drawio`). Edit mode opens it in an iframe inside a modal, in embed mode. The iframe has an opaque origin, so the editor cannot reach the Grafana page (see `docs/security.md` and `docs/adr/0001-bundled-editor-opaque-origin.md`). Earlier editor checks cover the frontend sandbox, `content_security_policy = true`, and `app_sub_url`; current authoring coverage is recorded separately. The plugin has no option for another editor URL. An `editorUrl` value that an older version saved is ignored. No draw.io code loads in view mode.

Before the modal makes the editor frame, the panel reads `drawio/js/main.js` of the plugin. If Grafana does not send that file as JavaScript (for example a 404 for a build without `dist/drawio`), the modal shows "The draw.io editor is not installed with this plugin build (dist/drawio is missing)." and a Close button. To repair the build, run `npm run build`: it puts draw.io in `dist/drawio`. If the editor does not open its channel to the panel in 15 s, the modal shows an error and stops to wait. The modal does not try again: close it and open the editor again. A dashboard refresh does not change an open editor.

![Diagram options](docs/images/options-diagram.png)

## Grafana 12 and 13

The plugin targets Grafana `>=12.4.0` and builds against `@grafana/*` 12.4.x. React comes from Grafana (it is not bundled). The authoring matrix and its evidence are in [authoring compatibility](docs/research/authoring-compatibility.md). The v4 checks and the earlier PoC results are in `docs/acceptance.md`.

## Development

```bash
npm run dev               # webpack in watch mode
npm test                  # Vitest unit tests (jsdom, real SVG fixtures)
npm run typecheck && npm run lint
npm run check:bundle      # fails if draw.io runtime code is in the bundle
npm run e2e:12            # Playwright project `matrix` on Grafana 12 (the stack must run)
npm run e2e:13            # Playwright projects `matrix` and `plugin` on Grafana 13
npm run e2e:matrix        # both: the version split suite
npm run e2e:webkit        # the WebKit check of the card tooltip on Grafana 13
npm run e2e:release       # everything on both versions, then the WebKit check (before a tag)
npm run stack:wait        # wait for the demo series, Grafana health and the plugin (bounded, no fixed sleep)
npm run package           # artifacts/simnv-drawiomap-panel-<version>.zip (run npm run build first)
npm run ci:local          # all CI steps in order: install, checks, build, package, e2e (the version split) on both versions
npm run build:dashboard   # rebuild provisioning/dashboards/demo.json
./scripts/export-fixtures.sh   # export fixtures/{demo,hand}/*.drawio to fixtures/demo/svg/*.svg
```

Two benches, not in CI. The history bench prints ms and KB per pass of 300 cells for the history cache, the frame scan, the boundary copy, `historySeries` and 600 store resolves; run it alone, with the GC held. The card bench records a Chromium trace of 20 hovers on the demo dashboard and prints the pointermove task times, the chart commit and the top self-time functions; it needs the stack and the built plugin.

```bash
DMAP_BENCH=1 NODE_OPTIONS="--expose-gc --max-semi-space-size=512" npx vitest run src/query/history.bench.test.ts --maxWorkers=1
GRAFANA_URL=http://localhost:3013 node scripts/bench/card-hover.mjs
```

The demo network in `fixtures/demo/` is fictional. Its `.yaml` sources are portograph input; `npx portograph render fixtures/demo/demo-l3.yaml --format drawio --output fixtures/demo/demo-l3.drawio` makes the `.drawio` file again.

The acceptance results are in `docs/acceptance.md`. The decision records are in `docs/adr/`.

### E2E suites

`playwright.config.ts` has two Chromium projects. The split follows the surface that a test depends on:

- `matrix`: the tests on surfaces that differ between Grafana versions: the panel edit page and the options pane, the dashboard save API, the datasource query editors, the dashboard refresh in panel edit, field config and overrides, the theme, plugin and chunk loading. They run on 12.4 and on 13.2. A whole spec file is in `matrix` when it is in the list `MATRIX_SPECS` in `playwright.config.ts`. A single test is in `matrix` when it has the tag `@matrix` (`test(title, { tag: '@matrix' }, fn)`).
- `plugin`: every other test, that is, the tests on the DOM that the plugin draws itself. They run on 13.2 only. A regression in this DOM on 12.4 only is found by `npm run e2e:release`.

`npm run e2e:12` runs `matrix`; `npm run e2e:13` runs `matrix` and `plugin`; `npm run e2e:release` runs both projects on both versions and then the WebKit check. Pass a spec file after `--` to run one spec, for example `npm run e2e:13 -- tests/links.spec.ts`. Use `--project=name` with an equals sign: `--project name` takes the next file name as a project.

Playwright does not call a vertical or horizontal link half visible, because its polyline has no width or height. Use `hoverHalf` and `pointOnHalf` from `tests/authoring-controls.ts` to hover or click a half. They wait for a layout box and use the mouse.

### Unit test projects

`vitest.config.ts` has two projects. `npm test` and `npm run test:affected` run both. Pick the project by the file name:

- `logic`: a plain `src/**/*.test.ts` file. It has no `render`, no `vi.mock` and no `@grafana/ui`. The project runs on the threads pool with `isolate: false`: the files of one worker share their module registry, so the import of `@grafana/data` is paid once for each worker and not for each file. Each file still gets its own jsdom document. `vitest.setup.logic.ts` resets the body, the root attributes, the storage, the timers and the query sessions after each test. A test in this project must not leave module state behind.
- `components`: every `src/**/*.test.tsx` file, the `.ts` files that mock modules (`src/module.test.ts`, `src/query/grafana.test.ts`), and the `.ts` files that reach DOMPurify (`portograph`, `setCellAttrs`, `harness`, `applier`, `sanitize`, `sanitizeCache`, `svgStage`). Node loads DOMPurify once for each worker and binds it to the jsdom window of the first file that imports it, so in the next file `sanitize` returns null. To make this failure independent of the file order, `vitest.setup.logic.ts` mocks `dompurify` with an error: a logic file that reaches it always fails. Each file has its own process, jsdom and module registry, so mocks and mounted trees cannot leak.

A new `.test.ts` file that needs `vi.mock`, `@grafana/ui` or `sanitizeSvg` goes in the `componentTests` list in `vitest.config.ts`. Put polyfills in `vitest.polyfills.ts` (a function that each setup file calls: a setup file runs for every test file, a module that it imports runs once for each worker). Run one project with `npx vitest run --project logic`. After you change the logic setup, run it once with `--sequence.shuffle` to find order dependence.

### Git hooks

Run `npm run hooks:install` once for each clone. It sets `core.hooksPath` to `.githooks`.

- `pre-commit`: the privacy check on the staged diff, then `npm run typecheck` and `npm run lint` when code files are staged.
- `pre-push`: the privacy check on the pushed commits, then `npm test`.

The privacy check prints `file:line` only. It uses generic patterns (home paths, MAC addresses, private IPv4 outside the demo ranges in `.githooks/privacy-allow.txt`) and the private terms in `~/.config/simnv-drawiomap-panel/denylist` (set `SIMNV_PANEL_DENYLIST` to use another path). Without that file only the generic patterns run. `npm run check:privacy` scans all tracked files. CI runs the generic patterns in the `privacy` step of `build.yaml`.

### CI

Woodpecker CI (v3, docker backend) runs the workflows in `.woodpecker/` on push, pull request and manual events:

1. `build.yaml`: `npm ci`, typecheck, lint, unit tests, build, `check:bundle`, `package`. The last step shows the plugin zip and its sha256. There is no cache: each run downloads the pinned draw.io release (about 46 MB from github.com) and `scripts/vendor-drawio.sh` checks its sha256.
2. `e2e.yaml` (after `build`): one workflow for each Grafana version of the matrix `GRAFANA` (12.4.13, 13.2.4, the same images as `docker-compose.yaml`). The step `build` builds the plugin and runs `scripts/ci-grafana-files.sh`: it copies `dist/` and `provisioning/` to `ci/` in the workspace. The detached steps `victoriametrics`, `metrics-gen` and `grafana` start the stack. The step name is the hostname. Grafana reads the plugin and the provisioning from the workspace (`GF_PATHS_PLUGINS`, `GF_PATHS_PROVISIONING`). The step `wait` runs `scripts/wait-stack.sh` with `VM_URL=http://victoriametrics:8428` and `GRAFANA_URL=http://grafana:3000`. The step `e2e` runs Playwright in `mcr.microsoft.com/playwright`, with the same version as `@playwright/test`. It runs the project `matrix` on Grafana 12.4 and the projects `matrix` and `plugin` on 13.2 (see "E2E suites"). CI does not run the WebKit check.

The steps do not use the docker socket, volumes, privileged mode or secrets. The repository does not have to be trusted. The steps need access to registry.npmjs.org, github.com and raw.githubusercontent.com (draw.io release and its LICENSE).

`npm run ci:woodpecker` runs both workflows with `woodpecker-cli exec` (image `woodpeckerci/woodpecker-cli:v3`) on the local docker. It copies the files of the working tree (without ignored files) to `~/.cache/wp-ci/repo`, so `node_modules` and `dist/` of your checkout do not change. `npm run ci:woodpecker -- .woodpecker/build.yaml` runs one workflow only. `e2e.yaml` runs only together with `build.yaml`: `woodpecker-cli exec` removes a workflow when its `depends_on` workflow is not in the same run.

`npm run ci:local` runs the same steps without Woodpecker. Its e2e steps use the compose stack. `SKIP_INSTALL=1` keeps `node_modules`. `SKIP_E2E=1` stops after the package step. The e2e steps stop the compose stack at the end (`docker compose down -v`).

## Known limits

Authoring evidence: 2026-10-18, in `docs/research/authoring-compatibility.md`. The v4 checks and the earlier PoC results are in `docs/acceptance.md`.

- No signing and no catalogue entry.
- No rules embedded in the diagram (`pg-rules`).
- No animated flow.
- No diagrams loaded from a URL.
- No multi-page diagrams. The panel renders page 1 and binds page 1 only. The **Diagram** options show a warning when you import or paste a file with several pages.
- The panel reads the portograph contract version 1 only (`pg-schema="1"` on the root cell). A diagram with a higher version shows a warning in the **Diagram** options; the panel reads its cells as version 1. A diagram without `pg-schema` is not a portograph export: the panel ignores its `pg-kind`, `pg-id`, `pg-from` and `pg-to` attributes. The cells join a class with `bind`, and the ends of its edges come from the `source` and `target` of the stored XML.
- Consult the authoring compatibility matrix for current browser and sandbox evidence.
- Panel edit can run the panel queries many times. This is not the panel: in the VictoriaMetrics datasource plugin (seen with 0.26.1), each query editor calls `onRunQuery` when it mounts and starts a label lookup. A panel with N VictoriaMetrics targets runs all its queries N+1 times when panel edit opens. The target JSON has no workaround.

## Licence

Apache-2.0. See `LICENSE`.
