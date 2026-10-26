# Simplify step 5: a patch diff in the applier and the overlay, a path geometry cache

- Status: draft 2026-10-26. Design only; no code in this change.
- Scope: `src/render/applier.ts` (`applyPatches`), `src/render/overlay.ts` (`renderOverlay`), `src/render/geometry.ts`
  (`pathGeometry`), `src/render/linkLabels.ts` (one comment, no logic), `src/components/DrawioMapPanel.tsx` and
  `src/editor/popup/DiagramStage.tsx` (the type of the applied set), their tests, a new bench
  `scripts/bench/refresh.mjs`, `docs/acceptance.md`.
- Reads: the simplify plan (step 5, O2), the consumer team's measurement on a dense sheet of about 300 cells, the
  step 4 spec section 4 (the identity rule of a stale tick), the link labels spec sections 6 and 7 (the placement runs
  once per stage; `syncMasks` runs on every pass), `CODING_STANDARDS.md` "State and data" and "Rendering and layout".
- Out of scope: the bind (`bindPlan` builds new patch objects per result; this step does not change that), the
  placement of the link labels (it already runs once per stage), the mask measurement in `syncMasks` (section 8),
  the legend highlight, the card.

## 1. Goals and decisions

1. A data refresh touches the DOM of a cell only when the patch of that cell changed in a field the applier or the
   overlay reads. A cell with an equal patch gets no attribute write, no style write and no element.
2. The overlay elements of a link (two polylines, two arrow heads) and the status marker of a cell live across
   refreshes. A change of colour, width or status updates the attributes of the existing elements. The layer of a
   link is built again only when its set of halves changes (a half appears or goes) or the stage changes.
3. The path geometry of an edge (`getTotalLength`, `getPointAtLength`, the parsed vertices, the bends) is measured
   once per path element and reused by every caller: the overlay, the status marker and the link label legs. A new
   diagram has new elements, so it measures again. A resize or a zoom changes the viewBox of the root and no path, so
   nothing is measured again.
4. The visible result does not change: the same colours, widths, arrow heads, markers, texts, masks, `data-dmap-*`
   attributes, tab stops and `aria-label`, the same z-order. The hover card and the keyboard access see the same
   elements as before, only older.
5. Equality is structural, not by identity. A refresh is a new bind with new patch objects (step 4 keeps identity on a
   stale tick only), and the overlay tests change a view inside one patch object and render again. The key of a cell
   is a short string of the fields that the applier or the overlay reads (section 3). Two patches with the same key
   draw the same picture.

## 2. Today: the flow

Both callers (`DrawioMapPanel.tsx:520-536`, `DiagramStage.tsx:125-137`) run, in one animation frame after each
`result`:

1. `applyPatches(index, patches, previous: Set<string>, interactive?)` (`applier.ts`): resets every cell of
   `previous` (fill, stroke, stroke width, the icon fill, the end markers, the label text, five `data-dmap-*`
   attributes, the owned `tabindex`, `role` and `aria-label`), then applies every patch (the same writes in the other
   direction). About 15 writes per cell per refresh; for 300 cells, about 4 500 attribute and style writes, all of them
   for cells whose data did not change.
2. `renderOverlay(root, index, patches, { theme })` (`overlay.ts:142-164`): removes every `g.dmap-overlay` and every
   `.dmap-status-marker` under the root with two `querySelectorAll` sweeps, then for every link patch calls
   `pathGeometry(entry.line, layer)` (two `getCTM`, one `getTotalLength`, a parse of `d`, the bends) and
   `geo.polyline` and `geo.pointAt` (one `getPointAtLength` per sample point, about one per four units of length, plus
   three per arrow tip), creates two polylines and two polygons per two-way link, and one marker group per non-normal
   status. In the browser profile of the hover bench, `getPointAtLength` was the top self-time frame of the panel's
   own code (`docs/acceptance.md`, the card-hover table). The consumer team's live profile shows the same frame on a
   refresh, for every link of the sheet.
3. `renderLinkLabels(root, index, patches, opts)` (`linkLabels.ts:141-202`): with the same key, `refresh` writes the
   texts and the drawn widths that changed; then `syncMasks` (`linkLabels.ts:794-923`) selects every `.dmap-half` and
   `.dmap-arrow` of the root again, measures the labels, and sets `mask="url(#...)"` on the new elements of every
   masked link. Its comment says why: "the overlay is drawn again on each frame". A mask whose key did not change is
   not rebuilt.

