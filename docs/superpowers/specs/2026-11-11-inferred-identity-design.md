# Inferred identity: identity on the port, the link reads it

- Status: draft, revision 2 after review round 1 (Codex "Astra", findings R1–R7, all accepted: section 16),
  2026-11-11. The owner approved the model on 2026-11-11 ("stage 2" of the binding UX
  audit). This spec designs it in detail and records each point where the design differs from the approved model
  (section 12).
- Amends: `docs/superpowers/specs/2026-10-28-binding-model-v4-design.md` ("the v4 spec"), sections 2.4 step 4, 3.3,
  3.8.2, 3.8.4, 4 and 5.4. The row of 2026-11-11 in its "Superseded decisions" table points here. D19 (the three
  writes of the inspector) does not change.
- Builds on: stage 1a (the cell attribute `capacity` as a second name of `cap`, the entry `cap-conflict`), which is
  on `main` (864485b), and the editor fixes of c5d97af (readable link ends, the `at` action).
- Scope: the panel (`src/`), the demo fixtures, the guide. No change of the config schema: the config stays
  `version: 4`. The generator of the consumer team does not change.
- Decisions of this spec have the ids **I1–I26**. Acceptance checks have the ids **AC1–AC24**. Plan steps have the
  ids **S0–S9**.
- Privacy: all examples use the demo network (`fixtures/demo/`).

## 1. Problem

Today a cell reads only its own attributes. A link must carry a copy of the identity of the interface that gives its
counters:

- Demo L3: 9 links carry `key`, `port` and `at`. In 9 of 9, `key` is the key of the node at the `at` end and `port`
  is the name of the port at that end. These are 18 copied values and 9 values of `at`.
- A port cell cannot read `key` from its node. A shape cannot read an attribute from its container. Only
  `${from.<name>}` and `${to.<name>}` search the owners of a cell (`endAttr`, `src/binding/edgeEnds.ts`).
- The sheets of the consumer team: each link that has counters has exactly one instrumented end. Thus the diagram
  already tells which end the counters come from. 51 links have no instrumented end.

## 2. Goals and non-goals

Goals:

1. The identity sits on nodes and ports. A link needs only `bind`, and an attribute only for an exception.
2. One resolver gives each attribute value to the match, the templates, the capacity, the card and the inspector.
3. A diagram that binds today binds identically (section 8).
4. The editor tells where each value comes from and which end a link measures.

Non-goals (not in this stage):

- Counters from both ends on one link.
- A class by layer, tag or shape (selector classes): stage 3.
- Split links (`pg-run`): section 7.3 states what occurs; no work until portograph gives a fixture.
- New writes of the inspector (D19 stays).
- Stage 2b, "a port shows its link" (section 10): designed here, not in the plan of this stage.

## 3. Terms

| Term             | Meaning                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| own attribute    | an attribute on the cell itself (`data-meta-<name>`), and `id`, the draw.io cell id                  |
| owner            | the next cell that can give an attribute to a cell: section 4.1                                      |
| owner chain      | the cell, its owner, the owner of that owner, up to the layer                                        |
| own-only name    | a name that only the cell itself can give: section 4.2                                               |
| end-free use     | a query use of a link whose match block the link resolves itself: section 5.1                        |
| dependent use    | a query use of a link that needs a name that the link does not have: section 5.1                     |
| identity names   | for a link: the inheritable names that its dependent uses read: section 5.1                          |
| measured end     | the end of a link whose interface gives the counters of the link: `source` or `target`               |
| end cell         | the cell at an end of an edge (v4 spec 3.8.1): the port cell, or the node cell for an anonymous port |
| instrumented end | an end whose owner chain gives all identity names that the link does not have itself                 |
| unmeasured link  | a bound link with dependent uses and no identity: these uses are quiet: section 5.4                  |

## 4. The owner chain

### 4.1 The owner of a cell (I1)

The owner of a cell is the entry of the cell in `EdgeEnds.parents` (`src/binding/edgeEnds.ts`), as today:

1. For a portograph port cell (`pg-kind="port"`): the node cell that `pg-node` names.
2. For each other cell: its XML parent in page 1, when the parent is below a layer. The search stops at the layer.
   The root cell (`id="0"`) is never an owner.

This is the search of `endAttr`. It does not change. A cell of the chain that is not in the cell index (a bare
`mxCell`, for example a portograph group) gives no attribute, and the search goes on to its owner.

### 4.2 Which names a cell inherits (I2, I3)

**I2.** A vertex cell reads a name from itself, then from its owner chain. The first cell that has the name gives the
value. An empty value counts as present (v4 spec 2.4 step 4).

**I3.** These names are own-only. A cell never reads them from an owner or from an end:

| Name              | Reason                                                                       |
| ----------------- | ---------------------------------------------------------------------------- |
| `bind`            | the class of a cell is its own decision; a port must not join the node class |
| `at`              | a property of one link                                                       |
| `cap`, `capacity` | a capacity has its own rule (section 6)                                      |
| `id`, `label`     | they name one cell                                                           |
| each name `pg-*`  | the portograph contract: structure, not identity                             |

Each other name is inheritable. The engine gives no special meaning to `key` or `port`: they are inheritable as all
other names. Thus a port that has no `key` reads the `key` of its node: "the job of the node". This is the purpose.
A class is free to use other names (`job`, `device`), as demo L1 does.

**I4. `port` has no default.** The engine does not read `pg-port` as the value of `port`. Alternative, rejected: "the
attribute `port` of a port cell is `pg-port` when the cell has no `port`". With that default each named port is
instrumented, both ends of most links qualify, and the rule "source first" selects an end with no series. An explicit
attribute on the port (`port`, `device`) is the mark "this interface has counters". The cost is one value for each
measured port.

### 4.3 `${from.<name>}` and `${to.<name>}` (I5)

They keep their meaning: the geometric source end and target end, through `endAttr`, for each name, also the
own-only names (`${from.pg-port}`, `${from.label}` work as today). They do not follow the measured end.

## 5. A link reads through its measured end

### 5.1 Dependent uses and the identity names (I6)

The inference reads the query uses that the link really has (v4 spec 3.2 step 4: the status, the text, the rows, the
chart, `up`, `down`, `capacity`), each with its own match block: the row match, else the class match of the
effective class (the class after the override of the cell). A class `match` that no use reads has no effect.

For one match block, the **inheritable required names** are its required attributes (v4 spec 2.4 step 4: the record
keys and the placeholders), without the names `from.<x>` and `to.<x>` (they name an end explicitly) and without the
own-only names (4.2).

- A use is **end-free** when the link has each inheritable required name of its block as an own attribute. Such a
  use resolves exactly as today: the inference never changes its values, its feed (5.6) or its place in the list.
  Example: a row with `match: {id: edge}`.
- Each other use is **dependent**.
- The **identity names** of the link are the inheritable required names of the blocks of its dependent uses, as a
  sorted set. The **missing names** are the identity names that the link does not have itself.

