import { formattedValueToString, type Field, type PanelData } from '@grafana/data';
import type { MatchV4, RowV4 } from '../model/v4';
import type { validateConfig } from '../model/validate';
import { reduceAcross } from '../query/reduce';
import { equalityKey, indexSeries } from '../query/seriesIndex';
import type { QuerySnapshot, Series } from '../query/snapshot';
import type { BindContext, CellIndex, CellMeta, HalfState, SeriesInfo, StatusV4Fields } from '../types';
import { capacityV4, type LinkCapacity } from './capacity';
import { effectiveClass, type ResolvedClass } from './classes';
import { noDataColor } from './color';
import { endContextOf, type EndContext } from './edgeEnds';
import {
  createIdentity,
  endCap,
  identityNames,
  isEndFree,
  usePlan as planUses,
  type AttrOrigin,
  type MeasuredEnd,
} from './identity';
import { halfState } from './engine';
import { cadenceOf, freshnessMs, staleCheck, type FreshnessPatch } from './freshness';
import { linkFeeds } from './linkFeeds';
import { createRegexCache, parseMatchBlock, resolveBlock, type ParseResult, type ResolvedMatcher } from './matcher';
import type { ReportEntry, UsePath } from './report';
import type { StatusView } from './status';
import { NO_DATA_TEXT, statusOfUse, type StatusV4 } from './statusV4';
import { directionHistory, isInstant, shownField, snapshotV4 } from './rowData';
import { resolveTemplateV4, type TemplateScopeV4 } from './template';
import { defaultReduce } from './units';
import { fieldPath, LINK_FIELDS, listUses, type Use } from './uses';
import { resolveTitleV4, resolveUrlV4 } from '../interact/links';

/**
 * One row of the card of a cell, in the order of the rows of its effective class. A `metadata` row holds its
 * resolved text and a `drilldown` row its resolved URL; a row whose template does not resolve is not in the list
 * (spec 3.3). A query row holds only its path: its series are in `series` under the path of its use.
 */
export interface RowSlotV4 {
  path: UsePath;
  kind: RowV4['kind'];
  label?: string;
  text?: string;
  url?: string;
}

/**
 * The patch of a bound cell. `statusV4` is the status of the status use and `staleStatusV4` the status after the
 * deadline of a relative range (spec 3.5): the stale pass (`useStaleStatusV4`) applies it. `statusView` carries the
 * same status for the painter, the band and the legend (`statusViewOf`).
 */
export interface PatchV4 extends FreshnessPatch<StatusV4> {
  rowsV4?: RowSlotV4[];
}

export interface BindInputV4 {
  index: CellIndex;
  /** the draw.io XML of the diagram; the ends of an ordinary edge come from it (spec 3.8.1) */
  xml?: string;
  validated: ReturnType<typeof validateConfig>;
  data: PanelData;
  ctx: BindContext;
}

export interface BindResultV4 {
  patches: Map<string, PatchV4>;
  /** cell id → the uses of the cell (spec 3.2 step 4) */
  uses: Map<string, Use[]>;
  /** cell id → use path → the series that the use selects for the cell, in the order of spec 3.7 */
  series: Map<string, Map<UsePath, Series[]>>;
  /** class name → the ids of the cells whose `bind` names it, in the order of the index (spec 3.2 step 3), also a cell with an invalid override */
  cells: Map<string, string[]>;
  /** cell id → the YAML path of the `match` of the cell after its override; no entry for a cell that does not bind */
  matchOrigins: Map<string, string>;
  /** cell id → each name that the bind read from another cell, with the cell that gave it (spec I26) */
  inherited: Map<string, Map<string, AttrOrigin>>;
  /** Bound edge id to the capacity of each geometric direction, with the cell that gave an attribute (I25). */
  capacity: Map<string, { a2b: LinkCapacity; b2a: LinkCapacity }>;
  /** Bound edge id to its measured end, including unmeasured links (I26). */
  measured: Map<string, MeasuredEnd>;
  /** Cell id to each use path and its resolved matchers or problem (I26). */
  resolved: Map<string, Map<UsePath, { matchers: ResolvedMatcher[] } | { problem: string; detail?: string }>>;
  report: ReportEntry[];
  /** the sorted unique moments after which a status turns stale; the clock reads again after each */
  deadlines: number[];
}

