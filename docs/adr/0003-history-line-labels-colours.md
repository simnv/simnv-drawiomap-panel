# 3. History line labels and colours

- Status: accepted by the P1-11b review corrections C1 and C2; the single-label rule added by the P1 gate (P1-G0)
- Date: 2026-10-29

## Decision

This decision supersedes the line label and palette order rules in section 3.7 of the v4 design.

History lines show only the labels whose values differ among the first eight series.
When exactly one label differs, the line shows the bare value of that label (`ssid-0`, not `{ssid="ssid-0"}`), as the Grafana legend does for a single label.
When two or more labels differ, the line shows them as `{key="value", ...}`, sorted by key.
When no label differs, the line uses the Grafana field display name.
The tooltip uses the same labels and order as the chart.
The canonical series order and the count after the eighth series stay unchanged.

The first eight lines use Grafana classic palette slots 0, 1, 2, 3, 4, 5, 26 and 30.
These slots give green, yellow, blue, orange, red, purple, cyan and pink.
The cyan and pink slots replace the repeated green and yellow shades.
A line with no finite value keeps its colour slot.

## Reason

Common labels repeat the cell key and make each tooltip row harder to read.
With one differing label, the braces and the label name repeat on each line and give no information.
Eight different hues make the eight lines easier to distinguish than repeated shades.