The templates (the URL, its title, the `metadata` and `drilldown` rows) add no identity name. They read through the
end that the dependent uses select (5.3). Reason: a link has one measured end.

Known limit: the set is a union. When one dependent use reads a name that no end gives (a row with
`match: {site: site}`), no end is instrumented, also for the uses that one end could serve. The fix is to write that
name on the link or on the port.

### 5.2 The measured end (I7)

The first rule that applies gives the measured end and its reason:

| Order | Condition                                                                  | Measured end                            | Reason |
| ----- | -------------------------------------------------------------------------- | --------------------------------------- | ------ |
| 1     | the link has its own `at`                                                  | `target` for `at=target`, else `source` | `at`   |
| 2     | the link has no dependent use                                              | `source`                                | `own`  |
| 3     | exactly one end is instrumented                                            | that end                                | `only` |
| 4     | both ends are instrumented                                                 | `source`                                | `both` |
| 5     | no end is instrumented, and the link has one or more identity names itself | `source`                                | `own`  |
| 6     | no end is instrumented, and the link has no identity name itself           | none: the link is unmeasured (5.4)      | `none` |

An end is instrumented when its end cell exists and its owner chain gives each missing name. Rules 1 and 2 are the
behaviour of today: a link whose uses all resolve today has no dependent use, so its end is `at`, else the source. In rule 5 the link has a part of an identity: the author
started to write it, so the missing part is `missing-attr`, as today.

### 5.3 How a link reads a name (I8)

A link reads an inheritable name from itself, then from the owner chain of its measured end cell. An own attribute
of the link wins. The own-only names come from the link only. A link does not read its XML parent (an edge inside a
container): its ends give its identity. Alternative, rejected: own, then the container, then the end. Two sources
for one name make the inspector hard to read, and no known sheet needs it.

A name that neither the link nor the end gives is `missing-attr`, as today. The exception is the unmeasured link
(5.4).

### 5.4 Unmeasured links (I9, I10)

**I9.** An unmeasured link (rule 6) has dependent uses, no `at`, no identity name of its own and no instrumented
end. The panel is quiet about what the link cannot have, and keeps what the link has:

- Its dependent uses are not in the list of its uses. Thus they give no `missing-attr`, no `no-series` and no other
  entry of a use.
- Its end-free uses bind as today, with the feed of today.
- Its templates resolve with the own attributes of the link, as today. A template that reads an identity name that
  the link lacks is not shown and gives no entry: the entry of I10 covers it. A template that lacks another name
  gives `missing-attr`, as today.
- `patch.link` (the halves) exists only when an `up` or a `down` use is in the list.
- When no use is in the list and no template gives an item, the link gets no patch: the panel draws it as the
  diagram has it, with no card. This is the usual case, a link with `bind` and nothing else between two cells that
  have no counters.
- The link stays a cell of its class (`BindResultV4.cells`), so the class does not get `class-no-cells`.

**I10.** The report has one entry for each class and each set of identity names:

```ts
| { kind: 'unmeasured-link'; cls: string; attrs: string[]; cellIds: string[] }
```

`attrs` holds the identity names in sorted order. Two links of one class have different sets only when an override
changes a match; then the class has two entries, and each line names the right attributes. The line is
"classes.lan: 12 links have no measured end (no end gives key, port)". The entry is information, not a warning:

- The view mode does not count it and does not list it in the warning badge.
- The split editor shows it in the tab of the class, after the warnings, and does not count it in the number after
  the class name. A click highlights the links.
- The cell counts of the class show the unmeasured links as their own number.

Alternatives, rejected: (a) a class option `quiet: true`: it changes the schema, and the author must know the
problem before it shows; (b) no entry at all: then a link that the author forgot to instrument has no trace; (c)
revision 1 of this spec: skip the whole cell. It removed the end-free uses and the URLs that work today (review R1).

### 5.5 Both ends qualify (I11, I12)

**I11.** With no `at`, the source end wins. This is safe for a tunnel and for each link whose two ends have series
for the queries of the class: the feed follows the selected end (5.6), so both selections draw the same directions.
The two views differ only by the loss on the path.

**I12.** It is not safe when both ends have the attributes but only one end has series. Example: a router port with
`port=eth1` from one exporter and a switch port with `port=16` from another, and a link class on the queries of the
switch. The source is the router: the link gets `no-series`. The design gives three protections:

1. The inspector always shows the reason `both` (section 9).
2. The report has one entry for each class, only for the links where the choice had no result:

   ```ts
   | { kind: 'end-ambiguous'; cls: string; cellIds: string[] }
   ```

   A link is in the entry when its reason is `both` and, for its dependent uses only: each of them has no problem,
   the snapshot of each is ready or empty, and none of them selects a series. The set of dependent uses is not empty
   for the reason `both`, so a class with only a URL never gets the entry. An end-free use does not count: its
   series do not hide the problem, and its lack of series does not cause the entry. One dependent use with one or
   more series (also `many-series`) stops the entry. The measured end itself never depends on the data. The line is "classes.lan: 2 links: both ends give the identity, the source end has no
   series. Set at=target if the target end has the counters." It is a warning.

3. The guide tells the author to name the attribute after the label of its exporter family (`device` on the ports of
   one family, `port` on the other), so that one class finds only one end.

Alternative, rejected: select the first end that has series. The result then changes with the data: when the device
at one end is down, the link moves to the other end with no notice.

### 5.6 The feed (I13)

The feed of a directional use (`up`, `down`, an `updown` row, an `updown` chart) follows the end that gives the
identity of that use:

| The link and the use          | The end of the use            |
| ----------------------------- | ----------------------------- |
| the link has its own `at`     | `at` (as today), for each use |
| no `at`, the use is end-free  | the source (as today)         |
| no `at`, the use is dependent | the measured end of the link  |

`linkFeeds` takes the end of the use: `target` flips the feeds exactly as `at=target` does today (v4 spec 3.8.2).
Each use of an edge records its end (`Use.end`), and the stroke, the link label, the card row and the chart read
it from there. Reason: the flip exists because the matched attributes name an interface at one end. A use that
matches through the link itself (`match: {id: edge}`) names no interface of the inferred end, so the inference must
not change its direction (review R2).

Thus the rule "one feed for all views" of v4 spec 3.8.3 holds for each use, and for all uses of a link that have the
same kind of match. A link can have two feeds only when it has no `at`, a dependent use and an end-free directional
use, and the measured end is the target. Today such a link has `missing-attr`. The inspector shows the end of each
use (section 9).

## 6. Capacity (I14–I16)

**I14. The order.** For each geometric direction, the first source that gives a value:

| Order | Source                                            | Notes                                           |
| ----- | ------------------------------------------------- | ----------------------------------------------- |
| 1     | the `capacity` query of the class                 | as today; its series match through the resolver |
| 2     | the attribute `cap` of the link                   | as today: a→b / b→a                             |
| 3     | the attribute `capacity` of the link              | stage 1a                                        |
| 4     | the attribute `cap` of the measured end cell      | new                                             |
| 5     | the attribute `capacity` of the measured end cell | new                                             |
| 6     | none                                              | as today                                        |

