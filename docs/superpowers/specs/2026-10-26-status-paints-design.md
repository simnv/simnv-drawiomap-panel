# The status paints the element; the status markers go

- Status: draft 2026-10-26. Design first; the code follows in small commits on the same branch.
- Request: the consumer team's owner, 2026-10-26. "Colour coding is enough, and the hover card should show that
  warning."
- Scope: `src/binding/color.ts` (the status colours, the tint), `src/render/applier.ts` (the node border and tint,
  the stroke of a status-only edge, the end dots), `src/render/overlay.ts` (the halves and arrow heads; the markers
  go), `src/render/linkLabels.ts` (the marker room goes), `src/interact/cardModel.ts` (the status row with hover
  rows), `src/legend/model.ts` and `src/components/StatusBand.tsx` (the import of `statusColor`), their tests,
  `tests/visual-regions.spec.ts`, `tests/link-labels.spec.ts`, `README.md`, `CHANGELOG.md`, `docs/acceptance.md`.
- Reads: `docs/adr/0002-grafana-native-colours.md` (the colours come from the theme and the field config),
  `docs/superpowers/specs/2026-10-26-simplify-step5-patch-diff-design.md` section 3.1 (every write of the applier is
  a function of the key; a new write must enter it), `CODING_STANDARDS.md` "State and data" (a missing value shows
  grey, never a good state) and "Rendering and layout" (the overlays stay in the z-order of the edge).
- Out of scope: the status band (it stays as it is), the status rule schema and the editor, the legend layout, the
  arrow heads that draw.io draws on a status-only edge (open question 1).

## 1. Decisions

1. The status markers go: the `! down`, `! warning`, `? stale` and `? missing` texts on links and devices, the room
   that the link label placement kept free for them, and their mentions in the docs. The status band stays.
2. A status that is not `normal` paints the element itself. A device gets a border in the status colour and a light
   tint of its fill. A link gets its stroke in the status colour. A `normal` status changes nothing: the binding
   colours show.
3. Precedence on a link: a status that is not `normal` wins over the binding colour of each half. One exception:
   a `missing` status on a link that has halves leaves the halves alone, because each half already shows its own
   state (the half with no data is grey; the other half keeps its value colour). Section 3.3 says why.
4. The status colours come from the theme, as the rest of the panel: `down` and `critical` the palette red, `warning`
   and `stale` the palette orange, `missing` the no-data grey. The band and the legend use the same function, so the
   three places agree.
5. The hover card shows the status state and its reason for every cell that has a status, also when the cell has
   hover rows. The status row is the first row, in the card's existing status row style.
6. Every new write is a function of the step 5 key and of the colour scheme; the reset of the applier puts the
   diagram's values back when the status goes back to `normal` or the cell leaves.

## 2. What goes

| Item                                                                                               | Where                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `drawStatusMarker`, `statusMarkerBox`, `StatusMarkerBox`, `STATUS_MARKER_FONT`, `TextProbe`, the marker state and its sweep | `src/render/overlay.ts`. `statusColor` moves to `src/binding/color.ts`. `TextProbe` moves to `linkLabels.ts`, its only user. |
| The marker room obstacle and the `probe` parameter of `stageObstacles`                             | `src/render/linkLabels.ts`; the `Obstacle` comment in `labelPlacement.ts`                                 |
| The marker tests                                                                                   | `overlay.test.ts` ("status overlay", the marker cases of "keeps its elements", "linkSplit and statusMarkerBox"), `linkLabels.test.ts` ("reserves the status marker room"; the `284` expectations that came from the room) |
| The e2e marker checks                                                                              | `tests/visual-regions.spec.ts` (the count of 2 markers, the marker tops of the crowded panel), `tests/link-labels.spec.ts` (the marker boxes in the overlap test) |
| The docs mentions                                                                                  | `README.md` (the band paragraph, the legend "Status" entry, the shape binding paragraph, the label placement obstacle list), `docs/acceptance.md` (three rows), the step 5 spec (section 3.2 items 4 and 5 and R1-4 describe the markers; a note at the top says they are gone) |

The layer `g.dmap-overlay` keeps its elements and its z-order. Nothing else of the overlay changes.

## 3. The paint

### 3.1 The colours

`statusColor(view, theme)` moves from `overlay.ts` to `src/binding/color.ts`, next to `noDataColor`:

| State                | Colour                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `down`, `critical`   | `theme.visualization.getColorByName('red')` (`#E02F44` light, `#F2495C` dark)             |
| `warning`, `stale`   | `theme.visualization.getColorByName('orange')`                                           |
| `missing`            | `noDataColor(theme)` (`theme.colors.text.disabled`), the grey of every missing value      |

Today the function reads `theme.colors.error.text`, `warning.text` and `text.secondary`. The band and the legend
import the new one; their colours change with it, so the band, the legend and the elements show one colour per
state.