Item 3 holds the links' placement across refreshes because the spec of step 2 of the link labels asked for it. Items
1 and 2 do not: the applier and the overlay rebuild everything.

## 3. The new flow

### 3.1 The applier

```ts
/** What one apply left in the DOM: the key of the applied patch per cell, for the index and the colour scheme it was applied under. */
export interface Applied {
  index: CellIndex;
  isDark: boolean;
  keys: Map<string, string>;
}
export function applyPatches(
  index: CellIndex,
  patches: PatchMap,
  previous?: Applied,
  interactive?: Set<string>,
  isDark?: boolean
): Applied;
```

`applyKey(patch, interactive): string` is one function in `applier.ts`. It joins the fields the applier reads:
`shape` (`status`, `stepIndex`, `target`, `color`, `text`), `unavailable` (`color`, `reason`), `link.a2b` and
`link.b2a` (`status`, `color`, `width`, `stepIndex`), `statusView` (`state`, `reason`) and the `interactive` flag
(`tag` reads `status` and `stepIndex` of the shape and of both halves for `data-dmap-status` and `data-dmap-step`,
R1-1). `JSON.stringify` of a short array is the format: a missing part is `null`, so `shape.text` undefined and
`shape.text` `""` differ. The cell label of `aria-label` comes from `entry.meta`, constant per index, so it is not in
the key.

The colour scheme (R1-3). `paints()` decides from the effective style whether an end marker gets the colour of its
half; a `light-dark()` paint resolves against the `color-scheme` of the root, which the panel writes from
`theme.isDark`. The patches do not carry it (an ok half keeps its threshold colour in both themes), so the callers pass
`theme.isDark`, and `Applied` records it. A pass with another `isDark` than `previous` resets and writes every cell, as
every pass did before this step.

The pass:

1. `previous` applies when `previous.index === index`; else it counts as empty. A new stage has new elements: every
   patch is applied, nothing is reset (the old DOM is gone).
2. The changed set: the cells of `patches` whose key differs from `previous.keys` (or are new), plus every cell of
   `previous.keys` that is not in `patches` or has no entry. With another `isDark`, every cell of both.
3. A node and its icon cell change together (R1-2). `applyShape` of a node with `target: 'icon'` colours the shape of
   its icon cell (`entry.iconId`), and `reset` of the icon cell puts the icon's own fill back. If the icon cell has a
   patch of its own (a url, an unavailable state) and only one of the two changes, the one that is skipped loses its
   paint. So the changed set is closed over both relations of the index (`CellEntry.iconId`: a node to its icon;
   `CellEntry.ownerId`: a part, the icon, the icon tile or a description, to its node) until nothing is added: a
   changed description leads to its node, and the node to its icon, so the icon's own grey patch is written again
   after the node coloured it (R2-1). Only cells with a patch now or before join. The closure is bounded by the
   parts of one node.
4. Resets first, then writes, as today (a node colours the icon of another cell; a later reset must not undo it).
   Every cell of the changed set that is in `previous.keys` is reset; then every cell of the changed set that is in
   `patches` and has an entry is written, in the order of `patches`, with the functions of today (`applyShape`,
   `applyUnavailable`, `applyLink`, `tag`) and no change in them.
5. A cell outside the changed set is not touched: no reset, no write, no `setOwnedAttrs` call. Its `written`,
   `iconOwner` and `endOriginal` records stay, so the reset of a later change still puts the diagram's values back.
6. The result holds `index`, `isDark` and the keys of every cell that was written or kept.

`markInteractive(index, ids, previous?: Marked): Marked` with `Marked = { index, ids }`. Today it writes the
attribute on every interactive cell on every pass; it now writes only the cells that are new in `ids` and removes
only the ones that left (R1-5). `previous` of another index counts as empty, the rule of `Applied`: the ref of the
panel survives a new stage, and the new elements get the attribute (R2-2).