/** The reason of the cells that cannot bind (spec 2.5 step 4). */
export const INVALID_BINDING = 'Binding is not valid';
/** The most label sets of one `orphan-series` entry (spec 4). */
const ORPHAN_CAP = 50;

const NO_TARGET: QuerySnapshot = { state: 'empty', fetchedAt: 0, fromCache: false };

/** The status of the painter, the band and the legend from a v4 status. */
export function statusViewOf(status: StatusV4): StatusView & StatusV4Fields {
  const { state, severity, color, text, refId, reason, value } = status;
  return {
    state,
    reason: reason ?? '',
    queryIds: refId ? [refId] : [],
    conditionKey: JSON.stringify([refId || null, state, severity, color ?? null, text ?? null, reason ?? null]),
    coverage: { available: state === 'missing' ? 0 : 1, expected: 1 },
    severity,
    color,
    text,
    refId,
    ...(value === undefined ? {} : { value }),
  };
}

const missingStatus = (reason: string, refId = ''): StatusV4 => ({
  state: 'missing',
  severity: 'missing',
  text: NO_DATA_TEXT,
  refId,
  reason,
});

const staleOf = (status: StatusV4): StatusV4 => ({
  state: 'stale',
  severity: 'stale',
  text: status.text,
  refId: status.refId,
  reason: 'Sample is stale',
});

type CellsEntry = Extract<ReportEntry, { cellIds: string[] }>;
type CellsFree = CellsEntry extends infer E ? (E extends CellsEntry ? Omit<E, 'cellIds'> : never) : never;

/** The report of one bind: each entry once, the cells of an entry merged in the order of the cells. */
class Report {
  readonly entries: ReportEntry[];
  private readonly byKey = new Map<string, ReportEntry>();
  /** the cells of each entry that has cells: the check for a repeat is O(1) */
  private readonly cellsOf = new Map<ReportEntry, Set<string>>();

  constructor(first: ReportEntry[]) {
    this.entries = [...first];
  }

  once(entry: ReportEntry): void {
    const key = JSON.stringify(entry);
    if (!this.byKey.has(key)) {
      this.byKey.set(key, entry);
      this.entries.push(entry);
    }
  }

  cell(entry: CellsFree, cellId: string): void {
    const key = JSON.stringify(entry);
    let found = this.byKey.get(key) as CellsEntry | undefined;
    if (!found) {
      found = { ...entry, cellIds: [] } as CellsEntry;
      this.byKey.set(key, found);
      this.entries.push(found);
      this.cellsOf.set(found, new Set());
    }
    const seen = this.cellsOf.get(found)!;
    if (!seen.has(cellId)) {
      seen.add(cellId);
      found.cellIds.push(cellId);
    }
  }

  manySeries(cls: string, use: UsePath, id: string, count: number): void {
    const key = JSON.stringify(['many-series', cls, use]);
    let found = this.byKey.get(key) as Extract<ReportEntry, { kind: 'many-series' }> | undefined;
    if (!found) {
      found = { kind: 'many-series', cls, use, cells: [] };
      this.byKey.set(key, found);
      this.entries.push(found);
    }
    found.cells.push({ id, count });
  }
}

/** The series of one refId, read once per bind. */
interface Query {
  snapshot: QuerySnapshot;
  series: Series[];
  /** the series that at least one cell selects */
  selected: Set<Series>;
  /** the cadence of the refId, found on first use: without a request step it scans every sample of every series */
  cadence?: { ms: number | undefined };
}

/** A match block of one refId, parsed once per bind, with its label-tuple map built on first use. */
interface Block {
  parsed: ParseResult;
  /** the labels of the `=` matchers (bare ones included), sorted; empty when the block has none */
  names: string[];
  tuples?: Map<string, Series[]>;
}

/**
 * What one use selects for one cell: the series, or why it selects none (`problem`) with the report entry of each
 * use that shares the selection. A block that does not parse has its `schema` entry from validateConfig already.
 */
