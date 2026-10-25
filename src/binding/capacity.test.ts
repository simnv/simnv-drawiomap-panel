import { describe, expect, it } from 'vitest';
import { FieldType, type Field } from '@grafana/data';
import type { TemplateScope } from '../types';
import type { QueryBinding } from '../model/config';
import type { HistoryModel } from '../query/frames';
import { inFieldUnit, resolveCapacity, type CapacityRequest } from './capacity';

const binding = (queryId: string): QueryBinding => ({ queryId, match: {}, reducer: 'last' });
const field = (unit?: string, max?: number): Field =>
  ({
    name: 'Value',
    type: FieldType.number,
    config: { ...(unit ? { unit } : {}), ...(max ? { max } : {}) },
    values: [],
  }) as Field;
const series = (latestValue: number | undefined, unit?: string): HistoryModel => ({
  state: 'ready',
  field: field(unit) as Field<number | null>,
  timeField: { name: 'Time', type: FieldType.time, config: {}, values: [] } as Field<number>,
  timestamps: [],
  values: [],
  latestValue,
  fetchedAt: 0,
  fromCache: false,
});
const scope: TemplateScope = { cell: { capacity_bps: '100000000', speed: 'fast', zero: '0' } };
const base = (over: Partial<CapacityRequest> = {}): CapacityRequest => ({
  ownPath: 'link.a2b',
  sharedPath: 'link',
  numberUnit: 'canonical',
  scope,
  read: () => undefined,
  ...over,
});
const readers = (models: Record<string, HistoryModel | undefined>) => (b: QueryBinding) => models[b.queryId];

describe('resolveCapacity: the chain', () => {
  it('own binding, own value, shared binding, shared value, field Max, none: in this order', () => {
    const read = readers({ own: series(1e9, 'bps'), shared: series(2e9, 'bps') });
    const all = base({
      own: { capacityBinding: binding('own'), capacity: 3e9 },
      shared: { capacityBinding: binding('shared'), capacity: 4e9 },
      field: field('bps', 5e9),
      read,
    });
    expect(resolveCapacity(all)).toMatchObject({ amount: 1e9, source: 'series', diagnostics: [] });
    expect(resolveCapacity({ ...all, own: { capacity: 3e9 } })).toMatchObject({ amount: 3e9, source: 'number' });
    expect(resolveCapacity({ ...all, own: undefined })).toMatchObject({ amount: 2e9, source: 'series' });
    expect(resolveCapacity({ ...all, own: undefined, shared: { capacity: 4e9 } })).toMatchObject({
      amount: 4e9,
      source: 'number',
    });
    expect(resolveCapacity({ ...all, own: undefined, shared: undefined })).toMatchObject({
      amount: 5e9,
      source: 'fieldMax',
    });
    expect(resolveCapacity({ ...all, own: undefined, shared: undefined, field: field('bps') })).toEqual({
      source: 'none',
      diagnostics: [],
    });
  });
  it('a template resolves against the scope, in bit/s, as source attr', () => {
    expect(resolveCapacity(base({ own: { capacity: '${cell.capacity_bps}' } }))).toMatchObject({
      amount: 1e8,
      source: 'attr',
      diagnostics: [],
    });
  });
  it('a failed own template falls to the shared value, with a diagnostic at the own path', () => {
    const result = resolveCapacity(base({ own: { capacity: '${cell.missing}' }, shared: { capacity: 7e8 } }));
    expect(result).toMatchObject({ amount: 7e8, source: 'number' });
    expect(result.diagnostics).toEqual([
      { code: 'unresolved-metadata', path: 'link.a2b.capacity', message: expect.stringContaining('cell.missing') },
    ]);
  });
  it('a failed shared template falls to the field Max, with a diagnostic at the shared path', () => {
    const result = resolveCapacity(base({ shared: { capacity: '${cell.speed}' }, field: field('bps', 1e9) }));
    expect(result).toMatchObject({ amount: 1e9, source: 'fieldMax' });
    expect(result.diagnostics).toEqual([
      { code: 'unresolved-metadata', path: 'link.capacity', message: expect.stringContaining('"fast"') },
    ]);
  });
  it('a template that gives zero is not a capacity', () => {
    const result = resolveCapacity(base({ own: { capacity: '${cell.zero}' } }));
    expect(result.source).toBe('none');
    expect(result.diagnostics[0]).toMatchObject({ code: 'unresolved-metadata', path: 'link.a2b.capacity' });
  });
  it('a field Max that is not positive is no capacity', () => {
    expect(resolveCapacity(base({ field: field('bps', -1) })).source).toBe('none');
  });
});