The OS preference (R2-3, R6-1). A descendant could carry `style="color-scheme: light dark"` (an accepted inline
style) and a `light-dark()` paint: its subtree follows the OS preference, and `paints()` would change with no change
of `isDark`. The first design stripped `color-scheme` from descendants in the sanitizer; four review rounds found a
bypass each (case, escapes, comments, the CSS recovery rules), because a lexical strip cannot follow the browser's CSS
tokenizer, and `color-scheme` is not a security property. The sanitizer is unchanged. Instead the OS preference is the
second input of the applier's colour scheme: `ColourScheme = { isDark, osDark }` with `osDark =
matchMedia('(prefers-color-scheme: dark)').matches`, read through `useOsDark()` (`useSyncExternalStore` over the
media query's `change` event; the listener goes on unmount; a host without `matchMedia` gives false). A change of
either value writes every cell again. draw.io writes `color-scheme` on the root only (0 of 2 195 descendant styles in
`fixtures/` and the consumer team's samples), so the case is cosmetic and rare, and it is correct.

### 3.2 The overlay

`renderOverlay(root, index, patches, opts)` keeps its signature. Its state is per root, in a
`WeakMap<SVGSVGElement, OverlayState>`:

```ts
interface HalfDrawn {
  line: SVGPolylineElement;
  arrow: SVGPolygonElement;
  key: string;
} // key: status|color|width|stepIndex
interface LinkDrawn {
  layer: SVGGElement;
  combo: 'ab' | 'a' | 'b';
  a2b?: HalfDrawn;
  b2a?: HalfDrawn;
}
interface MarkerDrawn {
  layer: SVGGElement;
  key: string;
} // key: state|reason|fill|halo colours
interface OverlayState {
  index: CellIndex;
  arrowSize: number;
  links: Map<string, LinkDrawn>;
  markers: Map<string, MarkerDrawn>;
}
```

The pass:

1. The state belongs to `(root, index, arrowSize)`. With another index or arrow size, the two `querySelectorAll`
   sweeps of today remove every overlay group and marker under the root, and the state starts empty. This is the only
   case that sweeps the DOM.
2. Links. For each patch with a half and an entry with a line: `combo` names the halves present. A drawn link with the
   same `combo` whose layer still has a parent (`isConnected` is false in the detached hosts of the tests) is updated in place: for each half whose key changed, the polyline
   gets `stroke`, `stroke-width`, `data-dmap-status` and `data-dmap-step`, the polygon gets `fill`. The `points`
   attributes are not written: the geometry of a half depends on the path and the combo only. Else (new link, a new
   combo, a layer that is gone) the old layer is removed and `drawLink` runs as today; the new elements go into the
   state. A path with no length draws nothing, as today, and holds no record.
3. A drawn link whose cell has no half in `patches` any more (or no entry) loses its layer and its record.
4. Markers. For each patch with a non-normal `statusView` and an entry: a drawn marker with the same key stays. Else
   the old marker is removed and `drawStatusMarker` runs as today. A drawn marker of a cell that is now normal, has
   no view or no patch is removed.
5. The place of a kept marker (R1-4). `drawStatusMarker` puts the marker right after the primitive (`primitive.after`),
   so on an edge without arrow heads the order is path, marker, overlay: the marker lies under the halves. A rebuilt
   layer goes after the path again (`ensureOverlay` anchors on the path and its arrow heads), which would put the
   kept marker above the new layer. So the marker step moves a kept marker back when it is not the next sibling of
   its primitive (`primitive.after(marker)`, one move on a rebuild, nothing on a kept layer). The child order of
   path, marker, arrow heads, overlay is the same as a fresh render in every case (test on the child order).
6. `ensureOverlay` does not change: it already returns the existing layer after the arrow heads. A kept layer is not
   looked up at all: the state holds it.

The z-order holds: an updated element keeps its place; a rebuilt layer goes where `ensureOverlay` puts it, as today,
and the marker of its cell goes back under it.

The mask. `syncMasks` sets `mask` only when the attribute differs and removes it from the strokes of a link that lost
its mask. An updated polyline keeps its `mask` attribute; a rebuilt layer has none and gets it in the same pass,
because both callers run `renderLinkLabels` after `renderOverlay`. The comment "the overlay is drawn again on each
frame" becomes "a rebuilt layer has no mask yet". No logic changes in `linkLabels.ts`.

The hover card. `hit.ts` finds the cell of an overlay element by `data-dmap-cell`; the element under the pointer now
stays the same element across refreshes. The native `pointerleave` listener of the panel (for the case that the
redraw removed the element under the pointer) stays: a rebuilt layer is still possible.

### 3.3 The geometry cache

`pathGeometry(line, target)` keeps its signature and its two branches. The measurements that depend on the path only
are cached per path element in a `WeakMap<SVGPathElement, LocalGeom>`:

```ts
interface LocalGeom {
  length: number; // getTotalLength once, or the parsed polyline length in jsdom
  bends: number[]; // from the parsed vertices, scaled to `length` as today
  parsed: Point[]; // parsePathPoints(d) once
  at(d: number): Point; // getPointAtLength(clamp(d)) memoised per d, in the path's user space
  samples(from: number, to: number): Point[]; // the sample points of `polyline(from, to)` memoised per pair, path space
}
```

The matrix `M` (the inverse of `target.getCTM()` times `line.getCTM()`) is read on every call, as today: it is the
part that a test stubs per call and that a host without layout gives as null; it is not cached. `pointAt` and
`polyline` map the cached path-space points through `M` (no mapping for the identity). `unit` and `matrix` come from
`M`.

Who calls it after this step: `drawLink` for a new or rebuilt link only (section 3.2); `statusMarkerBox` for a new
or rebuilt marker and for the full placement of the labels; `edgeLegs` for the full placement. A refresh with equal
link sets and equal markers calls no `getPointAtLength`, no `getTotalLength` and no `getCTM`.

Invalidation. The cache is keyed by the element. A new diagram (a save in the editor, a new panel option) builds a
new stage with new elements: the old entries go with them. The stage DOM is immutable after `buildCellIndex`: nothing
writes `d` or `transform` of an edge path (the applier writes styles and `data-dmap-*` only; the zoom writes the
viewBox of the root). A resize changes the panel size and the viewBox, not the path. The matrix between the path and
its sibling layer does not depend on the viewBox. So the cache has no time and no size input; nothing clears it by
hand.

## 4. What changes on a refresh

| Output                                                        | Equal patch (same key)         | Colour or width change                                                   | A half appears or goes, or a new stage    |
| ------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------- |
| the shape fill, stroke, icon, end markers, label text         | not touched                    | reset, then written                                                      | reset, then written                       |
| `data-dmap-status`, `-step`, `-target`, `-reason`, aria attrs | not touched                    | reset, then written                                                      | reset, then written                       |
| the overlay polylines and polygons                            | the same elements, not touched | the same elements; `stroke`, `stroke-width`, `fill`, two data attributes | new elements in a new layer               |
| the `points` attributes, `getPointAtLength`, `getCTM`         | none                           | none                                                                     | from the cache (the matrix is read)       |
| the status marker                                             | the same element               | the same element (a new reason: a new element)                           | a new element                             |
| the `mask` attribute of the strokes                           | stays                          | stays                                                                    | set again by `syncMasks` in the same pass |
| the link label text and drawn width                           | as today (`refresh`)           | as today                                                                 | as today (a full placement on a new key)  |

## 5. The bench

`scripts/bench/refresh.mjs`, in the style of `card-hover.mjs`: it opens the demo dashboard on `GRAFANA_URL`, installs
in the page (before the plugin loads) a `MutationObserver` over the stage of each panel, counters around
`SVGPathElement.prototype.getTotalLength`, `getPointAtLength` and `SVGGraphicsElement.prototype.getCTM`, and a wrapper
of `requestAnimationFrame` that times each callback and takes the mutation records right after it. Then it clicks the
refresh button `REFRESHES` times (default 10) with a gap (`GAP_MS`, default 1500), and prints, per panel: the DOM
mutations per refresh (median and max), the duration of the animation frame callbacks that mutated the stage (the
apply pass: applier, overlay, labels; median and p90), and the path API calls per refresh. The demo queries are
synthetic series that change with time, so the colours and widths of some links change on each refresh; the numbers
show the cost of the equal cells against the changed ones. The bench is not an e2e project and does not run in CI.

Measure before (the dist of `main`) and after on 13.2, 1600×1000; put both rows in `docs/acceptance.md`.

## 6. Migration of each caller

| Caller                                  | Today                                                                                               | After                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `DrawioMapPanel.tsx`                    | `patchedRef = useRef<Set<string>>(new Set())`; `applyPatches(..., patchedRef.current, interactive)` | `useRef<Applied>()`; `applyPatches(..., patchedRef.current, interactive, theme.isDark)`; nothing else changes                |
| `DiagramStage.tsx`                      | `patched = useRef<Set<string>>(new Set())`                                                          | `useRef<Applied>()`; `applyPatches(stage.index, patches, patched.current, undefined, theme.isDark)`                          |
| `overlay.ts` `renderOverlay`            | sweeps and redraws                                                                                  | the state per root (section 3.2); `drawLink`, `drawStatusMarker`, `ensureOverlay` unchanged, `drawHalf` returns its elements |
| `geometry.ts` `pathGeometry`            | measures per call                                                                                   | the per-element cache (section 3.3); same `PathGeom`                                                                         |
| `linkLabels.ts` `syncMasks`, `edgeLegs` | unchanged logic                                                                                     | one comment; `edgeLegs` reads the cache through `pathGeometry`                                                               |
| the tests of `applyPatches`             | `applyPatches(index, patches, new Set())`                                                           | `applyPatches(index, patches)`; `prev` is the returned `Applied`                                                             |

## 7. Test plan

Unit, `npm run test:affected` in the worktree; the full suite once on main before the push. Failing tests first.

- `src/render/applier.test.ts`: a second apply with equal patches (new objects, the same values) makes no DOM
  mutation (`MutationObserver.takeRecords()` on the host is empty) and returns the same keys; a changed colour of one
  cell writes that cell only (the records name its elements, no other); a removed cell is reset; a changed
  `interactive` flag rewrites the tab stop; an `Applied` of another index counts as empty (every patch is written, no
  reset); the editor's owned attributes survive an equal apply (the existing test stays green); the end-marker and
  text cases stay green with the new signature. The review cases: a shape whose `stepIndex` (or `status`) changes
  with the same colour gets the new `data-dmap-step` (R1-1); a node that colours its icon keeps the icon colour when
  the patch of the icon cell changes or goes, and the icon cell keeps its own grey when the node's patch changes
  (R1-2); an end dot with a `light-dark()` fill is evaluated again after a pass with another `isDark` (R1-3);
  `markInteractive` with the same ids makes no mutation (R1-5).
- `src/render/overlay.test.ts`: a second render with equal halves keeps the same polyline and polygon elements
  (`isSameNode`) and makes no mutation under the root; a colour and width change updates `stroke`, `stroke-width`,
  `data-dmap-status`, `data-dmap-step` and the arrow `fill` on the same elements and leaves `points` and a `mask`
  attribute set by hand in place; a half that goes (two-way to one-way) rebuilds the layer of that link only, the
  other link keeps its elements; a marker with the same state and reason is the same element; a new reason is a new
  element; a normal view removes it; a link patch that goes removes its overlay; a new index removes every element of
  the old render ("clears the previous render" adapted); the theme change case: a new theme draws the markers again;
  the child order on an edge without arrow heads is path, marker, overlay after a fresh render and after a rebuild of
  the layer with a kept marker (R1-4).
- `src/render/geometry.test.ts`: with stubbed `getTotalLength`, `getPointAtLength` and `getCTM` on one path, two
  `pathGeometry` calls and the same `pointAt` and `polyline` arguments call `getTotalLength` once and
  `getPointAtLength` once per distinct arc length, and `getCTM` on every call; a second path element measures again;
  the jsdom branch gives the same points as before (the existing cases stay green).
- `src/render/linkLabels.test.ts`: two passes of `renderOverlay` then `renderLinkLabels` with new half objects of the
  same values: the strokes are the same elements and keep their `mask`; a pass with a changed colour keeps the mask on
  the updated elements; a pass after a half went away sets the mask on the rebuilt elements.
- `src/components/DrawioMapPanel.test.tsx`: "a data refresh with equal values keeps the overlay elements": two results
  with the same values give the same `polyline.dmap-half` elements (`isSameNode`) and the same outer HTML; the pause
  tests and their applier counts stay green (the applier is still called once per result; it writes less).

E2E, when the coordinator frees the shared dist, one spec at a time on 13.2: `tests/refresh.spec.ts` (its control
step expects at least one mutation per refresh without the popup: the demo query is a random walk, so a width
changes; the popup pause step still expects zero), `tests/link-labels.spec.ts` ("a dashboard refresh keeps every
label element and its transform"; the masks), `tests/links.spec.ts` (the hover card over a half), `tests/view.spec.ts`
and `tests/color.spec.ts` (the colours after the first refresh), `tests/legend.spec.ts` (the highlight over the
patched cells). On main before the push: `npm run e2e:matrix` (the rendered panel changes).

Docs in the same diff: `docs/acceptance.md` (a "Patch diff and geometry cache" block with the check table and the
bench rows before and after); the link labels spec, section 7 bullet "The cut" (the reason `syncMasks` runs on every
pass). The README changes nothing: no option changes.

## 8. Open questions, with a recommendation each

1. `syncMasks` still measures every on-stroke label (`getBBox`) and the box of every masked overlay group on every
   pass, then compares keys. That is label geometry, not path geometry, and the writes are already skipped.
   Recommendation: out of scope; the bench reports the pass time, and a follow-up can key the measurement on the
   label records that changed.
2. The key of the applier could be the patch identity first and the string second (a stale tick keeps identity).
   Recommendation: the string only; one rule is simpler, and the string costs microseconds per cell.
3. A status marker whose cell moved (nothing moves a cell) or whose font changed (constant) would need a new box.
   Recommendation: no handling; a new stage rebuilds everything.
4. (closed by R1-5) `markInteractive` diffs its writes too.

## 9. Review resolutions

Review 1 (Codex, 2026-10-26, the spec at `eec0c82`). No finding on the geometry cache and its invalidation, the mask,
the hit test, the popup stage, the bench method or the e2e plan.

| Concern                                                                                                                                                                   | Resolution                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-1 (P1). The key omitted `shape.status` and `shape.stepIndex`, which `tag` reads: a threshold change with the same colour left stale data attributes                    | Both are in the key (section 3.1; test "a shape whose stepIndex changes with the same colour").                                                                                             |
| R1-2 (P1). A changed or removed patch of an icon cell was reset while its unchanged node owner was skipped: `reset` put the icon fill back and the node colour was lost   | The changed set closes over the node and its icon cell through `iconId` and `ownerId`; both are reset and written together (section 3.1, item 3; tests "a node that colours its icon ..."). |
| R1-3 (P1). The key ignored the theme in `paints()`: an end dot with a `light-dark()` fill kept its patched paint after a theme switch, where it had to be evaluated again | The callers pass `theme.isDark`; `Applied` records it; another value resets and writes every cell (section 3.1, "The colour scheme"; test "an end dot with a light-dark() fill").           |
| R1-4 (P1). A kept marker stayed above a rebuilt layer: on an edge without arrow heads the order went from path, marker, overlay to path, overlay, marker                  | The marker step moves a kept marker back after its primitive when it is not the next sibling (section 3.2, item 5; test on the child order).                                                |
| R1-5 (P3). The text said `markInteractive` already diffs; it rewrote every interactive cell that stays on each pass                                                       | It writes only the new ids and removes only the ones that left (section 3.1; test "makes no mutation with the same ids").                                                                   |

Re-check (Codex, 2026-10-26, the spec at `2a4557e`). R1-1 and R1-4 accepted.

| Concern                                                                                                                                                                       | Resolution                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-1 (P1). One hop from a changed description reached its node, but not the node's icon: the node repainted the icon and the icon's unchanged grey patch was skipped and lost | The changed set is the closure over `iconId` and `ownerId` (section 3.1, item 3; test "a changed description of the node leaves the grey of the icon cell in place").                                      |
| R2-2 (P2). `markInteractive` skipped the retained ids after a new stage mounted, but the ref survives the stage: the new elements lost the attribute and the hand cursor      | `Marked = { index, ids }`; another index counts as empty (section 3.1; test "marks the cells of a new stage").                                                                                             |
| R2-3 (P2). A descendant with an accepted `color-scheme` inline style and a `light-dark()` paint followed the OS preference; `paints()` changed with the same `isDark`         | The sanitizer strips `color-scheme` from descendants; the root keeps its own (section 3.1, "The sanitizer"; `sanitize.test.ts` "keeps the colour scheme of the root and strips it from every descendant"). |

Found during the implementation: `dropMasks` took the mask off the strokes with the selector `[mask^="url(#dmap-lm-"]`,
which jsdom does not match; the strokes were new on every pass before this step, so the miss had no effect. It now
filters `[mask]` by the prefix (the one logic change in `linkLabels.ts`).

Review 3 (Codex, 2026-10-26, the src diff `e5a27d5..41958c9`). One finding, nothing else, privacy included.

| Concern                                                                                                                                                                                                                                                                | Resolution                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3-1 (P1). The strip of `color-scheme` chose its elements with the case-sensitive selector `[style*="color-scheme"]`; a declaration such as `COLOR-SCHEME: light dark` (CSS property names are case-insensitive) survived, and the attribute form matched one spelling | Every `[style]` element is filtered with a case-insensitive declaration match in a split on `;`; every attribute whose lower-cased name is `color-scheme` goes from every descendant. No CSSOM: jsdom's `cssstyle` drops `light-dark()` values on a re-serialisation (`d003d9f`; test "in any case, with any whitespace, with !important, and as an attribute"). |

Re-check 2 (Codex, 2026-10-26, the fix `d003d9f`). Still blocking: a name behind a CSS escape (`color\-scheme`,
`\63 olor-scheme`) or a comment (`color-scheme/**/:`) survived; and the split on `;` damaged a quoted value with `;`.

| Concern                                                                       | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R4-1 (P1). CSS escapes and comments in the declaration name passed the filter | `splitDeclarations` walks the style and splits on `;` outside quotes and parentheses only; `setsColorScheme` takes the name before the first `:`, trims it, and drops the declaration when it is `color-scheme` in any case or when it holds a backslash, a `/` or a `*` (draw.io writes neither an escape nor a comment in a name). The values are not read; the kept declarations are joined with `; `; an empty result removes the attribute. Test "drops a descendant declaration whose name hides behind a CSS escape or a comment, and keeps a quoted value whole" (the three names, a quoted value with `;` and `:`, a `;` inside parentheses, idempotent). |

Re-check 3 (Codex, 2026-10-26, the fix `2956c16`). Still bypassable: the splitter was not a CSS tokenizer (comment contents
and escaped punctuation in values counted as structure; an unescaped line break did not end a string).

| Concern                                                                                                                                                          | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R5-1 (P1). `fill: red /* ( */; color-scheme: light dark`, `font-family: x\(; color-scheme: light dark` and a quoted value with a line break kept the declaration | Fail closed: a descendant style that holds a backslash, a comment, a line break (`\n`, `\r`, `\f`) or an unbalanced quote or parenthesis (the simple scan) is removed whole; the grammar left is plain declarations with quotes and parentheses, which the scan reads exactly, and the name check stays. Count over every SVG in `fixtures/` (5 files, 717 descendant style attributes) and the consumer team's theme samples (9 files, 1 478): 0 removed. `docs/security.md` says so. Test "removes the whole style of a descendant that holds an escape, a comment, a line break or an unbalanced quote or parenthesis" (nine styles, each gone; idempotent) and "keeps a draw.io style byte for byte". |

Re-check 4 (Codex, 2026-10-26, the fix `7a87ef9`). Two more bypasses: the bad-URL recovery (`fill: url(#x(); color-scheme:
light dark; x:())`, CSS Syntax 3, 4.3.6 and 4.3.15) and an upper-case `STYLE` attribute, which the XML selector misses
and DOMPurify lowercases afterwards.

| Concern                                                                                | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R6-1 (P1). A lexical strip cannot beat the CSS recovery rules; four rounds of bypasses | The strip is dropped: `sanitize.ts`, its tests and the `docs/security.md` paragraph are back at their state on main. The OS preference is a key input of the applier instead (`ColourScheme = { isDark, osDark }`; section 3.1 "The OS preference"); both callers read it through `useOsDark()` and a change writes every cell again, as a theme change does. Tests: `applier.test.ts` "another theme or OS colour scheme resets and writes every cell", `useOsDark.test.tsx` (follows a change, removes its listener on unmount, false without `matchMedia`), `DrawioMapPanel.test.tsx` "an OS colour scheme change runs the applier once more". |