interface Selection {
  series: Series[];
  resolved?: ResolvedMatcher[];
  problem?: { reason: string; detail?: string; entry?: (cls: string, path: UsePath) => CellsFree };
}

/** The result of one use for one cell. */
interface UseResult {
  snapshot: QuerySnapshot;
  series: Series[];
  /** set when the binding of the use is not usable for the cell: an unknown refId, a missing attribute, a bad regex */
  problem?: string;
  /** set when the series have units that do not convert (spec 3.7) */
  mixed?: boolean;
}

function seriesInfo(series: Series, field: Field = series.field): SeriesInfo {
  return {
    refId: series.refId,
    name: field.name,
    labels: series.labels,
    field,
    values: series.values.filter((v): v is number => v !== null),
    times: series.times.filter((_, i) => series.values[i] !== null),
    frame: { length: series.times.length, fields: [field] },
  };
}

/**
 * A use that expects one series (the table of spec 3.7), with the `reduce` that declares N series as expected:
 * the text, a `value` or `updown` row or chart, a link direction and a capacity. Undefined for the status and a
 * `history` row or chart.
 */
function expectsOne(use: Use, eff: ResolvedClass): { reduce?: string } | undefined {
  switch (use.kind) {
    case 'status':
      return undefined;
    case 'text':
      return { reduce: eff.text?.reduce };
    case 'up':
    case 'down':
    case 'capacity':
      return {};
    default:
      return use.row?.kind === 'value' || use.row?.kind === 'updown' ? { reduce: use.row.reduce } : undefined;
  }
}

/**
 * The v4 bind (spec 3.2 steps 3–12, 3.6–3.8, 4). It groups the cells by `bind`, lists the uses of each cell from its
 * effective class, selects the series of each use, and gives the patches, the series of each use, the match report
 * and the stale deadlines. The clock is not an input: `useStaleStatusV4` applies the deadlines. The cells of an
 * invalid class, of an unknown class, of an abstract class and the cell of an invalid override are unavailable.
 */
