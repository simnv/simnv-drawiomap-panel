import type { Field } from '@grafana/data';
import type { CapacitySource, TemplateScope } from '../types';
import type { CapacitySources, Diagnostic, QueryBinding } from '../model/config';
import type { HistoryModel } from '../query/frames';
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
