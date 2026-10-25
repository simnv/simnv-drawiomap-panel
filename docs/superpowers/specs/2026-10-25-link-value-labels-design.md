# Link value labels

- Status: decided 2026-10-25 (the user's decisions in section 9), revised after two review rounds (section 10).
  Design only; no code in this change.
- Requested by: the owner of the consumer team (six requirements: content, position, angle, collisions, legibility,
  config). This spec answers each one and records the decisions that the requirements left open (section 9).
- Scope: `src/model/config.ts` (one new leaf), `src/binding/patterns.ts` (`mergeDisplay`), `src/binding/engine.ts`
  (`percentText`, `percentDisplay`, `labelMode`), two new render modules, `src/render/overlay.ts`
  (`statusMarkerBox`), `src/render/zoom.ts` (`viewScaleOf`), the two overlay call sites (`DrawioMapPanel.tsx`,
  `editor/popup/DiagramStage.tsx`), `BindingFields.tsx`, the README and the fixtures.
- Reads: step 2 spec (`HalfState`, `capacityDisplay`, version 3), `CODING_STANDARDS.md` ("Rendering and layout"),
  portograph ADR-0014 and `candidateBox` (`run-label-box.ts:306`): the angle, side and clearance rules are copied.
- Independent of step 3 (the snapshot store): the labels read `PatchMap` and `HalfState`, whatever produces them.
- Supersedes step 2 spec section 6: no `both` mode and no panel option (section 2 here). The PoC spec gets one row in
  "Superseded decisions".

## 1. Summary

Each link half shows its own load as a small text beside the stroke, in the middle of its own leg, turned to follow
the leg (portograph gravity), placed once per stage so that a data refresh only changes the text. The text is a
string that `halfState()` already made; the label module formats nothing. The default is off per pattern, so no
existing sheet changes.

## 2. Config (version 3, additive)

```ts
// src/model/config.ts, inside `link`
const linkLabel = z.object({ mode: z.enum(['percent', 'value', 'none']) }).strict();
const link = z.object({ enabled, a2b, b2a, ...capacitySources, label: linkLabel.optional() }).strict();
```

- `display.link.label.mode`: `percent` shows the percent of that direction's capacity; `value` shows the reading;
  `none` (the default when the key is absent) shows nothing. Per pattern and per override.
- `mergeDisplay` merges `label` as a leaf (`patch.link.label ?? previous?.link.label`), tracked as `link.label`, so the
  provenance and the inspector treat it like `link.capacity`. An override can set `none` to switch a link off.
- No panel-wide option (decided). A pattern `{ select: { kind: 'link' }, display: { link: { label: { mode:
  'percent' } } } }` is the sheet-wide default and lives in the same document as the bindings; a second source would
  need a precedence rule (CODING_STANDARDS "Grafana first": no option when the config does it).
- The envelope stays `version: 3`: an item with the key fails under `.strict()` in a reader that does not know it,
  which is the rule of step 2 for every new key. The consumer team's generator adds the key when it wants labels.
- Editor: `BindingFields.tsx` gets a "Label" select (None, Percent of capacity, Value) in the link section; it writes
  `link.label.mode` and `leafPaths` gains the path. The hover card does not change.
- README: a new subsection "Link value labels" after "Capacity", with the three modes, the fallback rules of
  section 3 and the phone rule of section 6; the "Capacity" paragraph notes the `<1%` text of the card.

## 3. Text rules (what the label shows)

The label reads one `HalfState` and the mode. It never calls a formatter and never rounds.

| Half | `percent` | `value` |
| --- | --- | --- |
| `status: 'ok'`, `percent` defined | `percentDisplay` ("41%", "<1%", "0%", ">999%") | `formattedValueToString(display)` ("3.1 Mb/s") |
| `status: 'ok'`, no capacity (`percent` undefined) | `formattedValueToString(display)` | the same |
| `status: 'nodata'` | no label | no label |
| `status: 'unbound'` (unavailable half, step 2) | no label | no label |
| `mode: 'none'` | no label | no label |

- One helper `percentText(percent)` in `engine.ts` replaces the inline `${Math.round(percent)}%` of `halfState()`
  (`engine.ts:467`): a real `0` gives `0%`; `0 < percent < 0.5` gives `<1%`; above `999` gives `>999%`; else
  `Math.round(percent)%`. The card label and the new `HalfState.percentDisplay` both use it (one concept, one
  function). The card changes with it: `0.4 %` shows `<1%` in the card too.
- The `value` text comes from `formattedValueToString` of `@grafana/data` on `display` (the field's unit and
  decimals, as the card). The step 2 rule "automatic decimals in the unit of the field" applies unchanged.
- A label whose text is empty (a `display` without text) is treated as no label.

## 4. Geometry: one coordinate space, legs, anchor, angle, box

One space. Everything the placement compares (arc lengths, the split, the clearance, the slot width, the obstacles)
is in **root user units** (the viewBox space, where the label layer lives). The overlay keeps its own split `mid`
in path-local arc length (`pathGeometry(line, overlayLayer)`); the label module does not recompute it. It takes
`geoRoot = pathGeometry(line, labelLayer)` (`pointAt` returns root coordinates; `PathGeom` gains `matrix`, the
`M = layer.getCTM()⁻¹ × line.getCTM()` it already computes, identity in jsdom) and the overlay's `mid`. The root
polyline is **every vertex** of the `d` attribute (`parsePathPoints`, nothing filtered: `bendLengths` drops turns of
5° or less and is not used here) mapped through `matrix`, plus the split vertex `geoRoot.pointAt(mid)` inserted
at its projection onto the nearest segment of that polyline. The root arc lengths, the bends (a turn above 5°, as
the overlay sees them) and the split are then measured on this root polyline. It is exact for a draw.io M/L path
under any affine transform of the edge or its ancestors; a curve counts by its end points, as in the overlay.
Nothing multiplies a path-local arc length by `geo.unit`: under `scale(2)` the split, the legs and the clearance all
come out at the overlay's own point.

Stroke widths are in the path's local units (the overlay polyline is a sibling of the path). Every stroke-derived
clearance converts to root units once: `strokeRoot = strokeLocal × geo.unit` (`unit = sqrt(|det M|)`, the scale of
the edge's CTM; a non-uniform scale is approximated by it, as the overlay's `clear` already is). The label's own
`strokeRoot` is `linkWidth.max × unit` of its edge; another edge's is its own width × its own `unit`.

Legs. a2b is the root polyline from the first vertex to the split vertex, b2a from the split to the last; a link with
one bound direction has one leg over the whole polyline. The anchor `d0` of a half is the midpoint of its leg's
root arc length (about 25 % and 75 % of a two-leg link). The straight run of the leg that holds `d0` is the
label's run.

Angle and side: the rules of portograph's `candidateBox` (`run-label-box.ts:306-337`) and ADR-0014, copied:

```ts
export function runHeading(dx: number, dy: number): { degrees: number; first: Point } {
  if (Math.abs(dx) <= VERTICAL_EPS) {                 // an exactly vertical run, whichever way it runs
    return { degrees: -90, first: { x: -1, y: 0 } };  // reads bottom to top; the first (top) side is the left
  }
  let degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (degrees > 90) degrees -= 180;
  if (degrees <= -90) degrees += 180;                  // (−90, 90)
  const r = (degrees * Math.PI) / 180;
  return { degrees, first: { x: Math.sin(r), y: -Math.cos(r) } };   // above the run: up at 0°, up-left at −45°
}
```

`VERTICAL_EPS = 0.01` user units (draw.io writes two decimals; portograph's `EPS` is 1e-7 on exact numbers). A
horizontal run gives 0; 89° stays 89° (the text runs down the screen, letters' bottom to the left); 91° becomes
−89°; −89° stays; −91° becomes 89°; the glyphs' down vector `(−sin θ, cos θ)` has `cos θ ≥ 0` on every heading,
so the letters' bottom never faces up the screen. The second side is `−first`. A vertical run (−90°) has `first = left`, the side the tops of the letters face. Both halves of a link take one place (section 9). The text is rotated about the box
centre, `transform="rotate(θ cx cy)"` with `text-anchor="middle"` and `dominant-baseline="central"`, the
construction the port pills use (`rotate(-90,213.05,107.5)` in `fixtures/demo/svg/demo-l3.svg`).

Box. Size `w × h`: `w` is the slot width (section 7), `h = fontSize × 1.25`, both plus `2 × halo` (portograph
`haloSize`, `halo = 1` after the live run: a 2-unit stroke is 1 unit outside the glyphs). Clearance to the stroke: `gap = normalGap + strokeRoot / 2`, `normalGap = 2` root units (4 as `wideGap`, see section 9)
(`LINK_LABEL_GEOMETRY`). The centre is `anchor + side × (gap + h / 2)`, the turned branch of `candidateBox`, so the
near edge of the box is `normalGap` outside the stroke edge on every heading. The local stroke width is
`linkWidth.max` of the panel options (decided), not the half's current width: the width grows with the load on each
refresh, and a label that moved with it would not be "placed once per stage". With the default range 2..10 the
visible gap is 4 px at full load and 8 px at idle.

## 5. Placement: candidates, obstacles, index, determinism

Pure module `src/render/labelPlacement.ts`, unit-tested in jsdom with plain numbers.

```ts
export interface LegInput {
  /** the leg in root user units: its vertices, the arc lengths of its bends and its length */
  points: Point[]; bends: number[]; length: number;
  /** the slot size without the halo */
  size: { width: number; height: number };
  /** the stroke width of the edge in root units (`strokeLocal × geo.unit`, section 4) */
  strokeRoot: number;
}
export type Obstacle =
  | { kind: 'rect'; rect: Rect; clearance: number }                       // cell body, pill, chip, dot, arrowhead, marker room, placed label
  | { kind: 'segment'; a: Point; b: Point; clearance: number; owner: string }; // a straight run of a drawn edge
export interface ObstacleIndex { add(o: Obstacle): void; near(box: Rect): Iterable<Obstacle> }  // a uniform grid
export function obstacleIndex(items: readonly Obstacle[], cell?: number): ObstacleIndex;
export interface Placed { centre: Point; degrees: number; box: OrientedBox; along: number }
export type Placement = Placed | { dropped: 'short-leg' | 'no-free-spot' };
export const LINK_LABEL_GEOMETRY = { fontSize: 8, normalGap: 2, wideGap: 4, halo: 1, alongStep: 4, endMargin: 4 } as const;
export function placeHalfLabel(leg: LegInput, own: string, index: ObstacleIndex): Placement;
export function runHeading(dx: number, dy: number): { degrees: number; first: Point };
export function labelsVisible(viewScale: number): boolean;   // section 6
```

Candidates, in this order (the first free one wins):

1. Place (owner rules after the live run, superseding the portograph side ladder): on the stroke first (the box centre on the half's own stroke; the own stroke is no obstacle there, everything else is), then the top side, then the bottom side, each over the whole leg. The top side is the side the tops of the letters face: `runHeading().first` (above a horizontal run, left of a vertical run at −90°, the text-top side of a diagonal). Beside the stroke the near edge of the box stands `normalGap = 2` beyond the stroke edge (centre offset `strokeRoot / 2 + 2 + h / 2`, `h` with the halo); the portograph 4 units gave 15.2 px live. When a chip or a pill wider than the stroke blocks the whole half at gap 2, the same two sides are tried with `wideGap = 4`. The place is chosen per link: `placeLinkLabels` tries on the stroke for both halves, then the top side for both, then the bottom side for both (then the wide gap). Each half takes its own place only when no single place holds both. An isolated re-placement of one half tries the place of the other half first; a dropped half keeps its last place. The text stands at the drawn width of its half (`drawnCentre`); the reservation is the union of every box the label can take for a drawn width between `linkWidth.min` and `linkWidth.max` (beside the stroke: the band from the near edge at the thinnest stroke to the far edge at the widest; on the stroke: as high as the largest gap rect, `max + 2`), so a load change never needs a new collision check. The wide gap counts from the edge of the widest stroke for every drawn width, because a chip or a pill is wider than a thin stroke.
   A label on its stroke cuts the stroke of its link under the text with an SVG mask (section 7, "The cut"); no rect is drawn and no colour is read.
2. Distance from `d0`: `0, s, 2s, …` with `s = alongStep = 4` user units, up to the leg's ends.
3. At one distance: towards the end of the link first (away from the arrowheads at the split), then towards it.

A candidate at arc length `d` is accepted only when the run that holds `d` holds the whole box along the run:
`run.from + endMargin + w/2 ≤ d ≤ run.to − endMargin − w/2`. A bend is never under a label. The box is the oriented
rectangle of section 4 on the candidate's run (so the angle can differ between candidates of one leg on an
orthogonal path).

Short leg: a leg whose longest run is shorter than `w + 2 × endMargin` is dropped before any candidate is tried.
No free spot: every candidate collides; the half gets no label. Both are counted in a `data-dmap-labels-dropped`
attribute of the layer for the tests; no diagnostic, because a drop is a normal outcome of a dense sheet and not an
error in the config.

Collision test: the oriented box against a `rect` obstacle grown by its clearance (separating-axis test on the four
axes); against a `segment` obstacle, the distance from the segment to the box is less than the clearance, or the
segment crosses the box. The label's own run is not an obstacle (the box is already `normalGap` away from it); the
other runs of the same edge are (a U-shaped edge).

Index. Obstacles go into a uniform grid (`obstacleIndex`, cell 64 user units, an obstacle in every cell its grown
bounding box touches); a candidate asks for the obstacles of the cells its bounding box touches and tests those
only. The grid is built once per stage and placed labels are added to it as they are accepted.

Obstacles, built once per stage in root user units (the four corners of `getBBox()` mapped through
`root.getCTM()⁻¹ × el.getCTM()`, then the axis-aligned box; in jsdom the `x/y/width/height` or `cx/cy/r` attributes
through the `localMatrix` of `geometry.ts`, which becomes exported; a cell whose box cannot be read is skipped):

| Source | Elements | Clearance |
| --- | --- | --- |
| every non-edge cell body | `entry.shape` of every cell without `line`, whatever its kind: portograph nodes and pills, plain draw.io nodes (`kind: 'other'`), icon tiles, text cells | its stroke width / 2, in root units |
| portograph label chips | `entry.group` of every `kind: 'link-label'` cell (the text and its background) | 0 |
| edge text | `entry.label` of every edge (its own value text; also an obstacle for the labels of that edge, only its stroke is exempt), and the label child cells (`edgeLabel`), which are text cells | 0 |
| end dots | `entry.ends[].el` of every edge | 0 |
| arrowheads | `polygon.dmap-arrow` of the overlay, and `entry.arrows` of every edge that has no patch (its arrows stay visible) | 0 |
| status marker room | `statusMarkerBox(entry).bounds` of every cell in `patches` (below), mapped to root units | 0 |
| edge strokes | the straight runs of every edge's root polyline (portograph links and plain draw.io edges) | `strokeRoot / 2`: `linkWidth.max × unit / 2` for a patched edge, the drawn width × unit / 2 for the others |
| placed value labels | the box of each label placed earlier in this pass | 0 |

Status marker room. `renderOverlay` draws the `! down` markers again on every refresh and their presence depends on
the data, so a marker cannot be read as an obstacle once per stage. Its place depends on the geometry only: the
midpoint of an edge, the bottom-left corner of a shape (`overlay.ts:drawStatusMarker`). The computation moves into
one exported `statusMarkerBox(entry, probe): { anchor: Point; bounds: Rect }` in the marker's own space (the space
`drawStatusMarker` draws in: the primitive's transform for a shape, the edge's parent for an edge). `anchor` is the
text start, the baseline point `(x + 4, y − 4)` that `drawStatusMarker` writes into `x, y` today; `bounds` is the
painted box of the widest marker text (`? missing`, bold 12 px, measured once by the same probe as the slots) set
on that baseline (`x: anchor.x`, `y: anchor.y − ascent`, the measured width and the line height), grown by 1.5
units on every side for the 3-unit halo stroke. `drawStatusMarker` draws at `anchor`; the label module maps
`bounds` into root units through the marker space's CTM and reserves it for every patched cell. A label then
never covers a marker that appears later, and the placement stays static. The cost is a reserved box near every
split that is often empty; the anchors sit at 25 % and 75 %, so a leg of 60 units or more keeps its label.

The overlay arrowheads depend on the geometry only (`arrowAnchor` reads bends and `arrowSize`), so they are stable
per stage and are read once, after the first `renderOverlay`. Group and frame boxes are not obstacles (decided): a
label may sit on a group background, as the pills do.

Determinism. The halves are placed in the order (cell id ascending, then `a2b` before `b2a`), not in `PatchMap`
order, so a full placement is a function of the stage and the set of slots only. The order of the obstacle list
does not change the result. A test asserts that two runs give deep-equal output and that a shuffled obstacle list
gives the same output. An isolated re-placement (section 7) depends on the sequence of slot changes since the full
placement; a new stage, a config change or a changed `linkWidth` does a full placement again.

Mesh buses and shared segments. A mesh bus member has no link cell (contract section 5), so it has no halves and
no label; the bus bar is a bare cell and takes nothing. Two edges drawn on one trunk (a parallel pair, or the runs
of a split link) are not obstacles for each other's label: the other stroke lies under the label's own stroke, and
the box is `normalGap + max/2` from the centreline while the other stroke claims `max/2`, so 4 units stay free.
Their labels compete: the first half in cell-id order takes the anchor, the next slides along the trunk past it
(the placed label is an obstacle), and a trunk too short for both drops the later one. A split link (`pg-run`)
labels every run that has its own halves (decided); the short-leg rule removes the pieces that cannot hold a label.

## 6. Zoom and the minimum on-screen size

The labels are SVG text in user units in the root, so they scale with the viewBox like the pills: no work on zoom.
The on-screen glyph size is `fontSize × k` with `k` the pixels per user unit of the rendered SVG:
`viewScaleOf(root) = min(rect.width / vb.w, rect.height / vb.h)` with `rect = root.getBoundingClientRect()` and
`vb` the `viewBox` attribute (the `meet` rule; `minScale` and the Custom mode make the SVG larger than the panel,
and the rendered rect is the size that counts, not the panel). Rule (decided): `labelsVisible(k) = fontSize × k ≥ 7`
CSS px. Below it the whole layer gets `visibility="hidden"`; above it the attribute is removed.

Sync points: `setLinkLabelScale(root)` runs (1) when `renderLinkLabels` creates or re-enables the layer, so the first
frame is right, and (2) in the zoom effects of the panel and of `DiagramStage`, right after `applyLayout`, which the
effects already run on every change of the view, the zoom options and the panel size. It reads one rect and toggles
one attribute: O(1), no re-placement; a pinch pays nothing. Examples: a 1900 px sheet in Fit on a 390 px phone gives
`k ≈ 0.2`, 1.6 px, hidden; a pinch to 5× of that view shows them; `minScale: 1.3` shows them always.

## 7. Rendering layer, z-order, cache and the refresh path

DOM module `src/render/linkLabels.ts` (the only module that touches the DOM for labels):

```ts
export const LINK_LABEL_CLASS = 'dmap-link-label';
export interface LinkLabelOptions { theme: GrafanaTheme2; linkWidth: { min: number; max: number } }
/** Builds or updates the label layer. Returns the counts for the tests and a debug log. */
export function renderLinkLabels(root: SVGSVGElement, index: CellIndex, patches: PatchMap, opts: LinkLabelOptions): { placed: number; dropped: number; moved: number };
export function setLinkLabelScale(root: SVGSVGElement): void;
```

- Layer: one `<g class="dmap-link-labels">`, the last child of the root SVG, in root user space. It is above every
  cell, above the overlay halves and above the portograph chips; the overlay groups keep their place as the next
  sibling of their edge (CODING_STANDARDS: the overlays stay below the labels and in the edge's own z-order).
- Element per label: `<text class="dmap-link-label" data-dmap-cell data-dmap-half data-dmap-mode x y
  transform="rotate(θ x y)" pointer-events="visiblePainted">`. The label carries `data-dmap-cell` of its link, so a
  hover or a tap on it opens the card of the link, not of the node or group under it: `hit.ts:57` resolves
  `data-dmap-cell` on the element or its ancestors with no change. `visiblePainted`, not `all`: a label hidden by
  the zoom rule or by section "Isolated re-placement" never takes input (`all` ignores `visibility`), so the half
  or the node under it gets the tap. `font-size: 8` (the port pill size of the export),
  `font-family` of the first `pg-linkLabel` text in the stage when there is one, else `sans-serif` (the status
  markers' choice), `fill: theme.colors.text.primary` (decided), `text-rendering: geometricPrecision`. The label has no halo and no box: the labels never overlap an obstacle, and the stroke of the own link is cut. (`LINK_LABEL_GEOMETRY.halo = 1` stays as 1 unit of padding of the reserved box.) A theme change rewrites the text fill only.
- The cut. `syncMasks` runs on every pass (the overlay is drawn again on each frame). For each link that has an on-stroke, visible label it keeps one `<mask id="dmap-lm-<panel>-<n>" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" data-dmap-cell>` in a `defs.dmap-link-label-defs` that is the sibling before the layer (not inside it: the layer takes `visibility="hidden"` at a small scale and that would hide the mask content). The mask holds one white rect over the overlay of the link (with a margin) and one black rect per slot: the slot wide, `max(fontSize × 1.25, drawn + 2)` high, corner radius 2, in root units, with `transform="matrix(inverse of the overlay group to root) rotate(label angle, centre)"`, so a scaled, translated or rotated group maps the box into the local space of the elements that wear the mask. The mask is applied (`mask="url(#id)"`) to the `.dmap-half` and `.dmap-arrow` elements of the link (the edge itself is invisible under a patch). The mask is removed when the label moves off the stroke, has no text, is dropped, the layer is hidden by the scale or the labels are switched off (the defs go with the last mask). The id carries a panel-instance number, so two panels on one page never share an id. The sanitiser works on the loaded diagram only, so the runtime mask does not meet it.
- `labelMode` travels on the patch: `bindPlan` sets `CellPatch.link.labelMode` from the merged
  `display.link.label?.mode ?? 'none'`; no half carries it, because the mode is per cell.
- Slots. Every width comes from one hidden probe `<text>` with the label font (`getComputedTextLength()`; in jsdom
  `0.6 × fontSize × glyphs`), memoised per string per stage; `g` rounds a width up to a 4-unit grain. A label that
  shows a percent (any text `percentText` can produce, `<1%` to `>999%`) has **one fixed slot**,
  `g(width(">999%"))`, so its slot never changes between refreshes. A label that shows a reading (`value` mode, or
  `percent` mode without a capacity) has the slot `g(width(text))`, the value rule. A half in `percent` mode whose
  capacity comes or goes switches between the two rules; that is a slot change and takes the isolated path below.
  A text is drawn only inside a slot that holds it (next bullet); a slot is never a clip because nothing wider is
  ever drawn in it.
- Cache per root (a `WeakMap<SVGSVGElement, LabelLayout>`): the root polylines, the obstacle grid, the slot of every
  half and its placement. Full-placement key: `index`, the set of patched cell ids with their `labelMode`,
  `linkWidth.max` and the font family. A call with the same key and the same slots changes `textContent` and the
  hidden state only (a half that went to `nodata` keeps its element with `visibility="hidden"`, so its slot stays
  reserved and nothing moves when the data returns).
- Isolated re-placement. When the slot of one half changed and the key did not, only that label is placed again:
  its old box leaves the grid, every other label stays where it is as an obstacle, and `placeHalfLabel` runs for it
  alone with the new slot. When it finds a spot the label moves there (`moved` counts it). When it finds none the
  label is hidden (`visibility="hidden"`, `data-dmap-dropped="no-free-spot"`), its old box goes back into the grid
  as its reserved slot, and the next refresh tries again from that slot. A text is never drawn over an obstacle and
  never outside its slot. A percent label with data has a fixed slot, so a value refresh never moves or hides one.
- Call sites: `DrawioMapPanel.tsx:583`, in the same `requestAnimationFrame` right after `renderOverlay` (the
  arrowheads must exist as obstacles), and `DiagramStage.tsx:128` the same way, so the popup preview shows the mode
  while the user edits it. The zoom effects (`DrawioMapPanel.tsx:620`, `DiagramStage.tsx:139`) call
  `setLinkLabelScale` after `applyLayout`.
- Cost. One label tests at most `2 sides × (leg / 4) candidates`, each against the obstacles of the grid cells its
  box touches (about 10 on a dense sheet). Bound for a dense diagram: 1,000 halves on legs of 100 units give
  `1,000 × 2 × 25 × 10 = 5 × 10^5` box tests, each a few multiplications; the bench of section 8 pins the number.
  The demo L3 sheet (40 halves, about 150 obstacles) is three orders below it. A `console.debug` behind
  `localStorage.dmapDebug` logs the counts and the time.

## 8. Test plan

What jsdom can and cannot test. jsdom has no `getBBox`, `getCTM`, `getComputedTextLength` or layout. The unit
tests cover the pure placement, the coordinate conversion with stubbed matrices, the cache and refresh logic, the
text rules and the visibility toggle with a stubbed rect. The real boxes of rotated pills and chips, the font
measurement, transforms on real cells and the rendered scale are tested in the browser e2e only, by the no-overlap
check and the screenshots.

Unit (`npm run test:affected` in the worktree):

- `src/render/labelPlacement.test.ts`, heading (`runHeading`): horizontal both ways → 0, first side up; vertical up
  and down → −90, first side left (the side the tops of the letters face; the owner rule replaced portograph's right); upper-left to lower-right → 45 and its reverse → 45;
  lower-left to upper-right → −45 and its reverse → −45; steep: `(1, 57.29)` → 89 stays, `(−1, 57.29)` → 91 becomes
  −89, `(1, −57.29)` → −89 stays, `(−1, −57.29)` → −91 becomes 89; `(0.005, 100)` is vertical, `(0.02, 100)` is not.
  Position: a horizontal link of length 400 split at 200 gives centres at `x = 100` and `x = 300`,
  `y = y0 − (4 + 5 + h/2)` with stroke 10, angle 0, same side; a vertical link gives `x = x0 + gap + h/2`, angle −90.
  An L-shaped edge whose 25 % point lies on the vertical run gives −90 for a2b and 0 for b2a; a 45° diagonal gives a
  box turned by 45 whose near edge is 4 units from the stroke edge. Collisions: a rect on the anchor slides the
  label to the first free candidate towards the end, not towards the split; both sides blocked along the whole leg →
  `no-free-spot`; a leg of 20 units with a 30-unit slot → `short-leg`; two halves on one trunk → the second sits past
  the first; another edge's stroke within its half width → slide; a stroke exactly under the own run → no slide; the
  own run is no obstacle; a bend under the box rejects the candidate. Grid: `near` returns every obstacle a box
  touches and none from far cells; a placement with the grid equals a placement with a flat list. Determinism: two
  runs are deep-equal; a shuffled obstacle list is deep-equal.
- `src/render/labelPlacement.bench.test.ts`: a synthetic grid of 500 edges (1,000 halves, legs of 100 units) and
  2,000 rect obstacles; asserts a full placement under 250 ms in jsdom on CI (the measured figure goes into the
  acceptance row) and that every half is placed or dropped exactly once.
- `src/render/linkLabels.test.ts` (jsdom): the layer is the last child of the root and the overlay groups stay next
  to their edges; one `text` per labelled half with the data attributes, `pointer-events="all"` and the
  `rotate(θ x y)` transform; `hit.ts` resolves a label to its link; a second call with new values changes
  `textContent` only (same elements, same transforms); a half that goes to `nodata` hides its element and keeps it;
  a value-mode text that crosses a grain moves that label only and the percent label next to it keeps its
  transform; a label whose new slot fits nowhere is hidden with `data-dmap-dropped`, keeps its transform and its
  reserved box, and comes back when a later text fits; a hidden label has `pointer-events="visiblePainted"` and
  `hit.ts` does not resolve it; a percent label keeps its slot from `<1%` to `>999%`; `mode: 'none'` draws nothing;
  an unbound half draws nothing; a changed `linkWidth.max` or mode re-places everything; a plain draw.io node
  (`kind: 'other'`) is an obstacle; `statusMarkerBox(entry).bounds` of a patched edge is reserved and
  `drawStatusMarker` writes `anchor` into `x, y`. Coordinates: an edge inside `<g transform="scale(2)">` with
  stubbed `getCTM` and `getPointAtLength` places the split and the labels at the overlay's own points (`x = 168`,
  not `184`, for the reviewer's case) with a gap of `4 + max × 2 / 2` root units; a path with a 3° turn keeps that
  vertex in the root polyline; a 3-unit stroke in the scaled group gives a 3-unit segment clearance in root units.
  `setLinkLabelScale` with a stubbed `getBoundingClientRect`: hidden at `k = 0.2`, shown at `k = 1`, a freshly
  created layer takes the current `k`; `labelsVisible(7 / 8)` is true.
- `src/binding/engine.test.ts`: `percentText`: 0 → `0%`, 0.4 → `<1%`, 0.5 → `1%`, 41.4 → `41%`, 1200 → `>999%`;
  `percentDisplay` equals the percent part of `label`; absent without capacity; `labelMode` on the patch from a
  pattern and from an override that sets `none`.
- `src/model/config.test.ts`: the three modes parse, `both` and an unknown key fail the item; the round trip keeps
  `label`. `src/binding/patterns.test.ts`: `mergeDisplay` leaf, provenance path `link.label`.
- `src/render/zoom.test.ts`: `viewScaleOf` from a stubbed rect and viewBox for Fit, Fit width, a `minScale`
  layout (SVG larger than the panel) and a live view.
- Editor: `BindingFields.test.tsx` writes `link.label.mode`; `leafPaths.test.ts` lists it.

E2E, one new spec `tests/link-labels.spec.ts` in the `plugin` project (the DOM the plugin draws; nothing in it
differs between Grafana versions), run one spec at a time in the worktree, then `npm run e2e:matrix` on main:

1. Percent: the demo dashboard with the WAN pattern set to `percent`; `text.dmap-link-label[data-dmap-cell=ISP_A]`
   for `a2b` reads `41%` and for `b2a` a whole percent; the two texts are on the same side of the edge.
2. Value: the same with `value`: the a2b text matches `/41(\.\d)? Mb\/s/`.
3. No overlap (browser only): for every placed label, its `boundingBox()` does not intersect any
   `g[data-cell-id^="pg-port"] rect`, any `g[data-cell-id^="pg-linkLabel"]` box and any `.dmap-status-marker` (a
   1 px tolerance); on the hand-drawn panel, no label intersects a plain node body.
4. Tap: a tap on a label opens the card of its link (`isp-a ↔ rtr-a`), not of the group under it.
5. Refresh: the `transform` of each label before and after a dashboard refresh is equal; no element is replaced
   (a `data-dmap-placed-at` stamp written at placement).
6. Phone (`devices['Pixel 5']`): in Fit the layer has `visibility="hidden"` on the first frame; after a pinch to 5×
   it is visible; a `minScale: 1.3` dashboard shows it at load.
7. Default: a sheet with no `label` key has no `.dmap-link-label` (the existing `view.spec.ts` dashboard).

Screenshots, inspected before the change is called done (CLAUDE.md "For a layout change, open the screenshot"):
`docs/images/link-labels-percent.png` (L3, desktop), `docs/images/link-labels-value.png`, and
`docs/images/link-labels-phone-zoomed.png`. The `tests/visual-regions.spec.ts` baselines change only when the demo
dashboard turns labels on; the demo dashboard stays at the default and a labelled variant of the WAN pattern goes
into `src/fixtures/demo-config.ts` for the spec only. `docs/acceptance.md` gets a row "Link value labels" with the
spec, the bench figure and the three screenshots.

## 9. Decisions (user, 2026-10-25)

1. Rounded zero: a real `0` shows `0%`; a load above 0 and under 0.5 % shows `<1%` (section 3).
2. Panel-wide default: none; a `kind: 'link'` pattern is the default.
3. Text colour: the theme text colour, not the half colour (no halo: R4-2).
4. Clearance basis: `linkWidth.max`, so the label never moves with the load.
5. Value-mode slot: the current text rounded up to a 4-unit grain; a label can move when the value crosses a grain
   (section 7 limits the move to that label).
6. Split links: every run with halves gets labels; the short-leg rule prunes.
7. Minimum on-screen size: 7 CSS px.
8. Group backgrounds as obstacles: no.

## 10. Review resolutions

| Concern | Resolution |
| --- | --- |
| R1-1. Path-local lengths against root units; `scale(2)` put the split at 184, not 168 | One space, root user units, for every distance. The root polyline is built from the path stops through `geoRoot.pointAt`, the split is the overlay's own `mid` as a vertex, and nothing scales a length by `geo.unit` (section 4). A jsdom test with stubbed matrices pins the reviewer's case (section 8). |
| R1-2. Plain draw.io nodes missing; a tap on a label | Every non-edge cell body is an obstacle, whatever its kind (section 5). The label carries `data-dmap-cell` with `pointer-events="all"`, so `hit.ts` resolves it to its link; an e2e taps one (sections 7, 8). |
| R1-3. Stale cache: `linkWidth.max`; status markers drawn on refresh | `linkWidth.max` and the font family are in the full-placement key. Markers are not read as obstacles; their room is reserved once per stage for every patched cell through `statusMarkerBox`, which `drawStatusMarker` shares, so a marker that appears later is never covered (sections 5, 7). |
| R1-4. `lineAngle` gives +90 for both verticals | `runHeading` tests `|dx| ≤ VERTICAL_EPS` first and returns −90 with the left side first (the side the tops of the letters face; superseded by the owner rule, see section 9); the gravity formula serves non-vertical runs only. The tests say −90 and "first side left" for both vertical directions (sections 4, 8). |
| R1-5. Zoom scale from the panel size; no initial sync | `viewScaleOf(root)` reads the rendered SVG rect and the viewBox; it runs when the layer is created or re-enabled and after every `applyLayout` (section 6); a `minScale` case is in the unit and e2e tests. |
| R1-6. Percent slot ignored the fallback text and large percents | `percentText` bounds at `>999%`; the slot rule of round 1 is replaced by R2-6 (sections 3, 7). |
| R1-7. Segment clearance inconsistent | Half the stroke width everywhere: `linkWidth.max / 2` for a patched edge, half the drawn width otherwise; the shared-trunk argument uses the same figures (section 5). |
| R1-8. A value refresh could move percent labels | A percent label with data never changes its slot. A slot change re-places that one label with every other label fixed; the "no spot" outcome is R2-2 (section 7). |
| R1-9. jsdom cannot test rotated cells or chips | Section 8 opens with the split: pure math, stubbed matrices, cache and text in jsdom; real boxes, fonts, transforms and the rendered scale in the browser e2e (no-overlap check, screenshots). |
| R1-10. Cost without an index; no measured bound | A uniform grid (`obstacleIndex`, 64 units) with a bound for 1,000 halves and a bench test that asserts it (sections 5, 7, 8). |
| R2-1. A hidden label with `pointer-events="all"` still takes taps | `pointer-events="visiblePainted"`: a label hidden by the zoom rule or by a failed re-placement takes no input (section 7; a jsdom test on `hit.ts`). |
| R2-2. A text that overflows its old slot collides | Replaced: a label whose new slot fits nowhere is hidden, keeps its reserved box and tries again on the next refresh; a text is never drawn over an obstacle or outside its slot (section 7). |
| R2-3. `bendLengths` drops turns of 5° or less, so a polyline rebuilt from the bends loses vertices | The root polyline is every vertex of the `d` attribute mapped through `geo.matrix`, plus the split vertex; bends are then measured on it (section 4; a 3° turn case in the tests). |
| R2-4. Stroke clearance in the wrong units inside a transformed group | Every stroke width converts once to root units, `strokeLocal × geo.unit` of its own edge; `LegInput.strokeRoot` and the obstacle table use root figures only (sections 4, 5). |
| R2-5. The marker reservation mixed the rectangle origin with the text baseline | `statusMarkerBox` returns `anchor` (the baseline start `drawStatusMarker` writes) and `bounds` (the painted box of the widest text on that baseline, grown by 1.5 units for the 3-unit halo) separately, in the marker's own space, mapped to root for the reservation (section 5). |
| R2-6. Percent slots changed size with the fallback text | One fixed percent slot, `g(width(">999%"))`, for every percent text; a capacity-less reading follows the value rule and the isolated path (section 7). |
| R3-1. Live run: the halo was a lumpy blob; the two halves stood on opposite sides; the label stood 15.2 px from the stroke | `halo = 1` with round joins and caps. One place per link (`placeLinkLabels`). The owner rules of section 9: on the stroke first with a canvas-coloured gap rect, then beside it with the near edge 2 units beyond the stroke edge (4 for a chip wider than the stroke), the top side being the side of the tops of the letters (left of a vertical run). The 15.2 came from `normalGap = 4` plus the label line box (the box is 12 high for glyphs about 6 high) at the widest stroke `linkWidth.max`. |
| R4-1. Live run: a label on its stroke covered the value text of its own edge | The text of an edge (`entry.label`) is an obstacle for every label, also for the labels of that edge; only the stroke of the own half is exempt. |
| R4-2. The gap rect was near-black, then white on a light panel with a dark diagram; a colour under the label cannot be known safely (paint order, opacity, patterns) | No colour at all: the stroke is cut under the on-stroke text with an SVG mask (section 7, "The cut"). The halo is removed. |
