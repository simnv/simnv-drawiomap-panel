# Binding model v4: classes, keys on the cells, a YAML editor

- Status: draft, revision 4 after review round 3, 2026-10-29. Not approved.
- Decisions: the user settled the design on 2026-10-28 (the consumer team's planning note "drawiomap-bindings
  decisions", items 1–26), amended it after review round 1 (amendments A1–A13 of the same note) and after
  revision 2 (A14–A17; A14–A16 close the open questions O1–O3 of revision 2, A17 closes O4). This spec calls them
  **D1–D26** and **A1–A17**. An amendment overrides the decision it names. This spec does not change a decision or
  an amendment. When a decision does not fit the code, section 10.2 records it as an open question with the evidence.
- Reviews of round 1: "Fable" (sections (a)–(h), items numbered per section: "Fable b.1") and "Astra" (findings
  numbered 1–23: "Astra 5"). Reviews of round 2: "Astra R1"–"R9" with its section (3) on the acceptance checks, and
  "Fable M1", "M2" with its smaller items and its section (3). Review round 3: a narrow check of revision 3, with
  the open items R8, N1 and the A17 edits. Section 0 maps each finding to its resolution.
- Reads: the v3 inventory and the prior-art survey of the consumer team (12 tools), `CODING_STANDARDS.md`, ADR 0001,
  ADR 0002, `docs/security.md`, `docs/research/portograph-contract.md`, the PoC spec section 8.
- Scope: the panel (`src/`), its README, its tests and its docs; the generator of the consumer team
  (`scripts/gen_drawiomap/`, in the consumer repository); the pilots.
- Citations: a path with no prefix is in this repository. "Consumer" marks a path in the consumer repository.
  "Portograph" marks a path in the portograph repository. "NM" is `node_modules` at `@grafana/ui` and
  `@grafana/data` 12.4.13.
- Privacy: the pilot examples keep the real metric names, label names and refIds. Host names and job values are
  names from the demo network (`fixtures/demo/`), because the real device names are on the private denylist.

## 0. Changes since the reviews

### 0.1 Changes since review rounds 2 and 3

Changes since review round 3 (revision 4):

| Item | Severity | What changed in this spec | Section |
|---|---|---|---|
| A17 (O4) | amendment | `${name:format}` with a Grafana variable format is a dashboard variable; `${name}` with no format stays a required cell attribute (A5); bare `$var` stays a dashboard variable. The URL order keeps an explicit format and gives `percentencode` only to a bare ordinary variable. `${job:queryparam}` is no longer rejected. O4 closed. | 2.4, 3.3, 6.2, 9 (P1 acceptance 4, 14), 10.1, 10.2 |
| R8 | major | The acceptance expectation follows the retained `yDomain`: `min: auto` with lines at 49 and 51 gives 47.45 to 52.55, because the helper keeps a span of at least 10 % of the top. The helper does not change. | 3.7, 9 (P1 acceptance 9) |
| N1 | major | Only a positively identified v3 deployment (`options.config.version` below 4) is exempt when `options.build` is missing. A v4 panel with no usable base stops `pull` and the deploy gate; nothing replaces `.cells.yml`, and nothing deploys. | 7.3.5, 7.4, 9 (P2 acceptance 2, 9), 10.3 |

Changes since review round 2 (revision 3). Amendments:

| Amendment | What changed in this spec | Section |
|---|---|---|
| A14 (O3) | Generated healthy mappings use the colour `transparent`: a healthy cell keeps its drawn colour, severity normal. A hand author can still choose green. O3 closed. | 3.4, 7.3.4, 8.1, 8.2, 9 (P2 acceptance 6) |
| A15 (O2) | `gen_drawiomap pull --check` runs in step 0 of the consumer `scripts/deploy.sh`, with the Grafana token from the environment. No API access stops the deploy. O2 closed. | 7.4, 9 (P2) |
| A16 (O1) | In P2, `"editable": true` is set by hand in `dashboards/Home & IoT/wb-enclosures.json`. O1 closed. | 7.3.8, 9 (P2) |
| A17 (O4) | Added in revision 4: see the table above. | 3.3, 10.1 |

Findings:

| Finding | Severity | Resolution | Section |
|---|---|---|---|
| Astra R1 | major | `applier.ts` moves to the rewrite list: its `applyKey` reads every status field that the painter reads (colour, text, severity, refId). A colour change with the same state repaints; `transparent` resets the paint. | 3.4, 6.2, 6.3, 9 (P1 acceptance 6) |
| Astra R2 | blocker | P1 replaces the v3 popup with the plain YAML option (A11). P1 deletes the whole v3 popup and its entry buttons, so P1 and P2 typecheck and ship without P3. A table names each e2e case that waits for P3. | 5.0, 5.1, 6.1, 6.2, 6.3, 6.5, 9 (P1 work, P1 acceptance 15, P3 work) |
| Astra R3 | major | `pull` compares the deployment with the unmerged base of the deployed build, not with the merged XML. Each pull gives the full delta again; a removed attribute leaves the file. Two pull, build and deploy cycles are tested. | 7.3.5, 7.3.6, 9 (P2 acceptance 3) |
| Astra R4 | major | A relative range measures the age at the clock, with the lag of a range that ends before now; an absolute range measures it at the range end. Tested with the same data and time range objects across a clock step. | 3.5, 9 (P1 acceptance 8) |
| Astra R5 | major | Frames of one refId with equal labels and field name merge by timestamp; history stays. Only a different value at an equal timestamp is a `duplicate-series` entry. Both frame orders are tested. | 3.2, 9 (P1 acceptance 9) |
| Astra R6 | major | The regex dialect is the common part of RE2 and JavaScript: a scan rejects RE2-only and JavaScript-only forms (`\z` included), rewrites escaped punctuation, and the compile uses the flag `u`. | 2.4, 9 (P1 acceptance 3) |
| Astra R7 | major | A bare dashboard variable in a URL gets the Grafana format `percentencode`; `$__…` variables stay raw. `links.ts` moves to the rewrite list. A `${` that is neither a placeholder nor a formatted variable (A17, revision 4) is a `schema` entry. | 3.3, 6.2, 6.3, 9 (P1 acceptance 4), 10.1 (O4) |
| Astra R8 | major | N lines share one Y range through `yDomain`, so the zero-based default of `CODING_STANDARDS.md:21` stays. `history.min` keeps `"auto"`. | 2.2, 3.7, 9 (P1 acceptance 9) |
| Astra R9 | major | A3 stays: topology wins. The P3 pilot binds a cell that the source generator leaves unbound, and a separate check shows that an edit of a generator-owned attribute is a conflict. | 7.3.6, 8.2, 9 (P3 acceptance 10) |
| Fable M1 | major | Same fix as R4. | 3.5, 9 (P1 acceptance 8) |
| Fable M2 | major | `pull` reads the build id of the deployed panel (`options.build`), not `HEAD`. A difference of config, targets, geometry or style is a printed warning. The deploy gate compares content, not versions. | 7.3.5, 7.4, 9 (P2 acceptance 2, 9) |
| Fable, smaller: `at=target` on generated links | minor | The one-click `at=target` serves hand-drawn edges. On a generated link the fix goes into the catalogue family. | 5.4, 7.3.6 |
| Fable, smaller: `gen_boiler.py` | minor | Today it writes only `model`, `slave` and `k`. P2 changes it to write `bind`, `key` and `port` and keeps its cell ids. | 7.3.7, 9 (P2 work, P2 acceptance 10) |
| Fable, smaller: consumer paths | minor | The harness scripts and the baseline file are under `scripts/gen_drawiomap/tests/`. | 6.4, 9 (P0) |
| Fable, smaller: a deployed sheet with no `.cells.yml` | minor | The gate computes the delta; an empty delta passes, else "pull first". | 7.4, 9 (P2 acceptance 9) |
| Fable, smaller: `object_class` | minor | All 13 nodes of net-l2-dm carry `object_class` today; the example shows it on each node. | 8.1 |
| Astra (3): P1/P3 boundary, P1 acceptance 15 | blocker | Same as R2; 6.5 has a P1 and a P3 column for each case that needs the popup. | 6.5, 9 (P1 acceptance 15) |
| Astra (3): repeat pull | major | Same as R3. | 9 (P2 acceptance 3) |
| Astra (3): R4, R9, O1, O2 | major | R4 and R9 are fixed; A16 closes O1; A15 puts the gate in a named deploy step; A14 closes O3. | 3.5, 7.4, 8.2, 10.1 |
| Astra (3): harness order | major | The bind validation runs after the SVG export and the config build, before the hash and the writes, on the cells of the exported SVG. | 7.4 |
| Astra (3): N-line tests | major | 9 lines with "+1 more", stable colours and labels after a frame reorder, the pinned tooltip, an empty member, R5 and R8. | 3.7, 9 (P1 acceptance 9, 14) |
| Astra (3): sandbox, CSP and phone | major | The Monaco smoke runs on the CSP and sandbox+CSP services of `docker-compose.yaml:49-65`; a phone check of the split view. Appendix A no longer defers them. | 9 (P3 acceptance 12, 13), Appendix A |
| Astra (3): Monaco test in `matrix` | minor | `split-editor` goes into `MATRIX_SPECS`; P1 removes `binding-editor` and `query` from it. | 6.5, 9 (P3 acceptance 9) |
| Astra (3): bundle check | minor | A fresh build first; the check looks for message texts of the `yaml` package, and the view-mode network trace shows no YAML chunk. | 5.3, 9 (P1 acceptance 17) |
| Fable (3): P1 acceptance 10 | minor | `${from.key}` through the parent chain; `no-edge-ends` on a compressed page. | 9 (P1 acceptance 10) |
| Fable (3): P1 acceptance 14 | minor | A `chart: {kind: value}` region. | 9 (P1 acceptance 14) |
| Fable (3): P1 acceptance 8 | minor | `raw.to: 'now'` with a clock step, and an absolute range. | 9 (P1 acceptance 8) |
| Fable (3): P2 acceptance 2 | minor | A deployment that is not `HEAD`, a build id that is not in the repository, and `--base`. | 9 (P2 acceptance 2) |
| Fable (3): boiler cell ids | minor | The regenerated source `.drawio` keeps its cell ids. | 9 (P2 acceptance 10) |

Round-1 findings that review round 2 marked "partly": Astra 1 (R1), Astra 5 (R6), Astra 6 (R7), Astra 7 and 8 (R4,
M1), Astra 15 (`gen_boiler.py`), Astra 18 (R2), Astra 21 (R3, A15), Astra 22 (R3, R9), Astra 23 (the section (3)
rows), Fable f.1 and f.2 (R3, A15), Fable f.4 (A16). The rows above resolve them.

### 0.2 Amendments of round 1

| Amendment | What changed in this spec | Section |
|---|---|---|
| A1 | The painter, the status band and the legend carry the exact Grafana colour, text and refId. Severity is only for "worst of N", the band and the legend. Q1 closed. | 3.4, 6.2 |
| A2 | `gen_drawiomap pull` writes `<sheet>.cells.yml`; the generator merges only from it, before the SVG export and the hashes. Generated dashboards are `editable: true`. Q4 closed. | 7.3, 7.4 |
| A3 | All editor-written attributes are kept; classes and overrides of generated panels stay generator-owned; a conflict exits non-zero unless `--accept-topology`; identity is uid + panel id + page + cell id. | 7.3.6 |
| A4 | Asymmetric capacity: `cap=50M/10M` and `capacity: {a2b, b2a}`. Capacities follow the geometry. Q5 closed. | 2.2, 3.8 |
| A5 | `${x}` is always a cell attribute, also inside a matcher; a missing one is `missing-attr`. Dashboard variables use bare `$var`. Reserved roots: `labels.`, `value`, `from.`, `to.`. Q3 closed. A17 (revision 4) adds `${name:format}` as a dashboard variable in URLs and titles; `${name}` with no format stays a cell attribute, and a matcher still reads no dashboard variable. | 2.4, 3.3 |
| A6 | A matcher value can be a list. Constant filters with no cell attribute go into the query. | 2.4 |
| A7 | A class with no `match` is a valid abstract base; it is an error only when a cell binds it. Q12 closed. | 2.3, 8.1 |
| A8 | Pilots: net-l2-dm and boiler-enclosure. wb-channels-lighting is a stretch pilot. Q2 closed. | 8 |
| A9 | Chart regions stay as the class field `chart`. Q7 closed. | 2.2, 3.9 |
| A10 | Stale is the result age per series; one stale series makes the cell stale; instant queries are never stale. Q9 closed. | 3.5 |
| A11 | P1 ships a plain YAML `CodeEditor` option. P1 and P2 ship in one change set. Q10 closed. | 5.0, 9 |
| A12 | The stored form is JSON only; the YAML text is written in a stable key order. Q6 closed. | 5.1 |
| A13 | Q8 `linkLabel` none/value/percent, the generator sets percent; Q11 an explicit rate-unit table; Q13 the inspector shows the source end and has one-click `at=target`; Q14 the generator sets `at` on each link and audits all panels; Q15 `yaml` 2.x only in a lazy chunk, with a bundle check. | 2.3, 3.7, 5.4, 7.3, 5.3 |

### 0.3 Blockers and major findings of round 1

| Finding | Severity | Resolution | Section |
|---|---|---|---|
| Fable a.3 | major | Reserved roots `labels.`, `value`, `from.`, `to.` stay (A5). `cell.`, `cellTitle` and `percent` go; `${label}` reads the cell attribute `label`. | 3.3, 2.6 |
| Fable b.1 | blocker | Each `${x}` in a matcher is a required cell attribute; a missing one is `missing-attr` (A5). | 2.4, 3.3 |
| Fable b.2 | major | A matcher value can be a list (A6). Constants go into the query. | 2.4 |
| Fable b.3 | major | No empty match. A singleton query keeps a label that names the cell; the boiler pilot shows the idiom. | 2.4, 8.2 |
| Fable c (fan-out cost) | major | A hand-authored panel uses open selectors and the report. README note. | 8.4 |
| Fable d.2 | major | `setCellAttrs` and the edge-end reader refuse a compressed page with a clear message. No inflate code. | 5.5, 3.8 |
| Fable e.1 | blocker | A stable `src/harness.ts`; the consumer `.mjs` scripts are rewritten against it, before the v3 delete. | 6.4, 9 |
| Fable e.2 | blocker | `tests/authoring-fixtures.ts` and `tests/authoring-controls.ts` are rewritten, not deleted. | 6.5 |
| Fable e.3 | major | The unlisted `src/` files are now in the lists. | 6.1, 6.2, 6.3 |
| Fable e.4 | major | Each e2e spec has a line: deleted, rewritten or re-fixtured. | 6.5 |
| Fable f.1 | blocker | `pull` command and an offline merge from `<sheet>.cells.yml` (A2). | 7.3.5, 7.3.6 |
| Fable f.2 | major | Every editor-written attribute is kept; YAML of generated panels is generator-owned (A3). | 7.3.6 |
| Fable f.3 | major | Mode B merges from `<sheet>.cells.yml` too; the repo holds the source and the delta. | 7.3.7 |
| Fable f.4 | major | Generated dashboards become `editable: true` (A2); the mode B target is closed by A16. | 7.3.8 |
| Fable h.1 | major | P0 records the v3 colour parity on `main` before the delete; P2 compares with it. | 9 |
| Fable h.2 | major | P0 records the v3 bench number on `main`. | 9 |
| Fable h.3 | major | P1 acceptance: YAML → JSON → YAML round trip and block style for `${`. | 9 |
| Astra 1 | blocker | Exact colour, text and refId through patches, painter, band and legend (A1). | 3.4, 6.2 |
| Astra 2 | major | An explicit, tested rate-unit table with the flow units (A13). | 3.7 |
| Astra 3 | major | Abstract base classes are valid (A7). | 2.3, 8.1 |
| Astra 4 | major | A match block must be nonempty and must read a cell attribute; inherited and override blocks too. Row match replaces the whole block. | 2.4, 2.5 |
| Astra 5 | major | The matcher contract: parse, unescape, substitute, escape, compile, anchored whole-string, absent label = empty string, `matcher-error`. JavaScript regex dialect. | 2.4 |
| Astra 6 | major | A5; matchers do not read dashboard variables; the URL order keeps the `$` shield and `isAllowedUrl`. | 3.3 |
| Astra 7 | major | Freshness per series, the effective cadence of a target, absent interval, clock-driven transitions (A10). | 3.5 |
| Astra 8 | major | Stale is the result age (A10). The historical range uses the range end. | 3.5 |
| Astra 9 | major | Null, NaN, failed and loading are not "no series" and never `down`. | 3.6 |
| Astra 10 | major | N-series reduce: a deterministic order, unit normalisation, rebuilt display processor, explicit `reduce` silences the report, updown alignment. | 3.7 |
| Astra 11 | major | An explicit endpoint lookup: `pg-from`/`pg-to`, else the XML `source`/`target`; the port wins over the node. | 3.8 |
| Astra 12 | major | Capacity: invalid speed falls through with a report entry; asymmetric capacity (A4). | 3.8 |
| Astra 13 | major | Envelope-then-item parsing; invalid parents and overrides; uses after overrides; the editor keeps the last valid draft. | 2.5, 3.2, 5.1 |
| Astra 15 | major | D19 stays. `port` and `cap` come from the generator or from draw.io "Edit Data"; `at` from the inspector (A13). The boiler cells get their attributes from the source generator. | 5.5, 8.2 |
| Astra 16 | major | One draft transaction for config and diagram; `revision.ts` stays; conflict, discard, invalid text and undo are defined. | 5.7 |
| Astra 17 | major | Cursor rules for keys, blank lines, parse errors, duplicate keys, aliases, inherited rows and link-only classes. | 5.3 |
| Astra 18 | major | `editor-refresh` and the popup behaviours of `bindings-popup.spec.ts:251-365` are kept in rewritten specs; 6.5 tells which run in P1 and which wait for P3 (R2). | 6.5 |
| Astra 19 | major | Multi-series card and chart work is in the rewrite list. | 3.7, 6.2 |
| Astra 20 | major | The merge runs before the SVG export, the bundle and the hashes. | 7.4 |
| Astra 21 | major | Identity uid + panel + page + cell; one snapshot per dashboard; a failed pull stops; a deploy gate (A15). | 7.3.5, 7.4 |
| Astra 22 | major | Ownership (A3), a validation of the merged sheet with the panel's own bind, and the unbind semantics. | 7.3.6 |
| Astra 23 | major | The acceptance of each phase lists the targeted checks. | 9 |

### 0.4 Minor findings of round 1

Fixed in this revision: Fable a.1 (2.3), a.2 (2.6), a.4 (3.4), a.5 (3.4), b.4–b.7 (2.4, 3.2, 3.6), b.8 (3.8),
b.10 (4), c minor (7.3.6), d.3 (5.5), d.4 (5.1), d.5 (5.2), d.6 (9, P3), e.5 (6.2), e.6 (6.3), f.5–f.7 (7.3),
h.4–h.10 (9); Astra 14 (1.1), the D6 list-versus-map note (2.3) and the ADR 0002 capacity chain (6.6). Appendix A
lists the rest.

## 1. Problem, goals and non-goals

### 1.1 Problem

v3 binds a cell through a pattern. A pattern holds a full binding for each row (`src/model/config.ts:150-217`) and a
selector (`src/model/config.ts:30-40`). A selector can list many cell ids, and the generator groups cells with the
same display into profiles (consumer `scripts/gen_drawiomap/config.py:598-632`). Thus the next cell of a known kind
costs one selector id and its key metadata. But each new kind costs a full pattern, and the key metadata of a cell
must agree with the pattern. The ten generated panels hold 1–19 patterns and 1–43 targets each. Their options are
7.5–183.9 KiB.

A hand-made diagram has no generator. An example is `wb-channels-lighting`: 5 relay modules and 26 circuits. To bind
it, the author writes each pattern by hand. The cost is too high.

The join key is in the wrong place. In v3 the panel config holds the key (`select.ids`, `match: {job:
"${cell.bind_job}"}`), and the generator writes a different attribute name for each label (`bind_job`, `bind_name`,
`bind_port_num`, consumer `scripts/gen_drawiomap/cellmeta.py:27-57`). The two must agree.

### 1.2 Goals

1. A compact model in the panel options that the panel expands at run time. There is no build step (D1).
2. The queries are normal Grafana panel targets. The refId is the query name. One query fans out over all cells of a
   metric (D2).
3. The join key is on the cell: `bind=<class>` and `key=<value>`, plus other attributes such as `port` (D3).
4. A class holds the match, the status, the rows, the text, the chart and the link halves for all its cells (D4–D10,
   D14, D15, A9).
5. Status colour and text, unit and decimals come from the Grafana field config of the refId (D7, D9, A1; ADR 0002).
6. A match report shows each failed or ambiguous join (D21).
7. A split editor: a YAML code box beside the live diagram, with the match report below (D16–D20).
8. The generator writes v4. It keeps the cell attributes that an author set in Grafana (D23, A2, A3).

### 1.3 Non-goals

- No converter from v3 and no reader for v3 (D22). A v3 config binds nothing and shows one notice.
- No native datasource queries. `config.queries[]` goes away (D2).
- No dual Y axis in one chart (D9).
- No reuse of the portograph visual `class` as the binding class (D3).
- No change to the sanitiser, the editor iframe or the MessagePort protocol (ADR 0001, `docs/security.md`).
- No general attribute editor in the inspector (D19). Section 5.5 gives the route for other attributes.

## 2. The v4 options schema

### 2.1 Where it lives

The config stays in `Options.config` (`src/types.ts:122`). The diagram stays in `Options.diagram`
(`src/types.ts:96-101`, :120): the draw.io XML, the exported SVG, a hash and a time. The config is a JSON object in
the dashboard (D16, A12). The YAML text is only the editing view (section 5).

### 2.2 Sketch

zod 3.23.8 (`package.json:95`), the same as v3 (`src/model/config.ts:2`). One schema gives the types. A new module
`src/model/v4.ts` holds it. Section 2.5 tells how the panel applies it: the envelope first, then each item.

```ts
/** A class name or a cell attribute name. Portograph allows the same set for meta keys, incl. "-". */
const ident = z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/);
/** A Grafana refId of a panel target. The match report flags a refId that no target has. */
const refId = z.string().min(1);
/** A text with ${attr}, ${from.attr}, ${to.attr}, ${labels.x}, ${value}; in a URL also $var and ${var:format} (3.3). */
const template = z.string();
/**
 * One matcher (section 2.4). The record key is a cell attribute; the value is the series side:
 *   `name`                        bare label: series label `name` === cell attribute <key>
 *   `instance=~"${key}:.*"`       label, operator = != =~ !~, a double-quoted template
 * The envelope check is syntax only. Section 2.4 gives the full contract.
 */
const matcherText = z.string().regex(/^\s*[A-Za-z_]\w*\s*(?:(?:=|!=|=~|!~)\s*"(?:[^"\\]|\\.)*"\s*)?$/);
const matcher = z.union([matcherText, z.array(matcherText).min(1)]); // A6: a list of matchers
const match = z.record(ident, matcher).refine((m) => Object.keys(m).length > 0, 'match must not be empty');

const show = { label: z.string().optional(), unit: z.string().optional(), decimals: z.number().int().min(0).max(10).optional() };
const reduce = z.enum(['sum', 'max', 'mean']);
/** "5m" (a Grafana duration) or "3x" (times the cadence of the target, section 3.5). */
const freshness = z.string().regex(/^(?:\d+(?:ms|s|m|h)|\d+(?:\.\d+)?x)$/);

/** The low end of a Y range: a number, or "auto" for the data minimum, as in v3 (src/model/config.ts:90-93). */
const lowerBound = z.union([z.number().finite(), z.literal('auto')]);
const history = z.object({ kind: z.literal('history'), query: refId, match: match.optional(), ...show,
                           min: lowerBound.optional(), max: z.number().finite().optional() }).strict();
const value = z.object({ kind: z.literal('value'), query: refId, match: match.optional(), reduce: reduce.optional(), ...show }).strict();
const updown = z.object({ kind: z.literal('updown'), up: refId, down: refId, match: match.optional(), reduce: reduce.optional(), ...show }).strict();
const row = z.discriminatedUnion('kind', [
  history, value, updown,
  z.object({ kind: z.literal('metadata'), label: z.string(), text: template }).strict(),
  z.object({ kind: z.literal('drilldown'), label: z.string().optional(), url: template }).strict(),
]);
/** A9: a chart region fills the box of the cell. `value` draws a bar gauge. Same rules as the rows. */
const chart = z.discriminatedUnion('kind', [history, value, updown]);
/** A4: one refId for both directions, or one refId for each geometric direction. */
const capacity = z.union([refId, z.object({ a2b: refId, b2a: refId }).strict()]);

const fields = {
  match: match.optional(),                               // D4, A7: required only for a class that has cells
  status: refId.optional(),                              // D7, A1
  missing: z.enum(['nodata', 'down']).optional(),        // D7. Default: nodata (grey). Zero series only (3.6).
  text: z.object({ query: refId, match: match.optional(), reduce: reduce.optional(), ...show }).strict().optional(), // D10
  rows: z.array(row).optional(),                         // D9
  chart: chart.optional(),                               // A9
  freshness: freshness.optional(),                       // D11, A10
  url: template.optional(),                              // D6
  urlTitle: z.string().optional(),
  up: refId.optional(),                                  // D14, links only
  down: refId.optional(),
  capacity: capacity.optional(),                         // D15, A4
  linkLabel: z.enum(['none', 'value', 'percent']).optional(), // A13 (Q8). Default: none.
};
const klass = z.object({ extends: ident.optional(), ...fields }).strict();
const override = z.object(fields).strict();               // D6

/** The envelope. Each class and each override is parsed on its own (section 2.5). */
export const envelopeSchema = z.object({
  version: z.literal(4),
  freshness: freshness.default('3x'),                    // D11, the panel default
  classes: z.record(ident, z.unknown()),
  overrides: z.record(z.string().min(1), z.unknown()).default({}), // key: the draw.io cell id
}).strict();
export const classSchema = klass;
export const overrideSchema = override;
export type ClassV4 = z.infer<typeof klass>;
export type ConfigV4 = Omit<z.infer<typeof envelopeSchema>, 'classes' | 'overrides'> & {
  classes: Record<string, ClassV4>;
  overrides: Record<string, z.infer<typeof override>>;
};
```

### 2.3 The parts

**Classes (D4).** The config holds the classes of one panel. A cell joins a class with its attribute `bind`.

**Match (D4, A6).** The record key names a cell attribute. The value names a series label and an optional operator.
Section 2.4 gives the full contract.

| Form | Meaning |
|---|---|
| `key: name` | the label `name` of the series equals the attribute `key` of the cell |
| `key: instance=~"${key}:.*"` | the label `instance` matches `^(?:<key value, regex-escaped>:.*)$` |
| `port: port_num` | a second key: the label `port_num` equals the attribute `port` |
| `key: entity="switch.${key}_k${port}"` | a template can read any attribute of the cell; each one it reads is required |
| `key: [instance=~"${key}:.*", job="node"]` | a list: all matchers must pass (A6) |

YAML note: in flow style (`{…}`, `[…]`), a plain value cannot hold `{`, `}`, `[`, `]` or `,`. Thus a matcher with
`${` or a regex class such as `[1-6]` must be in block style or in single quotes. The YAML writer (5.1) writes
`match` in block style. The examples above are in block form in the pilots (section 8).

**Abstract classes (A7).** A class with no `match` after `extends` is valid as a base for other classes. When a cell
binds it, the report has `class-no-match` for those cells, and they get no data.

**Row match (D4).** A row, the `text` block, the `chart` and a link use the class `match`. A row can set its own
`match` for its own query: `{kind: history, query: clients, match: {key: name}}`. The row match replaces the class
match as a whole block: it does not add to it. Thus `{key: name}` on a row of the class `lan` drops the `port`
matcher of the class for that row.

**Extends (D5).** One parent. The chain resolves from the root. `rows` append: the parent rows come first. Each other
field replaces the parent field as a whole; `match`, `chart` and `capacity` are each one field. A cycle, an unknown
parent or a parent that did not parse is an error for each class in the chain below it (2.5).

**Overrides (D6).** The key is the draw.io cell id. D6 says "a list"; a JSON object keyed by cell id is the same list
with the duplicate check built in: the YAML parser rejects a duplicate key (5.3). An override applies after the
class chain, with the same rule as `extends`: rows append, other fields replace. Use it only for the rare rest. A
class template reads the cell attributes first (`url: /d/host?var-job=${key}`).

**Status (D7, A1).** `status` names a refId. The Grafana field config of that refId gives the colour and the text:
thresholds and value mappings. The cell shows that exact colour and text. Section 3.4 gives the severity rule.

**Values (D8, A13).** A `value` row, an `updown` row and `text` can set `reduce: sum|max|mean`. The default is `sum`
when the unit of the field is in the rate-unit table of section 3.7, else `max`.

**Rows (D9).** A row is one line. The label, unit and decimals come from the field config of the refId (the display
name, unit, decimals). A row can override them. Rows of different units in one card are allowed.

**Text (D10).** `text: {query: temp}` writes the formatted value on the cell. It replaces the v3 `display.shape`.

**Chart (A9).** `chart: {kind: history, query: cpu}` draws the chart in the box of the cell. It replaces the v3
`widgets`. It uses the rules of a row: match, N lines, units, `updown`.

**Freshness (D11, A10).** The panel default is `3x`. A class can set its own. A stale result is a state of its own,
`stale` (`src/binding/status.ts:128-135`). Section 3.5 gives the rule.

**Links (D13–D15, A4).** `up`, `down` and `capacity` apply to an edge cell. Section 3.8 gives the rules.

**Link labels (A13).** `linkLabel: none|value|percent`. The default is `none`. The generator sets `percent`.

**Legend (D12, A1).** There are no legend options in the config. The legend shows one block per status refId in use,
from its field config, and the link load scale (3.4).

### 2.4 The matcher contract

The panel runs one matcher in these steps. Each step has one failure mode.

1. **Parse.** The text is `<label>` or `<label><op>"<string>"`. `<label>` is a Prometheus label name,
   `[A-Za-z_][A-Za-z0-9_]*`. `<op>` is `=`, `!=`, `=~` or `!~`. White space around the parts is allowed. Only double
   quotes are allowed. A text that does not parse is a `schema` entry at its YAML path (2.5).
2. **Unescape.** The string uses the Go escapes of PromQL: `\\`, `\"`, `\n`, `\t`. Any other backslash sequence is a
   `schema` entry. Thus `entity=~"\\d+"` gives the regex body `\d+`, as in PromQL, and `"\d"` is an error, as in
   PromQL.
3. **Find the placeholders.** `${<name>}`, `${from.<name>}` and `${to.<name>}`, where `<name>` is
   `[A-Za-z_][A-Za-z0-9_-]*`. Each placeholder is a required attribute (A5). `${labels.x}` and `${value}` are not
   allowed in a matcher: a `schema` entry. A `${<name>:<format>}` is a dashboard variable (A17, 3.3), so it is a
   `schema` entry in a matcher too. A `$` that does not start such a placeholder is literal text. A matcher reads
   no dashboard variable: put a filter on a dashboard variable into the query (A6).
4. **Required attributes.** The required attributes of a match block are its record keys and all its placeholders. A
   cell that lacks one gets a `missing-attr` entry with the attribute name (`port`, `from.key`), and that use selects
   no series for the cell. An empty attribute value counts as present.
5. **Substitute.** For `=` and `!=`, the attribute value goes in as is. For `=~` and `!~`, the value is
   regex-escaped first (`[.*+?^${}()|[\]\\]` → `\$&`). The parse of step 1 ran on the template text, so a quote or a
   backslash in a cell value cannot change the matcher.
6. **Compile (Astra R6).** The dialect is the part of RE2 (the PromQL engine) and JavaScript that means the same in
   both. A regex compiles once per resolved text, in three steps:
   1. **Scan.** The scan reads the body and rejects each form that is RE2-only, JavaScript-only, or different in
      the two: `\A`, `\z`, `\Q…\E`, `\C`, `\p` and `\P`, `(?P<`, a flag group other than one leading `(?i)` (for
      example `(?s)`, `(?m)`, `(?U)`, `(?i:…)`), lookaround (`(?=`, `(?!`, `(?<=`, `(?<!`) and backreferences
      (`\1`…`\9`, `\k<`). The scan reads the body escape by escape, so the `\\` of step 5 is one token. A rejected form is a `matcher-error` with the message "not in the
      PromQL regex dialect: <form>". Thus `node-a\z` is an error. Without the scan, JavaScript reads `\z` as `z`,
      and the matcher selects `node-az` (verified with Node by review round 2).
   2. **Rewrite.** RE2 reads `\` and an ASCII punctuation character as that character. With the flag `u`,
      JavaScript accepts only `\^ \$ \\ \. \* \+ \? \( \) \[ \] \{ \} \| \/`, and `\-` only in a class. The scan
      writes each other escaped punctuation character (`\-`, `\_`, `\:`, `\@`, `\#`, `\=`, `\!`, `\,`, `\<`, `\>`,
      `\%`, `\&`, `\'`, `\"`, `\;`, `\~`, `` \` ``) as `\x<two hex digits>`, which is the same literal in both
      dialects, also in a class.
   3. **Compile.** `new RegExp('^(?:' + body + ')$', flags)`, where `flags` is `u`, plus `i` for a leading `(?i)`.
      With `u`, each other unknown escape (for example `\y`) is a compile error.

   A compile error is a `matcher-error` entry with the class, the path, the resolved text, the message and the
   cells. That use selects no series for those cells. The cache lives for one bind.
7. **Test.** The test reads the whole label value. An absent label is the empty string, as in PromQL: `job!="x"`
   passes on a series with no `job`, `job=""` passes on it, `job="x"` fails, `job=~".*"` passes.
8. **Combine.** All matchers of a block must pass. A list value (A6) adds each of its matchers to the block.

**A block must read the cell (Astra 4).** A match block is valid only when it reads at least one cell attribute: a
bare matcher, or a placeholder. A block that reads none selects the same series for every cell; it is a `schema`
entry (`match must read a cell attribute`). This rule applies to class, inherited, override and row blocks. An empty
block is a `schema` entry too. Thus `match: {}` and `match: {key: job!=""}` are both rejected.

**A query with no label for the cell (Fable b.3).** When the result of a query has no label that names the cell,
change the query so that it keeps one, for example `min by (entity) (…)`, or remove the aggregation and let "worst
of N" do it (3.4). The boiler pilot does this (8.2).

### 2.5 Parse and validation

The panel parses in the order of v3 (`src/model/config.ts:509-549`): the envelope first, then each item on its own.

1. The envelope (`envelopeSchema`). When it fails, the panel binds nothing and the report has the `schema` entries.
   A config with `version: 3` or older binds nothing and gives one `outdated-config` entry (D22).
2. Each class with `classSchema`, each override with `overrideSchema`, each matcher with the steps 1–3 of 2.4. An
   item that fails is "invalid". Its `schema` entries name the YAML path. The other items apply.
3. The chain. A class whose parent is invalid, unknown or in a cycle is invalid too, with `class-invalid-parent`,
   `class-unknown-parent` or `class-cycle`. Its descendants are invalid with the same entry.
4. The cells of an invalid class show "unavailable": the state `missing` with the reason "Binding is not valid". An
   invalid override makes its cell "unavailable" in the same way. The cells of other classes bind as usual.

The editor uses the same functions, so the live diagram and the view mode show the same result (5.1).

### 2.6 Carried over from v3, and dropped

No decision names these items. They come from v3 so that no feature goes silently. The owner confirms them when
approving this spec.

| Item | v3 source | v4 |
|---|---|---|
| Row kinds `metadata` and `drilldown` | `src/model/config.ts:190-191` | kept |
| `min`/`max` on `history` | `src/model/config.ts:174-175` | kept (the Y range through `yDomain`, 3.7); `min: auto` stays |
| `urlTitle` | v3 display url title | kept |
| `text.reduce` | — | new, follows D8 |
| `linkLabel` | `display.link.label.mode` | kept (A13) |
| Chart regions | `widgets`, `src/model/config.ts:272-286` | kept as `chart` (A9) |
| The field Max as a capacity | `src/binding/capacity.ts:117-121` | dropped (D15) |
| Template roots `cell.`, `cellTitle`, `percent` | `src/binding/template.ts:4` | dropped (A5); `${label}` reads the cell attribute `label` |
| The `${__…}` form of Grafana global variables | `src/binding/template.ts:20` | write `$__url_time_range`; `${__…}` is a cell attribute (A5) and the report says so |

## 3. The runtime join

### 3.1 Inputs

- `PanelData.series`: the frames of the panel targets. Each frame has a `refId`. `panelSnapshot(data, refId)`
  (`src/query/panelSnapshot.ts:12`) gives the frames of one refId and the error and loading states (:31-48).
- `PanelData.request.targets`: per refId, the flags `instant` and `range` and the minimum interval `interval`.
  `PanelData.request.intervalMs` and `PanelData.timeRange`.
- The cell index: `buildCellIndex(root)` (`src/render/svgStage.ts:82`). Each cell has `attrs`, the `data-meta-*`
  attributes without the prefix (`src/render/svgStage.ts:41-49`), and `from`/`to` from `pg-from`/`pg-to`
  (`src/adapter/portograph.ts:110-125`). The index rejects a duplicated cell id (`src/render/svgStage.ts:84-87`).
- The edge ends of an ordinary draw.io sheet, from `Options.diagram.xml` (3.8).
- The config v4 and the field config. A field carries the Grafana field config with the overrides applied. Its
  display processor gives text and colour (`src/binding/context.ts:14-15`, `fieldDisplay` `src/query/frames.ts:37`).

### 3.2 Steps

1. **Parse.** Section 2.5.
2. **Resolve the classes.** Resolve `extends`. Each valid class gets its final `match`, `status`, `rows`, and so on.
   Each resolved row keeps its origin path (`classes.device.rows[0]`) for the editor (5.3).
3. **Group the cells.** Group the cells by `attrs.bind`. A cell with a `bind` that names no class is an
   `unknown-class` entry. A cell with no `bind` has no binding. An override for a cell id that does not exist is an
   `unknown-override` entry.
4. **List the uses.** For each bound cell, apply its override to the resolved class. From this effective class:
   the status use, the text use, one use per row query, the chart uses, and the `up`, `down` and `capacity` uses.
   Each use has a refId, a match block (the row match, else the class match) and a YAML path. Uses with the same
   refId and the same match block share one series index. Thus an override that adds a query enters the index.
5. **Index the series.** For each refId in use, list the series. A series is the first numeric field of a frame,
   with its labels. A frame with more numeric fields gives one `many-fields` entry for the refId. Two frames of one
   refId with equal labels and an equal field name give one series (Astra R5). The panel merges their samples by
   timestamp into one sorted series. Thus a target with both `instant` and `range` gives the points of the range
   and then the instant point: a range frame at 0, 60 and 120 s and an instant frame at 125 s give four points, in
   both frame orders. A frame that repeats the same samples (one delivery twice) adds nothing. When two frames hold
   different values at an equal timestamp, the later frame in `PanelData.series` wins, and the report has one
   `duplicate-series` entry. For a match block with only bare and `=` matchers, the panel builds a map from the
   tuple of label values to the series. An absent label is `''` in the tuple (2.4 step 7).
6. **Bind each cell.** For each cell and each use: check the required attributes, substitute, compile and test (2.4).
7. **Reduce over time.** For each selected series, take the last non-null value and its time (3.6).
8. **Status, freshness, no data.** Sections 3.4, 3.5 and 3.6.
9. **Several series.** Section 3.7.
10. **Links.** Section 3.8.
11. **Rows and charts.** The hover card builds its rows when it opens, from the uses of step 4. The chart of a cell
    builds on each bind (3.9).
12. **Report.** Collect the entries of steps 1–11 (section 4).

The output is a `PatchMap` for the painter (`src/render/paintStage.ts:25`, `src/stage/useStagePaint.ts:18`). The
status part of a patch changes (3.4); the renderer of shapes and links does not.

### 3.3 Templates

The scope (A5, A17):

| Placeholder | Value |
|---|---|
| `${<name>}` | the cell attribute `<name>` (a `data-meta-*` attribute). `${id}` is the draw.io cell id. `${label}` is the attribute `label`. |
| `${from.<name>}`, `${to.<name>}` | an attribute of the cell at that edge end (3.8) |
| `${labels.<name>}` | a label of the status series of the cell; only when that use selects exactly one series |
| `${value}` | the formatted status value; the same condition |

Dashboard variables (A17) are not in the scope. The panel does not substitute them; `replaceVariables` does:

| Form | Meaning |
|---|---|
| `$<name>`, `$__<name>` | a dashboard variable or a Grafana global variable, bare form (A5) |
| `${<name>:<format>}` | a dashboard variable with a Grafana variable format (A17). `<name>` is `[A-Za-z_][A-Za-z0-9_]*`; `<format>` is a Grafana format id such as `csv`, `pipe`, `regex`, `queryparam`, `percentencode`, `raw` or `text`. The panel does not check the id against a list. |

Thus a colon in the braces marks a dashboard variable, and `${<name>}` with no colon is always a cell attribute
(A5). A17 does not change the matcher: a matcher reads no dashboard variable (2.4 step 3).

- A missing attribute is a `missing-attr` entry, never a dashboard variable. In a matcher, the use selects no series
  (2.4). In a URL, a `metadata` text or a `drilldown`, the item is not shown.
- `${labels.x}` and `${value}` with zero or many status series: the item is not shown, and the report has
  `template-unresolved` with the cells.
- The grammar of v4 substitutes only the placeholders of the scope table. A bare `$var`, a `$__…` variable and a
  `${<name>:<format>}` reach `replaceVariables` as they are.
- Only a URL and a title (`urlTitle`, a `drilldown` label) go through `replaceVariables`
  (`src/interact/links.ts:75-78`). A `metadata` text does not, so a `${<name>:<format>}` in it is a `schema` entry:
  "a metadata text reads no dashboard variable".
- The order for a URL (Astra R7, A17):
  1. Substitute each placeholder of the scope table with `shield(encodeURIComponent(value))`
     (`src/binding/template.ts:6-11`). The shield keeps a `$` in a cell value away from `replaceVariables`, so an
     attribute that holds `${site}` or `${site:csv}` is not expanded.
  2. Write each bare ordinary dashboard variable `$<name>` as `${<name>:percentencode}`. A name that starts with
     `__` stays as it is, because `$__url_time_range` gives `from=…&to=…` and must stay raw. A `${<name>:<format>}`
     keeps its explicit format: step 2 does not change it.
  3. `replaceVariables`, then `unshield`, then `isAllowedUrl` (`src/binding/url.ts:7-10`). A URL that fails
     `isAllowedUrl` is not shown. The check runs on the final text, so a format such as `raw` cannot bring in a
     scheme that the check refuses.

  Thus `/d/host?var-job=$job` with the value `a&var-site=b` gives `var-job=a%26var-site%3Db`, and a `#` gives `%23`.
  A multi-value variable in the bare form gives its values joined with a comma and encoded, `a%2Cb` (the Grafana
  format `percentencode`, Grafana docs "Variable syntax", advanced variable format options). For a dashboard that
  reads a multi-value variable from repeated parameters, write `/d/host?${job:queryparam}`: the values `a` and `b`
  give `var-job=a&var-job=b` (A17). Today `src/interact/links.ts:75-78` calls `replaceVariables(u.url, vars)` with
  no format, so a value can change the query structure; v4 rewrites this call (6.2). A title is text: step 2 and the
  encoding of step 1 do not apply to it, and a `${<name>:<format>}` in it goes to `replaceVariables` as it is.
- A `${` that starts neither a placeholder of the scope table nor a `${<name>:<format>}` (for example `${job.x:csv}`
  or `${}`) is a `schema` entry in a URL, a `metadata` text and a `drilldown`: "write ${attr} for a cell attribute,
  $var or ${var:format} for a dashboard variable".
- The grammar allows `-` in a name; today it allows only `\w` (`src/binding/template.ts:3`).

This replaces `cellScope` (`src/adapter/portograph.ts:189-195`). Today `cellScope` puts the pg-id at `cell.key`
(`src/adapter/portograph.ts:117`, :191), so `${cell.key}` cannot read an attribute named `key`. v4 removes the `cell.`
root, so the clash goes away. `endpointScope` (`src/adapter/portograph.ts:181-187`) gives only node, port, ordinal and
raw; v4 replaces it with the lookup of 3.8.

### 3.4 Status, colour and text (D7, A1)

For each series of the status use, the display processor of its field gives `{text, color}` for the value
(`src/binding/context.ts:14-15`). The cell shows the exact colour and text of the winning series:

- **Severity** decides only three things: the worst of N series, the status band and the legend. A mapping text
  `down` (any case) gives `down`. Else the named colour gives it: `red*` → critical, `orange*` or `yellow*` →
  warning, else normal. A hex colour goes to the nearest named hue of the Grafana palette; a unit test fixes the
  table for both themes.
- **Worst of N.** The rank is `STATUS_SEVERITY` (`src/binding/status.ts:128-135`): down, critical, warning, stale,
  missing, normal. Between two series of one rank, the first in the order of 3.7 wins.
- **Paint.** The patch carries `{state, severity, color, text, refId, reason}`. The painter paints the cell with
  `color` for each value state, normal included. Today `statusColor` maps a state to a theme colour and
  `statusPaint` paints nothing for normal (`src/binding/color.ts:27-33`, :51-53). v4 replaces both for value states.
  The theme colours stay only for `stale` (orange) and `missing` (grey). A field config can map a value to the named
  colour `transparent`; then the painter removes its own paint and the cell keeps its drawn colour. The generator
  writes `transparent` for each healthy mapping (A14); a hand author can choose green.
- **Repaint (Astra R1).** The applier repaints a cell only when the `applyKey` of its patch changes
  (`src/render/applier.ts:382-394`, compared at :422). Today the status part of the key is `[state, reason]` (:392),
  so a field mapping that changes green to blue with the same state and text leaves the old paint. v4 rewrites
  `applyKey`: it reads each patch field that a write reads, in the status part `state`, `severity`, `color`, `text`,
  `refId` and `reason`. A unit test changes each such field alone and expects a new key.
- **Text.** The hover card and the status band show `text`. The band row is `<text> · <refId>: <n> cells`; today it
  is `state: reason` (`src/components/StatusBand.tsx:129`). The band lists the rows that are not normal, worst
  first.
- **Legend.** One block per status refId in use. The block title is the display name of the refId. The entries are
  the value mappings of its field config (`mappingEntries`, `src/legend/model.ts:137`) and then its threshold steps,
  each with its exact colour and text, and with the cells that show it. Today the legend collects only the state
  (`src/legend/model.ts:233-239`) and adds one fixed status block (:280-291); that code is rewritten. A `stale` and a
  `missing` entry follow when cells have that state.
- **Links.** A link class can set `status`, for example a port state. `linkStatusPaint` keeps its rule: a `missing`
  status on a link with halves paints nothing, because each half shows its own state (`src/binding/color.ts:55-71`).

### 3.5 Freshness (D11, A10)

1. **Per series (Astra R4, Fable M1).** The age of a series is `ref − t`, where `t` is the time of its last
   non-null value. A series is stale when its age is more than the freshness. `ref` depends on the kind of the
   panel time range:
   - **Relative range.** `PanelData.timeRange.raw.to` is a string that holds `now` (`now`, `now-1h`, `now/d`). The
     range moves with the clock, so `ref = clock − lag`. The lag is `max(0, request.startTime − timeRange.to)`: 0
     for `now` and for a range end after the request (`now/d`), 1 h for `now-1h`. `request.startTime` is the time
     of the request (NM `@grafana/data/dist/types/types/datasource.d.ts:415`). The bind gives the deadline
     `t + freshness + lag` to the clock of step 5.
   - **Absolute range.** Each other `raw.to` (NM `@grafana/data/dist/types/types/time.d.ts:3-6`). `ref` is
     `timeRange.to`. The age does not change with the clock, and the bind gives no deadline. Thus a dashboard that
     shows an old absolute range measures age at the end of that range, not at now.
2. **Per cell.** A cell with N series of the status use is `stale` when one of them is stale (A10). This keeps the
   behaviour of `src/binding/status.ts:73-81`: the oldest sample decides, and a missing timestamp gives `missing`
   with "Sample timestamp is missing".
3. **Instant queries.** A target with `instant: true` and no `range: true` is never stale. A dead exporter goes to no
   data through the lookback of the datasource (A10).
4. **The cadence for `Nx`.** The cadence of a refId is the larger of `request.intervalMs` and the `interval` of its
   target (the minimum step, for example `1m` from consumer `config.py:239-245`). When both are absent or zero, the
   cadence is the median time step of the series. A series with fewer than two points then has no stale check.
5. **The clock.** The bind takes no clock. It gives the deadlines of step 1, and the stale pass runs on the patches
   with the clock of `useClock` and `useStaleStatus` (`src/visuals/useSampleStale.ts:17`, :69;
   `src/stage/useBoundDiagram.ts:132-134`). `useClock` reads the clock again after each deadline (:17-56). Thus on a
   relative range a cell turns stale with no new data, no new request and the same `PanelData` and `timeRange`
   objects. On an absolute range the state comes from the bind alone.
6. Freshness applies to the status use and to the rows (the row shows "stale"). It does not apply to `capacity`.

### 3.6 No data, failed and loading

The state of a use comes from the snapshot of its refId (`src/query/panelSnapshot.ts:31-48`):

| Snapshot | Cell state for this use | `missing: down` |
|---|---|---|
| `error` for the refId, or a request-wide error | `missing`, reason "Query failed"; report `query-unavailable` | does not apply |
| `loading`, first load with no series | `missing`, reason "Loading data" | does not apply |
| loading during a refresh | Grafana keeps the last series; the panel uses them | as `ready` |
| a refId that no target has | `missing`, reason "Unknown query"; report `unknown-ref` | does not apply |
| `ready` or `empty`, zero series for the cell | `missing`, grey "no data" | `down` |
| `ready`, a series with no finite value (all null, NaN, ±Infinity) | that series is `missing`, reason "No value" | does not apply |
| `ready`, a field that fails the checks of `src/query/frames.ts:73-94` | that series is `missing`; report `invalid-series` | does not apply |

- `missing: down` applies only to zero series (Fable b.7). A module with 5 of 6 relay series shows the worst of the
  5. It applies only to a ready query, so a failed query, a first load or an invalid binding never shows as a proven
  outage.
- A special-value mapping of Grafana (null → green) does not apply: a series with no finite value is always
  `missing`. The value must never show as a good state.
- Coverage, as `src/binding/status.ts:44-65`: two series, one with the value 1 and one with no value, give the worst
  of `normal` and `missing`, which is `missing` with the reason "1 of 2 series have no value".
- A link half with no series is grey; the other half keeps its colour (`src/binding/color.ts:55-71`). The text of a
  cell with no data is "–". The hover row shows "no data".

### 3.7 Several series

**Order.** The series of a use are in one fixed order: by the canonical label string (`k="v"` pairs, keys sorted,
compared by code unit), then by frame order, then by field index. "The first series", "+N more" and the line colours
use this order.

**Rate units (A13).** The rate-unit table holds the Grafana unit ids of the categories "Data rate", "Throughput" and
"Flow" (NM `@grafana/data/dist/esm/valueFormats/categories.mjs:531-640`, :940-970, :1377-1467): `pps`, `bps`,
`Bps`, `binbps`, `binBps`, `Kbits`…`Tbits`, `KBs`…`TBs`, `Kibits`…`Tibits`, `KiBs`…`TiBs`, `cps`, `ops`, `reqps`,
`rps`, `wps`, `iops`, `eps`, `mps`, `recps`, `rowsps`, `cpm`, `opm`, `reqpm`, `rpm`, `wpm`, `epm`, `mpm`, `recpm`,
`rowspm`, `flowgpm`, `flowcms`, `flowcfs`, `flowcfm`, `litreh`, `flowlpm`, `flowmlpm`. The table is a constant in
`src/binding/units.ts` with a unit test. `rotrpm` (rotation) is not a rate.

**Units.** Before a reduce or a shared chart, the panel reads the unit of each series (the field config with the
overrides). When all units are equal, it uses the values as they are. When the units differ and all are bit or byte
rates that `toBitsPerSecond` knows (`src/binding/units.ts:21`), it converts the values to the unit of the first
series. Else the use is `missing` with the reason "Mixed units", and the report has `unit-mismatch`. Thus 1 Mbit/s
and 500 kbit/s sum to 1.5 Mbit/s.

**Format.** The result uses the display processor of the first series. A row `unit` or `decimals` builds a new
processor with these values in the field config (`fieldDisplay`, `src/query/frames.ts:37`).

| Use | One series expected | With N series |
|---|---|---|
| status | no | the worst state (3.4) |
| text, `value` row, `value` chart | yes | reduce across series; a `many-series` entry unless the use sets `reduce` |
| `history` row or chart | no | N lines, cap 8, "+N more" |
| `updown` row or chart | yes, per direction | reduce per direction; a `many-series` entry unless the use sets `reduce` |
| link `up` / `down` | yes | reduce with the default; a `many-series` entry |
| `capacity` | yes | not used: falls through (3.8); a `many-series` entry |

An explicit `reduce` declares that N series are expected, so the report stays quiet for that use.

**N lines (D9).** A `history` row or chart with N series draws up to 8 lines in one chart, in the order above, then
"+N more". The lines share one Y range (Astra R8): `yDomain` (`src/visuals/domain.ts:35-70`) runs once over the
values of all drawn lines, with the row `min`/`max`, the field Min/Max and the unit of the first series. Thus the
default of `CODING_STANDARDS.md:21` stays: a range without negative values starts at 0, and two lines at 49 and 51
give the range 0 to 51, not 49 to 51. `min: auto` starts at the data minimum, as in v3, but `yDomain` keeps a span
of at least 10 % of the top, centred on the data (`src/visuals/domain.ts:49-59`): lines at 49 and 51 give 47.45 to
52.55. This spec does not change the helper.
Line i takes colour i of the Grafana classic palette (`theme.visualization.palette`). The order of this section
fixes the colour and the label of each line, so a new frame order changes neither. The line label is the display
name of the field. A series with no finite value keeps its place, its colour and its label; it draws no line, and
the tooltip shows "no data" for it. The pinned tooltip lists all drawn lines at the hovered time, then "+N more".
Today a card row holds one history
(`src/interact/cardModel.ts:33-51`), `Card` passes one model (`src/interact/Card.tsx:242-262`), and `SparklineView`
takes one model (`src/visuals/SparklineView.tsx:9-23`). These files are rewritten (6.2).

**Updown with N series.** The history of a direction is the reduce, at each timestamp, of the series that have a
value at that timestamp. When one of the N series has no value at a timestamp, that point is a gap. The series of one
range query share the step of the query, so their timestamps agree.

### 3.8 Links

1. **Ends.** The ends of an edge come from:
   - a portograph edge: `pg-from` and `pg-to` (`parseEndpoint`, `src/adapter/portograph.ts:70`). The end cell is the
     port cell when the endpoint names a port, and the node cell. An attribute on the port cell wins over the same
     attribute on the node cell.
   - an ordinary draw.io edge: the `source` and `target` of its `mxCell` in page 1 of `Options.diagram.xml`. The panel
     parses the XML once per diagram hash with `DOMParser`, and only when a bound class reads `${from.…}` or
     `${to.…}`, or when the editor is open. When the end cell lacks an attribute, its parent chain up to the layer is
     searched (a shape inside a container). Today `applyContract` deletes `from` and `to` on a sheet with no
     `pg-schema` (`src/adapter/portograph.ts:149-155`); v4 fills them from the XML instead.
   - A compressed page gives no ends: the report has `no-edge-ends` with the reason "compressed page" (5.5).
2. **Direction (D14).** The source end is `pg-from`, else the XML `source`. The half at the start of the drawn path is
   `a2b` (`src/render/applier.ts:197`); draw.io and portograph draw the path from the source. The edge `key` and the
   other matched attributes name the interface at the source end. The class sets `up: <tx refId>` and
   `down: <rx refId>`. Then a→b takes `up` and b→a takes `down`. The cell attribute `at=target` tells that the key
   names the target end. Then a→b takes `down` and b→a takes `up`. `at=source` is the same as no `at`. This follows
   the direction convention: tx is up, rx is down.
3. **One rule for all three views.** The stroke of each half, the link value label and the `updown` row of the card
   use the same feed: with `at=target`, the row's a→b line is the `down` refId.
4. **Capacity (D15, A4).** For each geometric direction, a→b and b→a, the first source that gives a value:
   1. The `capacity` refId of the class: one refId for both directions, or `{a2b, b2a}`. It is joined with the class
      match. The value is bit/s through the unit of its field (`toBitsPerSecond`, `src/binding/units.ts:21`). The
      panel uses it only when the snapshot is ready and exactly one series gives a finite value greater than 0 in a
      rate unit. Else it falls through, and the report has `capacity-fallback` with the reason: no series, many
      series, not positive, not finite, not a rate, query failed. This keeps the rule of
      `src/binding/capacity.ts:61-78`.
   2. The cell attribute `cap`. `cap=1G` gives 10⁹ bit/s for both directions. `cap=50M/10M` gives 50 Mbit/s a→b and
      10 Mbit/s b→a. The grammar of one value is `^\d+(\.\d+)?[kKMGT]?$`, SI and decimal. A value that does not
      parse, or is not finite, or is not greater than 0 gives `bad-cap` and no capacity for that cell.
   3. No capacity: the half shows the raw rate and no percent (ADR 0002).

   The capacities follow the geometry. `at=target` changes only which counter feeds which direction, not the
   capacities (A4). Example: `cap=50M/10M`, `at=target`, rx 8 Mbit/s: a→b shows 8 Mbit/s and 16 %.
5. **Colour and width.** As today: with a capacity, the colour input is the percent; without, the raw value
   (`colorFor`, `src/binding/color.ts:176-201`; ADR 0002).
6. **Node classes.** `up`, `down`, `capacity` and `linkLabel` on a class whose cells are not edges give one
   `unused-field` entry (Fable b.10).

### 3.9 Chart regions (A9)

The `chart` of a class draws in the box of each of its cells, with the rules of 3.7. The chart layer of today stays
(`src/visuals/ChartLayer.tsx`, `ChartHover.tsx`, `hoverSample.ts`, `tooltipPlace.ts`, `domain.ts`). Its input changes
from v3 widgets to the chart uses of step 4 of 3.2.

## 4. The match report

The runtime fills the report on each bind. The editor shows it below the diagram (section 5). The panel in view mode
shows only a count in the existing notice.

```ts
type ReportEntry =
  | { kind: 'schema'; path: string; message: string }                  // YAML path, e.g. classes.lan.rows[2].query
  | { kind: 'yaml'; line: number; message: string }                    // editor only: syntax, duplicate key, alias
  | { kind: 'outdated-config'; version: unknown }                      // D22
  | { kind: 'class-no-match'; cls: string; cellIds: string[] }        // A7: only when cells bind the class
  | { kind: 'class-cycle' | 'class-unknown-parent' | 'class-invalid-parent'; cls: string }
  | { kind: 'unknown-ref'; cls: string; path: string; refId: string } // no panel target has the refId
  | { kind: 'unknown-class'; cellIds: string[]; bind: string }         // cells with a bind that names no class
  | { kind: 'unknown-override'; cellId: string }
  | { kind: 'missing-attr'; cls: string; path: string; attr: string; cellIds: string[] } // attr can be from.x
  | { kind: 'matcher-error'; cls: string; path: string; text: string; message: string; cellIds: string[] }
  | { kind: 'template-unresolved'; cls: string; path: string; cellIds: string[] }
  | { kind: 'query-unavailable'; refId: string; state: 'error' | 'loading'; message: string }
  | { kind: 'no-series'; cls: string; use: UsePath; cellIds: string[] }     // D21: cells with no series
  | { kind: 'many-series'; cls: string; use: UsePath; cells: Array<{ id: string; count: number }> } // D21
  | { kind: 'orphan-series'; refId: string; labels: Labels[]; more: number } // D21: series with no cell
  | { kind: 'many-fields' | 'invalid-series'; refId: string; message: string }
  | { kind: 'duplicate-series'; refId: string; labels: Labels }
  | { kind: 'unit-mismatch'; cls: string; use: UsePath; units: string[]; cellIds: string[] }
  | { kind: 'capacity-fallback'; cls: string; reason: string; cellIds: string[] }
  | { kind: 'bad-cap'; value: string; cellIds: string[] }
  | { kind: 'no-edge-ends'; reason: string; cellIds: string[] }
  | { kind: 'unused-field'; cls: string; field: string; cellIds: string[] }
  | { kind: 'class-no-cells'; cls: string };                           // not given for an abstract class (A7)
```

- **Cells with no series:** per class and per use. The use is a YAML path (`classes.lan.up`).
- **Series with no cell:** per refId, the series that no cell of any class selects. The list shows at most 50 label
  sets in the order of 3.7, then "+N more".
- **More than one series where one is expected:** the uses of section 3.7, with the count per cell.
- **Counts:** per class, the number of cells, and per use the number of cells with 0, 1 and more series.
- Each entry has a YAML path, a cell set, or both. A click on an entry highlights its cells and moves the cursor
  (section 5).
- A `${__…}` placeholder gives `missing-attr` with the hint "write $__name for a Grafana variable".

The report uses the bind result. It sends no new query.

## 5. The split editor

### 5.0 P1: the plain YAML option (A11)

P1 adds one custom option editor (`addCustomEditor`, `src/module.ts:40`) for `config`: a Grafana `CodeEditor` with
`language="yaml"`. It has no diagram link.

- On mount, it writes the stored JSON as YAML (5.1). On each edit, it parses the YAML and runs the validation of 2.5.
  The errors show as Monaco markers on their lines.
- When the YAML parses and the envelope is valid, it calls `onChange` with the JSON. An item error does not block the
  save: the panel shows those cells as "unavailable".
- While the text does not parse, it keeps the text in local state and stores nothing.
- The option editor is a `React.lazy` chunk, so `dist/module.js` loads no YAML parser (A13, Q15).

**P1 has no popup (Astra R2).** A11 replaces the v3 popup with this option in P1. P1 deletes the whole v3 popup: the
popup body and panes, its lazy entry (`src/components/LazyBindingsPopup.tsx`, `src/editor/popup/index.ts`), the
"Edit bindings" button of the Diagram option (`src/options/DiagramEditor.tsx:91-104`, `dmap-edit-bindings-option`),
the "Edit bindings" button of the corner (`src/components/CornerControls.tsx:121`, `dmap-edit-bindings`) and the
popup state of the panel (`src/components/DrawioMapPanel.tsx:103-164`, :250-253, :527-530). The warning badge of the
corner keeps its count; a click on it opens nothing in P1. Thus no P1 file imports a module that P1 deletes, and P1
and P2 typecheck and ship without P3. Section 6.5 lists the e2e cases that wait for P3.

P3 grows this code box into the split view and adds the popup entry again (5.1).

### 5.1 Layout

The v3 popup goes (D16): the forms, the selector proposals, the bulk edit and the query panes. P1 deletes it (5.0).
P3 adds the new popup, with its lazy entry and the two "Edit bindings" buttons. The new popup has three parts:

- Left: the YAML code box of 5.0.
- Right: the live diagram, the same stage as today, painted with the bind result of the text in the box.
- Below: the match report and the inspector (5.4).

The popup frame stays: `PluginDialog`, `PopupLayout` (rewrite of the panes), `popupBus`
(`src/editor/popup/PopupLayout.tsx:15`). P3 writes a new `src/components/LazyBindingsPopup.tsx` with the load
boundary and the retry of the P0 file (`src/components/LazyBindingsPopup.tsx:6-68` at P0). The popup loads lazily, so view mode
loads no Monaco and no YAML parser. The popup reads `PanelData` from the panel props; it runs no query. The hold of
`useHeld` (`src/components/DrawioMapPanel.tsx:22`, `src/components/useHeld.ts`) exists for native queries and goes.

On open, the editor writes the stored JSON as YAML. The writer uses one key order: the schema order of 2.2 for the
fields, the stored order for class names, override ids and rows. It writes `match` in block style, and it writes no
anchors and no aliases. On each edit, it parses the YAML. When the YAML parses, it binds with the per-class result of
2.5, the same as view mode. When the YAML does not parse, the live diagram keeps the last valid draft and the markers
show the error. The stored form is JSON (D16, A12), so the YAML comments are lost.

### 5.2 Verified: Monaco APIs at Grafana 12.4

The panel targets `grafanaDependency >=12.4.0` (`src/plugin.json`) and builds with `@grafana/ui` 12.4.13
(`package.json:87-91`). `@grafana/ui` is external (`.config/bundler/externals.ts:29-31`), so the plugin uses the
Monaco of Grafana at run time.

| Need | API | Evidence | Verdict |
|---|---|---|---|
| The Monaco instance | `onEditorDidMount(editor, monaco)` | NM `dist/types/components/Monaco/CodeEditor.d.ts:7-26`; called at NM `dist/esm/components/Monaco/CodeEditor.mjs:64-66` | yes |
| Cursor events | `editor.onDidChangeCursorPosition`, `onDidChangeCursorSelection` | `monaco-editor` 0.34.1, `editor.api.d.ts:5173`, :5178 | yes, through the instance; no React prop |
| Completion | `monaco.languages.registerCompletionItemProvider('yaml', …)` | `editor.api.d.ts:5882` | yes, with our own provider |
| The `getSuggestions` prop | registers a provider for the language | NM `suggestions.mjs:56-93` | too crude: it gets no position and no model context; it runs on `$` and on word triggers with a prefix (:63, :78-90) |
| Markers | `monaco.editor.setModelMarkers` | `editor.api.d.ts:989` | yes; we make the diagnostics |
| Decorations | `editor.createDecorationsCollection` | `editor.api.d.ts:2608` | yes |
| Move the cursor | `editor.setPosition`, `revealLineInCenter` | `editor.api.d.ts:2466`, :2474 | yes |
| YAML highlight | Monarch `yaml` | `monaco.contribution.js:87` | yes, syntax only |
| YAML schema check | `monaco-yaml` | not installed | no: the panel validates with zod |

Notes:

- Do not import `monaco-editor`. Use only the instance from the callback and type imports (`monacoTypes`, NM
  `dist/types/index.d.ts:62`).
- Monaco loads lazily and shows "Loading editor" first (NM `ReactMonacoEditorLazy.mjs:15-18`). The editor ref exists
  only after mount.
- A completion provider is global to the language. Check the model id (as NM `suggestions.mjs:63` does) and dispose
  it on unmount. Two popups in two panels must not share one provider.
- `fixedOverflowWidgets: true` (NM `CodeEditor.mjs:121`) lets the suggest box draw above the modal. This works only
  when no parent of the editor in `PluginDialog` clips with `overflow: hidden`; P3 checks it on 12.4 (9, P3).
- Grafana 13 can have another Monaco version. All APIs above are old, stable Monaco APIs. The P3 e2e run on 13.2
  checks them (CODING_STANDARDS "Grafana first").
- `src/` uses no `CodeEditor` today. The jsdom tests need a mock of it.

### 5.3 Cursor to cells

The editor parses the text with the `yaml` package (eemeli/yaml 2.x, `parseDocument` with `uniqueKeys: true`). It
goes only into the lazy chunks (A13). A minifier renames `parseDocument`, so a search for that name proves nothing.
`scripts/check-bundle.sh` gets two checks: it fails when `dist/module.js` is older than a file in `src/` (no stale
build), and it fails when `dist/module.js` holds a message text of the `yaml` package: `Implicit keys need to be on a
single line` or `Map keys must be unique` (NM `yaml/dist/compose/resolve-block-map.js`, `yaml` 2.9.1). A minifier
keeps string literals. `tests/no-drawio.spec.ts` also checks in the browser that view mode requests no YAML chunk.

**The path at an offset.**

1. Find the deepest pair whose range, from the start of its key to the end of its value, holds the offset. On the
   key, the path is the path of that pair. On the value, the path goes into the value.
2. On a blank line or in the white space after a value, take the nearest pair above at the same or a smaller indent.
3. While the text has a parse error, `parseDocument` still gives a partial tree. Use its path. The cell sets come
   from the last valid draft.
4. A duplicate key is a `yaml` entry with a marker. An anchor or an alias is a `yaml` entry too: the editor rejects
   them, so there is no alias expansion.
5. An incomplete value (`query:` with no value) has the path of its key.

**The cells of a path.**

| Path under the cursor | Highlight | Badge per cell |
|---|---|---|
| `classes.<c>` and its plain fields | the cells of `<c>` and, lighter, the cells of classes that extend `<c>` | none |
| `classes.<c>.match` | the same cells | the count of series of the first use of the class: status, else the first row, else `up`, else `text`, else `chart`; none when the class has no use. Red for 0. |
| `classes.<c>.rows[i]` and below | the cells of each class whose resolved rows hold this origin path (3.2 step 2) | the count of series for that row in each class; red for 0 |
| `classes.<c>.text`, `.chart`, `.up`, `.down`, `.capacity`, `.status` | the same cells as `classes.<c>` | the count for that use; red for 0 |
| `overrides.<id>` | that one cell | the count for its first use |
| other paths | nothing | none |

Thus the cursor on a row of the base class `device` lights the cells of `host` and `unifi-switch` with the count of
that row in each class.

Then the stage zooms to fit the union of the cell boxes, with a margin. It does not zoom when the cell set did not
change. The editor waits 150 ms after the last cursor move. A click on a report entry uses the same path.

Reuse:

- The editor outlines: `setOwnedAttrs(el, 'editor', attrs)` and `clearOwnedAttrs` (`src/render/cellAttrs.ts:43`,
  :60), the CSS in `src/editor/popup/DiagramStage.tsx:237-245`. An applier refresh keeps these marks.
- The highlight store and dimming: `createHighlightStore` (`src/legend/highlightStore.ts:25`), `highlightCells`
  (`src/legend/highlight.ts:22`).
- Zoom: there is no zoom-to-cells function today. The new `fitCells(index, ids, base, margin): ViewBox` uses
  `relativeMatrix` (`src/render/geometry.ts:504`) for the boxes, then `viewBoxFor` and `clampFactor`
  (`src/render/zoom.ts:39`, :119). The caller passes the result to `setView` of `usePanZoom`
  (`src/stage/usePanZoom.ts:61`).

### 5.4 Click a cell

A click on a cell (`cellAt`, `src/interact/hit.ts:4`) opens the inspector below the diagram. It shows:

- The cell id, `bind`, `key` and all other attributes.
- The class chain and the override, when one exists.
- Per use: the refId, the resolved matchers, the count of series, the first 8 label sets in the order of 3.7, and the
  value.
- For an edge (A13, Q13): the source end and the target end (3.8), which end the key names, and the tx/rx arrow of
  each half. A button "key is at the target" sets `at=target`; it shows "key is at the source" when `at=target` is
  set. The button serves hand-drawn edges. On a generated link the generator writes `at` (7.3.3), so an editor
  value that differs is a conflict at the next build (7.3.6); the fix goes into the catalogue family of the link.
  On a generated panel the inspector says so next to the button.

The cursor jumps to the class of the cell: `overrides.<id>` when it exists, else `classes.<bind>`. When `bind` names
no class, the cursor goes to the end of `classes`.

### 5.5 Writes into the diagram

v1 has three writes (D19, A13):

1. Set `bind` and `key` on one cell.
2. A multi-select (click with a modifier key, or a box, `useBoxSelect`, `src/editor/popup/useBoxSelect.ts:49`) and
   "assign class": set `bind` on all selected cells. The `key` of each cell stays.
3. On an edge: set or clear `at=target` (5.4).

Other attributes (`port`, `cap`, and so on) come from the generator, or the author sets them in draw.io with
"Edit Data" (Ctrl+M) in the embedded editor (`DrawioModal`, `src/editor/DrawioModal.tsx:111`). The README says so.

The writes always go into the embedded draw.io XML (D19). The panel reads the attributes from the SVG, not the XML
(`src/render/svgStage.ts:41-49`). Thus a write changes both copies, with one pure function:

```ts
/** Sets attributes on cells of page 1 of the stored diagram. Returns a new Diagram with a new hash and time. */
function setCellAttrs(d: Diagram, cells: ReadonlyArray<{ id: string; attrs: Record<string, string | null> }>): Diagram;
```

- **Page.** Page 1 only, as the panel renders page 1 only (`src/options/importDiagram.ts:18-21`).
- **Compressed page.** Today an import keeps a compressed `<mxfile>` as it is (`src/options/importDiagram.ts:17-23`),
  and the editor saves with `compressXml: false` (`src/editor/protocol.ts:184`). `setCellAttrs` refuses a compressed
  page with the message "Open the diagram in draw.io once and save it. Then the panel can write to it." The panel
  has no inflate code, and v4 adds none.
- **XML.** On the `<object>` or `<UserObject>` with that id. A bare `<mxCell>` gets an `<object id label>` around it,
  the form that portograph writes (portograph `src/render/drawio.ts:425-429`). The `id` and the `value` (as `label`)
  move from the `mxCell` to the `object`; `source`, `target`, `parent`, `style`, `vertex`, `edge` and the children of
  the `mxCell` stay. A `null` value removes the attribute.
- **SVG.** On the cell group `g[data-cell-id]` (`src/render/svgStage.ts:82`), `data-meta-<name>` (the form of
  `embedCellMetadata`, `src/editor/protocol.ts:170`). The write keeps `data-meta-label` and all other attributes.
- **Names.** An attribute name must match the portograph meta key rule and must not be reserved: `pg-*`, `id`,
  `label`, `placeholders`, `xml*` (portograph `src/parse/index.ts:32-45`). The write never touches `pg-*`.
- **Errors.** The write refuses an XML with a parser error, a cell id that is not in page 1, and a cell id that
  occurs twice. It never writes only the first match.
- **Hash.** The hash is `fnv1a(svg + xml)`, as in `src/options/DiagramEditor.tsx:25-26`.
- **Sanitiser.** The output SVG goes through `sanitizeSvg` (`src/render/sanitize.ts:188`) on the next render, as
  today. The sanitiser keeps `data-meta-*` (`src/render/sanitize.ts:79`, `ALLOW_DATA_ATTR: true`).

### 5.6 Autocomplete

One provider for `yaml`, context by the path of 5.3:

| Place | Items |
|---|---|
| a key in `classes.<c>`, a row, `text`, `chart`, an override | the schema keys of that level, from `classSchema` |
| `extends`, the `bind` field of the inspector | the class names |
| `status`, `query`, `up`, `down`, `capacity`, `text.query` | the refIds of the panel targets |
| the left side of a matcher | the attribute names of the cells of the class |
| the right side of a matcher | the label names of the series of the refId of the use; after `="`, the label values, escaped for a PromQL string |
| inside `${` | the attribute names of the cells of the class, then `from.` and `to.` |

An item that holds `{`, `}`, `[`, `]` or `,` in a flow mapping is inserted in single quotes. The sources are the
loaded frames and the cell index. The provider sends no query.

### 5.7 Draft, Apply, conflicts and undo

The popup holds one draft: the YAML text, the last valid config, and the diagram with the pending writes of 5.5.

- **Apply** writes the config and the diagram in one `onOptionsChange`, as today
  (`src/editor/popup/BindingsPopup.tsx:119-125`). Apply is off while the YAML does not parse or the envelope fails.
  Item errors do not block Apply.
- **Conflict.** The base revision stays (`src/editor/revision.ts:3-16`, `baseRevision`, `hasConflict`). When the saved
  options change after the draft started (another tab, a dashboard reload), the popup shows "The saved panel
  changed" with two actions: "Reload" (drop the draft) and "Keep my draft" (the next Apply overwrites).
- **Discard.** Escape or close with a dirty draft opens the discard confirmation, as today
  (`src/editor/popup/BindingsPopup.tsx:145-163`). A draft with text that does not parse is dirty.
- **Undo.** Monaco keeps the undo of the text. The popup keeps a bounded stack (50) of diagram versions for the writes
  of 5.5 (`src/editor/history.ts`, rewritten). Ctrl+Z goes to Monaco when the code box has the focus, else to the
  diagram stack.

## 6. What goes and what stays

### 6.1 Deleted

P1 deletes every module of this table, the v3 popup included (5.0, Astra R2). After P1, no file of `src/` imports
`src/model/config.ts`: the type-only importers take their types from `src/model/v4.ts` (6.2).

| Module | Why |
|---|---|
| `src/model/config.ts` | the v3 schema (`version: 3` at :290; native queries at :242-266). The `QuerySnapshot` and `FreshnessPolicy` users move first (6.2). |
| `src/binding/patterns.ts` | patterns and override merge (`resolvePatterns` :329) |
| `src/binding/select.ts`, `src/model/matcher.ts` | the v3 selector and the `/re/flags` matcher; v4 uses the contract of 2.4 |
| `src/binding/resolve.ts` | the demand resolver over the native query store (:160-161) |
| `src/query/controller.ts`, `grafana.ts`, `session.ts`, `store.ts`, `useBindings.ts`, `panel.tsx`, `testService.ts` | native queries, their cache and their test double (`createQueryController` `controller.ts:98`) |
| `src/query/types.ts` | after `QuerySnapshot` moves to `src/query/snapshot.ts` (`src/query/panelSnapshot.ts:3` imports it) |
| `src/components/useHeld.ts` | the hold for native queries (5.1) |
| `src/editor/BindingEditor.tsx`, `BindingFields.tsx`, `BindingInspector.tsx`, `BindingsList.tsx`, `ChartFields.tsx`, `QueryEditor.tsx`, `PatternTransfer.tsx`, `EditorLayout.tsx` | v3 forms, list, inspector, query editor |
| `src/editor/bindingsModel.ts`, `draft.ts`, `draftContext.ts`, `fieldSource.ts`, `leafPaths.ts`, `patternPreview.ts`, `portable.ts`, `preview.ts`, `proposeSelector.ts`, `editorHarness.tsx` | v3 draft model and selector proposals (`proposeSelector.ts:50`) |
| `src/editor/popup/BindingsPopup.tsx`, `InspectorPane.tsx`, `ListPane.tsx`, `MultiSelectionPane.tsx`, `PatternFromSelection.tsx`, `BulkPane.tsx`, `QueryPane.tsx`, `CardPreview.tsx` | v3 panes; in P3 the new popup body replaces `BindingsPopup.tsx` and keeps its Apply, conflict and discard behaviour (5.7) |
| `src/components/LazyBindingsPopup.tsx`, `src/editor/popup/index.ts` | the lazy entry of the v3 popup (`index.ts` exports `BindingsPopup`; `LazyBindingsPopup.tsx:4` imports its props). P3 writes new ones (5.1). |
| `src/editor/history.ts` | the v3 draft undo; it imports `draft.ts` and `leafPaths.ts` (:1-2). P3 writes a new one for the diagram stack (5.7). |

`src/editor/revision.ts` stays (5.7).

### 6.2 Rewritten

| Module | Change |
|---|---|
| `src/model/v4.ts` (new), `src/binding/matcher.ts` (new) | the schema of 2.2, the parse of 2.5, the matcher of 2.4 |
| `src/binding/engine.ts` | input: the v4 uses; output: the patches with the status of 3.4 (`bindPlan` :150, `staleStatuses` :414) |
| `src/binding/status.ts` | `evaluateStatus` goes; per-series freshness (3.5) and coverage (3.6); `statusLevel` :119 and `STATUS_SEVERITY` :128 stay |
| `src/binding/color.ts` | `statusPaint` paints the exact colour (3.4); `statusColor` stays for stale and missing |
| `src/legend/model.ts` | one block per status refId (3.4); `mappingEntries` stays |
| `src/components/StatusBand.tsx` | the band text of 3.4 |
| `src/binding/capacity.ts` | refId or `{a2b, b2a}`, then `cap` with `a/b`; no field Max (3.8) |
| `src/binding/template.ts` | the scope and the grammar of 3.3; the shield stays |
| `src/interact/links.ts` | the URL order of 3.3: `percentencode` for bare ordinary dashboard variables; an explicit `${name:format}` keeps its format (A17); the cell-value shield and the final `isAllowedUrl` stay (:75-78 today passes no format) |
| `src/render/applier.ts` | `applyKey` reads every patch field that a write reads (3.4, Astra R1) |
| `src/binding/units.ts` | the rate-unit table (3.7) |
| `src/query/frames.ts` | the series index by refId and labels; the checks of :73-94 stay |
| `src/query/reduce.ts` | `sum`, `max` and `mean` across series; `last` over time. Today its `ReducerName` is `last`, `mean`, `max`, `min` over time, with no `sum` (:26-35) |
| `src/query/panelSnapshot.ts` | imports `QuerySnapshot` from `src/query/snapshot.ts` |
| `src/visuals/useSampleStale.ts` | its `FreshnessPolicy` type comes from `src/model/v4.ts` (:4 imports it from `model/config` today) |
| `src/interact/cardModel.ts`, `src/interact/Card.tsx`, `src/visuals/SparklineView.tsx`, `src/visuals/MirrorSparkline.tsx` | N lines in one chart, a shared Y range, palette colours, line labels, "+N more", the tooltip of all lines (3.7) |
| `src/visuals/ChartLayer.tsx`, `ChartHover.tsx`, `hoverSample.ts`, `tooltipPlace.ts`, `domain.ts` | input from the `chart` uses (3.9); `domain.ts:1` takes `LowerBound` and `RangeMax` from `src/model/v4.ts` |
| `src/render/linkLabels.ts`, `src/visuals/BarGaugeView.tsx`, `src/types.ts` | type imports only: `LinkLabelMode` (`linkLabels.ts:2`), `FreshnessPolicy` (`BarGaugeView.tsx:4`) and the config types (`types.ts:10`) come from `src/model/v4.ts` |
| `src/stage/useBoundDiagram.ts`, `src/components/DrawioMapPanel.tsx` | wire the v4 bind; `DrawioMapPanel.tsx:24,27` drops `EMPTY_CONFIG`, `legacyRulesWarning` and `MAX_DATA_POINTS` from deleted files; P1 removes the popup state and P3 adds the new popup (5.0) |
| `src/components/CornerControls.tsx`, `src/options/DiagramEditor.tsx` | P1 removes the two "Edit bindings" buttons; P3 adds them again for the split editor (5.0) |
| `src/adapter/portograph.ts` | `cellScope` and `endpointScope` give way to the scope of 3.3 and the end lookup of 3.8 |
| `src/editor/popup/PopupLayout.tsx`, `DiagramStage.tsx` | P3: the split editor. In P1 they have no user; `DiagramStage.tsx:13` follows the P1 type of `ChartLayerProps`, so P1 typechecks. |
| `src/editor/history.ts`, `src/components/LazyBindingsPopup.tsx`, `src/editor/popup/index.ts` (new in P3) | the split editor (5.1, 5.7) |
| `src/fixtures/demo-config.ts`, `authoring-config.ts`, `scripts/build-dashboard.ts` | v4 demo configs |
| `src/module.ts`, `src/types.ts` | `Options.config` type; the YAML option of 5.0; drop the v1 `rules` warning only when 1.0 allows it; `Options.build?: string`, which the generator writes and the panel never reads (7.3.5) |
| `scripts/check-bundle.sh`, `playwright.config.ts` | the bundle checks of 5.3; `MATRIX_SPECS` (`playwright.config.ts:22-33`) loses `binding-editor` and `query` in P1 and gets `split-editor` in P3 (6.5) |
| `src/harness.ts` (new) | the stable export for the consumer harness (6.4) |

### 6.3 Kept as they are

- Stage: `useStage` (`src/stage/useStage.ts:33`), `useStageLayout`, `useStagePaint`, `usePanZoom`.
- Render: `svgStage`, `sanitize` with its cache (`src/render/sanitize.ts:159-223`, `sanitizeSvg` :188), `zoom`,
  `geometry`, `cellAttrs`, `paintStage`, `overlay`, `labelPlacement`, `themeVars`. (`applier` and `linkLabels`
  are in 6.2.)
- Highlight: `highlightStore`, `highlight`.
- Colour: `colorFor` (`src/binding/color.ts:176-201`), `bindContextFor` (`src/binding/context.ts:19`).
- URLs: `src/binding/url.ts`.
- Query helpers: `src/query/boundary.ts`.
- Cards: `cardState`, `hit`. (`links` and `BarGaugeView` are in 6.2.)
- The draw.io editor: `DrawioModal` (`src/editor/DrawioModal.tsx:111`), `protocol.ts`, `drawio-shim.js`, `files.ts`,
  `decode.ts`, `availability.ts`, `target.ts`.
- The popup frame: `src/editor/popup/PluginDialog.tsx`, `popupBus.ts`, `overlayStack.ts`, `usePopupKeys.ts`,
  `boxTargets.ts`, `useBoxSelect.ts`. They import no deleted module, so they stay through P1 with their unit tests;
  `DrawioModal` uses `overlayStack` (`src/editor/DrawioModal.tsx:16`).
- `src/adapter/cellTitle.ts`, `src/importGraph.ts`, `src/editor/revision.ts`.

### 6.4 The consumer harness (Fable e.1)

The consumer scripts import panel modules by path (consumer `scripts/gen_drawiomap/panel_env.mjs:23`):
`validate_config.mjs:7` (`src/model/config.ts`), `plan.mjs:15-18` (`patterns.ts`, `template.ts`, `model/config.ts`,
`model/matcher.ts`), `replay.mjs:16-18`, `hover.mjs:21-24`, `legend.mjs:21-23` (`patterns.ts`, `engine.ts`,
`cardModel.ts`, `legend/model.ts`), `panel_frames.mjs:78-79` (`engine.ts`, `panelSnapshot.ts`),
`tests/behaviour/regex_check.mjs:7` (`model/matcher.ts`) and `tests/behaviour/history.mjs:9` (`query/frames.ts`).
All paths of this section are relative to consumer `scripts/gen_drawiomap/`; the behaviour scripts are in consumer
`scripts/gen_drawiomap/tests/behaviour/`, not in a `tests/` folder at the root of the repository. P1 deletes most of
these modules.

- P1 adds `src/harness.ts`. It exports a stable set: `validateConfig` (2.5, returns the config and the report),
  `bind` (cells, config, `PanelData`, context → patches and report), `buildCellIndex`, `cellMetas`, `mountSvg`,
  `sanitizeSvg`, `buildCard`, `buildLegend`, `historyOf`, `compileMatcher` (2.4), `fnv1a`, and in P3
  `setCellAttrs`. A unit test pins the names of the exports.
- In the same change set (A11), the consumer rewrites `validate_config.mjs`, `plan.mjs`, `replay.mjs`,
  `panel_frames.mjs`, `hover.mjs`, `legend.mjs`, `bundle.mjs`, `tests/behaviour/regex_check.mjs`,
  `tests/behaviour/history.mjs` and `tests/behaviour/snapshot.mjs` to import only `src/harness.ts`
  (`tests/behaviour/matchers.mjs` imports only `@grafana/data`, :5, and stays).
- The consumer pins the panel commit (consumer `scripts/gen_drawiomap/bundle.py:41-43`, `pins.PANEL_SHA`). The pin
  moves to the P1 commit in the same change set.
- P0 runs the v3 harness on `main` before the delete and records the results (9).

### 6.5 Tests

- `tests/authoring-fixtures.ts` and `tests/authoring-controls.ts` are rewritten, not deleted. All 30 e2e specs import
  them for the `test` fixture and `saveDashboard`. The v3 config builders in them give way to v4 builders.
- Deleted: `binding-editor`, `bindings-list`, `bindings-popup-inspector`, `bindings-popup-selection`, `editor-layout`,
  `query` (native queries), `authoring-compat` tests 1–2 (v3 compatibility, native editors).
- Rewritten, the behaviour kept:
  - `editor-refresh`: the draw.io iframe and its channel survive two dashboard refreshes through both entries
    (`tests/editor-refresh.spec.ts:4-18`).
  - `bindings-popup.spec.ts:251-365` moves to `split-editor.spec.ts`: the conflict, dirty Escape, nested popup focus,
    undo ownership and refresh while open.
  - `panel-edit-requests`: panel edit and the popup run no query again and Cancel closes.
  - `refresh`: the panel-query part ("refresh keeps the last data: no missing marker, no band row, no layout
    shift"); the native-query part goes.
  - `authoring-compat` test 3 (a chart follows a nested anchor through fit, resize, pan and zoom) moves to
    `visual-regions`.
  - `visual-regions`: chart regions (A9) and "health becomes stale without another response".
- Re-fixtured with a v4 config: `view`, `zoom`, `legend`, `links`, `link-labels`, `status-band`, `hover-kinds`,
  `no-drawio`, `options`, `color`, `cursor`, `card-tooltip`, `sparkline-range`, `editor`, `editor-missing`,
  `min-scale`, `phone-sheet`, `reset-corner`.
- **P1 and P3 (Astra R2).** P1 has no popup (5.0). Each e2e case that needs the popup or an "Edit bindings" button
  has a P1 form and a P3 form:

  | Case | P1 | P3 |
  |---|---|---|
  | `bindings-popup.spec.ts` | deleted; the cases of :251-365 wait for P3 | the cases of :251-365 in `split-editor.spec.ts` |
  | `editor-refresh.spec.ts:6-18`, entry `geometry` (through the popup) | the entry `Diagram option` only | the entry `geometry` through the split editor |
  | `editor.spec.ts:125` (geometry export through the popup) | geometry export through the Diagram option; `bind` and `key` survive the save and the reopen | the chart assignment through the split editor |
  | `options.spec.ts:8-39` (Diagram option buttons at the narrowest width) | the buttons without `dmap-edit-bindings-option`, and the YAML option | with the button |
  | `zoom.spec.ts:138-162` (the corner in panel edit) | the corner without `dmap-edit-bindings` | with the button |
  | `reset-corner.spec.ts:165` (edit-bindings button in the corner) | waits for P3 | rewritten for the split editor |
  | `refresh.spec.ts:172` (refresh while the popup is open) | waits for P3 | rewritten for the split editor |
  | `panel-edit-requests.spec.ts:57` | the panel-edit part: no query again, no datasource resource call, Cancel closes | the popup part |
  | `no-drawio.spec.ts:12-13` | kept: no popup chunk and no button in view mode; plus no YAML chunk (5.3) | kept |

  `tests/authoring-controls.ts` loses `openBindingsPopup`, `closeBindingsPopup`, `popupInspector` and
  `selectStageCell` in P1; P3 adds the helpers of the split editor. In P1, `MATRIX_SPECS`
  (`playwright.config.ts:22-33`) loses `binding-editor` and `query`; in P3 it gets `split-editor`, so the Monaco
  test runs in the `matrix` project on 12.4 and 13.2.
- The unit tests of each deleted module go with it. The behaviour tests of a kept rule move to the new module (for
  example the coverage cases of `src/binding/status.test.ts`).

### 6.6 Docs

- README lines 64–378 ("Bindings, queries and chart regions", "Rules of version 1"): a new section "Bindings (v4)"
  replaces them, with the matcher contract and its regex dialect (2.4), the template scope and the URL encoding
  (3.3), the "Edit Data" route for attributes and the open selector note of 8.4. README 412–425 (shape), 477–621 (capacity, link value labels, hover card): rewritten.
- `docs/acceptance.md:75-331` (the popup tasks): archived; a new v4 list replaces it. P0 writes the v3 bench number
  into it.
- The PoC spec section 8 table gets one row "Binding model v4" (CODING_STANDARDS "Docs").
- ADR 0002 gets a note: the status colour and text come from the field config of the status refId (A1), and the
  capacity chain is refId, then `cap`, then none; the field Max goes (ADR 0002:31). ADR 0001 stays.
- The specs 2026-10-18 (authoring and demand data), 2026-10-23 (popup), 2026-10-25 steps 2–4 get the status
  "superseded by v4".

## 7. Generator changes (consumer repository)

### 7.1 Today

- Mode A reads one topology file and renders seven sheets; mode B reads `topology/drawiomap/<name>.bindings.yml` for
  two hand-made enclosure sheets (consumer `scripts/gen_drawiomap/manifest.py:44`, :54). A separate script makes the
  smoke panel.
- The mode A pipeline (consumer `run.py:68-97`): `cell_meta` makes the `bind_*` attributes, `emit_pg` writes them as
  portograph `meta`, portograph renders the XML (:75), draw.io exports the SVG (:77), `bundle.diagram_json` hashes
  (:78), `config.build` makes the v3 options (:79), the dashboard is written last (:82).
- The mode B pipeline (consumer `run.py:99-159`): the source `.drawio` is copied (:132), exported (:134), bundled
  (:135) and injected into a hand-made dashboard (:146). Two sheets inject into one dashboard,
  `wb-enclosures` panels 1 and 2 (:138).
- `meta` reaches the XML with no prefix (consumer `emit_pg.py:194`, :214, :220-226).
- The dashboard holds `options.diagram` and `options.config` (consumer `dashboard.py:99`). Mode B rewrites only
  these, the targets and the field overrides (consumer `inject.py:41-56`).
- There is no merge-back. Generated dashboards are `editable: False` (consumer `dashboard.py:109`) and say
  "DO NOT EDIT" (:106). The provisioning has `allowUiUpdates: true` and `updateIntervalSeconds: 10` (consumer
  `infra/grafana/provisioning/dashboards/dashboards.yml:7-8`).
- The generator has no Grafana API client; only `tests/behaviour/*` reads a live system.

### 7.2 Verified: portograph passes `meta.bind` and `meta.key`

| Check | Evidence | Result |
|---|---|---|
| The meta keys go out with no prefix | portograph `src/render/drawio.ts:412-417`; contract `docs/drawio-binding-contract.md:143-147` | `bind="…"`, `key="…"` on the `<object>` |
| Bound cells: object around a bare mxCell | portograph `src/render/drawio.ts:425-429` | yes |
| Nodes, ports and links get meta | portograph `src/render/drawio.ts:832-836`, :946-949, :590-598 | yes |
| Allowed names | portograph `src/parse/index.ts:32-35`: `^[A-Za-z_][A-Za-z0-9_-]*$`; reserved `pg-*`, `id`, `label`, `placeholders`, `xml*` | `bind`, `key`, `port`, `cap`, `at` pass |
| Portograph's own attributes | `id`, `label` and `pg-*` only (portograph `src/render/drawio.ts:593-597`, :832-836, :946-948) | no clash with `bind` or `key` |
| The visual `class` | YAML `class` drives style only (portograph `src/parse/index.ts:154`, :178, :336) | not written; `meta.class` would be a separate attribute |
| Escaping | `escapeAttribute` and `xmlSafe` (portograph `src/render/svg.ts:11`, :25-42) | safe |
| SVG | draw.io writes each `<object>` attribute as `data-meta-<name>` (consumer `tools.py:27`, `--embed-svg-metadata`); the panel strips the prefix (`src/render/svgStage.ts:41-49`) | `attrs.bind`, `attrs.key` arrive as is |
| The panel's own names | the panel reads only `pg-*` and `label` (`src/adapter/portograph.ts:59`, :116-131) | no clash |
| One clash in the panel | `cellScope` puts the pg-id at `cell.key` (`src/adapter/portograph.ts:191`) | removed by the scope of 3.3 |

Verdict: yes. The one clash is in the v3 template scope, and v4 replaces that scope.

### 7.3 Changes

1. **Classes.** `config.build` writes `version: 4`, the classes and the overrides. One class per kind of cell: per
   catalogue family, for example a host, a UniFi switch, a camera, a LAN link (consumer `config.py:598-632` groups
   them today as profiles). It sets `linkLabel: percent` on link classes (A13).
2. **Cell attributes.** `cellmeta.cell_attrs` writes `bind`, `key`, and the other matched attributes (`port`, `cap`)
   instead of `bind_<label>` (consumer `cellmeta.py:27-57`). A link gets `cap` from the topology capacity when no
   speed refId exists, as `a/b` when the two directions differ (consumer `config.py:484-504` handles the asymmetric
   case today; `emit_pg.py:221-224` writes `capacity_a2b_bps`). When the slots of a cell disagree on one label
   (today `bind_<slot>_<label>`, consumer `cellmeta.py:48-51`), the second value goes into an attribute named
   `<slot>`, and the row of that slot sets `match: {<slot>: <label>}`.
3. **`at` on each link (A13).** The generator sets `at=source` or `at=target` on each link from the slot identity
   and the two endpoints. An audit runs over all panels and fails when a link has no known key end. Measured in
   review round 1: net-l2 13 of 13 at the source; cctv-path 5 of 10 at the source (5 unbound); 26 links on
   `mon-pipeline`, `net-geography-dm` and `net-l3-vpn-dm` bind on labels that are not ports (probes, tunnels), so
   their catalogue family states the tx end.
4. **Targets.** One fan-out target per metric. refId = the query name. The catalogue families stay (consumer
   `config.py:634-709`); the single per-cell targets `<cell>_<slot>` go into the family of their metric. The field
   overrides match `byFrameRefID`, not a display-name regex (consumer `config.py:711-751`). A value mapping of a
   healthy state ("up", "normal", "no fault") gets the colour `transparent` (A14), so a healthy cell keeps its
   drawn colour and its severity stays normal (3.4). Mode B writes its mappings the same way.
5. **`pull` (A2, Astra R3, Fable M2).** A new command, `gen_drawiomap pull [--sheet <name>] [--base <commit>]
   [--check]`, reads the deployed dashboards. It is the only command that talks to Grafana.
   - It reads the URL and the token from environment variables and never prints the token.
   - It takes one snapshot per dashboard uid: `GET /api/dashboards/uid/<uid>`. All panels of that dashboard come from
     this one snapshot.
   - **The build id.** Each build records which unmerged XML it started from. The unmerged XML is the XML of step 1
     of 7.4, before the merge. Mode A writes it as `topology/drawiomap/<sheet>/base.drawio`, next to the merged
     `diagram.drawio`. In mode B it is the source `.drawio`, which the merge never changes. The build id is the git
     blob id of these bytes (`git hash-object -w`, which also stores the blob in the local repository), and the
     build writes it into the panel as `options.build`. The
     panel never reads this key. Grafana keeps it in the saved options, the YAML option of 5.0 changes only
     `config`, and Apply writes `{...options, config, diagram}` (`src/editor/popup/BindingsPopup.tsx:121` today,
     kept in 5.7). P1 acceptance 14 checks that a save keeps it.
   - **The base.** For each sheet, `pull` finds the panel by id, checks its type and reads `options.build`. It loads
     the base with `git cat-file blob <id>`. `--base <commit>` reads the base file of the sheet at that commit
     instead. A build id that is not in the repository stops the run: "the deployed build <id> is not in this
     repository; fetch it or pass --base".
   - **No build id (review round 3, N1).** A panel with no `options.build` is exempt only when it is a positively
     identified v3 deployment: its `options.config.version` is a number below 4 (D22). Such a panel has no
     editor-written v4 attributes, so `pull` writes a file with no cells and prints "no v4 build deployed". Each
     other panel with no `options.build` (`version: 4`, or no readable version) has no usable base: `pull` stops
     with a non-zero exit, prints "the deployed panel has no build id; pass --base <commit>", and does not replace
     `<sheet>.cells.yml`. With `--base <commit>` the base of that commit is usable, and `pull` goes on.
   - **The delta.** `pull` compares page 1 of the deployed `options.diagram.xml` with the base. It writes
     `topology/drawiomap/<sheet>.cells.yml` with each cell attribute whose deployed value differs from the base:
     the deployed value, or `null` when the base has a value and the deployment has none. It compares all
     attributes except `pg-*`, `id`, `label`, `placeholders` and `xml*`. The new file replaces the old file as a
     whole, also when it has no cells, so that the file always records the last pull.
   - **No lost edits (Astra R3).** The base holds no earlier delta. Thus an attribute that an earlier pull kept and
     a later build deployed comes out of each later pull again, and an attribute that the author removed in
     Grafana is not in the new file. The earlier rule (compare with the merged `HEAD` XML) dropped a kept attribute
     at the second pull.
   - **Warnings, not stops (Fable M2).** The YAML classes, the overrides and the targets are generator-owned (A3).
     When the deployed `options.config` or targets differ from the build, `pull` prints "generator-owned: the next
     build overwrites it" for each and goes on. A difference of geometry or style in the XML is printed in the same
     way. Only cell attributes go into the file. Thus `pull` works when `HEAD` holds a newer build that is not
     deployed, and when the author changed the YAML box of a generated panel.
   - A 404 for a dashboard that was never deployed writes no file and prints "first deployment". Each other failure
     stops with a non-zero exit and writes nothing: 401, 403, 5xx, a network error, malformed JSON or XML, a missing
     panel, a wrong panel type, a compressed page, a duplicated cell id, an unknown build id, a missing build id on a
     panel that is not a positively identified v3 deployment.
   - `--check` is the deploy gate of 7.4: it computes the delta of each sheet as above, compares it with the file,
     and writes nothing. It accepts `--base <commit>` with the same meaning.

   ```yaml
   schema: 1
   dashboard: {uid: net-l2-dm, version: 42}
   panel: 1
   page: page-1
   build: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad   # the git blob id of the base
   cells:
     pg-link~p-a1-16: {cap: 2.5G}
     pg-node~cam-1: {bind: camera, key: cam-1}
   ```
6. **Merge and ownership (A2, A3).** The generator merges only from `<sheet>.cells.yml`. It never talks to Grafana.
   - Identity: dashboard uid + panel id + page + cell id. A file whose uid, panel or page does not match the sheet
     stops the run.
   - For each attribute of the file: when the new XML has no value for it, the generator writes the file value. When
     the new XML has the same value, nothing changes. When the new XML has another value, this is a conflict. A
     `null` against a value of the new XML is a conflict too. Each value that the generator writes counts as a
     topology value, also an inferred default such as `at=source`.
   - **Generator-owned attributes (A3, Astra R9).** Topology wins. An edit in Grafana of an attribute that the
     generator writes (`bind`, `key`, `port`, `cap`, `at` on a generated cell) is a conflict at the next build. To
     change such a value, change its source: the topology or the catalogue family in mode A, the source generator
     in mode B. Thus the one-click `at=target` of 5.4 serves hand-drawn edges; on a generated link the fix goes into
     the catalogue family (7.3.3). An attribute on a cell that the generator leaves unset is the author's, and the
     merge keeps it.
   - A conflict prints the sheet, the cell id, the attribute and both values, and the run exits non-zero. With
     `--accept-topology`, the topology value wins and the run continues.
   - A cell id of the file that the new XML does not have (a node or port was renamed, so its id changed) is an
     orphan. It is printed and exits non-zero in the same way. Thus a renamed node or port loses its hand-set
     attributes only with `--accept-topology` (Fable f.6).
   - The YAML classes, the overrides and the targets of a generated panel stay generator-owned. An editor change to
     them is overwritten, and the README says so.
   - After the merge, the generator runs the panel's own validation and bind (`src/harness.ts`, 6.4) on the merged
     sheet, at step 5 of 7.4. An `unknown-class`, `missing-attr` or `class-no-match` entry on a cell stops the run.
     Thus a kept `bind` that names a class that the generator no longer writes cannot ship.
7. **Mode B (Fable f.3).** The same `pull` and merge. The base is the source `.drawio` in the repository. The repo
   holds the source and the delta, so the repo and the deployment agree. The v3 hand format of mode B maps as follows
   (consumer `boiler-enclosure.bindings.yml:36-40`): the cell-id template `mr6cu-72-k{n}` becomes the attributes
   `key=72 port=<n>` on the cells, and `relay{entity="switch.wb_mr6cu_72_k{n}"}` becomes the class matcher
   `entity="switch.wb_mr6cu_${key}_k${port}"`. The source generator of mode B (consumer `docs/diagrams/gen_boiler.py`)
   writes today only `model` and `slave` on its bound device blocks (:205, :258, :265, :280, through `add_bound`
   :54-56) and `k` on the relay chips (:63). P2 changes it to write `bind`, `key` and `port` as meta of its bound
   cells (the values of 8.2), and keeps its id counter (:30-36), so the regenerated source `.drawio` has the same
   cell ids as today. `inject.py` (consumer `inject.py:41-56`) also writes `options.build` (7.3.5).
8. **`editable: true` (A2).** Generated dashboards are `editable: true` (consumer `dashboard.py:109`). The note at
   :106 changes to: "Edit the bindings of cells in the binding editor only; `gen_drawiomap pull` keeps them. Other
   edits are lost on the next build." The mode B target dashboard belongs to its author: in P2 its file gets
   `"editable": true` by hand (A16; consumer `dashboards/Home & IoT/wb-enclosures.json:13`).

### 7.4 The order of a build (Astra 20, Astra 21)

1. Render the unmerged XML (mode A: portograph, written as `base.drawio`; mode B: the source). Its git blob id is
   the build id (7.3.5).
2. Read `<sheet>.cells.yml`, check the identity, merge, resolve the conflicts (7.3.6).
3. Export the SVG from the merged XML.
4. Build the config, the targets, the plan and the report.
5. Validate and bind with the panel harness (7.3.6). The cells come from the exported SVG through the same path as
   the panel: `buildCellIndex(mountSvg(sanitizeSvg(svg)))` (6.4). The inputs are the config of step 4 and a
   `PanelData` with the targets of step 4 and no frames. The run stops on a `schema`, `unknown-class`,
   `missing-attr`, `class-no-match` or `unknown-ref` entry. The entries that need series (`no-series`,
   `orphan-series` and the like) do not apply here.
6. Bundle and hash the diagram (consumer `bundle.py:39-46` hashes both the XML and the SVG).
7. Write all artefacts, the manifest and `options.build`.

Thus the exported `data-meta-*` attributes, the hash and the manifest all hold the merged values, and the bind of
step 5 reads the same cells as the deployed panel (Astra review round 2, section (3): the earlier order bound before
the export and before the config existed). A test reads the exported SVG, not only the XML.

**The deploy gate (A15, Fable M2).** A UI save after the last `pull` is lost when the provisioned file replaces the
dashboard. Step 0 of the consumer `scripts/deploy.sh` (where the alert-panel lint runs today, consumer
`scripts/deploy.sh:26-29`) runs `gen_drawiomap pull --check`, with the Grafana URL and token from the environment.
For each sheet, it computes the delta of the deployed panel against its build (7.3.5) and compares it with the
`cells` of `<sheet>.cells.yml`:

| State | Gate |
|---|---|
| the delta equals the file | pass |
| the delta differs from the file | stop: "pull again" |
| the sheet has no `.cells.yml`, and the delta is empty | pass |
| the sheet has no `.cells.yml`, and the delta is not empty | stop: "pull first" |
| the dashboard was never deployed (404) | pass |
| the panel has no `options.build`, and its `options.config.version` is a number below 4 (a v3 deployment) | pass |
| the panel has no `options.build`, and it is not a positively identified v3 deployment (N1) | stop: "no build id; pass --base" |
| no API access: a network error, 401, 403, 5xx, no token | stop (A15) |

A stop leaves `<sheet>.cells.yml` as it is and copies no file. For the N1 row, the author runs
`gen_drawiomap pull --base <commit>` with the commit of the deployed build; step 0 of `scripts/deploy.sh` passes
`--base "$DRAWIOMAP_PULL_BASE"` to the gate when that variable is set.

The gate compares content, not the dashboard `version`: each provisioning of a file increments the version, so a
version check would stop the deploy after each deploy. The content check also ends the deadlock of review round 2
(Fable M2): `HEAD` holds a new build that is not deployed, and the author saved cell edits after the last pull. The
gate says "pull again"; `pull` reads the deployed build, not `HEAD`, so it succeeds; the next build of `HEAD` merges
the new file, and the gate passes.

## 8. The pilots (A8)

### 8.1 net-l2-dm: nodes, links, direction, capacity

Facts (consumer `dashboards/Network/net-l2-dm.json`, its diagram in `topology/drawiomap/net-l2-dm/`):

- 27 targets with meaningful refIds (`net-l2-dm.json:1657-1865`). The hosts join on `job`, the UniFi devices on
  `name`, the ports on `name` + `port_num`, each camera on `device`. No `instance` or `ifName` labels.
- 13 nodes, 13 links, 18 ports. All 13 links start at a switch port (`pg-from="<switch>:p<n>"`). The link cell holds
  the switch port identity today (`bind_name`, `bind_port_num`). So `key` at the source end fits D14; the generator
  writes `at=source` (7.3.3).
- `lan_state` is `clamp_max(port_speed_bps, 1)`. The exporter writes port series only for connected ports. No series
  means the port is down: `missing: down`.
- The v3 node pattern (`net-l2-dm.json:204-283`) has three history rows, a metadata row and a drilldown. Its status
  maps `scrape_up` 0 to down. The v3 link pattern `link-lan-1g` (`net-l2-dm.json:662-765`) binds `lan_tx`/`lan_rx`
  with `capacity: "${cell.capacity_a2b_bps}"`.

Cell attributes after P2 (demo names):

```xml
<object id="pg-node~rtr-a" label="rtr-a" pg-kind="node" pg-id="rtr-a" bind="host" key="node-rtr-a" object_class="host">
<object id="pg-node~sw-a1" label="sw-a1" pg-kind="node" pg-id="sw-a1" bind="unifi-switch" key="sw-a1" object_class="appliance">
<object id="pg-node~cam-1" label="cam-1" pg-kind="node" pg-id="cam-1" bind="camera" key="cam-1" object_class="probe">
<object id="pg-node~ap-a" label="ap-a" pg-kind="node" pg-id="ap-a" bind="unifi-client" key="ap-a" object_class="probe">
<object id="pg-link~p-a1-16" pg-kind="link" pg-from="sw-a1:p16" pg-to="rtr-a:eth1" bind="lan" key="sw-a1" port="16" at="source" path_role="primary">
<object id="pg-link~p-a1-3" pg-kind="link" pg-from="sw-a1:p3" pg-to="cam-1" bind="lan" key="sw-a1" port="3" at="source" path_role="primary">
```

Targets (unchanged refIds; the regex lists are the demo names):

```text
scrape_up         up{job=~"node-rtr-a|node-hv-a|node-ctl-a"}                                  instant
host_cpu          100 * (1 - avg by (job) (rate(node_cpu_seconds_total{job=~"…",mode="idle"}[5m])))
host_mem          100 * (1 - node_memory_MemAvailable_bytes{job=~"…"} / node_memory_MemTotal_bytes{job=~"…"})
host_uptime       time() - node_boot_time_seconds{job=~"…"}                                   instant
unifi_dev_health  unpoller_device_uptime_seconds{name=~"sw-a1|sw-a2"} > bool 0                 instant
unifi_dev_cpu     100 * unpoller_device_cpu_utilization_ratio{name=~"sw-a1|sw-a2"}
unifi_dev_poe_budget  100 * sum by (name) (unpoller_device_port_poe_watts{…}) / on (name) group_left() unpoller_device_max_power_total{…}
unifi_client_health   unpoller_client_uptime_seconds{name=~"ap-a|lte-modem"} > bool 0            instant
hik_up            hikvision_up{device=~"cam-1|cam-2"}                                          instant
lan_tx            unpoller_device_port_transmit_rate_bytes{name=~"sw-a1|sw-a2"} * 8
lan_rx            unpoller_device_port_receive_rate_bytes{name=~"sw-a1|sw-a2"} * 8
lan_state         clamp_max(unpoller_device_port_port_speed_bps{name=~"sw-a1|sw-a2"}, 1)        instant
unifi_port_speed  max by (name, port_num) (unpoller_device_port_port_speed_bps{name=~"sw-a1|sw-a2"})  instant
```

Field config by refId: `scrape_up`, `unifi_dev_health`, `unifi_client_health`, `hik_up`, `lan_state`: value mappings
0 → "down" (red), 1 → "up" (`transparent`, A14). `lan_tx`, `lan_rx`, `unifi_port_speed`: unit `bps`; `lan_tx`/`lan_rx`
carry the utilisation thresholds of today's regex override. `host_cpu`, `host_mem`, `unifi_dev_cpu`: unit `percent`.
`host_uptime`: unit `dtdurations`.

The config:

```yaml
version: 4
freshness: 3x
classes:
  device:                       # abstract base: no match, no cells (A7)
    rows:
      - {kind: metadata, label: Role, text: "${object_class}"}
  host:
    extends: device
    match: {key: job}
    status: scrape_up
    rows:
      - {kind: history, query: host_cpu}
      - {kind: history, query: host_mem}
      - {kind: value, query: host_uptime}
      - {kind: drilldown, label: Open host, url: "/d/host?var-job=${key}"}
    url: "/d/host?var-job=${key}"
  unifi-switch:
    extends: device
    match: {key: name}
    status: unifi_dev_health
    rows:
      - {kind: history, query: unifi_dev_cpu}
      - {kind: value, query: unifi_dev_poe_budget}
  unifi-client:
    match: {key: name}
    status: unifi_client_health
  camera:
    match: {key: device}
    status: hik_up
  lan:
    match: {key: name, port: port_num}
    up: lan_tx                  # sw-a1:p16 sends = a→b
    down: lan_rx
    capacity: unifi_port_speed  # else the cell attr cap=1G
    status: lan_state
    missing: down               # no port series = the cable is out
    linkLabel: percent
    rows:
      - {kind: updown, up: lan_tx, down: lan_rx, label: Traffic}
      - {kind: metadata, label: Path, text: "${path_role}"}
overrides:
  pg-link~p-a1-15:
    rows: [{kind: metadata, label: Note, text: second uplink}]
```

The base class `device` has no cells and no `match`. It is valid (A7). The `object_class` attribute is required only
by the metadata row. The generator writes it on every node today: 13 of 13 nodes in consumer
`topology/drawiomap/net-l2-dm/diagram.drawio` (the values `appliance`, `host`, `probe`), so the report has no
`missing-attr` for it (Fable, round 2). A cell with no `object_class` would show no Role row and give `missing-attr`.

Expected match report: 0 cells with no series when all devices are up; `lan` with `port` from the switch port; one
`many-series` entry if a camera name repeats.

### 8.2 boiler-enclosure: bound cells, key + port, text on the cell, N lines

Facts (consumer `topology/drawiomap/boiler-enclosure.bindings.yml`, `docs/diagrams/boiler-enclosure.drawio`,
`docs/diagrams/gen_boiler.py`, `dashboards/Home & IoT/wb-enclosures.json`):

- Mode B. The source sheet comes from `gen_boiler.py`. Its bound cells are `<object>` elements with `pg-kind="node"`
  and a `pg-id`: `wb7`, `mr6cu-72`, `mr6cu-72-k1`…`k6`, `mrwm2-25`, `boiler`. The cell ids are numbers from a
  counter in draw order (consumer `gen_boiler.py:30-36`), stable while the script does not change.
- It injects into panel 1 of the dashboard `wb-enclosures` (consumer `boiler-enclosure.bindings.yml:11`). Panel 2 of
  the same dashboard is the water-pump sheet. The dashboard has `"editable": false` (`wb-enclosures.json:13`).
- 9 targets, all range queries, refIds `b:<name>` today. Every query was verified live by the consumer team on
  2026-10-19 (consumer `boiler-enclosure.bindings.yml:3`).
- `mrwm2_norm` is `min(…)` over two entities. Its result has no label, so no cell can join it (2.4). v4 drops the
  `min`: the class takes the worst of the two series, which gives the same state.
- The relay mappings are 0 → off, 1 → on (the real texts are Russian). The v3 relay chips have no status query.

Targets after P2 (refId = the query name; `node-ctl-a` is the demo job):

```text
wb7_up        up{job="node-ctl-a"}
wb7_temp      node_hwmon_temp_celsius{job="node-ctl-a",chip="thermal_thermal_zone0",sensor="temp0"}
wb7_uptime    time() - node_boot_time_seconds{job="node-ctl-a"}
mr6cu_avail   homeassistant_entity_available{entity="switch.wb_mr6cu_72_k1"}
relay         homeassistant_switch_state{entity=~"switch[.]wb_mr6cu_72_k[1-6]"}
mrwm2_norm    homeassistant_binary_sensor_state{entity=~"binary_sensor.wb_mrwm2_25_urms_normal_k[12]"}   (was min(…))
volt          homeassistant_sensor_voltage_v{entity=~"sensor[.]wb_mrwm2_25_urms_l[12]"}
boiler_fault  homeassistant_sensor_state{entity="sensor.wbe2_i_opentherm_11_boiler_fault_indication"}
boiler_err    homeassistant_sensor_state{entity="sensor.wbe2_i_opentherm_11_error_code"}
```

Field config by refId: `wb7_up`, `mr6cu_avail`: 0 → "down" (red), 1 → "up" (`transparent`, A14). `mrwm2_norm`: 0 →
"out of range" (orange), 1 → "normal" (`transparent`). `boiler_fault`: 0 → "no fault" (`transparent`), 1 → "fault"
(red). `relay`: 0 → "off"
(grey), 1 → "on" (yellow); `relay` is a text refId, not a status, so its yellow is not a warning. `wb7_temp`: unit
`celsius`, decimals 0. `wb7_uptime`: unit `dtdurations`. `volt`: unit `volt`, decimals 0.

Cell attributes after P2. `gen_boiler.py` writes them as meta (7.3.7):

```xml
<object id="48" label="WB 7" pg-kind="node" pg-id="wb7" model="WB 7" bind="controller" key="node-ctl-a">
<object id="53" label="WB-MR6CU v.2 · ID 72" pg-kind="node" pg-id="mr6cu-72" model="WB-MR6CU v.2" slave="72" bind="relay-module" key="72">
<object id="61" label="K1" pg-kind="node" pg-id="mr6cu-72-k1" k="K1" bind="relay-output" key="72" port="1">
<object id="14" label="WB-MRWM2 · ID 25" pg-kind="node" pg-id="mrwm2-25" model="WB-MRWM2" slave="25" bind="mains-monitor" key="25">
<object id="59" label="Котёл&#xa;(OpenTherm)" pg-kind="node" pg-id="boiler" model="OpenTherm boiler" bind="boiler" key="11">
```

The config:

```yaml
version: 4
freshness: 3x
classes:
  controller:
    match: {key: job}
    status: wb7_up
    freshness: 180s             # v3: stale_after 180s
    url: /d/ctl-a
    rows:
      - {kind: history, query: wb7_temp, label: SoC}
      - {kind: value, query: wb7_uptime, label: Uptime}
      - {kind: drilldown, label: Open dashboard, url: /d/ctl-a}
  relay-module:
    match:
      key: entity="switch.wb_mr6cu_${key}_k1"
    status: mr6cu_avail
    rows:
      - {kind: drilldown, label: Open dashboard, url: /d/home-assistant}
  relay-output:                 # one relay output: key = Modbus id, port = output
    match:
      key: entity="switch.wb_mr6cu_${key}_k${port}"
    text: {query: relay}        # "on" / "off" on the chip
    rows:
      - {kind: history, query: relay, label: State}
  mains-monitor:
    match:
      key: entity=~"binary_sensor[.]wb_mrwm2_${key}_urms_normal_k[12]"
    status: mrwm2_norm          # 2 series: the worst
    rows:
      - kind: history           # 2 lines in one chart: L1 and L2 (v3 had two rows)
        query: volt
        label: Voltage
        match:
          key: entity=~"sensor[.]wb_mrwm2_${key}_urms_l[12]"
      - {kind: drilldown, label: Open dashboard, url: /d/home-assistant}
  boiler:
    match:
      key: entity="sensor.wbe2_i_opentherm_${key}_boiler_fault_indication"
    status: boiler_fault
    freshness: 300s             # v3: stale_after 300s
    url: /d/home-assistant
    rows:
      - kind: value
        query: boiler_err
        label: Error code
        unit: none
        match:
          key: entity="sensor.wbe2_i_opentherm_${key}_error_code"
      - {kind: drilldown, label: Open dashboard, url: /d/home-assistant}
```

This pilot shows: a key and a port in one template; a row match that replaces the class match; one regex that takes
N series for one cell; N lines in one chart; the worst state of N series instead of `min`; text on the cell; class
freshness.

**The round trip in P3 (Astra R9).** A3 stays: topology wins, so the pilot does not change a value that the source
generator writes. The source generator leaves the device blocks without a `pg_id` unbound: they are bare `<mxCell>`
elements from `add_cell` (consumer `gen_boiler.py:157-158`). One of them is the 24 V supply block that feeds the
controller (consumer `gen_boiler.py:248-251`). In P3 the author binds it in the editor (5.5): `bind=controller`,
`key=node-ctl-a`. The supply then shows the status of the controller it feeds. The write wraps the bare `<mxCell>`
in an `<object>` (5.5). `pull` writes the two attributes, the next build keeps them (7.3.6: a value on a cell that
the generator leaves unset), and the provisioned dashboard shows them. A separate check edits the `key` of one
relay chip, which the source generator owns: `pull` writes it, and the next build exits non-zero with both values;
with `--accept-topology` the chip gets its source value again.

### 8.3 wb-channels-lighting (stretch pilot)

Facts (consumer `docs/diagrams/wb-channels-lighting.drawio`, `docs/diagrams/gen_wb_channels.py:107-200`):

- One RS-485 bus with five WB-MR6C v.3 relay modules, 26 lighting and ventilation circuits, outputs K1–K6.
- The sheet has no bound cells: 0 `<object>` elements, 0 `pg-*` attributes, 134 bare `<mxCell>` with ids in draw
  order. A channel is two loose text cells, not a container (`gen_wb_channels.py:62-80`).
- No dashboard panel shows it, and no relay metric of these modules exists in the consumer repository. The entity
  naming `switch.wb_mr6c_v3_<modbus id>_k<n>` is not verified.

Before this pilot starts (A8): check the entities live in Home Assistant; make `gen_wb_channels.py` write stable
cell ids, one container cell per channel, and the attributes `bind`, `key`, `port`. Then the classes follow the
pattern of `relay-output` and `relay-module` of 8.2, with `entity=~"switch[.]wb_mr6c_v3_${key}_k[1-6]"` for a
module with six lines in one chart.

### 8.4 Hand-authored panels: open selectors

The hidden cost of a hand-authored panel is the fan-out query. In 8.1 each target is an explicit list
(`job=~"node-rtr-a|node-hv-a|node-ctl-a"`); a new host by hand means editing 4 targets. The generator writes these
lists; a hand author does not. A hand-authored panel uses open selectors (`job=~"node-.*"`) and relies on the
`orphan-series` and `no-series` entries of the report. The cap of 8 lines and of 50 orphan label sets keeps that safe.
The README says so.

## 9. Phases

The gate of each phase: `npm run typecheck`, `npm run lint`, `npm run test:affected`; one adversarial review of the
`src/` diff against `CODING_STANDARDS.md`; `npm run check:privacy` on the new fixtures, the demo config and the
regenerated dashboards. Before the push: the full `npm test`, and `npm run e2e:matrix` when the change touches the
panel or the editor.

### P0: baselines on `main`, before any delete

1. **Bench.** A bench of the v3 bind of 300 cells and 1000 series on a demo fixture (`src/fixtures/`, as
   `src/query/history.bench.test.ts`). The number goes into `docs/acceptance.md` with the commit.
2. **Colour parity.** The consumer runs its v3 harness (`replay.mjs`, `hover.mjs`, `legend.mjs`) on net-l2-dm and
   boiler-enclosure with a recorded frame fixture. It stores per cell: the severity, the fill and stroke colour, the
   colour and percent of each link half, the text. The result goes into the consumer's behaviour fixtures (next to
   consumer `scripts/gen_drawiomap/tests/fixtures/behaviour/baseline-digests.json`).

### P1 and P2: one change set (A11)

**P1, the panel.** Work: `src/model/v4.ts`, the matcher, the class resolver, the join (section 3), status, freshness,
links, rows, charts, the report data, `src/harness.ts`, the YAML option of 5.0; all deletes of 6.1, the v3 popup and
its two "Edit bindings" buttons included (5.0, Astra R2); the P1 column of 6.5; the e2e fixtures of 6.5; a v4 demo
config.

P1 acceptance:

1. Unit: both pilot configs of section 8 pass the parse; a class with an unknown key is invalid and the other
   classes still bind; an invalid parent makes its descendants invalid; an invalid override makes one cell
   unavailable.
2. Unit: YAML round trip for both pilots: `parse(write(cfg))` deep-equals `cfg`, and `write(parse(write(cfg)))`
   equals `write(cfg)`. The writer puts `match` values with `${` or `[` in block style.
3. Unit: each matcher form (bare, `=`, `!=`, `=~`, `!~`, a list); anchoring; a regex-escaped value with `.`, `"` and
   `\`; `\\d` in a matcher; a leading `(?i)`; `(?P<n>…)` gives `matcher-error`; `!=` and `!~` on an absent label pass,
   `=` fails, `=""` passes; an empty block and a block that reads no attribute are rejected. The dialect (2.4 step 6,
   Astra R6): `instance=~"node-a\\z"` gives `matcher-error` and selects neither `node-a` nor `node-az`; a lookbehind
   and `\1` give `matcher-error`; `\-` and `\_` outside and inside a class are literals; `\y` gives `matcher-error`.
4. Unit: `${port}` in a matcher of a cell with no `port` gives `missing-attr`, also when a dashboard variable `port`
   exists; a `$` in a cell value is not expanded by `replaceVariables`; a URL that fails `isAllowedUrl` is not shown.
   URL encoding (3.3, Astra R7, A17): the text that reaches `replaceVariables` holds `${job:percentencode}` for
   `$job`, `$__url_time_range` as it is, and `${job:queryparam}` and `${job:csv}` as they are, with no `schema`
   entry; a cell with the attribute `job=cell-a` and a dashboard variable `job` give `cell-a` for `${job}` and
   leave `${job:queryparam}` to `replaceVariables`; a `${job:csv}` in a matcher and in a `metadata` text is a
   `schema` entry; `${job.x:csv}` in a URL is a `schema` entry. The real Grafana formats run in the e2e check of
   acceptance 14.
5. Unit: `extends`: rows append, other fields replace, a cycle, an unknown parent; overrides by cell id; an override
   that adds a query enters the series index; a row match replaces the class match.
6. Unit: status: exact colour and text of a mapping (`magenta` / `Offline` paints magenta), the severity table for
   both themes, `down` from the text, the worst of N, `transparent` paints nothing, the band text, the legend block of
   a refId with value mappings. The applier (Astra R1): a patch with the same state and text and another colour
   gives a new `applyKey`, and `applyPatches` repaints the cell (green → blue); blue → `transparent` removes the
   paint; a change of each status field alone (`state`, `severity`, `color`, `text`, `refId`, `reason`) gives a
   new key.
7. Unit: no data: zero series = grey; `missing: down` only at zero series of a ready query; a failed query, a first
   load and an all-null series never give `down`; NaN and Infinity give `missing`; coverage 1 of 2.
8. Unit: freshness: one stale series of six makes the cell stale; an instant target is never stale; the cadence of
   a `1m` target with a 15 s request interval; no interval: the median step. The clock (3.5, Astra R4, Fable M1):
   with `raw.to: 'now'`, the same `PanelData` and `timeRange` objects and a clock step past `t + freshness`, the
   cell turns stale through `useStaleStatus`, with no new bind; with `raw.to: 'now-1h'` the deadline holds the lag
   of 1 h; with an absolute range, the same clock step changes nothing, and the state comes from `timeRange.to`.
9. Unit: several series: the order of 3.7; `sum` for `bps`, `flowlpm` and `cpm`, `max` for `percent` and `rotrpm`;
   1 Mbit/s + 500 kbit/s = 1.5 Mbit/s; mixed units give `unit-mismatch`; an explicit `reduce` gives no `many-series`;
   two numeric fields in one frame; a duplicate frame is counted once; an updown gap. Frame merge (3.2 step 5, Astra
   R5): a range frame at 0, 60 and 120 s and an instant frame at 125 s with equal labels give four points in both
   frame orders, and the history row keeps all four; two values at one timestamp give `duplicate-series`. N lines
   (3.7): 9 series give 8 lines and "+1 more"; after a reorder of the frames each line keeps its colour and label;
   a series with no finite value keeps its colour slot and shows "no data" in the tooltip model; two lines at 49 and
   51 give the Y range 0 to 51 (Astra R8), and `min: auto` gives 47.45 to 52.55, the result of the retained
   `yDomain` (`src/visuals/domain.ts:49-59`: a span of at least 10 % of the top, centred on the data).
10. Unit: links: a→b = `up`; `at=target` flips the halves, the label and the card row; capacity from the refId,
    `{a2b, b2a}`, then `cap=1G`, then `cap=50M/10M`, then none (no percent); a speed of 0, a negative speed, two
    speed series and a failed speed query fall through; `cap=abc` gives `bad-cap`; `${from.key}` reads the port cell
    before the node cell; an ordinary draw.io edge reads its ends from the XML; `${from.key}` of an ordinary edge
    whose source is a shape inside a container reads `key` from the container through the parent chain; a
    compressed page gives `no-edge-ends` with the reason "compressed page".
11. Unit: the report: each entry kind of section 4; the orphan cap of 50 on a refId of 1000 series.
12. Unit: a `version: 3` config binds nothing and gives one notice.
13. Unit: `src/harness.ts` exports the pinned names.
14. E2E (`plugin` project): the demo dashboard with a v4 config: a link half colour, a down node, a grey node with
    no data, a card with a history row of 3 lines on one axis, a chart region; the YAML option saves a valid config.
    N lines in the browser: a card row with 9 series shows 8 lines and "+1 more"; the pinned tooltip lists the 8
    lines at the hovered time. A `chart: {kind: value}` region draws a bar gauge. A panel whose options hold
    `build: "x"` still holds it after a save of the YAML option (7.3.5). URL encoding with the real
    `replaceVariables` (3.3, Astra R7): a dashboard variable `job` with the value `a&var-site=b` gives the link
    `var-job=a%26var-site%3Db`; a `#` gives `%23`; the values `a` and `b` give `a%2Cb` for `$job`;
    `$__url_time_range` gives `from=…&to=…` unencoded. Formatted variables (A17): with the values `a` and `b`,
    `/d/host?${job:queryparam}` gives the link `/d/host?var-job=a&var-job=b`; a cell with the attribute
    `job=cell-a` and the URL `/d/host?var-node=${job}&${job:queryparam}` gives
    `var-node=cell-a&var-job=a&var-job=b`.
15. E2E: the re-fixtured specs of 6.5 pass, in the P1 column of the table in 6.5. The cases of the P3 column do not
    run in P1, because P1 has no popup (5.0).
16. Bench: the bind of the P0 fixture is faster than the P0 number. The bench also runs a fixture with 300 distinct
    regexes and one with malformed matchers.
17. After a fresh `npm run build`, `npm run check:bundle` passes with the checks of 5.3: the build is newer than
    `src/`, and `dist/module.js` holds no message text of the `yaml` package. `tests/no-drawio.spec.ts` shows that view
    mode requests no YAML chunk.

**P2, the generator and the 10 panels (consumer repository).** Work: section 7.3 and 7.4; the harness rewrite of
6.4; regenerate the 10 panels. Also: the build id, `base.drawio` and `options.build` (7.3.5); the deploy gate in
step 0 of consumer `scripts/deploy.sh` (7.4, A15); `transparent` for the healthy mappings (7.3.4, A14); the change
of `gen_boiler.py` (7.3.7), then a regenerated `docs/diagrams/boiler-enclosure.drawio`; `"editable": true` by hand
in `dashboards/Home & IoT/wb-enclosures.json` (A16).

P2 acceptance:

1. The generator tests: a sheet gives classes and cell attributes `bind`/`key`/`at`; no `bind_*` attribute remains;
   the `at` audit passes on all panels.
2. `pull`: one snapshot for the two panels of one dashboard; 401, 403, 5xx and malformed XML stop with no file; 404
   prints "first deployment"; the token is not in the output. Against the deployed build (7.3.5, Fable M2): when
   `HEAD` holds a newer build that is not deployed, `pull` reads the base of `options.build` and writes the delta;
   a changed `options.config` or target prints a warning and does not stop; a build id that is not in the
   repository stops with "not in this repository"; `--base <commit>` then reads the base of that commit. No build
   id (7.3.5, N1): a panel with `version: 3` and no `options.build` gives a file with no cells; a panel with
   `version: 4` and no `options.build`, which has edited attributes, stops with a non-zero exit, and the existing
   `.cells.yml` keeps the same bytes; with `--base <commit>` the same panel gives the delta with the edited
   attributes.
3. Merge: a file value on a cell that the topology does not set is kept; an equal value is quiet; a different
   topology value and a `null` against a value exit non-zero and print both values; `--accept-topology` lets the
   topology win; an orphan cell exits non-zero; two panels with equal cell ids keep their own values; a kept `bind`
   to a missing class stops the run; a second build with no change gives the same bytes. Repeat pulls (Astra R3), in
   a test repository with a fake Grafana: the base lacks `key`; the author sets `key=demo-key`; pull, build, commit
   and deploy; a second pull with no new edit still writes `key=demo-key`; the next build keeps it. Then the author
   removes `key` in Grafana; the next pull writes no `key`, and the next build has none.
4. Order: the exported SVG has the merged `data-meta-*` values, and the hash covers them.
5. Each of the 10 panels loads with no `schema` and no `unknown-ref` report entry.
6. net-l2-dm and boiler-enclosure: compared with the P0 record at the same frames, each cell has the same severity
   and each link half the same colour and percent. A normal cell keeps its drawn colour, as in v3, because its
   healthy mapping is `transparent` (A14). A list in the change set names each other expected difference.
7. Each options object is smaller than in v3 (the table in section 1.1).
8. Rollout: the panel release note names the first version that reads v4, and the 10 dashboards are regenerated in
   the same change set as that release.
9. The deploy gate (7.4, A15): each row of the gate table of 7.4 has a test; `scripts/deploy.sh` step 0 runs it
   before it copies a file; a missing token stops the deploy; a provisioning that increments the dashboard version
   with no cell edit passes. N1: a `version: 4` panel with no `options.build` stops the deploy, no file is copied,
   and `.cells.yml` keeps the same bytes; the same run with `DRAWIOMAP_PULL_BASE` set to the commit of the deployed
   build passes when the delta equals the file.
10. boiler-enclosure (7.3.7): the regenerated source `.drawio` has the same cell ids as the committed one; its bound
    cells carry the `bind`, `key` and `port` of 8.2; the bindings of 8.2 give no `missing-attr` entry.

### P3: the editor (panel)

Work: section 5; the new popup entry, the two "Edit bindings" buttons and the new `history.ts` (5.0, 5.1, 6.2);
the P3 column of 6.5; README and acceptance docs.

P3 acceptance:

1. Unit: the path at an offset for a key, a value, a blank line, an incomplete `query:`, a parse error; a duplicate
   key and an alias give a `yaml` entry; the cell set of each path kind of 5.3; a row of a base class lights the cells
   of each child class; a link-only class has a `match` badge from `up`.
2. Unit: `setCellAttrs` changes the XML and the SVG, keeps the other attributes and `data-meta-label`, wraps a bare
   `mxCell` and keeps its `source`, `target` and `parent`, refuses a compressed page, a duplicate id and a parser
   error, and is stable when run twice.
3. Unit: `sanitizeSvg(setCellAttrs(d).svg)` keeps the new `data-meta-*` attributes, and a second `sanitizeSvg` gives
   the same text.
4. Unit: the completion items at each place of 5.6, with the quoting of 5.6; two providers in two models do not mix.
5. E2E: the cursor in a class highlights its cells and zooms to them; the cursor in a row shows the counts, red for 0.
6. E2E: a click on a cell opens the inspector and moves the cursor to its class; on an edge, "key is at the target"
   sets `at=target` and the halves swap.
7. E2E: multi-select 3 cells, assign a class, Apply, reload: the 3 cells keep `bind` and their own `key`. The stored
   XML has the `<object id label bind key>` wrapper around a formerly bare `<mxCell>`. Open draw.io, save with no
   change: the attributes stay.
8. E2E: a schema error shows a marker on its line and the report entry; invalid YAML keeps the last valid diagram and
   turns Apply off; Escape with a dirty draft asks to discard; a save in another tab gives the conflict banner; Apply
   writes config and diagram together; Ctrl+Z in the code box and on the stage undo their own changes.
9. E2E on Grafana 12.4 and 13.2 (`matrix`): the code box loads, completion opens above the modal (no clipping in
   `PluginDialog`), the cursor events fire. `split-editor` is in `MATRIX_SPECS` (6.5), so `npm run e2e:matrix` runs
   it on both versions.
10. Pilot (8.2, Astra R9): on boiler-enclosure, the author binds the 24 V supply block (a bare `<mxCell>`) with
    `bind=controller` and `key=node-ctl-a`, Apply, saves; `pull` writes the two attributes; a build keeps them; the
    provisioned dashboard shows the supply with the controller status after a reload. Then the author changes the
    `key` of one relay chip; `pull` writes it; the next build exits non-zero and prints both values;
    `--accept-topology` gives the chip its source value again.
11. Screenshot of the split view, checked by eye (CLAUDE.md "layout change").
12. Isolation (Astra round 2, section (3)): the Monaco test of acceptance 9 (load, completion, cursor events) passes
    on the isolation services `grafana13-csp` and `grafana13-sandbox-csp` (`docker-compose.yaml:49-65`, ports 3133
    and 3143). The table "Isolation variants" of `docs/acceptance.md:54-70` gets the result.
13. Phone: at the viewport of `tests/phone-sheet.spec.ts` (iPhone 13), the split view opens; the code box, the
    diagram and the report are each reachable with no horizontal scroll of the page; the focus starts in the code
    box and stays in the dialog through Tab and Shift+Tab; Escape closes the dialog. A screenshot, checked by eye.

## 10. Questions and risks

### 10.1 Questions now closed

Round 1: Q1 → A1. Q2 → A8. Q3 → A5. Q4 → A2. Q5 → A4. Q6 → A12. Q7 → A9. Q8, Q11, Q13, Q14, Q15 → A13. Q9 → A10.
Q10 → A11. Q12 → A7.

Revision 2: O1 → A16 (7.3.8). O2 → A15 (7.4). O3 → A14 (3.4, 7.3.4).

Revision 4: O4 → A17 (3.3). `${name:format}` with a Grafana variable format is a dashboard variable, so a
multi-value variable works in a URL (`${job:queryparam}` gives `var-job=a&var-job=b`). `${name}` with no format
stays a required cell attribute (A5), and bare `$var` stays a dashboard variable. A17 is the coordinator default; the
owner can override it.

### 10.2 Open questions

None.

### 10.3 Risks

- **Performance.** A regex matcher runs per cell and per series. 300 cells × 1000 series is 300 000 tests per
  refresh. Mitigation: equality first through the label-tuple map; one compiled regex per resolved text; the bench of
  P1 acceptance 16 against the P0 number.
- **Silent wrong joins.** A matcher that is too wide takes the series of another cell. Mitigation: the `many-series`
  entry, the rule that a block reads the cell (2.4), and the counts in the editor.
- **Writes into the SVG.** The editor changes the stored SVG without a draw.io export. The sanitiser must keep the
  new `data-meta-*` attributes, and its output must stay idempotent (CODING_STANDARDS). P3 acceptance 3 covers it.
- **Grafana 13 Monaco.** The Monaco version can change between Grafana 12.4 and 13. P3 acceptance 9 runs the editor
  on both.
- **YAML flow style.** See the note in 2.3. The writer uses block style for `match`, and a parse error points to the
  matcher.
- **Cell ids of mode B.** The cell ids of `gen_boiler.py` come from a counter. A change of the drawing order changes
  them, and the merge reports orphans (7.3.6). The author then re-binds or accepts the loss.
- **No migration.** Each v3 dashboard binds nothing until it is regenerated (D22). P1 and P2 ship together (A11, P2
  acceptance 8).
- **A UI save during the deploy.** The gate of 7.4 runs before the copy. A save between the gate and the copy is
  lost. The window is the time of the copy; the author does not edit while a deploy runs.
- **`options.build` and Grafana.** `pull` needs the key that the build wrote. If a Grafana version drops an unknown
  option key on a save, the panel still has `version: 4`, so `pull` and the deploy gate stop with "no build id;
  pass --base" (7.3.5, N1). They replace no `.cells.yml` and deploy nothing, so no edit is lost silently. P1
  acceptance 14 checks the save on the supported versions.
- **Two copies of the XML in mode A.** `base.drawio` and `diagram.drawio` are both in the repository. They differ
  only by the delta of `.cells.yml`.

## Appendix A. Deferred minor findings

| Finding | Why deferred | Where it goes |
|---|---|---|
| Fable b.9 (freshness `3x` on a 1 m step) | No change needed: 3.5 step 4 uses the target step. | — |
| Astra 23, rollout: rollback artefacts | A rollback is the previous panel release plus the previous dashboards from git; P2 acceptance 8 pins the pair. A rollback drill is not in v1. | release checklist |
| Astra 23, generator: multi-page policy | v4 binds page 1 only (5.5), as the panel renders page 1 only. A second page stays unbound. | README |
| Astra 17, completion replacement ranges beyond quoting | The P3 plan gives the exact Monaco ranges; 5.6 fixes the quoting rule. | P3 plan |

The phone check and the sandbox and CSP smoke of the split editor are no longer deferred: P3 acceptance 12 and 13
(Astra review round 2, section (3)).
