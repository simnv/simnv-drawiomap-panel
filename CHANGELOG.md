# Changelog

## 1.5.0 (Unreleased)

- Added the last data timestamp: the time of the newest sample of the panel data, at the bottom of the panel beside the legend. The text has the date with the year, the time and the UTC offset in the dashboard time zone, for example `2026-10-31 14:32:05 +01:00`. Its tooltip says "Last data timestamp" and gives the time zone name and the age. The new option **Show last data timestamp** (`legend.timestamp`, group **Legend**) is on by default, also for saved panels without it. The timestamp and the legend share the bottom row and never overlap at their start places, also on a narrow panel and on a phone.
- Changed the **Zoom**, **Align** and legend **Corner** options to rows of icon buttons with tooltips. They fit the narrowest options pane. The saved values do not change.
- Renamed the **Open editor** button of the **Diagram** options to **Edit in draw.io**. A panel without a diagram still shows **New diagram**.
- Changed the match report of the split editor: one tab for each class, and a tab **Not in a class** for the other entries. The tab label counts the entries. The cursor in a class and a selected cell open the tab of their class. The arrow keys, Home and End move between the tabs.
- Changed the size of the **Edit bindings** dialog to the size of the draw.io dialog: 96 % of the window width and 94 % of its height, in the middle. A phone still shows a full-screen sheet.
- Made each data refresh faster. The panel reads one series of one frame with no copy and no sort, and it skips the alignment of a link direction with one series. It computes the expected sample step once for each query, not once for each cell. On a diagram with 100 links and 1,000 points for each series, the bind takes about 16 ms instead of about 190 ms.
- Made the link overlay faster. The drawn width of a link half moves in steps of a quarter unit (the configured minimum and maximum stay exact), so a small change of the load does not compute the arrow outline again. The geometry caches have a size limit: a dashboard that stays open for days no longer uses more memory with each refresh. A link value label keeps its place when its text changes by less than one grid step.
- Made pan and zoom smoother. A pan or a wheel zoom writes the view directly and updates the panel state only at the end of the gesture. One observer for each chart layer replaces one observer for each chart. With 20 sparklines a wheel step takes about 2 ms instead of about 31 ms.
- Made the first paint of a large diagram faster. A diagram larger than 256 KB is prepared after the first frame, and the panel stays empty until the diagram is ready. The panel never shows one diagram with the bindings of another.
- Made the draw.io editor open faster: the panel preloads the editor scripts. A cold open takes about 0.5 s instead of about 0.9 s on the test stack. The editing code loads only when a user edits, and the panel no longer needs the `zod` library, so a dashboard viewer downloads about 18 % less plugin code (`module.js`, about 85 KB instead of about 104 KB with gzip).
- Made the split editor faster on large diagrams: a click changes only the cells that change. The editor reads the YAML 150 ms after the last keystroke, and at once on blur, Apply, Ctrl+S and close. The **Bindings** YAML box of the options pane still stores each valid keystroke at once.
- Made the plugin zip smaller: about 19 MB instead of about 22.6 MB. The vendor script removes the draw.io files that the embedded editor never loads (development bundles, standalone copies of libraries that the main editor bundle already contains, and the language files: the embedded editor has no language menu).
- Fixed the hover card and the phone sheet: the value line of a combined up/down row no longer clips at the right edge. A line that is too wide wraps between the up and the down part. The row title stays visible.

## 1.4.0 (Unreleased)

- Added the class and cell override field `arrow`: `point`, `triangle` or `none`. A subclass inherits the style through `extends`.
- Changed the default link head to `point`. Its base equals the drawn stroke width and has no wings. Saved configs that omit `arrow` use this default.
- Set `arrow: triangle` to keep the head with wings used before 1.4.0. Set `arrow: none` for a flat end with no direction mark.
- The split editor completes the `arrow` key and its values. Hover text explains each style and the default.
- The match report flags `arrow` on a node class. Link labels reserve the selected head shape, including a bent point.

## 1.3.1 (Unreleased)

- Changed the link load scale of the colour legend: its threshold steps show as one bar with a segment of the same width for each step, hard colour stops between the segments and the step values under the bar. Before, each step was a separate swatch (`< 60%`, `≥ 60%`, `≥ 85%`). Each segment still highlights the links of its step on hover, on focus and on a tap. The collapsed chip shows the same hard stops. The link load bar no longer merges with a status block that has the same steps.

## 1.3.0 (Unreleased)

This version removes the option `legend.maxBlocks`. The panel ignores a saved value.

- Changed the colour legend: blocks with the same content (the same texts and colours in the same order, the same gradient) merge into one block. Its title lists the queries, joined with ` · `. The pointer or the focus on an entry highlights the cells of all these queries.
- Changed the title of a status block in the legend: it is the **Display name** of the field config, else the query name (refId). Before, it could be the name of one series from the legend format, for example `scrape_up node-rtr-a`.
- Removed the legend option **Maximum scales** (`legend.maxBlocks`) and its `+N more` line. The legend shows all blocks and scrolls.
- The **Edit bindings** button in the panel corner shows its text next to the link icon.
- The **Edit bindings** button of the options pane moved from the **Diagram** group to the **Bindings** group, above the YAML.
- Link value labels use a font size of 9 (was 8): no text that the panel draws on the diagram is smaller than 9. The labels hide below 7 CSS px per glyph, as before, so they now show from a view scale of 7/9.