- Sources 4 and 5 read the end cell itself only: `cap` and `capacity` are own-only, so a port does not read the
  `cap` of its node. For an anonymous port the end cell is the node cell: then the `cap` of the node counts.
- The panel reads sources 4 and 5 only when the link has neither `cap` nor `capacity`. An own `cap` that does not
  parse gives `bad-cap` and no capacity, as today: it does not fall through to the end.
- `bad-cap` and `cap-conflict` of the end cell name the end cell in `cellIds`, so the click goes to the port.
- An unmeasured link has no measured end, so sources 4 and 5 give nothing for it.
- The link's own pair and the pair of the `capacity` queries stay geometric, whatever the end of a use is (A4).

**I15. The direction of a capacity on an end.** On a link, `cap=50M/10M` is a→b / b→a (A4). On an end cell,
`cap=50M/10M` is transmit / receive of that interface. The panel maps it to the geometry with the measured end:
measured at the source, a→b is the transmit value; measured at the target, a→b is the receive value. Reason: a port
does not know the direction of its links, and a port can have two links.

**I16. The `capacity` series.** The `capacity` uses read the class `match`, so they match through the same inferred
identity. `{a2b, b2a}` stays geometric (A4).

**I25. One capacity for each link, in the bind result.** Today the bind computes the capacity only for a link with
`up` or `down` (`linkHalves`), and the card computes it again on its own (`cardModel.readerOf`); a link with only
an `updown` row has no `patch.link`. The card has no end context, so it cannot read an end cell. Thus:

```ts
/** bound edge id → the capacity of each geometric direction, with the cell that gave an attribute capacity */
capacity: Map<string, { a2b: LinkCapacity; b2a: LinkCapacity }>;   // a field of BindResultV4
interface LinkCapacity { amount?: number; source: CapacitySource; cellId?: string }
```

- The bind fills it for each bound edge that has an `up`, `down` or `capacity` use or an `updown` row or chart. The
  halves, the card and the inspector read it from there. `cardModel` does not call `capacityV4`.
- `source` stays `attr` for an attribute; `cellId` is the link or the end cell.
- The end lookup stays lazy: `capacityV4` takes the end as a function and calls it only when the link has neither
  `cap` nor `capacity` and a direction has no value from the `capacity` query. A class whose `capacity` query gives
  both directions never asks for the ends.
- The entries keep their cells: `bad-cap` and `cap-conflict` of an end cell name the end cell; those of the link and
  `capacity-fallback` name the link. Today `bindV4.ts` replaces the cells of each capacity entry with the edge id;
  that changes.

## 7. Where the inference lives

### 7.1 One resolver (I17)

A new module `src/binding/identity.ts` holds the rules of sections 4, 5 and 6 as pure functions on `EndContext`.
Nothing else in `src/` implements them.

```ts
/** A name that only the cell itself gives (I3). */
export function isOwnOnly(name: string): boolean;

/** Where a value comes from: the cell that has the attribute. */
export interface AttrOrigin { value: string; cellId: string; via: 'own' | 'owner' | 'end' }

/** I2: the cell, then its owner chain. An own-only name reads the cell only. `id` is the cell id. */
export function ownerAttr(cellId: string, name: string, ctx: EndContext): AttrOrigin | undefined;

export type EndReason = 'at' | 'own' | 'only' | 'both';
export type MeasuredEnd =
  | { end: 'source' | 'target'; reason: EndReason; cellId?: string; needs: string[] }
  | { end: 'none'; reason: 'none'; needs: string[] };

/** I6: the inheritable required names of one parsed match block (no `from.x`, `to.x`, own-only names). */
export function inheritableNames(requiredAttrs: readonly string[]): string[];

/** I6: the identity names of a link: the sorted union over its dependent blocks. Empty: no dependent use. */
export function identityNames(meta: CellMeta, blocks: ReadonlyArray<readonly string[]>): string[];

/** I6: true when the link has each inheritable required name of the block itself. */
export function isEndFree(meta: CellMeta, requiredAttrs: readonly string[]): boolean;

/** I7: the measured end of an edge. `needs` are the identity names. */
export function measuredEnd(meta: CellMeta, needs: readonly string[], ctx: () => EndContext): MeasuredEnd;

/** I8: a name of a link through its measured end. */
export function linkAttr(meta: CellMeta, name: string, end: MeasuredEnd, ctx: () => EndContext): AttrOrigin | undefined;

/** I14: `cap` and `capacity` of the measured end cell. */
export function endCap(end: MeasuredEnd, ctx: EndContext): { cellId: string; cap?: string; capacity?: string } | undefined;

/**
 * The resolver of one bind. `attr` reads `from.<x>` and `to.<x>` with `endAttr`, an edge with `linkAttr`, each other
 * cell with `ownerAttr`. It reads the ends only when a cell lacks an own attribute. It records each value that is
 * not own in `inherited`.
 */
export function createIdentity(ends: () => EndContext): {
  measure(meta: CellMeta, needs: readonly string[]): MeasuredEnd; // memo: one result for each cell id
  attr(meta: CellMeta): (name: string) => string | undefined;
  inherited: Map<string, Map<string, AttrOrigin>>; // cell id → name → origin
};
```

Users of the resolver:

| User                     | Reads                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| the match (`bindV4`)     | `attr(meta)` in `resolveBlock`                                                                  |
| the templates (`bindV4`) | `attr(meta)` in the scope: `${key}` of a link is own, then the measured end; `${from.x}` as 4.3 |
| the uses (`listUses`)    | a plan for each match block: the end of the use, or "drop" (5.4, 5.6); not `cell.attrs.at`      |
| the capacity             | `endCap`, through the lazy function of I25                                                      |
| the card (`cardModel`)   | `Use.end` for the feed and `BindResultV4.capacity`; it does not read `attrs.at` or `attrs.cap`  |
| the inspector            | `BindResultV4.measured`, `inherited`, `resolved`, `capacity` and `Use.end` (I26)                |

`listUses(cell, cls, plan?)`: `plan(match)` gives `'source'`, `'target'` or `'drop'` for the uses of one match
block. With no plan the function works as today (`cell.attrs.at`), so its other callers do not change. Each use of
an edge gets `end: 'source' | 'target'`.

**I26.** `BindResultV4` gets four fields. The card and the inspector read them; they do not run the inference again.

```ts
/** bound edge id → its measured end (I7), also for an unmeasured link */
measured: Map<string, MeasuredEnd>;
/** cell id → each name that the bind read from another cell, with the cell that gave it */
inherited: Map<string, Map<string, AttrOrigin>>;
/** cell id → use path → the matchers with the values put in, or the reason why the block does not resolve */
resolved: Map<string, Map<UsePath, { matchers: ResolvedMatcher[] } | { problem: string }>>;
/** I25 */
capacity: Map<string, { a2b: LinkCapacity; b2a: LinkCapacity }>;
```

