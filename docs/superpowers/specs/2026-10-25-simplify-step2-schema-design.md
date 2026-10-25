# Simplify step 2: one v2 schema, per-direction capacity, per-item validation

- Status: decided 2026-10-25 (all open questions; no backward compatibility), revised after three reviews (section 9)
- Scope: `src/model/config.ts`, `src/binding/patterns.ts`, `src/binding/engine.ts`, `src/binding/status.ts`,
  `src/interact/cardModel.ts`, `src/render/applier.ts`, a new `src/binding/capacity.ts`, the editor fields that write
  `display.link`, the popup list and inspector for a skipped item, the fixtures and the README.
- Reads: the simplify plan (step 2, agreed 2026-10-23), ADR 0002, `CODING_STANDARDS.md`, the PoC spec section 8.
- Out of scope: the link value labels (section 6 gives only the interface), the snapshot store (step 3), `nowMs` (step 4).

## 1. Goals and decisions

1. One zod schema is the source of the config types: `export type DiagramConfig = z.infer<...>`. The hand-written
   interfaces in `config.ts` lines 12-165 go away. The display schema shares nothing with the deleted version 1 rules.
2. One saved shape for the sources of a capacity, `{ capacity, capacityBinding }` (two leaves), at four places: the
   link, each link direction, the combined card row, each of its series entries. One `resolveCapacity` for link halves
   and card directions.
3. The capacity text uses the unit of the value field. Today `half()` (`engine.ts:401-404`) formats every capacity with
   `getValueFormat('bps')`, so a field in m³ shows `45% of 4.1 b/s`. The meaning of a saved number does not change: bit/s
   at a link place, the unit of the values at a row place.
4. One invalid item no longer empties the plan. `resolvePatterns` (`patterns.ts:280-284`) returns an empty plan on any
   diagnostic. After step 2 it skips only an item that does not parse, shows the cells that item touched as unavailable,
   and reports where.
5. **No migration.** Decision of the user, 2026-10-25: no backward compatibility before 1.0; the consumer team regenerates its
   dashboards. The new shape is **`version: 3`**. A config with `version: 2` gives one diagnostic at the root and binds
   nothing (section 3). There is no `upgradeConfig`, no `setMigrationHandler`, no sentinel for old values, no scan for
   old keys. The step 1 upgrade code goes too.

## 2. The schema

Sketch in zod. Names in `PascalCase` are the exported `z.infer` types.