## 1.2.2 (Unreleased)

- Fixed links that Safari stopped drawing after the dashboard was open for a long time with the tab in the background (both halves and the arrow heads went, and came back later or on a reload). Each link with a value label on its stroke had an SVG `<mask>` that cut the stroke under the text, and only such links went. The cut is now a gap in the dash pattern of the half: no mask, no `url(#id)` reference.

## 1.2.1 (Unreleased)

- Fixed link value labels that stood far from their link. On a short link a label stands beside the arrow head of its half as it is drawn, not beyond the widest head: at a low load it is 8 units nearer, and it moves out when the head grows. When the text of a link or another obstacle sends one half away from its stroke, the other half stays on its own stroke if it is free there.
- Fixed a false `class-no-cells` warning for a base class when a cell binds a class that extends it, directly or through a chain.
- Fixed a second XML declaration in the saved diagram after a write in the split editor in Chromium: the browser serializer writes the declaration of the document, and the panel added the saved one again. Draw.io and `gen_drawiomap pull` refuse such a document.

## 1.2.0 (Unreleased)

The 1.1.0 tag comes first: do not release 1.2.0 before it.

- Added a split bindings editor with a live diagram, match report and cell inspector. Open it with **Edit bindings**.
- The cursor in the YAML highlights the affected cells. A click on a cell opens its inspector and moves the cursor to its class or override.
- The inspector writes `bind` and `key` for one cell. **Assign class** sets `bind` on several selected cells and keeps their keys.
- On an edge, **key is at the target** sets or clears `at=target`. On a generated panel the inspector warns that the generator writes `at` again.
- The writes change page 1 of the diagram, in XML and SVG. They need an uncompressed page 1.
- **Undo** and **Redo** keep up to 50 diagram versions. **Apply** saves the config and the diagram together. A save in another tab shows a conflict banner.

## 1.1.0 (Unreleased)

Binding model v4. This is the first version that reads the v4 config. A config of version 3 or older binds nothing: the diagram renders, the panel shows one note, and you write the config again as version 4 (or regenerate it). There is no migration. Regenerate the dashboards of a generator in the same change as this release.

- A cell joins a class with its attribute `bind`. The attributes `key`, `port` and others select the series of the cell, with a matcher (`=`, `!=`, `=~`, `!~`, a list) in a fixed regex dialect. The classes and the cell overrides are in the panel option `config`. See [Bindings](docs/guide/bindings.md).
- The status colour and text of a cell are the exact colour and text of the field config of the `status` query. A healthy value can keep the drawn colour with the colour `transparent`. A missing value is grey "no data", never a good state.
- A link takes `up` and `down` queries for its two halves; the attribute `at=target` flips them. The capacity of a link is a `capacity` query, else the attribute `cap` (`1G`, `50M/10M`), else none. The field Max is no longer a capacity.
- A `history` row or chart draws up to 8 lines in one Y range and then "+N more". A `value` chart is a bar gauge. A cell turns stale on the clock when its newest sample is too old, with no new data.
- The match report names the cells with no series, the series with no cell and each config error with its YAML path. The warning badge shows its count.
- New option **Bindings**: a YAML editor for the config. It loads in its own chunk, so view mode loads no YAML parser. The panel stores the config as JSON; YAML comments are not kept.
- A dashboard variable in a link keeps its place: the panel encodes each cell value and each bare `$name`, and `${name:format}` selects a Grafana format (`${job:queryparam}`).
- The panel reads page 1 of a diagram only, and binds page 1 only.
- Removed: the bindings popup, the pattern selectors, the named queries, the combined row, the `display` settings and the v3 config. The popup results are archived in `docs/archive/acceptance-v3-popup.md`.

## 1.0.0 (Unreleased)

Initial release.

- Removed the rules of version 1 (the `rules` option and the Legacy rules editor). A saved value loads; the panel ignores it and shows one warning. See [Bindings](docs/guide/bindings.md).
- A shape binding with an explicit `shape.target` colours the node icon, the shape or its outline by the value, with the colours of the field config. Without a target the colour changes nothing, as before.
- The arrow head of a link half grows with its drawn width (8 by 8 up to a 2-unit half; above, each unit of width adds 2 to the base and 0.5 to the length), and the stroke stops under the head, so a busy link keeps a visible direction. The split, the label obstacles and the mask are fixed for `linkWidth.max`: a width change on a refresh moves no label. The label obstacle is the triangle of the widest head, and a label on a link too short for any spot beside the stroke stands beyond the wings of the widest head.
- The status paints the element: a device with a status that is not normal gets a border and a tint in the status colour, a link gets its stroke in it. The `! down` markers on the elements are gone; the hover card shows the state and its reason as its first row. See [Colours, status and legend](docs/guide/colours.md).