`resolved` holds the arrays that `resolveBlock` already makes, so it costs one map entry for each use.

`src/binding/cellAttrs.ts` stays as the own-attribute reader for the harness export (`attrOf`); the bind does not
use it. `src/harness.ts` also exports the functions of `identity.ts`.

### 7.2 The cache (I18)

- The ends and the owners depend only on the diagram. `edgeEnds.ts` gets `endContextOf(xml, index)`: it keeps the
  result in a `WeakMap` with the cell index as the key, and builds again when the XML text differs. The bind and the
  split editor both call it. Thus the panel builds the end maps once for each diagram, not on each data refresh. The
  parse of the XML is already one for each XML text (`pageOf`).
- The bind still asks for the ends only on the first read that needs them (a `from.`/`to.` name, a cell that lacks
  an own attribute, a link with no own capacity whose class gives no capacity value). A diagram where each bound cell
  has all its attributes never asks.
- The measured end of a link depends on the config (the class `match`), so its memo lives for one bind.
- `no-edge-ends` enters the report when the bind first asks for the ends, as today.

### 7.3 Split links (I19)

Out of scope. What occurs: each run is a cell of its own and infers alone. A run that has `pg-from` and `pg-to`
resolves both ends from them, so all runs of one link get the same measured end and select the same series. A run
that has no `pg-from`/`pg-to` takes its ends from the XML: only the first run has a source and only the last run has
a target, so a middle run has no instrumented end and is unmeasured (or gives `missing-attr` when it has a part of
an identity). No test covers this until portograph gives a `pg-run` fixture.

### 7.4 Plain draw.io diagrams (I20)

The same resolver, with no portograph rule except 4.1 item 1:

- The ends of an edge are the `source` and `target` of its `mxCell` in page 1 (v4 spec 3.8.1).
- A shape reads from its container, and the container from its own container, up to the layer.
- An edge that ends on a shape inside a container reads the shape, then the container.
- A compressed page gives no ends and no owners: `no-edge-ends`, as today. Then a link reads only its own
  attributes, and a link with dependent uses and no identity is unmeasured.

AC7 checks the parity with one diagram in both forms.

## 8. Compatibility

### 8.1 The rule (I21)

Revision 1 claimed more than it gave: it derived the end from the class `match` also when no use read it, and it
skipped the whole cell (review R1, R2). The rule of this revision is stated for each use and each template:

1. **Values.** The resolver gives a value that differs from today only for a pair (cell, name) where today gives no
   value.
2. **Uses.** A query use that resolves today on a link is end-free (5.1). It stays in the list, with the same
   matcher values, the same path and the same feed (`at`, else the source: 5.6). Thus it selects the same series for
   the same direction. A use of a vertex that resolves today reads only own values and does not change.
3. **Templates.** A template that resolves today reads only own values and gives the same text.
4. **Capacity.** The capacity of a link changes only when the link has neither `cap` nor `capacity`, a direction has
   no value from the `capacity` query, and the measured end cell has `cap` or `capacity` (C4).

Consequences:

- A use that has `no-series` today keeps it: it resolves today, so rule 2 applies. No use can move from `no-series`
  to a wrong series.
- The only items that change are uses and templates that have `missing-attr` today, and the capacity of rule 4.
- A cell with no `missing-attr` entry today, and no capacity change of rule 4, gives the same patch, the same series,
  the same card and the same report entries. The golden record (S0) checks this with the configurations of the
  review: row, text and chart matches on the cell id, an asymmetric own `cap`, `extends` and overrides.

### 8.2 The intended changes

| Id  | Today                                                                                               | After                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | a vertex lacks a name that its owner chain has: `missing-attr`                                      | the value of the owner; the inspector shows the origin                                                                                                   |
| C2  | a use or a template of a link lacks a name that the measured end has: `missing-attr`                | the value of the end; the feed of a dependent use follows the end (5.6)                                                                                  |
| C3  | a link with no identity and no instrumented end: `missing-attr` for each dependent use, grey halves | an unmeasured link: its dependent uses are quiet, one `unmeasured-link` information entry; the rest binds as today (5.4)                                 |
| C4  | a link with no `cap`; its end cell has `cap` or `capacity`: no capacity                             | the capacity of the end cell (I14, I15)                                                                                                                  |
| C5  | a compressed page, a config with no `from.`/`to.`: no `no-edge-ends`                                | `no-edge-ends` when the bind asks for the ends: a bound cell lacks an own attribute, or a link has no own capacity and a direction has no capacity value |

### 8.3 The risk of a wrong series

C1 and C2 can bind a cell that did not bind. The value can be wrong for the cell: a shape with `bind` and no `key`
inside a container with a `key` now shows the series of the container. Protections: the inspector marks each
inherited value with its origin; the cell counts of a class show the number of cells that read an inherited value;
`BindResultV4.inherited` gives the list to a harness.

### 8.4 Generated panels (I22)

The generator of the consumer team writes `bind`, `key`, the other matched attributes and `at` on each link, and the
identity on each bound node (v4 spec 7.3.2, 7.3.3). Thus each generated link takes rule 1 of 5.2, each of its uses
is end-free and reads only own attributes: no behaviour change. The proof has three parts:

1. The rule of 8.1, with the unit tests of AC2 and AC3.
2. A golden record (S0): the bind results of the pilot configs (`src/fixtures/pilots-v4.ts`) on cells in the
   generated form, and of demo L3 as it is today, written on `main` before any change in `src/`. The cells of the
   pilot fixture include traps: the node at the other end has another `key`, and the port cells at both ends have
   another `port`. The record also holds the configurations of review R1 and R2 (hand-authored forms that have no
   `missing-attr` today). The record must not change in any later step.
3. `BindResultV4.inherited` is empty and each reason in `measured` is `at` or `own` for these fixtures (AC4).

Two points for the consumer team, outside this repository:

- A port cell of a generated sheet must not carry `cap` or `capacity` (C4). Today no generator writes them on a
  port.
- The build stops on `unknown-class`, `missing-attr` and `class-no-match` (v4 spec 7.3.6). A generated link that
  loses its identity is now unmeasured (C3), not `missing-attr`. The harness check should also stop on
  `unmeasured-link` and on a `BindResultV4.inherited` that is not empty.

### 8.5 The config

No schema change, no new option, `version: 4`. The table test `src/model/v4.table.test.ts` does not change.

## 9. The inspector and the report

**I23. The inspector** (v4 spec 5.4) reads the bind result and shows:

- For each cell, in the attribute list: each name that the bind read from another cell, with the value and the
  origin, for example `key  node-rtr-a  (from rtr-a)`. The origin is the label of the giving cell, else its id. The
  list shows only the names that the class reads (`BindResultV4.inherited`), not each attribute of each owner.
