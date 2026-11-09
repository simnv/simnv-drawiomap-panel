# draw.io map panel guide

The panel shows a draw.io diagram as a network weathermap. Queries of the panel colour and label the cells.

"draw.io" is a trademark of JGraph Ltd. This plugin is not affiliated with JGraph Ltd or with the draw.io project.

## How it works

View mode loads no draw.io code. The panel stores the diagram XML and the SVG that draw.io exported. The panel shows the SVG and writes colours into it.

The panel removes every `<style>` element from the SVG. It keeps only the `--ge-*` colour variables of the draw.io auto theme (for example the label background), so they follow the Grafana light or dark theme. See [Theme variables](../security.md#theme-variables-of-the-svg).

## Pages

- [Install](install.md): zip, Grafana CLI, Docker, manual install.
- [Bindings](bindings.md): import a diagram, join cells to queries, classes, match, templates, rows, the match report.
- [Colours, status and legend](colours.md): field config colours, status band, status paint, legend, last data timestamp.
- [Links](links.md): capacity, arrow styles, link value labels.
- [Hover card](hover-card.md): the card, which cells open it, card titles.
- [Zoom](zoom.md): zoom options, live zoom, minimum scale.
- [Editor](editor.md): the bundled draw.io editor.

## Grafana 12 and 13

The plugin targets Grafana `>=12.4.0` and builds against `@grafana/*` 12.4.x. React comes from Grafana (it is not bundled). The authoring matrix and its evidence are in [authoring compatibility](../research/authoring-compatibility.md). The v4 checks and the earlier PoC results are in [acceptance](../acceptance.md).

## Known limits

Authoring evidence is dated 2026-10-18.

- No signing and no catalogue entry.
- No rules embedded in the diagram (`pg-rules`).
- No animated flow.
- No diagrams loaded from a URL.
- No multi-page diagrams. The panel renders page 1 and binds page 1 only. The **Diagram** options show a warning when you import or paste a file with several pages.
- The panel reads the portograph contract version 1 only (`pg-schema="1"` on the root cell). A diagram with a higher version shows a warning in the **Diagram** options; the panel reads its cells as version 1. A diagram without `pg-schema` is not a portograph export: the panel ignores its `pg-kind`, `pg-id`, `pg-from` and `pg-to` attributes. The cells join a class with `bind`, and the ends of its edges come from the `source` and `target` of the stored XML.
- For current browser and sandbox evidence, read the [authoring compatibility](../research/authoring-compatibility.md) matrix.
- Panel edit can run the panel queries many times. This is not the panel: in the VictoriaMetrics datasource plugin (seen with 0.26.1), each query editor calls `onRunQuery` when it mounts and starts a label lookup. A panel with N VictoriaMetrics targets runs all its queries N+1 times when panel edit opens. The target JSON has no workaround.