```ts
// --- shared ---
const binding = z.object({ queryId: nonempty, match: z.record(matcher), field: nonempty.optional(), reducer }).strict();
export type QueryBinding = z.infer<typeof binding>;

/** A ${...} template that resolves to a positive number at run time. */
const capacityTemplate = z.string().regex(/\$\{[^\s{}]+\}/, 'Use a number or a template like ${cell.capacity_bps}.');
/** A capacity value: a positive number or a template. Unit: see "Unit rules". */
const capacityValue = z.union([z.number().positive().finite(), capacityTemplate]);
/** The two sources of one level. The same pair at the link, a direction, a combined row and a series entry. */
const capacitySources = { capacity: capacityValue.optional(), capacityBinding: binding.optional() };
export type CapacitySources = { capacity?: z.infer<typeof capacityValue>; capacityBinding?: QueryBinding };

// --- link ---
/** `binding` is optional in a saved patch (an override may set only a capacity); a merged direction without one is inert. */
const linkDirection = z.object({ binding: binding.optional(), ...capacitySources }).strict();
export type LinkDirection = z.infer<typeof linkDirection>;
const link = z.object({ enabled: z.boolean().optional(), a2b: linkDirection.optional(), b2a: linkDirection.optional(), ...capacitySources }).strict();

// --- shape (unchanged fields, now inferred) ---
const shape = z.object({ enabled: z.boolean().optional(), binding: binding.optional(), target: z.enum(['icon', 'shape', 'stroke', 'none']).optional(), text: z.boolean().optional() }).strict();

// --- hover rows ---
const rowBase = { label: nonempty, unit: z.string().optional(), url: z.string().optional(), freshness: freshness.optional() };
const bounded = { min: lowerBound.optional(), max: z.number().finite().optional() };
const rowHeight = z.number().finite().min(ROW_HEIGHT_MIN).max(ROW_HEIGHT_MAX).optional();
const directionSeries = z.object({ binding, direction: z.enum(['up', 'down']), label: z.string().optional(), ...capacitySources }).strict();
const hoverRow = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), ...rowBase, ...bounded, binding }).strict(),
  z.object({ kind: z.literal('history'), ...rowBase, ...bounded, binding, height: rowHeight }).strict(),
  z.object({
      kind: z.literal('combined'),              // was: kind "history" with a `series` list
      ...rowBase,
      min: lowerBound.optional(),               // a row with one direction only, as today
      series: z.array(directionSeries).min(1).max(2),
      ...capacitySources,                       // the default of both directions
      max: z.union([z.number().finite(), z.literal('auto'), z.literal('capacity')]).optional(),
      height: rowHeight,
    }).strict()
    .refine((r) => new Set(r.series.map((s) => s.direction)).size === r.series.length, 'Each direction (up, down) can occur only once.'),
  z.object({ kind: z.literal('metadata'), label: nonempty, path: scopePath }).strict(),
  z.object({ kind: z.literal('drilldown'), label: nonempty, url: nonempty }).strict(),
]);
export type HoverRow = z.infer<typeof hoverRow>;

// --- display, items, envelope ---
const display = z.object({ enabled, link: link.optional(), shape: shape.optional(), status: status.optional(), hover: hover.optional(), reducer: reducer.optional(), label, url, urlTitle }).strict();
export type DisplayConfig = z.infer<typeof display>;
const patternItem = z.object({ id: nonempty, name: nonempty, select: cellSelector, display }).strict();
const overrideItem = z.object({ cellId: nonempty, display }).strict();
const widgetItem = /* as today */;  const queryItem = /* as today */;
/** The envelope: parsed first, items as unknown. Section 5 parses each item on its own. */
const envelope = z.object({ version: z.literal(3), defaultDatasource: datasource.optional(), queries: z.array(z.unknown()), patterns: z.array(z.unknown()), overrides: z.array(z.unknown()), widgets: z.array(z.unknown()) }).strict();
export type DiagramConfig = Omit<z.infer<typeof envelope>, 'queries' | 'patterns' | 'overrides' | 'widgets'> & { queries: NamedQuery[]; patterns: Pattern[]; overrides: ElementOverride[]; widgets: Widget[] };
```

The type `DiagramConfigV2` is renamed `DiagramConfig` (it holds version 3 now); `tsc` drives the mechanical rename.

Decisions in the sketch:

- Two leaves per level, `capacity` and `capacityBinding`. A pattern's series wins over an override's number
  (`engine.ts:198` today), and a series with no data falls back to the number (section 4).
- `linkDirection.binding` is optional. `mergeDisplay` merges `a2b` and `b2a` as objects: `binding` and `capacityBinding`
  through `mergeSelector`, `capacity` as a leaf. A pattern's binding plus an override's capacity still combine
  (`patterns.ts:107` today). A merged direction without a binding is skipped, as a missing `a2bBinding` is today.
- The schema has no way to clear an inherited `capacity` (today a `0` did that, by accident of the lax schema). A
  later owner can only replace it. Open question 1.
- `kind: 'combined'` replaces "`history` with `series`". The old shape needed a `superRefine` and gave a type with both
  `binding?` and `series?`, which `z.infer` cannot narrow. A discriminator gives a clean union and deletes the
  `'series' in row` checks (`rowBindings`, `collectBindingDemands`, `buildConfiguredCard`, the editor).
- `shape`, `status`, `widgets`, `queries`, `select` keep their fields. Only the types become inferred.
- Zod with `.strict()` and `z.unknown()` for the native target strips nothing: a parsed item is deep-equal to its saved
  JSON. A test asserts it (section 7). The popup forms therefore edit the parsed item without loss (section 5).

### Unit rules

| Source | Amount | Unit |
| --- | --- | --- |
| `capacity`, a number, at a **link** place | the number | bit/s (README "Capacity": "All values are in bit/s") |
| `capacity`, a number, at a **row** place | the number | the unit of the value field (README "Combined up/down row") |
| `capacity`, a template, at any place | the resolved text as a number | bit/s |
| `capacityBinding`, any place | the latest value of its series | its own field unit, through `toBitsPerSecond` |
| field **Max** | `field.config.max` | the unit of the value field |