- For a link, the line "Measured end":

  | Reason | Text                                                                            |
  | ------ | ------------------------------------------------------------------------------- |
  | `at`   | "target: at=target on the link" / "source: at=source on the link"               |
  | `own`  | "source: the link has key, port itself" (or "…has key itself; port is missing") |
  | `only` | "target: only this end gives key, port"                                         |
  | `both` | "source: both ends give key, port. Set at=target to measure the target end."    |
  | `none` | "none: no end gives key, port. Put them on a port, or on the link."             |

  The names in the text are the identity names of the link.

- The ends of the link in the readable form that `main` has (c5d97af).
- For each use (the section of the use): the matchers with the values put in, from `BindResultV4.resolved`, or its
  problem. Today the inspector resolves the block again with the own-attribute reader (`resolvedText`,
  `InspectorV4.tsx`); with an inherited `key` that shows "Missing attribute key" beside a series that the bind
  selected (review R3). The inspector stops its own resolve. For a directional use it also shows the end of the use
  (`Use.end`): "feed: target end (inferred)".
- The lines "a → b" and "b → a" of the link read the end of the `up` and `down` uses (`Use.end`), not
  `meta.attrs.at`.
- For an unmeasured link: the dependent uses in a list "not measured", with their match as the YAML has it.
- The capacity of each direction with its source, from `BindResultV4.capacity`: the query, the link, or the end cell
  (with its label).

The writes stay as they are (D19): `bind`, `key`, `at`. The `at` action of `main` keeps its behaviour. With an
inferred end it writes the other end as an explicit `at`; an action "infer the end" removes `at` when the link has
one. The note for a generated panel stays.

**I24. The report** gets two kinds (5.4, 5.5): `unmeasured-link` (information) and `end-ambiguous` (warning).
`missing-attr` stays for a link with a part of an identity and for each vertex. Stage 1c groups the entries of one
cause; `end-ambiguous` is one entry for each class, and `unmeasured-link` one for each class and name set (I10).

## 10. Stage 2b: a port shows its link (separable, not in this plan)

**What stage 2 already gives.** With the owner chain, a port cell with `bind` and its own `port` reads `key` from its
node. So a port class with `status`, `text`, a `chart` or an `updown` row binds the counters of the interface with no
copy of the node identity. This covers the mesh bus (no link cell): the port is the only cell that can carry the
value, and it carries it through a port class. The guide shows this (S8).

**What stage 2b adds** (a follow-up, after the owner sees stage 2):

1. A reverse index from a port cell to the links that end on it (from the end maps of 7.2).
2. A template root `${peer.<name>}` on a port cell: the owner chain of the other end of its link. A port with no link
   or with two or more links gives `template-unresolved`.
3. `up`, `down` and `capacity` on a class whose cells are port cells: the port takes the colour of the worse half,
   with the capacity of section 6 (the `cap` of the port itself first). `unused-field` then applies only to a vertex
   that is not a port.
4. A card row that names the peer and shows the load of the link, from the patch of the link when the link is bound.

Open points for 2b: the state of a port with two links; whether the port mirrors the patch of the link or binds
alone; the paint of a port pill. They need a mesh bus fixture from portograph.

## 11. Performance

- The bench `src/binding/bind.v4.bench.test.ts` (300 cells, 1000 series, own attributes): the median of three
  process medians stays within 5 % of `main`, measured in one session on one machine (the method of
  `docs/acceptance.md`, "Binding model v4: bench").
- A new case: 300 links that have only `bind`, 300 nodes with `key`, 600 ports of which 300 have `port`. Its median
  is at most 1.5 times the median of the own-attribute case with the same number of bound cells.
- Twenty binds of one diagram build the end maps once (AC14).

## 12. Changes to the approved model

| Point of the approved model                               | This spec                                                                                              | Why                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| "decide whether `key` and `port` are inherited"           | both are; no name is special; `label` is added to the own-only names (I3)                              | the engine stays free of name conventions                                           |
| (not stated) `port` from `pg-port`                        | rejected (I4)                                                                                          | an explicit attribute marks an instrumented port; a default makes both ends qualify |
| "the first end that gives ALL attributes"                 | the end must give the identity names that the link does not have itself (I7 rules 3–4)                 | a link with its own `port` (a VLAN device) still infers the node                    |
| "a link where no end gives them stays quiet"              | unmeasured only when the link has no identity name and no `at` (I7 rules 5–6)                          | a part of an identity is a mistake that the author must see                         |
| "the attributes that the class match needs"               | the names that the dependent uses of the link read, each use with its own match block (I6)             | a class match that no use reads must not decide anything (review R1, R2)            |
| "the feed flips by the chosen end exactly as `at=target`" | for each use: a use that resolves on the link itself keeps the feed of today (I13)                     | else the inference changes the direction and the percent of a row that works today  |
| "a link where no end gives them stays quiet" (the cell)   | only its dependent uses are quiet; its end-free uses and its templates bind as today (I9)              | a working row or URL must not go away                                               |
| "one summary entry or a class-level opt-in"               | one information entry for each class, not counted in view mode (I10); no opt-in                        | no schema change                                                                    |
| "`cap` on the measured port counts after the link's own"  | kept; on an end cell `a/b` is transmit/receive, not a→b/b→a (I15); an own `cap` that fails stops (I14) | a port has no geometry; the rule of stage 1a for a bad value                        |
| "both qualify → source first"                             | kept; plus `end-ambiguous` when the choice finds no series (I12)                                       | source first is safe for tunnels, not for two exporter families                     |
| "ports show their link (2b)"                              | a follow-up; the part that the owner chain gives is in scope (section 10)                              | 2b needs a mesh bus fixture and a paint decision                                    |
| (not stated) an edge inside a container                   | a link does not read its container (I8)                                                                | one source for each name                                                            |

## 13. Acceptance

Unit (vitest):

- **AC1** `ownerAttr`: a port reads `key` from its node; a shape reads from its container and the container of that;
  the search stops at the layer; an own value wins; an empty own value wins; `constructor` gives no value.
- **AC2** Own-only: a port does not read `bind`, `at`, `cap`, `capacity`, `label`, `id` or a `pg-*` name from its
  node; a link does not read them from an end.
- **AC3** `measuredEnd`: one test for each row of the table of 5.2, and: `at=source` with an instrumented target
  stays `source`; a link with its own `port` and no `key` infers the end that gives `key`; a class `match` that no
  use reads adds no identity name; the identity names are the sorted union over the dependent uses.
- **AC4** The golden record of S0 is unchanged after each step. For its fixtures `inherited` is empty and each
  reason is `at` or `own`.
- **AC5** A link with only `bind` between a node with `key` and a port with `port` binds the same series, the same
  halves and the same URL as the same link with `key`, `port` and `at` written on it, for the source and for the
  target.
- **AC6** An unmeasured link with only dependent uses: no patch, no uses, one `unmeasured-link` entry with the
  sorted identity names, no `missing-attr`, no `class-no-cells`. A link with `key` and no `port` and no instrumented
  end keeps `missing-attr`. Two unmeasured links of one class, one with an override `match` on another name: two
  entries, each with its own names and cells.
