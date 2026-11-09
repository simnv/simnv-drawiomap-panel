# 2. Colours from the Grafana field config

- Status: accepted
- Date: 2026-10-17

## Context and problem statement

The panel colours link halves by traffic and node icons by state. The first design let each rule set thresholds
(mode and steps) and used the field config only when a rule set none. Then there were two colour models: the rule
thresholds and the Grafana field config. Which one sets the colours?

## Decision drivers

- Users know the Grafana field config from other panels: colour scheme, thresholds, value mappings, Max, overrides.
- Different kinds of links need different scales (for example a WAN link and a LAN link).
- No data must show grey, never green.

## Considered options

1. Thresholds in each rule, with the field config as the fallback.
2. The Grafana field config only.

## Decision outcome

Option 2. Rules select cells and series. They set no colours. For each link half and each shape, the panel uses the
field config of the matched series, with the overrides applied (`getDisplayProcessor`).

- A link half with a capacity: the colour input is the utilisation in percent. Threshold steps are percent, and a
  continuous scheme uses percent / 100 as the position on the scale.
- A link half without a capacity, and each shape: the display colour of the raw value, as in a Stat panel.
- The capacity comes from the first source that gives a value: a series, a cell attribute, a number, the field Max.

### Consequences

- Good: one colour model, the same as in all Grafana panels. Overrides by query, series name or regex give each kind
  of link its own scale.
- Good: the rule schema is smaller.
- Bad: rules saved with `thresholds` lose them. Old dashboards still load: the engine ignores `thresholds` and shows
  a warning. The colours then come from the field config.

## More information

`docs/guide/colours.md`, "How colours and thresholds work", and `docs/guide/links.md`, "Capacity". `tests/color.spec.ts`.

## Update: binding model v4 (2026-10-29)

The decision stays: the colours come from the Grafana field config. Version 4 of the binding model (`docs/superpowers/specs/2026-10-28-binding-model-v4-design.md`, amendment A1 and decision D15) changes two details of this record.

- The `status` of a class names a query (a refId). The field config of that refId gives the colour and the text of the cell: the thresholds, the value mappings and the colour scheme. The cell shows the exact colour and text of the winning series. The severity (down, critical, warning, normal) decides only the worst of N series, the status band and the legend.
- The capacity of a link half comes from the first source that gives a value: a `capacity` query (a refId, one for both directions or one for each), then the cell attribute `cap`, then none. The field **Max** is no longer a capacity source, and a number in the config is gone. The line "a series, a cell attribute, a number, the field Max" above describes version 3.

The sections "Decision outcome" and "Consequences" about rules and patterns describe the removed version 1 and version 3 configs. ADR 0001 (the bundled editor in an opaque-origin frame) is not changed.