`statusPaint(view, theme)` is the colour for a view whose state is not `normal`, else `undefined`. `linkStatusPaint(patch, theme)`
adds the exception of decision 3. Both live in `color.ts`; the applier and the overlay call them, nothing computes
the precedence twice.

### 3.2 Devices (nodes)

For a cell with a shape (`entry.shape`) and a status that is not `normal`, after `applyShape` and `applyUnavailable`
ran:

- The border: `shape.style.stroke = colour` and `shape.style.strokeWidth = max(2, 1.5 × w)`, where `w` is the stroke
  width the shape had before the patch: the `stroke-width` attribute, else the inline style, else the original inline
  style, else 1 (the SVG default). `strokeWidthOf` in `linkLabels.ts` is that rule; it moves to `geometry.ts` and the
  applier uses it (also for `target: 'stroke'`, which computes `attribute + 1` inline today). The width is in the
  user units of the shape. draw.io exports a vertex at scale 1 (a `rotate` transform at most), so the user units of a
  shape are the root units of the diagram; a shape under a scaling group gets a border scaled with the shape, which is
  the right size on the screen.
- The tint: the fill the shape shows now, mixed with the status colour at 20 %. The fill is read in this order, the
  first value that parses as a colour: the computed `fill` (`getComputedStyle`, which resolves `light-dark()` and
  `var()` for the colour scheme of the root), the inline `style.fill`, the `fill` attribute. A colour with an alpha
  below 1, `none`, a `url()` paint, `currentColor` or a value that does not parse gives no tint: the border alone
  shows the status. The parser is `colorManipulator.decomposeColor` of `@grafana/data` (hex, `rgb()`, `rgba()`,
  `hsl()`, `hsla()`), the one Grafana uses; a status colour with an alpha (the no-data grey has 0.6) mixes with
  `ratio × alpha`. The result is written as `rgb(r, g, b)` into `shape.style.fill`.
- With `target: 'shape'` the fill the shape shows now is the binding colour: the tint keeps it visible and adds the
  status. With `target: 'stroke'` the status border replaces the binding outline (precedence). With `target: 'icon'`
  the icon keeps its colour; the node shape gets the border and the tint.
- An unavailable cell (grey fill, status `missing`) gets a grey border on its grey fill.
- The icon cell, the icon tile and the description of the node do not change.

### 3.3 Links

- A link with halves (`patch.link.a2b` or `b2a`): `renderOverlay` draws both polylines and both arrow heads in the
  status colour. `data-dmap-status` and `data-dmap-step` of the polylines stay the binding's values (the legend
  highlight and the tests read them). The applier paints the end dots (`paintEnds`) in the same colour. The width
  stays the binding's.
- A link without halves (a status rule on an edge with no link binding): the applier writes the status colour into
  `entry.line.style.stroke`, as `applyUnavailable` does for the no-data grey. The arrow heads that draw.io drew keep
  their colour (open question 1).
- The exception: a `missing` status on a link that has halves paints nothing. The engine gives a link that status when
  one direction has no data ("Incomplete coverage"), when a binding has a metric problem, or when the health query of
  its status rule has no data. In the first two cases the half with the problem is grey already, and the other half
  keeps the colour of its value; a grey stroke over both would show a measured value as no data. In the third case
  the band and the card say `missing`, and the traffic colours stay. A link without halves gets the grey stroke, as
  an unavailable edge does today.

### 3.4 Reset

The writes above use the properties the reset of the applier already restores: `style.fill`, `style.stroke` and
`style.strokeWidth` of the shape (to `entry.original`), `style.stroke` of the line, the end dots (to `endOriginal`,
with their priority). No new reset code. When the status goes back to `normal`, the key changes, the cell is reset and
written again without the paint. When the cell leaves the patches, it is reset. The overlay halves get the binding
colour again through their own key.

### 3.5 The key and the colour scheme

- The applier key already holds `statusView` (`state`, `reason`), `shape` (`color`, `target`) and the halves. The
  paint is a function of these and of the diagram (the fill and stroke width of the shape, constant per stage) and of
  the colour scheme (the computed fill of a `light-dark()` paint, the theme colours). The scheme is already an input
  of `Applied`: another theme or OS preference resets and writes every cell, so the tint is read again.
- The applier needs the theme for the colours. The fifth parameter `scheme: ColourScheme` becomes
  `ctx: ApplyContext = { theme: GrafanaTheme2; osDark: boolean }`; `Applied.scheme` stays `{ isDark: theme.isDark, osDark }`.
  Both callers have the theme at hand. Without a context the applier uses the default theme of `createTheme()` (cached),
  for the tests.
- The overlay: the key of a half (`halfKey`) is computed from the state the half is drawn with, which is the binding
  state with the status colour in `color` when the status paints. A theme change gives other theme colours, so the
  key changes and the elements are updated in place.

## 4. The hover card

`buildConfiguredCard` adds the status row for every patch with a `statusView`, as the first row, before the hover
rows: `{ key: 'status', kind: 'status', title: state, text: reason }`, the row that a status-only cell shows today.
`opensCard` does not change (a status already opens the card). The editor's card preview uses the same model.

