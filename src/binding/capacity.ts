import type { Field } from '@grafana/data';
import type { QuerySnapshot, Series } from '../query/snapshot';
import type { CapacitySource } from '../types';
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
  /** the cell attribute `capacity`: the name of the portograph contract, same grammar as `cap`; `cap` wins */
  capacityAttr?: string;
  /** the snapshot of a refId and its series that the class match selects for the cell */
  series: (refId: string) => { snapshot: QuerySnapshot; series: Series[] };
  /** the class of the report entries */
  cls?: string;
  /** the link: the cell of its entries and of `LinkCapacity.cellId` */
  cellId?: string;
  /**
   * The measured end cell with its own `cap` and `capacity` and the end of the link (I14). The function runs only
   * when the link has neither `cap` nor `capacity` and a direction has no value from the `capacity` query.
   * `at` is the measured end: `cap=50M/10M` on the end cell is transmit/receive (I15).
   */
  end?: () => EndCapacity | undefined;
}

export interface EndCapacity {
  cellId: string;
  cap?: string;
  capacity?: string;
  at: 'source' | 'target';
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

/** The capacity of one direction of a link in bit/s and where it comes from. */
export interface LinkCapacity {
  amount?: number;
  source: CapacitySource;
  /** the cell that gave an attribute capacity: the link or its measured end cell */
  cellId?: string;
}

/** The attribute pair `cap` / `capacity` of one cell (stage 1a): the value, and the entries for the cell. */
function attrPair(
  cap: string | undefined,
  alt: string | undefined,
  cellId: string | undefined,
  entries: ReportEntry[]
) {
  const cellIds = cellId === undefined ? [] : [cellId];
  const parsedCap = cap === undefined ? undefined : parseCap(cap);
  const parsedAlt = alt === undefined ? undefined : parseCap(alt);
  // `cap` wins. An explicit `cap` that does not parse stays visible: it does not fall through to `capacity`.
  if (cap !== undefined && parsedCap === undefined) {
    entries.push({ kind: 'bad-cap', attr: 'cap', value: cap, cellIds });
  } else if (cap !== undefined && alt !== undefined) {
    if (parsedAlt?.a2b !== parsedCap?.a2b || parsedAlt?.b2a !== parsedCap?.b2a) {
      entries.push({ kind: 'cap-conflict', cap, capacity: alt, cellIds });
    }
  } else if (alt !== undefined && parsedAlt === undefined) {
    entries.push({ kind: 'bad-cap', attr: 'capacity', value: alt, cellIds });
  }
  return cap !== undefined ? parsedCap : parsedAlt;
}

/**
 * The v4 capacity of a link, per geometric direction (spec 3.8.4, I14): for each direction the first of the
 * `capacity` refId of the class, the cell attribute `cap`, the cell attribute `capacity`, the same two attributes of
 * the measured end cell, else none (the half shows the raw rate and no percent). The one place of this chain: the
 * bind computes it once for each link, the halves and the card read it from `BindResultV4.capacity`. A speed that
 * falls through gives `capacity-fallback` with the reason; a `cap` (or a `capacity` when `cap` is absent) that does not
 * parse gives `bad-cap` and does not fall through to the end; two attributes with different values give
 * `cap-conflict`. The entries of the link name the link, those of the end cell name the end cell. The capacities
 * follow the geometry: `at=target` changes only the feeds (`linkFeeds`), not this result (A4); an end pair maps
 * transmit/receive to a→b/b→a with the end (I15).
 */
export function capacityV4(input: CapacityV4Input): {
  a2b: LinkCapacity;
  b2a: LinkCapacity;
  report: ReportEntry[];
} {
  const report: ReportEntry[] = [];
  const cls = input.cls ?? '';
  const cellIds = input.cellId === undefined ? [] : [input.cellId];
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
  const bySpeed = { a2b: speed(refs?.a2b), b2a: speed(refs?.b2a) };
  const attr = attrPair(input.cap, input.capacityAttr, input.cellId, report);
  const linkHasAttr = input.cap !== undefined || input.capacityAttr !== undefined;
  // The end is read once, and only when a direction has nothing from the query and the link has no attribute.
  let end: { cellId: string; pair?: { a2b: number; b2a: number } } | undefined;
  if (!linkHasAttr && input.end && (bySpeed.a2b === undefined || bySpeed.b2a === undefined)) {
    const found = input.end();
    if (found) {
      const pair = attrPair(found.cap, found.capacity, found.cellId, report);
      // On an end cell the pair is transmit/receive; measured at the target, a→b is the receive value.
      end = {
        cellId: found.cellId,
        pair: pair && (found.at === 'target' ? { a2b: pair.b2a, b2a: pair.a2b } : pair),
      };
    }
  }
  const of = (dir: 'a2b' | 'b2a'): LinkCapacity => {
    if (bySpeed[dir] !== undefined) {
      return { amount: bySpeed[dir], source: 'series' };
    }
    if (attr) {
      return { amount: attr[dir], source: 'attr', ...(input.cellId === undefined ? {} : { cellId: input.cellId }) };
    }
    return end?.pair ? { amount: end.pair[dir], source: 'attr', cellId: end.cellId } : { source: 'none' };
  };
  return { a2b: of('a2b'), b2a: of('b2a'), report };
}
