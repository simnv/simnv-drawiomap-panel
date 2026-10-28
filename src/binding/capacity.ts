import type { Field } from '@grafana/data';
import type { CapacitySource, TemplateScope } from '../types';
import type { CapacitySources, Diagnostic, QueryBinding } from '../model/config';
import type { HistoryModel } from '../query/frames';
import type { QuerySnapshot, Series } from '../query/snapshot';
import type { ReportEntry } from './report';
import { resolveTemplate } from './template';
import { toBitsPerSecond } from './units';

/** A value in the unit of its field, in bit/s. A unit that is not a data rate keeps the raw value and gives a note. */
export function bitsWithNote(value: number, unit: string | undefined): { bits: number; note?: string } {
  const rate = toBitsPerSecond(value, unit);
  return rate.unknownUnit
    ? { bits: rate.bits, note: `unit "${rate.unknownUnit}" is not a data rate, the raw value is used as bit/s` }
    : { bits: rate.bits };
}

/**
 * The one resolution of a capacity: a link direction and a card direction both use it. The chain stops at the first
 * source that gives an amount; a source that fails reports where and the chain continues.
 */
export interface CapacityRequest {
  /** the sources of the direction: `link.a2b`, `hover.rows[2].series[1]` */
  own?: CapacitySources;
  ownPath: string;
  /** the sources shared by both directions: `link`, `hover.rows[2]` */
  shared?: CapacitySources;
  sharedPath: string;
  /** how a bare number is read: 'canonical' at a link place (bit/s), 'field' at a row place (the unit of the values) */
  numberUnit: 'canonical' | 'field';
  scope: TemplateScope;
  /** the value field of this direction when its model is ready: the unit, the Max */
  field?: Field;
  /**
   * Reads a capacity series. Undefined when the binding is not usable for this cell (not in `cell.bindings`). The
   * reader reports its own metric problems (no match, an error): this module reports only what it decides itself.
   */
  read: (binding: QueryBinding, path: string) => HistoryModel | undefined;
}

export type CapacityDiagnostic = Pick<Diagnostic, 'code' | 'message'> & { path: string };

export interface ResolvedCapacity {
  /** the amount in the canonical unit of `field` (bit/s for a data rate, the raw unit otherwise); undefined: no capacity */
  amount?: number;
  source: CapacitySource;
  /** paths relative to the display, for example `link.a2b.capacity` */
  diagnostics: CapacityDiagnostic[];
}

/** The amount of a capacity in the unit of `field`: for the text and for the chart range ("max": "capacity"). */
export function inFieldUnit(amount: number, field: Field | undefined): number {
  return amount / toBitsPerSecond(1, field?.config?.unit).bits;
}

export function resolveCapacity(req: CapacityRequest): ResolvedCapacity {
  const diagnostics: CapacityDiagnostic[] = [];
  const unit = req.field?.config?.unit;
  const fail = (code: string, path: string, message: string) => {
    diagnostics.push({ code, path, message });
    return undefined;
  };
  const fromBinding = (binding: QueryBinding | undefined, path: string): number | undefined => {
    if (!binding) {
      return undefined;
    }
    const model = req.read(binding, path);
    if (model === undefined || model.state !== 'ready' || model.latestValue === undefined) {
      // not usable for the cell (the plan reported why at `<path>.queryId`) or not ready: no amount; a metric
      // problem is the reader's report
      return undefined;
    }
    if (!(model.latestValue > 0)) {
      return fail('unresolved-metadata', path, `Capacity series value ${model.latestValue} is not positive.`);
    }
    const rate = bitsWithNote(model.latestValue, model.field.config?.unit);
    if (rate.note) {
      diagnostics.push({ code: 'unit-not-rate', path, message: rate.note });
    }
    return rate.bits;
  };
  const fromValue = (
    value: CapacitySources['capacity'],
    path: string
  ): { amount: number; source: CapacitySource } | undefined => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === 'number') {
      // the schema admits positive numbers only; a number is bit/s at a link place, the unit of the values at a row place
      const amount = req.numberUnit === 'field' ? toBitsPerSecond(value, unit).bits : value;
      return amount > 0 ? { amount, source: 'number' } : undefined;
    }
    const r = resolveTemplate(value, req.scope);
    if (r.unresolved.length) {
      fail('unresolved-metadata', path, `Capacity is not usable: unresolved ${[...new Set(r.unresolved)].join(', ')}`);
      return undefined;
    }
    const n = r.text.trim() === '' ? NaN : Number(r.text);
    if (!Number.isFinite(n) || n <= 0) {
      fail('unresolved-metadata', path, `Capacity "${r.text}" is not a positive number of bit/s.`);
      return undefined;
    }
    return { amount: n, source: 'attr' };
  };
  for (const [sources, path] of [
    [req.own, req.ownPath],
    [req.shared, req.sharedPath],
  ] as const) {
    const amount = fromBinding(sources?.capacityBinding, `${path}.capacityBinding`);
    if (amount !== undefined) {
      return { amount, source: 'series', diagnostics };
    }
    const value = fromValue(sources?.capacity, `${path}.capacity`);
    if (value) {
      return { ...value, diagnostics };
    }
  }
  // the last source: the Max of the field config (a standard option, also by override), in the field unit
  const max = req.field?.config?.max;
  if (typeof max === 'number' && max > 0) {
    return { amount: toBitsPerSecond(max, unit).bits, source: 'fieldMax', diagnostics };
  }
  return { source: 'none', diagnostics };
}