- **AC7** Parity: one topology as a portograph export and as a plain draw.io diagram (edges with `source` and
  `target`, shapes in containers) gives the same series for each link.
- **AC8** `${key}` in a URL of a link reads the measured end; `${from.key}` and `${to.key}` read the geometric ends,
  also when the measured end is the target; `${from.pg-port}` works.
- **AC9** The feed: an inferred `target` gives the same halves, link label, `updown` row and `updown` chart as
  `at=target`, and each of these uses has `end: 'target'`.
- **AC10** Capacity: each row of the table of I14; `cap=50M/10M` on a port measured at the source and at the target
  (I15); an own `cap` that does not parse does not read the end; `bad-cap` of an end names the end cell; a
  `capacity` series matches through the inferred identity.
- **AC11** `end-ambiguous`, reason `both`: no dependent use has a series → one entry; one dependent use has a
  series, or many → no entry; a dependent use loads or fails → no entry; only an end-free row has a series → the
  entry stays; a class with a URL and no query use → no entry.
- **AC12** The view mode warning list has no `unmeasured-link` line; the split editor shows it in the class tab and
  does not count it.
- **AC13** The card of a link with an inferred `target` shows the same rows as with `at=target`.
- **AC14** Twenty binds of one index and one XML call the build of the end maps once; a new XML builds again.
- **AC15** The inspector: the origin of an inherited value; each text of the table of I23; the `at` action writes
  `at`. For a port that inherits `key` and for a link with an inferred target: the section of each use shows the
  resolved matcher text with the inherited value (`job="node-rtr-a", device="br-lan"`), not "Missing attribute"; the
  lines "a → b" and "b → a" name the queries of the flipped feed; the same with an override `match`. The capacity
  line names the end cell.
- **AC16** The demo: `fixtures/demo/demo-l3.yaml` has `key`, `port` and `at` on no link; the bind of the new export
  selects, for each link id, the same series as the golden record of the old export, with an empty report.

Compatibility and storage (review round 1):

- **AC21** (R1) The class of review R1 (`match: {key: job}`; `text`, an `updown` row and a `value` chart each with
  `match: {id: edge}`; `url: /d/demo?edge=${id}`), an edge with only `bind`, no end that gives `key`: the same
  text, row, chart, card, URL and empty report as on `main`. The same with a target end that gives `key`.
- **AC22** (R2) A class `match: {key: job}` with an `updown` row `match: {id: edge}`; the edge has `bind` and
  `cap=50M/10M`; only the target gives `key`: `rows[0].a2b` keeps the `up` refId, and the card shows the same
  percent of 50M as on `main`. With `up` and `down` added to the class: the halves read the target end and flip,
  the row does not, and each use holds its `end`.
- **AC23** (R1) An unmeasured link with a mix: the dependent uses are not in the list and give no entry; an end-free
  row binds; a URL with `${id}` shows; a URL with `${key}` does not show and gives no `missing-attr`; a `metadata`
  text with `${site}` (not an identity name) gives `missing-attr`; `patch.link` is absent.
- **AC24** (R4) `BindResultV4.capacity`: a link with only an `updown` row and a port `cap` has a capacity with the
  `cellId` of the port, and its card shows the percent; a class whose `capacity` query gives both directions never
  asks for the ends (an `ends` function that throws); `bad-cap` of a port names the port cell and the click in the
  report selects it; `bad-cap` of the link names the link.

Checks by command:

- **AC17** `npm run typecheck`, `npm run lint`, `npm run test:affected`, `npm run check:privacy` pass in each step.
- **AC18** The bench budget of section 11, recorded in `docs/acceptance.md`.
- **AC19** E2E, one spec at a time, on the worktree stack: `tests/link-strokes.spec.ts`, `tests/link-labels.spec.ts`
  and `tests/split-editor.spec.ts` pass with the new demo export. Before the push, on `main`: `npm run e2e:matrix`.
- **AC20** A screenshot of the demo dashboard after S7 shows the same link colours and labels as before; a person
  opens it and looks at it.

## 14. Implementation plan

Rules for each step: tests first; one step is one branch and one worker session; the gate of AC17; an adversarial
review for each diff in `src/`. "Parallel" names the steps that can run at the same time in separate worktrees.

| Step | Title                                 | Needs      | Parallel with |
| ---- | ------------------------------------- | ---------- | ------------- |
| S0   | Golden record                         | —          | S1, S2        |
| S1   | The resolver module                   | —          | S0, S2        |
| S2   | The end cache                         | —          | S0, S1        |
| S3   | Owner chain in the bind               | S0, S1, S2 | —             |
| S4   | Measured end in the bind and the card | S3         | —             |
| S5   | Capacity from the end                 | S4         | S8            |
| S6   | The inspector and the report views    | S5         | S8            |
| S7   | The demo fixtures                     | S5         | S6, S9        |
| S8   | The guide and the contract note       | S4         | S5, S6, S7    |
| S9   | The bench record                      | S5         | S6, S7        |

S6 needs S5 because the inspector shows the capacity of `BindResultV4.capacity` and both steps change the readers of
the bind result. S5 and S6 do not run in parallel.

### S0. Golden record (tests only)

- Files: new `src/binding/identity.golden.test.ts` and its snapshot file.
- Content: a function `record(result)` that keeps, for each cell: the uses (path, refId), the labels of the series of
  each use, the status (state, text), the text on the cell, the link halves (status, value, percent, capacity
  source), the URLs and the rows; for each edge the card model (`buildCardV4`: the text and the state of each row,
  so the percent of an `updown` row is in the record); and the report. It does not keep `patch.scope`.
- Each case must have an empty report on `main` before the snapshot is written (assert it in the test). When a
  report is not empty, correct the frames or the targets of the case, not the expectation.
  1. The pilot `netL2Pilot()` on cells in the generated form: two nodes with `bind` and `key`, their port cells
     (`pg-kind=port`, `pg-node`), links with `bind`, `key`, `port` and `at` (one with `at=source`, one with
     `at=target`, one with `cap`), `pg-from` and `pg-to`. Traps: the node at the other end has another `key`; the
     port cells at both ends have another `port`. Frames for both nodes and all ports, so a wrong read selects a
     series and shows.
  2. The pilot `boilerPilot()` on cells with own `key` and `port`, each relay cell inside a container that has
     another `key`.
  3. Demo L3: the SVG and the `.drawio` of today with `demoConfigV4`. Build the index as the bench does
     (`buildCellIndex(mountSvg(…))`, `src/binding/bind.v4.bench.test.ts`) and pass the XML to `bindV4`. Give one
     frame for each series that a use of `demoConfigV4` selects. Make the list from the config, not by hand: bind
     once with no frames and read `result.uses`. Today the refIds are `lan_tx`, `lan_rx`, `wan_tx`, `wan_rx`,
     `speed`, `up`, `load`, `cpu`, `v4_samples` and `v4_nine`. Take the label sets and the number of series of each
     from `stack/metrics-gen/gen.py` and the targets of `demo/dashboard.template.json`: `v4_samples` gives three
     series and `v4_nine` nine series for each router, so the record holds the N-series behaviour. Copy both files to
     `src/fixtures/golden/demo-l3-2026-11-11.svg` and `.drawio`, so that S7 can change the demo and the record
     stays.
  4. Review R1 (AC21): the class, the edge and the frames of that check, twice: with no end that gives `key`, and
     with a target port whose node gives `key`.
  5. Review R2 (AC22, first sentence): the row match on the cell id, the own `cap=50M/10M`, a target that gives
     `key`.
  6. `extends` and overrides: a child class that inherits a row with `match: {id: edge}` from its parent; a cell
     override that replaces the class `match` with `{id: edge}`; a cell override that adds an `updown` row with its
     own match. Each on an edge with only `bind` (and `at=target` on one), with a trap `key` on the target node.