Internally every amount is in the canonical unit of the value field: bit/s for a data-rate unit or no unit, the raw
unit otherwise (`toBitsPerSecond` is the identity there and adds `unit-not-rate`). Percent:
`toBitsPerSecond(value, field.unit) / amount × 100`. Text: `inFieldUnit(amount, field)` =
`amount / toBitsPerSecond(1, field.unit).bits`, formatted with the display processor of the value field (unit,
decimals). A `bps` field shows `100 Mb/s`, a `Bps` field with amount 1e9 shows `125 MB/s`, an m³ field shows
`4.1 m³`. The percent and the colour do not change.

## 3. Old to new mapping (for the consumer team's generators) and outdated configs

The table is documentation for `scripts/gen_drawiomap/config.py`, `bindings.py`, `inject.py` (mode B, four owned
fields), `validate_config.mjs`, `plan.mjs`, `replay.mjs`. The panel does not apply it.

| Old field | New field | Note |
| --- | --- | --- |
| `version: 2` (root) | `version: 3` | the only detector of the shape; a generator that writes the new keys writes 3 |
| `link.a2bBinding: B` | `link.a2b.binding: B` | |
| `link.b2aBinding: B` | `link.b2a.binding: B` | |
| `link.capacityA2bBinding: B` | `link.a2b.capacityBinding: B` | |
| `link.capacityB2aBinding: B` | `link.b2a.capacityBinding: B` | |
| `link.capacityA2b: n \| "${…}"` | `link.a2b.capacity` | a number must be > 0; `0` as "no own value" has no equivalent: leave the key out |
| `link.capacityB2a` | `link.b2a.capacity` | same |
| `link.capacityBinding: B` | `link.capacityBinding: B` | unchanged key |
| `link.capacity: n \| "${…}"` | `link.capacity` | unchanged; a numeric string `"123"` must become the number; `"auto"` must go (the Max is the default) |
| `hover.rows[i]`: `kind: 'history'` with `series` | `kind: 'combined'` | rename |
| `hover.rows[i].capacity`, `series[j].capacity` | same keys, same meaning | a row number is in the unit of the values; a template in bit/s |
| `shape.*`, `status`, `label`, `url`, `urlTitle`, `reducer` | same | unchanged |

New abilities: `capacityBinding` on a combined row and on a series entry.

```jsonc
// root
{ "version": 2, "queries": […], "patterns": […], "overrides": [], "widgets": [] }
// becomes
{ "version": 3, "queries": […], "patterns": […], "overrides": [], "widgets": [] }
// consumer generator, symmetric link (config.py)
{ "link": { "a2bBinding": TX, "b2aBinding": RX, "capacity": "${cell.capacity_a2b_bps}" } }
// becomes
{ "link": { "a2b": { "binding": TX }, "b2a": { "binding": RX }, "capacity": "${cell.capacity_a2b_bps}" } }
// recommended generator output for an asymmetric link
{ "link": { "a2b": { "binding": TX, "capacity": "${cell.capacity_a2b_bps}" }, "b2a": { "binding": RX, "capacity": "${cell.capacity_b2a_bps}" } } }
// combined card row
{ "kind": "history", "label": "Traffic", "capacity": 100000000, "series": [ … ] }
// becomes
{ "kind": "combined", "label": "Traffic", "capacity": 100000000, "series": [ … ] }
```

Outdated configs. The envelope version is the one detector. `validateConfig` reads `version` before the parse:
`3` parses; `2` gives one diagnostic `outdated-config` at `(root)`: "This configuration has version 2, the shape before
1.0.0 (2026-10-25). Create the bindings again in Edit bindings, or regenerate the config with version 3." A document
with `rules` or `diagram` keeps `legacy-config`. Any other version: `invalid-config`. No `config`, nothing binds; the
popup shows the note above an empty list, as it does for the rules of version 1 (`legacy-config` and
`legacyRulesWarning` stay). Old keys inside a `version: 3` document are plain schema failures of their item
(`skipped-item`, section 5); no key list exists anywhere. The panel still renders the diagram: the standard "old saved
panel options must still load" holds as "no failure"; its "migrate" clause is suspended for the bindings config until
1.0, and `CODING_STANDARDS.md` says so in the same diff.

Deleted with this: `upgradeConfig`, `upgradeDisplay`, `legacyCapacityBinding`, `dropKeys`, `DROPPED_LINK_KEYS`,
`DROPPED_SHAPE_KEYS`, `SERIES_SELECTOR_KEYS` (`config.ts:384-470`) and the tests of `config.test.ts:528-600`.

## 4. resolveCapacity