export function bindV4(input: BindInputV4): BindResultV4 {
  const { index, data, ctx } = input;
  const { parsed, classes } = input.validated;
  const report = new Report(input.validated.report);
  const out: BindResultV4 = {
    patches: new Map(),
    uses: new Map(),
    series: new Map(),
    cells: new Map(),
    matchOrigins: new Map(),
    inherited: new Map(),
    measured: new Map(),
    capacity: new Map(),
    resolved: new Map(),
    report: [],
    deadlines: [],
  };
  const config = parsed.config;
  if (!config) {
    out.report = report.entries;
    return out;
  }
  const deadlines = new Set<number>();
  const regexCache = createRegexCache();
  const targets = data.request ? new Set(data.request.targets.map((t) => t.refId)) : undefined;
  const queries = new Map<string, Query>();
  const blocks = new Map<string, Block>();
  let endContext: EndContext | undefined;

  /** The ends and owners, read on the first cell that lacks an own attribute or reads `${from.…}`/`${to.…}` (spec 7.2). */
  const ends = (): EndContext => {
    if (!endContext) {
      const found = endContextOf(input.xml, index);
      found.report.forEach((entry) => report.once(entry));
      endContext = found;
    }
    return endContext;
  };
  const identity = createIdentity(ends);
  out.inherited = identity.inherited;
  const attrOf = identity.attr;

  const query = (refId: string): Query => {
    let found = queries.get(refId);
    if (found) {
      return found;
    }
    const snapshot = snapshotV4(data, refId);
    found = { snapshot, series: [], selected: new Set() };
    if (snapshot.state === 'error' || snapshot.state === 'unsupported') {
      const errors = data.errors ?? [];
      const error = errors.find((e) => e.refId === refId) ?? errors.find((e) => !e.refId);
      const message = error?.message ?? snapshot.message;
      report.once({ kind: 'query-unavailable', refId, state: 'error', message });
    } else if (snapshot.state === 'loading' || snapshot.state === 'idle') {
      report.once({ kind: 'query-unavailable', refId, state: 'loading', message: 'Loading data' });
    } else if (snapshot.state === 'ready') {
      const indexed = indexSeries(snapshot.frames, refId);
      found.series = indexed.series;
      indexed.report.forEach((entry) => report.once(entry));
    }
    queries.set(refId, found);
    return found;
  };

  const cadenceOfQuery = (refId: string, q: Query): number | undefined => {
    q.cadence ??= { ms: cadenceOf(refId, data.request, q.series) };
    return q.cadence.ms;
  };

  const blockOf = (use: Use): Block => {
    const key = JSON.stringify([use.refId, use.match]);
    let block = blocks.get(key);
    if (!block) {
      const parsedBlock = parseMatchBlock(use.match, use.path);
      const names = parsedBlock.ok
        ? [...new Set(parsedBlock.block.matchers.filter((m) => m.op === '=').map((m) => m.label))].sort()
        : [];
      block = { parsed: parsedBlock, names };
      blocks.set(key, block);
    }
    return block;
  };

  /** Spec 2.4 steps 4–8 for one cell: the label-tuple map first when the block has `=` matchers, then the test. */
  const select = (use: Use, meta: CellMeta, q: Query): Selection => {
    const block = blockOf(use);
    if (!block.parsed.ok) {
      return { series: [], problem: { reason: INVALID_BINDING } };
    }
    const resolved = resolveBlock(block.parsed.block, attrOf(meta), regexCache);
    if (!resolved.ok) {
      if (resolved.kind === 'missing-attr') {
        const attr = resolved.attr;
        return {
          series: [],
          problem: {
            reason: `Missing attribute ${attr}`,
            entry: (cls, path) => ({ kind: 'missing-attr', cls, path, attr }),
          },
        };
      }
      const { text, message } = resolved;
      return {
        series: [],
        problem: {
          reason: 'Matcher error',
          detail: message,
          entry: (cls, path) => ({ kind: 'matcher-error', cls, path, text, message }),
        },
      };
    }
    let candidates = q.series;
    if (block.names.length && resolved.equality) {
      if (!block.tuples) {
        block.tuples = new Map();
        for (const s of q.series) {
          const key = equalityKey(s.labels, block.names);
          const same = block.tuples.get(key);
          if (same) {
            same.push(s);
          } else {
            block.tuples.set(key, [s]);
          }
        }
      }
      candidates = block.tuples.get(JSON.stringify(block.names.map((n) => resolved.equality!.get(n) ?? ''))) ?? [];
    }
    const series = candidates.filter((s) => resolved.test(s.labels));
    series.forEach((s) => q.selected.add(s));
    return { series, resolved: resolved.resolved };
  };

  const unavailable = (meta: CellMeta, reason: string) => {
    const status = missingStatus(reason);
    out.patches.set(meta.id, {
      cellId: meta.id,
      scope: { cell: meta.attrs },
      urls: [],
      unavailable: { reason, color: noDataColor(ctx.theme) },
      statusV4: status,
      statusView: statusViewOf(status),
    });
  };

  // 3.2 step 3: group the cells by `bind`. A cell with an invalid override does not bind, but its class has a cell.
  const cellsOf = new Map<string, CellMeta[]>();
  const withCells = new Set<string>();
  for (const { meta } of index.values()) {
    const bind = meta.attrs.bind;
    if (bind !== undefined) {
      // A cell uses each ancestor, but belongs directly to the class that its `bind` names.
      for (const name of classes.get(bind)?.chain ?? [bind]) {
        withCells.add(name);
      }
      if (classes.has(bind)) {
        const ids = out.cells.get(bind);
        if (ids) {
          ids.push(meta.id);
        } else {
          out.cells.set(bind, [meta.id]);
        }
      }
    }
    if (parsed.invalidOverrides.has(meta.id)) {
      unavailable(meta, INVALID_BINDING);
    } else if (bind === undefined) {
      continue;
    } else if (classes.has(bind)) {
      const same = cellsOf.get(bind);
      if (same) {
        same.push(meta);
      } else {
        cellsOf.set(bind, [meta]);
      }
    } else if (parsed.invalidClasses.has(bind)) {
      unavailable(meta, INVALID_BINDING);
    } else {
      report.cell({ kind: 'unknown-class', bind }, meta.id);
      unavailable(meta, 'Unknown class');
    }
  }
  for (const cellId of [...Object.keys(config.overrides), ...parsed.invalidOverrides.keys()]) {
    if (!index.has(cellId)) {
      report.once({ kind: 'unknown-override', cellId });
    }
  }
  for (const [name, cls] of classes) {
    if (!cls.abstract && !withCells.has(name)) {
      report.once({ kind: 'class-no-cells', cls: name });
    }
  }

  for (const [name, cells] of cellsOf) {
    for (const meta of cells) {
      const eff = effectiveClass(classes.get(name)!, config.overrides[meta.id], meta.id);
      if (eff.abstract) {
        report.cell({ kind: 'class-no-match', cls: name }, meta.id);
        unavailable(meta, 'The class has no match');
        continue;
      }
      if (!meta.isEdge) {
        for (const field of LINK_FIELDS) {
          if (eff[field] !== undefined) {
            report.cell({ kind: 'unused-field', cls: name, field }, meta.id);
          }
        }
      }
      out.matchOrigins.set(meta.id, eff.origins.match);
      bindCell(meta, eff);
    }
  }

  function bindCell(meta: CellMeta, eff: ResolvedClass): void {
    const cls = eff.name;
    let uses = listUses(meta, eff);
    const required = new Map<MatchV4, readonly string[]>();
    let end: MeasuredEnd | undefined;
    if (meta.isEdge) {
      for (const use of uses) {
        const parsed = blockOf(use).parsed;
        required.set(use.match, parsed.ok ? parsed.block.requiredAttrs : []);
      }
      const needs = identityNames(meta, [...required.values()]);
      end = identity.measure(meta, needs);
      out.measured.set(meta.id, end);
      uses = listUses(meta, eff, planUses(meta, required, end));
      if (end.end === 'none') {
        report.cell({ kind: 'unmeasured-link', cls, attrs: needs }, meta.id);
      }
    }
    const byPath = new Map<UsePath, Series[]>();
    const results = new Map<UsePath, UseResult>();
    const selections = new Map<string, Selection>();
    out.uses.set(meta.id, uses);
    out.series.set(meta.id, byPath);
    const resolved: NonNullable<ReturnType<typeof out.resolved.get>> = new Map();
    out.resolved.set(meta.id, resolved);

    for (const use of uses) {
      const unknown = targets && !targets.has(use.refId);
      const q = unknown ? { snapshot: NO_TARGET, series: [], selected: new Set<Series>() } : query(use.refId);
      const key = JSON.stringify([use.refId, use.match]);
      let selection = selections.get(key);
      if (!selection) {
        selection = select(use, meta, q);
        selections.set(key, selection);
      }
      resolved.set(
        use.path,
        selection.problem
          ? {
              problem: selection.problem.reason,
              ...(selection.problem.detail ? { detail: selection.problem.detail } : {}),
            }
          : { matchers: selection.resolved! }
      );
      let result: UseResult;
      if (unknown) {
        report.once({ kind: 'unknown-ref', cls, path: use.path, refId: use.refId });
        result = { snapshot: NO_TARGET, series: [], problem: 'Unknown query' };
      } else {
        const problem = selection.problem;
        result = { snapshot: q.snapshot, series: selection.series, problem: problem?.reason };
        if (problem?.entry) {
          report.cell(problem.entry(cls, use.path), meta.id);
        } else if (!problem && (q.snapshot.state === 'ready' || q.snapshot.state === 'empty')) {
          checkCount(use, eff, meta.id, result);
        }
      }
      byPath.set(use.path, result.series);
      results.set(use.path, result);
    }

    if (end?.reason === 'both') {
      const dependent = uses.filter((use) => !isEndFree(meta, required.get(use.match)!));
      if (
        dependent.length &&
        dependent.every((use) => {
          const result = results.get(use.path)!;
          return (
            !result.problem &&
            (result.snapshot.state === 'ready' || result.snapshot.state === 'empty') &&
            !result.series.length
          );
        })
      ) {
        report.cell({ kind: 'end-ambiguous', cls }, meta.id);
      }
    }

    // An updown chart shares one numeric scale across both uses.
    for (const use of uses.filter((u) => u.row?.kind === 'updown' && u.path.endsWith('.a2b'))) {
      const partner = results.get(use.path.replace(/\.a2b$/, '.b2a'));
      const first = results.get(use.path)!;
      if (!partner || first.problem || partner.problem || !first.series.length || !partner.series.length) {
        continue;
      }
      const units = reduceAcross([...first.series, ...partner.series], 'sum');
      if ('mismatch' in units) {
        report.cell(
          { kind: 'unit-mismatch', cls, use: use.path.replace(/\.a2b$/, ''), units: units.mismatch },
          meta.id
        );
      }
    }

    const patch: PatchV4 = { cellId: meta.id, scope: { cell: meta.attrs }, urls: [] };
    const statusUse = uses.find((u) => u.kind === 'status');
    let status: StatusV4 | undefined;
    if (statusUse) {
      const r = results.get(statusUse.path)!;
      status = r.problem
        ? missingStatus(r.problem, statusUse.refId)
        : statusOfUse(r.snapshot, r.series, {
            refId: statusUse.refId,
            missing: eff.missing ?? 'nodata',
            theme: ctx.theme,
          });
    }
    const scope: TemplateScopeV4 = {
      attr: attrOf(meta),
      from: (n) => attrOf(meta)(`from.${n}`),
      to: (n) => attrOf(meta)(`to.${n}`),
    };
    const statusSeries = statusUse ? results.get(statusUse.path)!.series : [];
    if (statusSeries.length === 1) {
      scope.labels = statusSeries[0].labels;
      if (status && status.reason === undefined) {
        scope.value = status.text;
      }
    }
    if (statusUse && status) {
      patch.statusV4 = freshness(status, statusUse, results.get(statusUse.path)!, eff, patch);
      patch.statusView = statusViewOf(patch.statusV4);
    }
    const textUse = uses.find((u) => u.kind === 'text');
    if (textUse && eff.text) {
      patch.shape = textShape(results.get(textUse.path)!, eff.text);
    }
    if (meta.isEdge && uses.some(needsCapacity)) {
      capacityOfEdge(meta, eff, uses, results, end);
    }
    if (meta.isEdge && uses.some((use) => use.kind === 'up' || use.kind === 'down')) {
      patch.link = linkHalves(meta, eff, uses, results);
    }
    templates(meta, eff, scope, patch, uses, end?.end === 'none' ? end.needs : []);
    if (end?.end === 'none' && !uses.length && !patch.urls.length && !patch.rowsV4?.length) {
      return;
    }
    out.patches.set(meta.id, patch);
  }

  /** `no-series`, `many-series` and `unit-mismatch` of one use of a ready query (spec 3.7, 4). */
  function checkCount(use: Use, eff: ResolvedClass, cellId: string, result: UseResult): void {
    const cls = eff.name;
    const count = result.series.length;
    if (count === 0) {
      report.cell({ kind: 'no-series', cls, use: use.path }, cellId);
      return;
    }
    if (count > 1 && use.kind !== 'status' && use.kind !== 'capacity') {
      const units = reduceAcross(result.series, 'sum');
      if ('mismatch' in units) {
        result.mixed = true;
        report.cell({ kind: 'unit-mismatch', cls, use: use.path, units: units.mismatch }, cellId);
      }
    }
    const one = expectsOne(use, eff);
    if (count > 1 && one && one.reduce === undefined) {
      report.manySeries(cls, use.path, cellId, count);
    }
  }

  /**
   * Spec 3.5: the stale state of the status use; a relative range gives a deadline to the clock. A ready selection
   * with partial coverage still checks its finite samples: stale ranks above missing (3.4). Series with no finite
   * value give no age, so an all-null selection stays missing.
   */
  function freshness(status: StatusV4, use: Use, r: UseResult, eff: ResolvedClass, patch: PatchV4): StatusV4 {
    if (r.problem || r.snapshot.state !== 'ready') {
      return status;
    }
    const q = query(use.refId);
    const check = staleCheck(r.series, {
      timeRange: data.timeRange,
      request: data.request,
      freshnessMs: freshnessMs(eff.freshness ?? config!.freshness, cadenceOfQuery(use.refId, q)),
      instant: isInstant(data, use.refId),
    });
    if (check.reason !== undefined) {
      return missingStatus(check.reason, use.refId);
    }
    if (check.stale) {
      return staleOf(status);
    }
    if (check.deadline !== undefined) {
      patch.staleStatusV4 = { after: check.deadline, status: staleOf(status) };
      deadlines.add(check.deadline);
    }
    return status;
  }

  /** The value on the cell (D10): the reduce across the series, formatted with the display of the first series. */
  function textShape(r: UseResult, text: NonNullable<ResolvedClass['text']>): PatchV4['shape'] {
    const nodata = {
      status: 'nodata' as const,
      color: noDataColor(ctx.theme),
      target: 'none' as const,
      stepIndex: -1,
      text: NO_DATA_TEXT,
    };
    if (r.problem || r.mixed || r.snapshot.state !== 'ready' || !r.series.length) {
      return nodata;
    }
    const first = r.series[0];
    const reduced = reduceAcross(r.series, text.reduce ?? defaultReduce(first.field.config.unit));
    if ('mismatch' in reduced || reduced.value === null) {
      return nodata;
    }
    const display = ctx.display(seriesInfo(first, shownField(first.field, text)), reduced.value);
    return {
      status: 'ok',
      color: display.color ?? '',
      target: 'none',
      stepIndex: -1,
      text: formattedValueToString(display),
      value: reduced.value,
      display,
    };
  }

  /** A use that reads the capacity of a link: a half, a `capacity` query, an `updown` row or chart. */
  function needsCapacity(use: Use): boolean {
    return use.kind === 'up' || use.kind === 'down' || use.kind === 'capacity' || use.row?.kind === 'updown';
  }

  /**
   * I25: the capacity of each geometric direction of one link, once for each bound edge. The `capacity` refIds come
   * from the `capacity` uses in the list of the edge: a dropped use is "no query". The end cell is read lazily.
   */
  function capacityOfEdge(
    meta: CellMeta,
    eff: ResolvedClass,
    uses: Use[],
    results: Map<UsePath, UseResult>,
    end: MeasuredEnd | undefined
  ): void {
    const capacityUses = uses.filter((u) => u.kind === 'capacity');
    const refIdOf = (suffix: string) => capacityUses.find((u) => u.path.endsWith(suffix))?.refId;
    const capacityQuery = !capacityUses.length
      ? undefined
      : typeof eff.capacity === 'string'
        ? capacityUses[0].refId
        : { a2b: refIdOf('.a2b')!, b2a: refIdOf('.b2a')! };
    const speedSeries = (refId: string) => {
      const use = capacityUses.find((u) => u.refId === refId);
      const r = use ? results.get(use.path)! : undefined;
      return r && !r.problem ? { snapshot: r.snapshot, series: r.series } : { snapshot: NO_TARGET, series: [] };
    };
    const measuredAt = end?.end === 'source' || end?.end === 'target' ? end.end : undefined;
    const capacity = capacityV4({
      capacity: capacityQuery,
      cap: meta.attrs.cap,
      capacityAttr: meta.attrs.capacity,
      series: speedSeries,
      cls: eff.name,
      cellId: meta.id,
      end:
        end && measuredAt
          ? () => {
              const found = endCap(meta, end, ends());
              return found && { ...found, at: measuredAt };
            }
          : undefined,
    });
    for (const entry of capacity.report) {
      const { cellIds, ...rest } = entry as CellsEntry;
      cellIds.forEach((id) => report.cell(rest as CellsFree, id));
    }
    out.capacity.set(meta.id, { a2b: capacity.a2b, b2a: capacity.b2a });
  }

  /** Spec 3.8: the feed of each half (`linkFeeds`), its capacity (`BindResultV4.capacity`) and its state (`halfState`). */
  function linkHalves(
    meta: CellMeta,
    eff: ResolvedClass,
    uses: Use[],
    results: Map<UsePath, UseResult>
  ): PatchV4['link'] {
    const capacity = out.capacity.get(meta.id)!;
    const link: NonNullable<PatchV4['link']> = { labelMode: eff.linkLabel ?? 'none', arrow: eff.arrow ?? 'point' };
    for (const dir of ['a2b', 'b2a'] as const) {
      const use = uses.find(
        (u) => (u.kind === 'up' || u.kind === 'down') && linkFeeds(u.end, 'up', 'down')[dir] === u.kind
      );
      if (!use) {
        continue;
      }
      link[dir] = half(results.get(use.path)!, use.refId, capacity[dir]);
    }
    return link;
  }

  function half(r: UseResult, refId: string, cap: LinkCapacity): HalfState {
    if (r.problem || r.mixed) {
      return {
        status: 'unbound',
        color: noDataColor(ctx.theme),
        width: ctx.linkWidth.min,
        label: 'unavailable',
        stepIndex: -1,
      };
    }
    return halfState(directionHistory(r), refId, cap, ctx).state;
  }

  /**
   * The templates of a cell (spec 3.3): the URL and its title, the `metadata` and `drilldown` rows. A template that
   * reads an attribute the cell lacks gives `missing-attr`; `${labels.x}` or `${value}` with no single status series
   * gives `template-unresolved`. Such an item is not shown.
   */
  function templates(
    meta: CellMeta,
    eff: ResolvedClass,
    scope: TemplateScopeV4,
    patch: PatchV4,
    uses: Use[],
    quiet: string[]
  ): void {
    const cls = eff.name;
    const resolves = (text: string, path: string): boolean => {
      const r = resolveTemplateV4(text, scope);
      r.missing
        .filter((attr) => !quiet.includes(attr))
        .forEach((attr) => report.cell({ kind: 'missing-attr', cls, path, attr }, meta.id));
      if (r.unresolved.length) {
        report.cell({ kind: 'template-unresolved', cls, path }, meta.id);
      }
      return !r.missing.length && !r.unresolved.length;
    };
    const title = (text: string | undefined, path: string): string | null | undefined =>
      text === undefined ? undefined : resolves(text, path) ? resolveTitleV4(text, scope, ctx.replaceVariables) : null;
    const url = (text: string, path: string): string | null =>
      resolves(text, path) ? resolveUrlV4(text, scope, ctx.replaceVariables) : null;
    if (eff.url !== undefined) {
      const href = url(eff.url, fieldPath(eff, 'url'));
      const label = title(eff.urlTitle, fieldPath(eff, 'urlTitle'));
      if (href !== null) {
        patch.urls.push(typeof label === 'string' ? { url: href, title: label } : { url: href });
      }
    }
    patch.rowsV4 = eff.rows.flatMap((row): RowSlotV4[] => {
      const path = row.origin;
      if (row.kind === 'metadata') {
        return resolves(row.text, `${path}.text`)
          ? [{ path, kind: row.kind, label: row.label, text: resolveTemplateV4(row.text, scope).text }]
          : [];
      }
      if (row.kind === 'drilldown') {
        const label = title(row.label, `${path}.label`);
        const href = url(row.url, `${path}.url`);
        if (href === null || label === null) {
          return [];
        }
        return [label === undefined ? { path, kind: row.kind, url: href } : { path, kind: row.kind, label, url: href }];
      }
      return uses.some((use) => use.path === path || use.path === `${path}.a2b`) ? [{ path, kind: row.kind }] : [];
    });
  }

  for (const [refId, q] of queries) {
    const orphans = q.series.filter((s) => !q.selected.has(s));
    if (orphans.length) {
      report.once({
        kind: 'orphan-series',
        refId,
        labels: orphans.slice(0, ORPHAN_CAP).map((s) => s.labels),
        more: Math.max(0, orphans.length - ORPHAN_CAP),
      });
    }
  }
  out.report = report.entries;
  out.deadlines = [...deadlines].sort((a, b) => a - b);
  return out;
}