- Acceptance: the test passes on `main` with no change in `src/` outside the test and the copies; each case has an
  empty report.

### S1. The resolver module (no wiring)

- Files: new `src/binding/identity.ts`, new `src/binding/identity.test.ts`.
- Tests first: AC1, AC2, AC3, and `linkAttr` (own wins; through the end; own-only names), `endCap`, `inheritableNames`
  (drops `from.x`, `to.x`, own-only names), `isEndFree`, `identityNames` (the sorted union over the dependent
  blocks; an end-free block adds nothing), `createIdentity` (the memo of `measure`; `inherited` records the origin;
  the ends are not read when each value is own: pass an `ends` function that throws).
- Code: the functions of 7.1 on `EndContext`. Use `Object.hasOwn` for each read, as `endAttr` does. Guard the owner
  walk against a cycle with a `seen` set.
- Acceptance: the tests pass; no other file in `src/` changes.

### S2. The end cache

- Files: `src/binding/edgeEnds.ts`, `src/binding/edgeEnds.test.ts`, `src/editor/popup/SplitEditor.tsx` (the `ends`
  memo calls the new function).
- Tests first: AC14 at the level of `endContextOf` (same index and XML: the same object; new XML: a new object; a
  new index: a new object); the report of `no-edge-ends` is on the cached result.
- Code: `endContextOf(xml, index): EndContext & { report: ReportEntry[] }` with a `WeakMap<CellIndex, …>`.
  `edgeEnds` stays exported for the harness.
- Acceptance: the tests pass; the golden record is unchanged.

### S3. Owner chain in the bind (vertices and templates)

- Files: `src/binding/bindV4.ts`, `src/binding/bindV4.test.ts`, `src/harness.ts` (export the functions of
  `identity.ts`).
- Tests first, in `bindV4.test.ts`: a port with `bind` and `port` reads `key` from its node and binds; a shape in a
  container reads `key`; a template `${site}` reads the container; an own-only name gives `missing-attr`;
  `result.inherited` holds the origin; a bind where each cell has its attributes never calls the ends (an XML that
  would give `no-edge-ends` gives no entry).
- Code: `bindV4` builds `createIdentity(ends)` with `ends` from `endContextOf`, and uses `identity.attr` in `select`
  and in the template scope. In this step an edge still reads only itself (pass the reason `own`). Add
  `inherited` to `BindResultV4`.
- Acceptance: AC1 at the bind level, AC4.

### S4. Measured end in the bind and the card

- Files: `src/binding/bindV4.ts`, `src/binding/uses.ts`, `src/binding/linkFeeds.ts` (the doc comment),
  `src/binding/report.ts`, `src/stage/useBoundDiagram.ts` (`reportLine`), `src/components/DrawioMapPanel.tsx` (the
  warning list drops `unmeasured-link`), `src/interact/cardModel.ts`, `src/editor/popup/MatchReport.tsx`
  (`entryTarget` for the two kinds), and the tests of each.
- Tests first: AC5, AC6, AC8, AC9, AC11, AC12 (the view mode part), AC13, AC21, AC22, AC23; `uses.test.ts`:
  `listUses` with a plan (source, target, drop; `Use.end`), and with no plan as today.
- Code:
  1. In `bindCell`, for an edge: list the uses once with no plan to get the match block of each use; parse each
     block (`blockOf`); `needs = identityNames(meta, blocks)`; `end = identity.measure(meta, needs)`; set
     `out.measured`.
  2. The plan of a block: with an own `at`, the end of `at`; for an end-free block, `source`; for a dependent block,
     `end.end`, or `drop` when the link is unmeasured. `uses = listUses(meta, eff, plan)`.
  3. For an unmeasured link: `report.cell({ kind: 'unmeasured-link', cls, attrs: needs }, id)`. The templates run
     with a reader of own attributes; a missing name that is in `needs` gives no entry and hides the item. When
     `uses` is empty and the templates give no URL and no row: no patch, return. `patch.link` only when a use of
     kind `up` or `down` is in `uses`.
  4. `linkHalves` reads the end of the `up` and `down` uses (`Use.end`), not `meta.attrs.at`.
  5. `end-ambiguous` (AC11): after the uses of an edge with the reason `both`, over its dependent uses only.
  6. `out.resolved`: in `select`, keep `resolved.resolved` or the reason of the problem for each use path (I26).
  7. `cardModel`: `updownRow` reads `data[0].use.end`; `UseReader.at` goes away.
  8. Add the two kinds to `REPORT_KINDS` and `ReportEntry`; `reportLine` gives the lines of I10 and I12.
- Acceptance: the listed checks; AC4; the bench of today within its budget (run it once, print the median).

### S5. Capacity from the end

- Files: `src/binding/capacity.ts`, `src/binding/capacity.v4.test.ts`, `src/binding/bindV4.ts`,
  `src/binding/bindV4.test.ts`, `src/interact/cardModel.ts`, `src/interact/cardModel.v4.test.ts`.
- Tests first: AC10, AC24.
- Code:
  1. `CapacityV4Input` gets `end?: () => { cellId: string; cap?: string; capacity?: string; at: 'source' |
'target' } | undefined` and `cellId` (the link). `capacityV4` calls `end` only when the link has neither `cap`
     nor `capacity` and a direction has no value from the `capacity` query. It parses the pair of the end with the
     rules of stage 1a, maps transmit/receive to a→b/b→a with `at` (I15), and sets `LinkCapacity.cellId`. Its
     entries carry the cell that has the attribute.
  2. `bindV4`: a function `capacityOfEdge` runs for each bound edge that has an `up`, `down` or `capacity` use or an
     `updown` row or chart, also when the edge has no `patch.link`. It stores the result in `out.capacity` and
     passes each entry to the report with the cells of the entry (do not replace them with the edge id).
     `linkHalves` reads `out.capacity`. Before you narrow the set of edges, check with a search for `capacityOf`
     and `'capacity'` (a chart range) that no other reader needs a capacity; if one does, add its edges.
  3. `cardModel.readerOf`: `capacityOf` reads `bound.capacity`; remove its call of `capacityV4`.
- Acceptance: AC10, AC24, AC4 (the card texts of the golden record do not change).

