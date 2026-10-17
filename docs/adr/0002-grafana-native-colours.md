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

README, "How colours and thresholds work" and "Capacity". `tests/color.spec.ts`.
