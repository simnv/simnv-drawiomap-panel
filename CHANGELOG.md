# Changelog

## 1.0.0 (Unreleased)

Initial release.

- Removed the rules of version 1 (the `rules` option and the Legacy rules editor). A saved value loads; the panel ignores it and shows one warning. See README, "Rules of version 1".
- A shape binding with an explicit `shape.target` colours the node icon, the shape or its outline by the value, with the colours of the field config. Without a target the colour changes nothing, as before.
- The arrow head of a link half grows with its drawn width (4 + 2 × the width, 8 for a thin half), and the stroke stops under the head, so a busy link keeps a visible direction. The split, the label obstacles and the mask are fixed for `linkWidth.max`: a width change on a refresh moves no label.
- The status paints the element: a device with a status that is not normal gets a border and a tint in the status colour, a link gets its stroke in it. The `! down` markers on the elements are gone; the hover card shows the state and its reason as its first row. See README, "Status paint".
