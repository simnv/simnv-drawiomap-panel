# Changelog

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

- A cell joins a class with its attribute `bind`. The attributes `key`, `port` and others select the series of the cell, with a matcher (`=`, `!=`, `=~`, `!~`, a list) in a fixed regex dialect. The classes and the cell overrides are in the panel option `config`. See README, "Bindings (v4)".
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

- Removed the rules of version 1 (the `rules` option and the Legacy rules editor). A saved value loads; the panel ignores it and shows one warning. See README, "Rules of version 1".
- A shape binding with an explicit `shape.target` colours the node icon, the shape or its outline by the value, with the colours of the field config. Without a target the colour changes nothing, as before.
- The arrow head of a link half grows with its drawn width (8 by 8 up to a 2-unit half; above, each unit of width adds 2 to the base and 0.5 to the length), and the stroke stops under the head, so a busy link keeps a visible direction. The split, the label obstacles and the mask are fixed for `linkWidth.max`: a width change on a refresh moves no label. The label obstacle is the triangle of the widest head, and a label on a link too short for any spot beside the stroke stands beyond the wings of the widest head.
- The status paints the element: a device with a status that is not normal gets a border and a tint in the status colour, a link gets its stroke in it. The `! down` markers on the elements are gone; the hover card shows the state and its reason as its first row. See README, "Status paint".
