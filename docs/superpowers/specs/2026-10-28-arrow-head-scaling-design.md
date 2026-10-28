# The arrow head of a half grows with its drawn width

- Status: accepted 2026-10-28.
- Request: the consumer team's owner, 2026-10-28. On a busy link the head of a half is about as wide as its stroke and
  disappears into it, so the direction is hidden exactly when the load is high. Live example: the demo hand-drawn panel on
  their smoke sheet, `edge-ab` a2b at 42 % of 100 Mb/s is drawn 5.36 units wide, and its head is invisible.
- Scope: `src/render/overlay.ts` (the head, the stroke under it, the split), `src/render/linkLabels.ts` (the head
  obstacle, the split of the legs, the mask area), `src/render/paintStage.ts` (passes `linkWidth.max`), their tests,
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

1. For a half drawn `w` units wide (clamped to `linkWidth.max`), with `e = max(0, w − 2)`, the head has the base
   `8 + 2e` and the length `8 + e / 2`. At `w ≤ 2` it is 8 by 8, as today. At `w = 10` it is 24 wide and 12 long
   (a right angle at the tip). The base is 4× to 2.4× the stroke over the range 2 to 10; each wing stands
   `(w + 4) / 2 ≥ 3` units beyond the stroke edge.
   The length grows at a quarter of the rate of the base: along the path the head takes room from the value label of
   its half (decision 3, and `docs/superpowers/specs/2026-10-25-link-value-labels-design.md`), and a short link
   would lose its label or push it off the line. Two earlier versions were too long. A square head (`4 + 2w` long)
   dropped the a2b value label of the 104-unit WAN link of the demo L3 sheet at `linkWidth.max` 10 (the e2e
   `link-labels.spec.ts` caught it). A head `8 + e` long (16 at max 10) moved the on-stroke labels of four
   129-px links of a consumer team sheet beside the stroke (their label probe caught it, revision 2 below).
2. The stroke of a half stops at the middle of its head (half the head length before the tip). There each side of
   the triangle stands a quarter of the base, `w / 2 + 1`, from the path: 1 unit beyond the stroke edge, so the tip
   stays sharp. For a thin half (8-unit head, 2-unit stroke) the change is less than one pixel at the tip; the look
   stays.
   A one-way half trims only the end that holds its tip; a tip that stands back from the port (a bend near the
   port) keeps the full stroke, as today.
3. All geometry that the label placement reads is fixed for `linkWidth.max`, not for the drawn width, so a width
   change on a refresh moves no label:
   - The split and the tip of a one-way half keep the longest head to the bends, at least `2 × 8 = 16` (the
     clearance before the heads grew). Up to `max = 10` the split and the tips stand where they stood; a tip stays
     at a port behind the usual 20-unit draw.io jetty. The triangle at the widest width never crosses a bend.
     `linkSplit` takes the max width, and the label legs call it with the same value as the overlay.
   - The obstacle of a head is the triangle of the head at `linkWidth.max` (the same tip and direction, the size of
     the widest head), not the drawn polygon and not its box: a convex `polygon` obstacle that the placement tests
     with a separating-axis test against the turned label box. A label beside the stroke may stand next to the
     narrow end of a head. The overlay keeps the reserved triangle of each head; the label module reads it through
     `reservedHead`.
   - A link so short that every spot beside its stroke meets a widest head (a 36-unit link of a consumer team
     sheet: two "<1%" labels beside the stroke at the split) gets one more pair of sides, ±3
     (`top-head`, `bottom-head`): the near edge of the box stands the wide gap beyond the wing of the widest head
     (`headRoot = base(max)`). It is the last rung of the ladder, so every label that has a place on the lower rungs
     keeps it.
   - The white rect of the mask covers the box of the edge path with the margin `3 × max + 20`, not the current box
     of the overlay group. The group box changes when a head grows; the path box does not (a curve counts with its
     bulge, as `getBBox` gives it), so the mask frame stays across refreshes. The black slots still follow the drawn
     width, as before.
4. A width change rewrites the `points` of the half and of its head in place (same elements, same mask). A change
   of colour, status or step only writes those attributes, as today.
5. A new `linkWidth.max` rebuilds the overlay (the split moves) and places the labels again (already part of the
   label key).
6. The end dots and arrows that draw.io draws stay as drawn: their size is in the diagram, and the reservation
   reads them as obstacles as before.

## 3. Revision 2 (2026-10-28, the consumer team's label probe)

The first push (`ceea077`) used a head `8 + e` long, a split clearance of the longest head plus 8 and the box of the
head as the obstacle. On the consumer team's sheets it moved the labels of four short links off the line and dropped
both labels of a 36-unit link. Revision 2 shortens the head (`8 + e / 2`), restores the clearance of 16, makes the
obstacle the triangle and adds the sides ±3. A local replay of both sheets in jsdom (every link with two thin
percent-labelled halves, `linkWidth` 2 to 10) gives the label places of the commit before the heads grew, except:
the labels of those four links stay on the line one step (4 units) farther from the split, and the two labels of the 36-unit link
stand beside the heads (7 units farther out) instead of beside the stroke.

## 4. Out of scope

- An option for the head size. The size follows the width; nothing to tune.
- The `--ge-adaptive-bg` fallback of the sanitiser and the demo fixture fix (a separate change).