### S6. The inspector and the report views

- Files: `src/editor/popup/InspectorV4.tsx`, `InspectorV4.test.tsx`, `src/editor/popup/MatchReport.tsx`,
  `MatchReport.test.tsx`, `src/editor/split/reportCounts.ts` and its test.
- Tests first: AC15; AC12 (the editor part); the counts of a class show the unmeasured links and the cells with an
  inherited value.
- Code: the inspector reads `bound.measured`, `bound.inherited`, `bound.resolved`, `bound.capacity` and `Use.end`
  (it has `bound` already). Remove `resolvedText` and its imports of `parseMatchBlock`, `resolveBlock` and `attrOf`:
  the text of a use comes from `bound.resolved`. `EdgeEnds` reads the end of the `up` and `down` uses. The texts of
  I23. Keep the end names and the `at` action of `main`. `reportCounts` adds `unmeasured` and `inherited` for each
  class. `MatchReport` puts `unmeasured-link` after the warnings and leaves it out of the tab number.
- Layout: open the split editor on the worktree stack, select a link of each reason, and look at a screenshot.
- Acceptance: AC15, AC12.

### S7. The demo fixtures

- Files: `fixtures/demo/demo-l3.yaml`, `fixtures/demo/demo-l3.drawio`, `fixtures/demo/svg/demo-l3.svg` and
  `legacy-html-labels.svg`, `src/fixtures/demo-config.ts` (the comment only), `src/fixtures/demo-config.test.ts`,
  `tests/authoring-fixtures.ts` (it copies the join attributes of the demo cells: now also of the port cells),
  `provisioning/dashboards/demo.json`.
- The YAML: each node keeps `bind` and `key`. Each measured port gets the map form with `meta: { port: <name> }`,
  and `cap: 100M` where the link has it today: `rtr-a` `br-lan`, `ts0`, `tun0`; `rtr-b` `br-lan`, `tun0`; `isp-a`
  `pppoe`; `radio` `dhcp`; `isp-b` `pppoe`; `proxy-a` `relay-out`. Each link keeps only `meta: { bind: <class> }`.
  No other port gets `port`, so each link has one instrumented end and the reason `only`. `rtr-b` `ts0` gets no
  `port`: `stack/metrics-gen/gen.py` has no series for it. Thus the demo has no link with the reason `both`; the
  guide explains that case in words (S8). Do not change the generator of the demo metrics in this step.
- Commands, in this order: `npx portograph render fixtures/demo/demo-l3.yaml --format drawio --output
fixtures/demo/demo-l3.drawio`; `./scripts/export-fixtures.sh` (needs the draw.io CLI or docker); `npm run
build:dashboard`. Check with `git diff --stat` that only the expected files change.
- Tests first: AC16 in `demo-config.test.ts`: for each link id, the series of each use equal the golden record of
  S0; the report is empty; no link has `data-meta-key`, `data-meta-port` or `data-meta-at`.
- E2E: AC19 on the worktree stack (see the task rules for the compose override). AC20: a screenshot.
- Acceptance: AC16, AC19, AC20, `npm run check:privacy`.

### S8. The guide and the contract note

- Files: `docs/guide/bindings.md` (the sections "Cell attributes", "Match", "Templates", "Links", "The match
  report"), `docs/guide/links.md` ("Capacity"), `docs/research/portograph-contract.md` (one paragraph: what the
  panel reads from a port cell), `README.md` only if it names `key`/`port`/`at` on links.
- Content: the owner chain and the own-only names; the measured end table of 5.2 in plain words; "put `port` on the
  port, `key` on the node, `bind` on the link"; the exceptions and their fix (a VLAN device: `port` on the port
  cell; two exporter families: different attribute names, or `at`); the capacity order of I14 and the meaning of
  `a/b` on a port; a port class for a mesh bus (section 10); the two new report kinds; `${from.x}` stays geometric.
- Acceptance: `npm run lint` (prettier), `npm run check:privacy`; a light review.

### S9. The bench record

- Files: `src/binding/bind.v4.bench.test.ts`, `src/fixtures/benchBind.ts` (a builder of the inferred case),
  `docs/acceptance.md`.
- Code: the new case of section 11 with value checks after each pass; print both medians.
- Run each case three times with `--maxWorkers=1`, on `main` before S3 and on the branch after S5, in one session.
- Acceptance: AC18; the numbers go into `docs/acceptance.md` under "Inferred identity: bench".

## 15. Open points

1. `port` with no default from `pg-port` (I4): the owner can reverse this for portograph sheets; the cost is the
   ambiguity of 5.5.
2. Unmeasured links draw with no grey (I9). An option for a grey "not measured" look is possible later.
3. Whether the consumer harness stops on `unmeasured-link` and on inherited values (8.4): a decision of the consumer
   team.
4. Stage 2b (section 10).
5. New in revision 2: one link can have two feeds (5.6): its dependent uses at an inferred target and an end-free
   directional use at the source. The alternative is one feed for the cell, which changes a row that works today.
   The owner can prefer the alternative with a `missing-attr`-free compatibility exception; this spec does not.
6. New in revision 2: the identity names are a union over the dependent uses (5.1). One row that reads a name that
   no end gives makes the whole link unmeasured. A rule "the end that serves the most uses" is possible later.

## 16. Review round 1 (Codex "Astra", on d4a4473)

All findings are accepted. Each was checked against the code.

| Finding      | Check against the code                                                                                              | Resolution                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| R1 (blocker) | `listUses` gives each row, the text and the chart its own match; the class `match` can have no reader (`uses.ts`)   | dependence is per use (I6); an unmeasured link keeps its end-free uses and templates (I9); AC21, AC23; S0 case 4 |
| R2 (major)   | the feed of an `updown` row comes from `cell.attrs.at` for the whole cell (`uses.ts`, `cardModel.updownRow`)        | the feed is per use, an end-free use keeps the feed of today (I13); I21 rewritten; AC22; S0 cases 5 and 6        |
| R3 (major)   | `resolvedText` and `EdgeEnds` of `InspectorV4.tsx` read `attrOf` and `meta.attrs.at`                                | `BindResultV4.resolved` and `Use.end` (I26); I23 and S6 changed; AC15 extended                                   |
| R4 (major)   | `linkHalves` runs only with `up`/`down`; `readerOf` calls `capacityV4` itself; `bindV4.ts` replaces the entry cells | `BindResultV4.capacity` with `cellId`, a lazy end, entries keep their cells (I25); AC24; S6 now needs S5         |
| R5 (minor)   | a class with no query use makes the old predicate true with an empty set                                            | the predicate reads the dependent uses only (I12); AC11                                                          |
| R6 (minor)   | `Report.cell` groups by the whole entry, so different `attrs` give two entries                                      | one entry for each class and sorted name set, by design (I10); AC6                                               |
| R7 (minor)   | `router-cpu` reads `v4_samples` and `v4_nine` (`demo-config.ts`)                                                    | S0 takes the refIds from the uses of the config and needs an empty report first                                  |
