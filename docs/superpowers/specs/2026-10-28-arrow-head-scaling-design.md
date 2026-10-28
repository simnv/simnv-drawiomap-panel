# The arrow head of a half grows with its drawn width

- Status: accepted 2026-10-28.
- Request: the consumer team's owner, 2026-10-28. On a busy link the head of a half is about as wide as its stroke and
  disappears into it, so the direction is hidden exactly when the load is high. Live example: the demo hand-drawn panel on their smoke sheet,
  `edge-ab` a2b at 42 % of 100 Mb/s is drawn 5.36 units wide, and its head is invisible.
- Scope: `src/render/overlay.ts` (the head, the stroke under it, the split), `src/render/linkLabels.ts` (the head
  obstacle, the legs, the mask area), `src/render/paintStage.ts` (passes `linkWidth.max`), their tests,
  `tests/view.spec.ts`, `README.md`, `CHANGELOG.md`, `docs/acceptance.md`.
- Reads: `docs/superpowers/specs/2026-10-25-link-value-labels-design.md` (the arrowheads are obstacles, read once per
  placement), `docs/superpowers/specs/2026-10-26-simplify-step5-patch-diff-design.md` (the overlay keeps its elements
  across refreshes).

## 1. Why the head disappears

The head is a triangle `ARROW_SIZE` (8) units long with a base of 8 units, in the colour of its half. The stroke of
the half runs to the tip with a butt cap. At the tip the triangle is 0 wide, so the stroke sticks out of the triangle
sides for the first `width` units from the tip. A 5.36-unit stroke covers two thirds of an 8-unit head: the head reads
as a short widening of the stroke, not as an arrow.

## 2. Decisions

1. The head size (its length and its base) is `headSize(w) = max(8, 4 + 2w)` for a half drawn `w` units wide, with
   `w` clamped to `linkWidth.max`. At `w ≤ 2` it is 8, as today. At the default range (2 to 10) the head is 8 to
   24 units, 4× to 2.4× the stroke; each wing stands `(w + 4) / 2 ≥ 3` units beyond the stroke edge.
2. The stroke of a half stops at the middle of its head (`headSize / 2` before the tip). There the triangle is
   `headSize / 2 = w / 2 + 1` units wide on each side of the path, wider than the stroke, so the tip stays sharp. For
   a thin half (8-unit head, 2-unit stroke) the change is less than one pixel at the tip; the look stays.
   A one-way half trims only the end that holds its tip; a tip that stands back from the port (a bend near the
   port) keeps the full stroke, as today.
3. All geometry that the label placement reads is fixed for `linkWidth.max`, not for the drawn width, so a width
   change on a refresh moves no label:
   - The split and the tip of a one-way half keep `headSize(max) + 8` free path to the bends on each side (today
     `2 × 8 = 16`; for `max = 10` it is 32). The triangle at the widest width never crosses a bend. `linkSplit` takes
     the max width, and the label legs call it with the same value as the overlay.
   - The obstacle of a head is the box of the head at `linkWidth.max` (the same tip and direction, the size of the
     widest head), not the drawn polygon. The overlay keeps the reserved triangle of each head; the label module
     reads it through `reservedHead`.
   - The white rect of the mask covers the legs of the link (the root polyline of the path) with the margin
     `3 × max + 20`, not the current box of the overlay group. The group box changes when a head grows; the legs do
     not, so the mask key and the mask stay across refreshes.
4. A width change rewrites the `points` of the half and of its head in place (same elements, same mask). A change
   of colour, status or step only writes those attributes, as today.
5. A new `linkWidth.max` rebuilds the overlay (the split moves) and places the labels again (already part of the
   label key).
6. The end dots and arrows that draw.io draws stay as drawn: their size is in the diagram, and the reservation
   reads them as obstacles as before.

## 3. Out of scope

- An option for the head size. The size follows the width; nothing to tune.
- The `--ge-adaptive-bg` fallback of the sanitiser and the demo fixture fix (a separate change).