New module `src/binding/capacity.ts`, pure, with `capacity.test.ts`. It replaces `capacityOf` and
`capacityFromBinding` (`engine.ts:431-455`) and `resolveRowCapacity` and `inValueUnit` (`cardModel.ts:233-268`).

```ts
export interface CapacityRequest {
  own?: CapacitySources;     ownPath: string;     // "link.a2b", "hover.rows[2].series[1]"
  shared?: CapacitySources;  sharedPath: string;  // "link", "hover.rows[2]"
  /** how a bare number is read: 'canonical' at a link place (bit/s), 'field' at a row place (the unit of the values) */
  numberUnit: 'canonical' | 'field';
  scope: TemplateScope;
  /** the value field of this direction when its model is ready: the unit, the Max */
  field?: Field;
  /** reads a capacity series; undefined when the binding is not usable for this cell (not in cell.bindings) */
  read: (binding: QueryBinding, path: string) => HistoryModel | undefined;
}
export interface ResolvedCapacity {
  /** the amount in the canonical unit of `field`; undefined: no capacity */
  amount?: number;
  source: CapacitySource;                                   // 'series' | 'attr' | 'number' | 'fieldMax' | 'none'
  diagnostics: Array<Pick<Diagnostic, 'code' | 'message'> & { path: string }>;   // paths relative to the display
}
export function resolveCapacity(req: CapacityRequest): ResolvedCapacity;
/** the amount in the unit of `field`: for the text and for the chart range ("max": "capacity") */
export function inFieldUnit(amount: number, field: Field | undefined): number;
```

The chain, the same as the link half today (`engine.ts:190-228`), stops at the first source that gives an amount:

1. `own.capacityBinding`: `read()`; not usable, not ready, no latest value: diagnostic (`metricProblem` wording) at
   `ownPath.capacityBinding`; a value ≤ 0: `unresolved-metadata`; else `toBitsPerSecond(value, ownField.unit)`
   (a non-rate unit adds `unit-not-rate`), source `series`.
2. `own.capacity`: a number: `numberUnit === 'field'` converts through the unit of `field`, else as is; source
   `number`. A template: resolved against `scope`; unresolved or not a positive finite number: `unresolved-metadata`
   at `ownPath.capacity`; else source `attr`.
3. `shared.capacityBinding`, 4. `shared.capacity`: the same rules at `sharedPath`.
5. `field.config.max` > 0: `toBitsPerSecond(max, field.unit)`, source `fieldMax`.
6. `{ source: 'none' }`.