## 5. Tests

Unit (`npm run test:affected`; failing tests first):

- `color.test.ts` (new, next to `color.ts`): `statusColor` per state in both themes (red, orange, the no-data grey);
  `statusPaint` is undefined for `normal` and for no view; `linkStatusPaint` is undefined for `missing` with halves
  and the grey for `missing` without halves; `tintFill`: 20 % of red into `rgb(213, 232, 212)`, an `rgba()` status
  colour mixes by its alpha, `none`, `url(#g)`, an `rgba(...)` fill and `currentColor` give undefined.
- `applier.test.ts`: a `down` node gets the red border (`stroke`, `strokeWidth` 2 for a shape without a width, 3 for
  `stroke-width="2"`), and a tinted fill; the fill, stroke and width go back to the originals when the status is
  `normal` and when the patch goes (the case "marks explicit health accessibly" changes: the shape is coloured now);
  a node with `target: 'shape'` and a status: the tint of the binding colour; `target: 'stroke'` and a status: the
  status border wins; a fill that does not parse (`url(#g)`) gets the border only; a status-only edge gets the
  stroke; a link with halves and a `down` status gets the end dots in red, and with `missing` the half colour; a
  second apply with the same patches writes nothing (the key covers the paint); another theme writes the paint again
  in the dark red.
- `overlay.test.ts`: a `down` link draws both polylines and both arrows in red and keeps `data-dmap-status` of the
  binding; a status that goes back to `normal` updates the same elements to the binding colours; `missing` with
  halves leaves the binding colours; no `.dmap-status-marker` under the root; the child order on an edge is path,
  (arrow heads), overlay; the "keeps its elements" cases without their marker lines.
- `linkLabels.test.ts`: the label expectations without the marker room (the `b2a` label stays at its own spot); the
  `stageObstacles` calls without the probe; the obstacle list has no rect at the midpoint of a patched edge.
- `cardModel.test.ts`: a patch with hover rows and a status gives the status row first, then the hover rows; a
  `normal` status gives the row too (the card says `normal` and its reason); no status, no row.
- `legend/model.test.ts` and `StatusBand.test.tsx`: the colours follow `statusColor` (the assertions that name a
  theme token change to the palette colour).

E2E, one spec at a time on 13.2, after the coordinator frees the shared dist:

- `tests/visual-regions.spec.ts`: no marker count; in `widespread outage` the `rect` of `device-1` has an inline
  `stroke` and `stroke-width: 2px` and a fill that differs from `#d5e8d4`; in `normal` the inline stroke is empty.
  The state adds a status rule on `link-1` (the `health` query): the `.dmap-half` strokes of `link-1` equal the stroke
  of `device-1` (the precedence), and the band row counts 3 elements. The screenshots of every state in both themes
  are the visual check; open `widespread outage` light and dark.
- `tests/link-labels.spec.ts`: the overlap test without the marker boxes.
- `tests/status-band.spec.ts`, `tests/legend.spec.ts`, `tests/links.spec.ts` (the hover card over a half): green.
- On main before the push: `npm run e2e:matrix` (the rendered panel changes).

## 6. Docs

- `README.md`: the feature line 10 ("mark abnormal devices" becomes "paint abnormal devices and links"); a paragraph
  "Status paint" after the band paragraphs in "Status summary" (the rules of section 3, the precedence, the
  exception, the hover card row); the band paragraph ("The markers on the elements stay" becomes "The paint of the
  elements stays"); the shape binding paragraph (line 411); the legend "Status" entry (line 427: the colours of the
  status paint, normal elements keep their colours); the label placement obstacle list (line 532: the marker room
  goes).
- `CHANGELOG.md`: one bullet.
- `docs/acceptance.md`: the three rows that name the markers; a block "Status paint" with the checks of section 5.
- The POC spec, section 8: a row "Status markers" (not in the spec; the markers came with the status rule on 2026-10-18; removed 2026-10-26, the
  status paints the element).
- The step 5 spec: a note under its status line that the markers went on 2026-10-26 (this spec); its text stays as
  the record of that step.

## 7. Open questions, with a recommendation each

1. The arrow heads that draw.io draws on a status-only edge keep their colour; only the stroke of the path takes the
   status colour, as the unavailable grey does today. Recommendation: accept; a status rule on an edge without a
   link binding is rare in the consumer team's sheets, and the halves cover the bound case.
2. The icon of a down device keeps its colour (the border and the tint are on the node shape). Recommendation:
   accept; the icon is the device class, and the tint keeps the class fill readable.
3. The tint ratio is 20 %, the top of the asked range, because the palette red over a light class fill at 15 % is
   hard to tell from the fill on a dark theme. Recommendation: 20 %; one constant, `STATUS_TINT`.
4. A `missing` status on a link with halves paints nothing (section 3.3). Recommendation: accept; the alternative
   paints a measured half grey.