// ---- v4 (spec 3.8.4, D15, A4) ----

export interface CapacityV4Input {
  /** the `capacity` of the class: one refId for both directions, or one for each geometric direction */
  capacity?: string | { a2b: string; b2a: string };
  /** the cell attribute `cap`: `1G`, or `50M/10M` for a→b/b→a */
  cap?: string;
  /** the snapshot of a refId and its series that the class match selects for the cell */
  series: (refId: string) => { snapshot: QuerySnapshot; series: Series[] };
  /** the class and the cells of the report entries */
  cls?: string;
  cellIds?: string[];
}

/** One value of `cap`: SI and decimal (3.8.4). */
const CAP_VALUE = /^(\d+(?:\.\d+)?)([kKMGT]?)$/;
const CAP_PREFIX: Record<string, number> = { '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };

/** `cap=1G` or `cap=50M/10M` in bit/s, or undefined when a value does not parse or is not a finite number above 0. */
function parseCap(cap: string): { a2b: number; b2a: number } | undefined {
  const parts = cap.split('/');
  if (parts.length > 2) {
    return undefined;
  }
  const bits = parts.map((part) => {
    const m = CAP_VALUE.exec(part);
    const value = m ? Number(m[1]) * CAP_PREFIX[m[2]] : NaN;
    return Number.isFinite(value) && value > 0 ? value : undefined;
  });
  if (bits.some((value) => value === undefined)) {
    return undefined;
  }
  return { a2b: bits[0]!, b2a: bits[bits.length - 1]! };
}

/**
 * The capacity of a speed refId in bit/s, or the reason why it falls through. The panel uses the speed only when the
 * snapshot is ready and exactly one series gives a finite value above 0 in a data-rate unit (no unit is bit/s). A
 * snapshot that loads falls through with no reason, as in `resolveCapacity`.
 */
function speedOf(result: { snapshot: QuerySnapshot; series: Series[] }): { bits: number } | { reason?: string } {
  const { snapshot, series } = result;
  if (snapshot.state === 'error' || snapshot.state === 'unsupported') {
    return { reason: 'query failed' };
  }
  if (snapshot.state === 'idle' || snapshot.state === 'loading') {
    return {};
  }
  if (snapshot.state === 'empty' || series.length === 0) {
    return { reason: 'no series' };
  }
  if (series.length > 1) {
    return { reason: 'many series' };
  }
  const { values } = series[0];
  let i = values.length - 1;
  while (i >= 0 && values[i] === null) {
    i--;
  }
  const value = values[i];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { reason: 'not finite' };
  }
  if (!(value > 0)) {
    return { reason: 'not positive' };
  }
  const rate = toBitsPerSecond(value, series[0].field.config?.unit);
  return rate.unknownUnit === undefined ? { bits: rate.bits } : { reason: 'not a rate' };
}

/**
 * The v4 capacity of a link, per geometric direction (spec 3.8.4): the `capacity` refId of the class, else the cell
 * attribute `cap`, else none (the half shows the raw rate and no percent). A speed that falls through gives
 * `capacity-fallback` with the reason; a `cap` that does not parse gives `bad-cap`. The capacities follow the geometry:
 * `at=target` changes only the feeds (`linkFeeds`), not this result (A4).
 */
export function capacityV4(input: CapacityV4Input): { a2b?: number; b2a?: number; report: ReportEntry[] } {
  const report: ReportEntry[] = [];
  const cls = input.cls ?? '';
  const cellIds = input.cellIds ?? [];
  const refs = typeof input.capacity === 'string' ? { a2b: input.capacity, b2a: input.capacity } : input.capacity;
  const speeds = new Map<string, number | undefined>();
  const speed = (refId: string | undefined): number | undefined => {
    if (refId === undefined) {
      return undefined;
    }
    if (!speeds.has(refId)) {
      const r = speedOf(input.series(refId));
      if ('reason' in r && r.reason !== undefined) {
        report.push({ kind: 'capacity-fallback', cls, reason: r.reason, cellIds });
      }
      speeds.set(refId, 'bits' in r ? r.bits : undefined);
    }
    return speeds.get(refId);
  };
  const cap = input.cap === undefined ? undefined : parseCap(input.cap);
  if (input.cap !== undefined && cap === undefined) {
    report.push({ kind: 'bad-cap', value: input.cap, cellIds });
  }
  return { a2b: speed(refs?.a2b) ?? cap?.a2b, b2a: speed(refs?.b2a) ?? cap?.b2a, report };
}
