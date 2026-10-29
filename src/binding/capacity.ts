import type { Field } from '@grafana/data';
import type { QuerySnapshot, Series } from '../query/snapshot';
import type { ReportEntry } from './report';
import { toBitsPerSecond } from './units';

/** A value in the unit of its field, in bit/s. A unit that is not a data rate keeps the raw value and gives a note. */
export function bitsWithNote(value: number, unit: string | undefined): { bits: number; note?: string } {
  const rate = toBitsPerSecond(value, unit);
  return rate.unknownUnit
    ? { bits: rate.bits, note: `unit "${rate.unknownUnit}" is not a data rate, the raw value is used as bit/s` }
    : { bits: rate.bits };
}

/** The amount of a capacity in the unit of `field`: for the text and for the chart range ("max": "capacity"). */
export function inFieldUnit(amount: number, field: Field | undefined): number {
  return amount / toBitsPerSecond(1, field?.config?.unit).bits;
}

// ---- the capacity of a link (spec 3.8.4, D15, A4) ----

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