describe('resolveCapacity: series', () => {
  it('a series in Bps gives bits × 8', () => {
    const read = readers({ s: series(125e6, 'Bps') });
    expect(resolveCapacity(base({ own: { capacityBinding: binding('s') }, read }))).toMatchObject({
      amount: 1e9,
      source: 'series',
    });
  });
  it('a series value that is not positive fails with its path and the chain continues', () => {
    const read = readers({ s: series(0, 'bps') });
    const result = resolveCapacity(base({ own: { capacityBinding: binding('s') }, shared: { capacity: 5 }, read }));
    expect(result).toMatchObject({ amount: 5, source: 'number' });
    expect(result.diagnostics).toEqual([
      { code: 'unresolved-metadata', path: 'link.a2b.capacityBinding', message: expect.stringContaining('positive') },
    ]);
  });
  it('a series that is not usable for the cell gives nothing and no diagnostic (the plan reported why); the chain continues', () => {
    const result = resolveCapacity(base({ own: { capacityBinding: binding('s') }, shared: { capacity: 5 } }));
    expect(result).toEqual({ amount: 5, source: 'number', diagnostics: [] });
  });
  it('a series that is loading or has no value gives nothing and no diagnostic; the caller reports the metric', () => {
    const loading = readers({ s: { state: 'loading' } });
    expect(resolveCapacity(base({ own: { capacityBinding: binding('s') }, read: loading }))).toEqual({
      source: 'none',
      diagnostics: [],
    });
    const empty = readers({ s: { state: 'empty', fetchedAt: 0, fromCache: false } });
    expect(resolveCapacity(base({ own: { capacityBinding: binding('s') }, read: empty })).source).toBe('none');
    const noValue = readers({ s: series(undefined, 'bps') });
    expect(resolveCapacity(base({ own: { capacityBinding: binding('s') }, read: noValue })).source).toBe('none');
  });
  it('a series in a unit that is not a data rate uses the raw value and adds unit-not-rate', () => {
    const read = readers({ s: series(4.1, 'm3') });
    const result = resolveCapacity(base({ own: { capacityBinding: binding('s') }, read }));
    expect(result).toMatchObject({ amount: 4.1, source: 'series' });
    expect(result.diagnostics).toEqual([
      { code: 'unit-not-rate', path: 'link.a2b.capacityBinding', message: expect.stringContaining('"m3"') },
    ]);
  });
});

describe('resolveCapacity: the unit of a number', () => {
  it("numberUnit 'field' reads a number in the unit of the field: 50 of 100 Bps is 50 %", () => {
    const result = resolveCapacity(base({ own: { capacity: 100 }, numberUnit: 'field', field: field('Bps') }));
    expect(result).toMatchObject({ amount: 800, source: 'number' });
    expect(inFieldUnit(result.amount!, field('Bps'))).toBe(100);
  });
  it("numberUnit 'canonical' reads a number as bit/s whatever the field unit", () => {
    expect(resolveCapacity(base({ own: { capacity: 100 }, field: field('Bps') }))).toMatchObject({
      amount: 100,
      source: 'number',
    });
  });
  it("numberUnit 'field' without a field keeps the number", () => {
    expect(resolveCapacity(base({ own: { capacity: 100 }, numberUnit: 'field' })).amount).toBe(100);
  });
  it('a field Max is read in the unit of the field at every place', () => {
    expect(resolveCapacity(base({ numberUnit: 'field', field: field('Bps', 125) })).amount).toBe(1000);
  });
});

describe('inFieldUnit', () => {
  it.each([
    ['bps', 1e8, 1e8],
    ['Bps', 1e9, 125e6],
    ['Mbits', 1e8, 100],
    [undefined, 1e8, 1e8],
    ['m3', 4.1, 4.1],
  ])('unit %s: %d in the canonical unit is %d in the field unit', (unit, amount, expected) => {
    expect(inFieldUnit(amount, field(unit))).toBeCloseTo(expected);
  });
  it('without a field the amount is as it is', () => {
    expect(inFieldUnit(42, undefined)).toBe(42);
  });
});