A source that fails reports its diagnostic and the chain continues (the link behaviour today). The combined card row
gains this: a failed own template now falls to the row value, then the Max, instead of "no percent" (README "Template
capacity" changes). The diagnostic still points at the failed source.

No data. The capacity never produces a value on its own. A direction whose traffic model is not ready stays
`status: 'nodata'`, grey, no percent (`half()` keeps that branch). A direction with a value and no capacity has
`percent: undefined`: the colour comes from the raw value (ADR 0002), the text has no "of" part. A percent exists
only when both the value and a positive amount exist, so a missing value never shows 0 % or green.

Unavailable direction. A configured direction (a merged `binding`) whose binding is not usable for the cell (not in
`cell.bindings`: unknown, skipped or unusable query, missing parameter path) gets an explicit `HalfState`
`{ status: 'unbound', color: noDataColor, width: linkWidth.min, label: 'unavailable', stepIndex: -1 }`. Today
`bindPlan` skips such a direction (`engine.ts:205`, `continue`), and `drawLink` (`overlay.ts:123`) then paints the other
half over the whole link: a green a2b hides a b2a that cannot bind. With the explicit half the link splits at `mid`,
the unavailable half is grey, and the half counts in the "Incomplete coverage" status view (`engine.ts:241-249`).
`collectBindingDemands` still demands nothing for it.

Callers, after step 2:

| Caller | own, shared | numberUnit | field | read |
| --- | --- | --- | --- | --- |
| `engine.ts` `bindPlan`, each link direction | `link.a2b`, `link` | canonical | the field of the direction model when ready | `read` of the cell (reports `metricProblem`, sets the `missing` status view) |
| `cardModel.ts` `combinedRow`, each direction | `series[j]`, the row | field | the field of the direction; a direction without data takes the field of the other (as today) | `readBinding` of the card (adds a hover demand) |
| the link labels (section 6) | none: they read `HalfState` | | | |

`HalfState` gains `capacityDisplay?: DisplayValue` (the capacity in the field unit, through `ctx.display`). The card
and the labels show it; nothing formats a capacity a second time. `half()` becomes `export function halfState(...)`
so `combinedRow` can build its `DirectionRowModel` from it instead of its own copy of `colorFor` and the percent text
(`cardModel.ts:309-320`). Open question 2. `combinedTop` for `"max": "capacity"` gets `inFieldUnit(...)`.

## 5. Per-item validation

Item: one entry of `queries`, `patterns`, `overrides` or `widgets`. Its path prefix is `queries[i]`, `patterns[i]`,
`overrides[i]`, `widgets[i]` with `i` the index in the **saved** list, the form the popup groups rows by.

One principle. **A type-level failure (zod) skips the item. A semantic problem keeps the item and makes its consumer
unavailable, with the reason; nothing is stripped, nothing is silently absent.**

```ts
export interface ValidatedConfig {
  /** undefined only when the envelope failed or the version is not 3 */
  config?: DiagramConfig;                    // dense lists: the items that parse, deep-equal to their saved JSON
  /** saved index of each item of the dense lists: indices.patterns[j] is the saved index of config.patterns[j] */
  indices: Record<'queries' | 'patterns' | 'overrides' | 'widgets', number[]>;
  /** the saved indices of the items that do not parse */
  skipped: Record<'queries' | 'patterns' | 'overrides' | 'widgets', number[]>;
  /** queries that parse but cannot run (missing datasource, bad parameter name, non-persistable target), by id */
  unusableQueries: Map<string, string>;
  diagnostics: Diagnostic[];
}
export function validateConfig(input: unknown): ValidatedConfig;
```

1. Envelope. `input` is not an object, `version` is not 3, or a list is not an array: no `config`, one diagnostic at
   `(root)` (`outdated-config` for version 2, `legacy-config` for a `rules` document, else `invalid-config`).
   Everything is invalid.
2. Items. Each entry is parsed with its item schema. A failure adds the zod issues with the saved prefix and one
   `skipped-item` diagnostic at the prefix ("Pattern X is not applied until its errors are fixed"). The item is not in
   `config`.
3. Semantic problems, the item stays in `config` unchanged:
   - `invalid-freshness` (`staleAfterMs < expectedIntervalMs`): `evaluateStatus` (`status.ts:50`) returns
     `view('missing', 'Invalid freshness policy', 'freshness')` before the stale check, so the element shows as
     unavailable and the status band counts it; a hover row or widget with it shows state `unsupported` with that text
     instead of a staleness mark. Stale data never shows as healthy.
   - `invalid-row-bounds`, `invalid-widget-bounds` (`min >= max`): the row shows `unsupported`, "Invalid range"; the
     widget is admitted to `plan.widgets` with `unavailable: 'Invalid range'` and `ChartLayer` shows the text instead of
     the chart. The form stays, so the user can fix the number.
   - `missing-datasource`, `invalid-parameter-name`, `invalid-native-target` on a query: the query is in
     `unusableQueries` with the reason; its editor stays open to fix it.
   - Duplicates: `duplicate-query-id`: the first stays, each later one is unusable ("Duplicate query id");
     `duplicate-pattern-id`, `duplicate-widget-id`, `duplicate-override`: reported only; `mergeCell` takes the first
     override as today.
4. References. A binding whose query is unknown, skipped or unusable is left out of `cell.bindings` by
   `resolvePatterns`, the mechanism of `missing-parameter-path` today (`patterns.ts:287-306`), with `unknown-query` and
   the reason ("Query X has errors (see queries[i])", "Query X cannot run: choose a datasource"). The engine then gives
   that link direction the explicit unavailable half (section 4), shows that hover row as unavailable, leaves a shape or
   status binding in `nodata`, and reports at the cell path. A widget with such a binding is admitted with
   `unavailable` and the reason.
5. `config` is returned whenever the envelope parsed, also with diagnostics. The Boolean "clean"
   check of the callers (`draft.ts:264`, `portable.ts`, `QueryEditor.tsx:159`) becomes `diagnostics.length === 0`;
   "loadable" is `config !== undefined`.

Skipped items and the cells they touched. Patterns are ordered patches; a cell that lost one of them would merge the
others and its override into a state nobody configured. Policy, with an explicit render state:

- `EffectiveCellBinding` gains `unavailable?: string` (the reason). `bindPlan` turns it into
  `PlanCellPatch.unavailable` and a `statusView` `{ state: 'missing', reason }`, so the status band counts the cells.
  The applier paints an unavailable cell in the no-data grey (the fill of a node, the stroke of a link, the same calls
  as `status: 'nodata'`), sets `data-dmap-status="unavailable"` and the aria label with the reason. It never falls into
  `reset` (`applier.ts:220`), which would restore the drawn fill, for example green.
- A skipped pattern whose `select` parses (`select` is parsed on its own first): the cells it matches are unavailable
  with "Pattern X is not applied", from no item. One diagnostic `skipped-cells` at `patterns[i]` with the count.
- A skipped pattern whose `select` does not parse: the match set is unknown; every cell is unavailable with that
  reason. One diagnostic at `patterns[i].select`. Widgets still bind.
- A skipped override with a string `cellId`: that cell is unavailable, "Override of X is not applied". Without a
  usable `cellId`: a diagnostic only.
- A skipped widget or query: nothing else; see 4 for its references.

`resolvePatterns` (`patterns.ts:278-284`) returns early only when `config` is undefined. Its own diagnostics
(`missing-cell`, `missing-anchor`, `missing-parameter-path`) use the saved index from `indices`, not the dense one.
`BindingPlan` gains `config: DiagramConfig` (the validated, dense config) so that every reader of the query list
reads the same one: `DrawioMapPanel.tsx:793` passes `plan.config.queries` to `ChartLayer`, not `opts.config.queries`
(`ChartLayer.tsx:95` would find a skipped query and run it). `cellIdentityDiagnostics` (duplicate cell ids or `pg-id`)
stays a diagnostic: the duplicated cells are unavailable with that reason, the other cells bind.

Popup. `draft.config` stays the raw document, typed `unknown` at the two places that pass it on (`resolvePatterns`,
`validateConfig`); `draft.validated` is a memo of `validateConfig(draft.config)`. The list (`bindingsModel.ts:96-144`)
and the inspector read the validated items for the form, the matches and the merge. Since a parsed item is deep-equal
to its saved JSON (section 2), a form that writes the whole item back (`ChartFields.tsx:43`, `draft.ts:250`) loses
nothing. `buildBindingsList` walks the saved indices: a skipped index gives a problem row with zero matches, its
diagnostics and a title from the raw `id` or `name` when that is a string, else `patterns[i]`; it never calls
`cellMatches` or `mergeDisplay` on it. The inspector of a skipped item shows the problems and the delete button; the
form is not shown. The draft reducer (`draft.ts:118-122`, `262-267`) accepts a config with diagnostics as the working
draft; Apply blocks on diagnostics as today.

Diagnostic paths: `patterns[3].display.link.a2b.capacity` (schema, saved index), `cells.<id>.link.a2b.capacity` (run
time, as today). Codes added: `outdated-config`, `skipped-item`, `skipped-cells`. Codes removed: none.

## 6. How link labels read from this shape

Not built in step 2. The interface the labels will use:

- Config: `display.link.label?: { mode?: 'none' | 'value' | 'percent' | 'both' }` in the link schema, merged by
  `mergeDisplay` as a leaf, overridable per pattern and per element. A panel option `linkLabels.mode` gives the
  default, `none`. Step 2 reserves nothing; the field is added with the feature, under `.strict()`.
- Data: one `HalfState` per direction in `CellPatch.link.a2b` and `.b2a`, with `display` (the value, formatted),
  `percent`, `capacityDisplay` (section 4) and `status`. The label renderer composes `value`, `percent`, `both` from
  these fields and shows nothing for `nodata` or an unavailable cell. It calls neither `resolveCapacity` nor a formatter.
- Placement: the overlay already splits the edge at `mid` and knows the half polylines (`overlay.ts:117-126`); a label
  per half anchors there. The z-order rule of CODING_STANDARDS applies.

## 7. Test plan

Unit, one file per concept, `--maxWorkers=2` while a worker runs them:

- `src/model/config.test.ts`: round trip of the new shape, `validateConfig(x).config` deep-equal to `x`, with every
  hover kind, both link directions with each source, status, widgets, a native target; each parsed item is
  `JSON.stringify`-equal to its saved item. Versions: `version: 2` gives `outdated-config` alone and no `config`, also
  when its items are valid version 3 items; a `rules` document gives `legacy-config`; version 4 gives
  `invalid-config`; a version 3 document with an old key (`a2bBinding`, a `history` row with `series`, `capacity: 0`,
  `capacity: { refId }`) skips that item only. Per-item: one
  invalid pattern keeps the others, `indices` and `skipped` hold saved indices, `skipped-item` present; a duplicate query
  id keeps the first and marks the later unusable; an unknown query keeps the pattern and lists `unknown-query`; a bad
  envelope gives no config; freshness and bounds keep the item unchanged and report; a bad parameter name puts the
  query in `unusableQueries`. The step 1 tests of the dropped fields are deleted.
- `src/binding/patterns.test.ts`: `mergeDisplay` merges `a2b` as an object (binding from the pattern, capacity from the
  override), tracks the new leaf paths; `resolvePatterns` with one invalid override keeps the other cells and marks that
  cell unavailable; a skipped pattern with a valid `select` marks its cells unavailable and reports `skipped-cells`; a
  skipped pattern with an invalid `select` marks every cell unavailable and keeps `plan.widgets`; a binding to an
  unknown or unusable query is absent from `cell.bindings`; a widget with it is admitted with `unavailable`; saved
  indices in `missing-cell`.
- `src/binding/capacity.test.ts`: the six steps in order; own binding over own value over shared; a failed own
  template falls to shared, a failed shared to Max; `numberUnit` 'field' with `Bps` (50 of 100 is 50 %) and
  'canonical'; a series in `Bps` gives bits × 8; `inFieldUnit` for `bps`, `Bps`, `Mbits`, no unit, `m3`; a series
  value ≤ 0 fails with its path.
- `src/binding/engine.test.ts`: `capacityDisplay` and the half label for `bps` ("41 Mb/s · 41% of 100 Mb/s"), `Bps`
  ("… of 125 MB/s") and a non-rate unit ("… of 4.1 m³"); no data stays grey; no capacity gives no percent; a pattern
  series plus an override number: the series wins when ready, the number when not; an unavailable cell gives a patch
  with `unavailable` and a `missing` status view; a valid a2b plus a b2a with an unknown query gives two halves, the
  b2a one `unbound` grey, and the coverage view 1/2.
- `src/render/overlay.test.ts`: a link with an `ok` half and an `unbound` half is drawn as two halves, the unbound one
  in the no-data colour, not one half over the whole edge.
- `src/binding/status.test.ts`: an invalid freshness gives `missing`, "Invalid freshness policy", also for fresh data.
- `src/interact/cardModel.test.ts`: a combined row through `resolveCapacity`: own, row, Max, fall-through; a numeric
  row capacity keeps its value-unit meaning; `"max": "capacity"` range in the field unit; a direction without data
  takes the unit of the other; a row with invalid bounds or freshness is `unsupported` with the text.
- `src/render/applier.test.ts`: an unavailable cell is grey with `data-dmap-status="unavailable"`; its drawn fill does
  not come back on the next apply.
- Editor: `leafPaths.test.ts`, `bindingsModel.test.ts`, `draft.test.ts`, `BindingEditor.test.tsx` for the renamed
  paths (`link.a2b.binding`, `link.a2b.capacity`, `link.a2b.capacityBinding`), a skipped item as a problem row with
  `select: null` (no crash), the inspector of a skipped item, and an edit of a widget label that keeps its other
  fields byte for byte; `ChartLayer.test.tsx` for the `unavailable` text.

E2E, one spec at a time in the worktree, then `npm run e2e:matrix` on main before the push (the rendered panel and
the editor change):

- `tests/color.spec.ts` (capacity sources, `41% of 100 Mb/s`, `48% of 1 Gb/s`; add a `Bps` text check).
- `tests/refresh.spec.ts` (writes `display.link` fields in its config).
- `tests/card-tooltip.spec.ts`, `tests/hover-kinds.spec.ts`, `tests/sparkline-range.spec.ts` (combined rows).
- `tests/bindings-popup-inspector.spec.ts`, `tests/binding-editor.spec.ts`, `tests/bindings-list.spec.ts` (link
  fields in the inspector; a problem row for a skipped item).
- `tests/authoring-compat.spec.ts`, `tests/authoring-fixtures.spec.ts`: rewritten to version 3; one case loads a
  `version: 2` config and expects the `outdated-config` note and an unbound diagram.
- `tests/status-band.spec.ts` (unavailable cells in the band), `tests/links.spec.ts` (a link with one unavailable half).
- Fixtures to rewrite by hand, all with `"version": 3`: `provisioning/dashboards/demo.json`,
  `src/fixtures/demo-config.ts`, `src/fixtures/authoring-config.ts`, the configs inside the e2e specs, the portable
  pattern documents of `src/editor/portable.ts` and its tests. the consumer team regenerates from the table in section 3.

Docs in the same diff: README "Capacity", "Capacity of each link direction", "Combined up/down row", "Template
capacity" (fall-through), "Capacity of each direction", "Templates", "Bindings" (problem rows, unavailable cells), a
short "Configs of version 2" note; a row in the PoC spec "Superseded decisions" (version 3, per-direction shape,
capacity text in the field unit, per-item validation, no migration before 1.0); `CODING_STANDARDS.md` ("migrate"
suspended for the bindings config until 1.0; the capacity rule points at `src/binding/capacity.ts`);
`docs/acceptance.md` row "Capacity sources".

## 8. Decisions on the open questions (user, 2026-10-25)

1. Two leaves per level (`capacity`, `capacityBinding`): yes.
2. Rename the combined row to `kind: 'combined'`: yes.
3. A bare number is bit/s at a link place and the unit of the values at a row place; only the text changes: yes.
4. No migration, no `setMigrationHandler`; `version: 3` is the detector; the consumer team regenerates: yes.
5. `capacity: null` as an explicit "clear the inherited value": not now. An override replaces, it cannot clear.
6. Share `halfState` between the link half and the card direction: yes, with a small diff in `cardModel.ts`.
7. A raw editor for a skipped item in the inspector: not now. Problems with their paths and a delete button.

## 9. Review resolutions

| Concern | Resolution |
| --- | --- |
| R1-1. Capacity-only patches; the `0` sentinel | `linkDirection.binding` optional; `mergeDisplay` merges `a2b`/`b2a` as objects with separate leaves (section 2). The `0` sentinel has no equivalent and no migration (user decision); open question 1. |
| R1-2. Precedence across owners | Two leaves per level at four places; a pattern's series still wins over an override's number (sections 2, 4). |
| R1-3. Unit rule changed saved meaning | Numbers keep the meaning documented at their place (`numberUnit`); only the text changes (section 2, unit rules). |
| R1-4. `"auto"`, the number fallback, no fall-through | The chain is the link chain of today; every failed source falls through with a diagnostic; rows gain it (section 4). `"auto"` is a schema failure of its item in version 3 (section 3). |
| R1-5. A skipped pattern retargets overrides | Its cells are unavailable from every item, with `skipped-cells`; an unparseable `select` makes every cell unavailable (section 5). |
| R1-6. Skipped query, widgets, ChartLayer | A widget with an unusable binding is admitted as unavailable; `BindingPlan.config` is the validated config and `ChartLayer` reads `plan.config.queries` (section 5). |
| R1-7. Popup with malformed items | `indices`, `skipped` with saved indices; problem rows without touching the item; `draft.config` raw, `draft.validated` typed (section 5). |
| R1-8. `setMigrationHandler` | Removed with the whole migration (user decision, section 1 and 3). |
| R2-1. Neutralised options and popup edits | Nothing is neutralised or stripped any more: a semantic problem keeps the item unchanged; a parsed item is deep-equal to its saved JSON (asserted by a test), so a form that writes the whole item back loses nothing (sections 2, 5). |
| R2-2. Invalid freshness made stale data healthy | `evaluateStatus` returns `missing`, "Invalid freshness policy" before the stale check; rows and widgets with it show `unsupported` (section 5, item 3). |
| R2-3. Omitted cells got their drawn fill back | New explicit state: `EffectiveCellBinding.unavailable` → `PlanCellPatch.unavailable` + a `missing` status view; the applier paints no-data grey and `data-dmap-status="unavailable"`, never `reset` (section 5). |
| R3-1. An unusable direction could look green | Every configured direction that cannot bind gets an explicit `unbound` grey `HalfState`; `drawLink` splits the link and the half counts in the coverage view (section 4, "Unavailable direction"; section 5, item 4; tests in 7). |
| R3-2, R3-3. The old-key scan was fragile | The scan is dropped. The envelope version is the detector: the new shape is `version: 3`; `version: 2` gives `outdated-config` and binds nothing; zod parses only 3; old keys inside a version 3 document are item-level schema failures (sections 1, 3, 5; the mapping table, the fixtures and the tests say `"version": 3`). |
