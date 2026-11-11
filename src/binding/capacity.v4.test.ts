import { describe, expect, it } from 'vitest';
import { FieldType, type Field } from '@grafana/data';
import type { QuerySnapshot, Series } from '../query/snapshot';
import { capacityV4, type CapacityV4Input, type EndCapacity } from './capacity';
import { linkFeeds } from './linkFeeds';

const READY: QuerySnapshot = { state: 'ready', frames: [], fetchedAt: 0, fromCache: false };
const speed = (values: Array<number | null>, unit: string | undefined = 'bps', refId = 'S'): Series => ({
  refId,
  labels: { ifname: 'eth0' },
  field: { name: 'Value', type: FieldType.number, config: unit ? { unit } : {}, values } as Field,
  frameIndex: 0,
  fieldIndex: 1,
  times: values.map((_, i) => i * 1000),
  values,
});
type Result = ReturnType<CapacityV4Input['series']>;
const ready = (...series: Series[]): Result => ({ snapshot: READY, series });
const queries =
  (by: Record<string, Result>): CapacityV4Input['series'] =>
  (refId) =>
    by[refId] ?? { snapshot: { state: 'empty', fetchedAt: 0, fromCache: false }, series: [] };
const input = (over: Partial<CapacityV4Input>): CapacityV4Input => ({
  series: queries({}),
  cls: 'uplink',
  cellId: 'e1',
  ...over,
});
/** The amounts of the chain, in the shape of the report. */
const chain = (i: CapacityV4Input) => {
  const r = capacityV4(i);
  return { a2b: r.a2b.amount, b2a: r.b2a.amount, report: r.report };
};
const fallback = (reason: string) => ({ kind: 'capacity-fallback', cls: 'uplink', reason, cellIds: ['e1'] });

describe('capacityV4: the chain of spec 3.8.4', () => {
  it('gives the source of each direction: series, then attr, then none (M1)', () => {
    const r = capacityV4(
      input({ capacity: { a2b: 'A', b2a: 'B' }, cap: '50M', series: queries({ A: ready(speed([1e9])) }) })
    );
    expect([r.a2b, r.b2a]).toEqual([
      { amount: 1e9, source: 'series' },
      { amount: 50e6, source: 'attr', cellId: 'e1' },
    ]);
    expect(capacityV4(input({})).a2b).toEqual({ source: 'none' });
  });

  it('one capacity refId gives both directions, in bit/s through the field unit', () => {
    const r = chain(input({ capacity: 'S', series: queries({ S: ready(speed([1000], 'Mbits')) }) }));
    expect(r).toEqual({ a2b: 1e9, b2a: 1e9, report: [] });
  });

  it('{a2b, b2a} gives one refId for each direction', () => {
    const r = chain(
      input({
        capacity: { a2b: 'A', b2a: 'B' },
        series: queries({ A: ready(speed([50e6])), B: ready(speed([10], 'Mbits')) }),
      })
    );
    expect(r).toEqual({ a2b: 50e6, b2a: 10e6, report: [] });
  });

  it('the capacity refId wins over cap', () => {
    const r = chain(input({ capacity: 'S', cap: '10M', series: queries({ S: ready(speed([1e9])) }) }));
    expect(r).toEqual({ a2b: 1e9, b2a: 1e9, report: [] });
  });

  it('cap=1G gives 10^9 bit/s for both directions', () => {
    expect(chain(input({ cap: '1G' }))).toEqual({ a2b: 1e9, b2a: 1e9, report: [] });
  });

  it('cap=50M/10M gives 50 Mbit/s a→b and 10 Mbit/s b→a', () => {
    expect(chain(input({ cap: '50M/10M' }))).toEqual({ a2b: 50e6, b2a: 10e6, report: [] });
  });

  it('reads the SI prefixes k, K, M, G and T and a decimal fraction', () => {
    expect(chain(input({ cap: '1.5k/2K' }))).toMatchObject({ a2b: 1500, b2a: 2000 });
    expect(chain(input({ cap: '2.5G/1T' }))).toMatchObject({ a2b: 2.5e9, b2a: 1e12 });
    expect(chain(input({ cap: '100' }))).toMatchObject({ a2b: 100, b2a: 100 });
  });

  it('no source gives no capacity and no entry', () => {
    expect(chain(input({}))).toEqual({ report: [] });
  });

  it('a direction whose refId fails falls through to cap for that direction only', () => {
    const r = chain(
      input({
        capacity: { a2b: 'A', b2a: 'B' },
        cap: '50M/10M',
        series: queries({ A: ready(speed([1e9])) }),
      })
    );
    expect(r).toEqual({ a2b: 1e9, b2a: 10e6, report: [fallback('no series')] });
  });
});

describe('capacityV4: a speed that falls through gives capacity-fallback with the reason', () => {
  const cases: Array<[string, Result, string]> = [
    ['a speed of 0', ready(speed([0])), 'not positive'],
    ['a negative speed', ready(speed([-1e9])), 'not positive'],
    ['two speed series', ready(speed([1e9]), speed([1e9])), 'many series'],
    ['a failed speed query', { snapshot: { state: 'error', message: 'timeout' }, series: [] }, 'query failed'],
    [
      'an unsupported speed query',
      { snapshot: { state: 'unsupported', message: 'no time' }, series: [] },
      'query failed',
    ],
    ['an empty speed query', { snapshot: { state: 'empty', fetchedAt: 0, fromCache: false }, series: [] }, 'no series'],
    ['a ready query with no series', ready(), 'no series'],
    ['a speed with only nulls', ready(speed([null, null])), 'not finite'],
    ['an infinite speed', ready(speed([Infinity])), 'not finite'],
    ['a speed in a unit that is not a data rate', ready(speed([5], 'percent')), 'not a rate'],
    ['a speed in packets per second', ready(speed([5], 'pps')), 'not a rate'],
  ];
  it.each(cases)('%s', (_, result, reason) => {
    const r = chain(input({ capacity: 'S', cap: '1G', series: queries({ S: result }) }));
    expect(r).toEqual({ a2b: 1e9, b2a: 1e9, report: [fallback(reason)] });
  });

  it('one refId for both directions gives one entry', () => {
    const r = chain(input({ capacity: 'S', series: queries({ S: ready(speed([0])) }) }));
    expect(r).toEqual({ report: [fallback('not positive')] });
  });

  it('reads the last non-null value of the speed series', () => {
    const r = chain(input({ capacity: 'S', series: queries({ S: ready(speed([1e6, 1e9, null])) }) }));
    expect(r).toEqual({ a2b: 1e9, b2a: 1e9, report: [] });
  });

  it('a speed with no unit is bit/s', () => {
    const r = chain(input({ capacity: 'S', series: queries({ S: ready(speed([1e9], undefined)) }) }));
    expect(r).toEqual({ a2b: 1e9, b2a: 1e9, report: [] });
  });

  it('a speed query that loads falls through with no entry', () => {
    const r = chain(
      input({ capacity: 'S', cap: '1G', series: queries({ S: { snapshot: { state: 'loading' }, series: [] } }) })
    );
    expect(r).toEqual({ a2b: 1e9, b2a: 1e9, report: [] });
  });
});

describe('capacityV4: bad-cap', () => {
  it.each(['abc', '1e9', '-1G', '0', '0.0M', '1G/', '/1G', '1G/2G/3G', '1 G', '1g', '1Gi', ''])(
    'cap=%j gives bad-cap and no capacity',
    (cap) => {
      expect(chain(input({ cap }))).toEqual({
        report: [{ kind: 'bad-cap', attr: 'cap', value: cap, cellIds: ['e1'] }],
      });
    }
  );

  it('cap=abc gives bad-cap also when the capacity refId gives a value', () => {
    const r = chain(input({ capacity: 'S', cap: 'abc', series: queries({ S: ready(speed([1e9])) }) }));
    expect(r).toEqual({
      a2b: 1e9,
      b2a: 1e9,
      report: [{ kind: 'bad-cap', attr: 'cap', value: 'abc', cellIds: ['e1'] }],
    });
  });

  it('a value too large to be finite gives bad-cap', () => {
    const cap = `${'9'.repeat(400)}T`;
    expect(chain(input({ cap }))).toEqual({ report: [{ kind: 'bad-cap', attr: 'cap', value: cap, cellIds: ['e1'] }] });
  });
});

describe('capacityV4 with at=target (A4)', () => {
  it('cap=50M/10M, at=target, rx 8 Mbit/s: a→b shows 8 Mbit/s and 16 %', () => {
    const feeds = linkFeeds('target', 'TX', 'RX');
    const rates: Record<string, number> = { TX: 2e6, RX: 8e6 };
    const cap = chain(input({ cap: '50M/10M' }));
    expect(feeds.a2b).toBe('RX');
    expect(rates[feeds.a2b]).toBe(8e6);
    expect((rates[feeds.a2b] / cap.a2b!) * 100).toBeCloseTo(16);
    // the capacities follow the geometry: b→a stays 10 Mbit/s and takes tx
    expect((rates[feeds.b2a] / cap.b2a!) * 100).toBeCloseTo(20);
  });
});

describe('capacityV4: the attribute capacity (second name of cap)', () => {
  it('uses capacity when cap is absent, with the grammar of cap', () => {
    expect(chain(input({ capacityAttr: '1000000000' }))).toEqual({ a2b: 1e9, b2a: 1e9, report: [] });
    expect(chain(input({ capacityAttr: '50M/10M' }))).toEqual({ a2b: 5e7, b2a: 1e7, report: [] });
  });
  it('gives no entry when cap and capacity are equal', () => {
    expect(chain(input({ cap: '1G', capacityAttr: '1000000000' }))).toEqual({ a2b: 1e9, b2a: 1e9, report: [] });
  });
  it('cap wins and cap-conflict shows when the values differ', () => {
    expect(chain(input({ cap: '1G', capacityAttr: '2G' }))).toEqual({
      a2b: 1e9,
      b2a: 1e9,
      report: [{ kind: 'cap-conflict', cap: '1G', capacity: '2G', cellIds: ['e1'] }],
    });
  });
  it('gives cap-conflict, not bad-cap, for a capacity that does not parse next to a valid cap', () => {
    expect(chain(input({ cap: '1G', capacityAttr: 'x' })).report).toEqual([
      { kind: 'cap-conflict', cap: '1G', capacity: 'x', cellIds: ['e1'] },
    ]);
  });
  it('gives bad-cap for a capacity that does not parse when cap is absent', () => {
    expect(chain(input({ capacityAttr: 'x' }))).toEqual({
      a2b: undefined,
      b2a: undefined,
      report: [{ kind: 'bad-cap', attr: 'capacity', value: 'x', cellIds: ['e1'] }],
    });
  });
  it('does not fall through to capacity when cap does not parse', () => {
    expect(chain(input({ cap: 'x', capacityAttr: '1G' }))).toEqual({
      a2b: undefined,
      b2a: undefined,
      report: [{ kind: 'bad-cap', attr: 'cap', value: 'x', cellIds: ['e1'] }],
    });
  });
  it('lets a series win over both attributes', () => {
    const r = capacityV4(
      input({ capacity: 'S', cap: '1G', capacityAttr: '2G', series: queries({ S: ready(speed([5e9])) }) })
    );
    expect(r.a2b).toEqual({ amount: 5e9, source: 'series' });
    expect(r.report).toEqual([{ kind: 'cap-conflict', cap: '1G', capacity: '2G', cellIds: ['e1'] }]);
  });
});

describe('capacityV4: the measured end cell (I14, I15)', () => {
  const endOf =
    (over: Partial<EndCapacity> = {}) =>
    (): EndCapacity => ({ cellId: 'p1', at: 'source', ...over });
  const throws = () => {
    throw new Error('the end must not be read');
  };

  it('order: query, link cap, link capacity, end cap, end capacity, none', () => {
    const q = queries({ S: ready(speed([1e9])) });
    // 1: the query wins over the link and the end
    expect(capacityV4(input({ capacity: 'S', series: q, cap: '5M', end: throws })).a2b).toEqual({
      amount: 1e9,
      source: 'series',
    });
    // 2 and 3: the link attributes win over the end
    expect(capacityV4(input({ cap: '5M', end: throws })).a2b).toEqual({ amount: 5e6, source: 'attr', cellId: 'e1' });
    expect(capacityV4(input({ capacityAttr: '6M', end: throws })).a2b).toEqual({
      amount: 6e6,
      source: 'attr',
      cellId: 'e1',
    });
    // 4: cap of the end; 5: capacity of the end; 4 wins over 5
    expect(capacityV4(input({ end: endOf({ cap: '7M' }) })).a2b).toEqual({ amount: 7e6, source: 'attr', cellId: 'p1' });
    expect(capacityV4(input({ end: endOf({ capacity: '8M' }) })).b2a).toEqual({
      amount: 8e6,
      source: 'attr',
      cellId: 'p1',
    });
    expect(capacityV4(input({ end: endOf({ cap: '7M', capacity: '7M' }) })).a2b.amount).toBe(7e6);
    // 6: none
    expect(capacityV4(input({ end: endOf() })).a2b).toEqual({ source: 'none' });
    expect(capacityV4(input({ end: () => undefined })).a2b).toEqual({ source: 'none' });
  });

  it('cap=50M/10M on a port measured at the source: a→b is transmit; at the target: a→b is receive', () => {
    const source = capacityV4(input({ end: endOf({ cap: '50M/10M', at: 'source' }) }));
    expect([source.a2b.amount, source.b2a.amount]).toEqual([50e6, 10e6]);
    const target = capacityV4(input({ end: endOf({ cap: '50M/10M', at: 'target' }) }));
    expect([target.a2b.amount, target.b2a.amount]).toEqual([10e6, 50e6]);
  });

  it('asks for the end only when a direction has no value from the query', () => {
    const both = queries({ A: ready(speed([1e9])), B: ready(speed([2e9])) });
    expect(() => capacityV4(input({ capacity: { a2b: 'A', b2a: 'B' }, series: both, end: throws }))).not.toThrow();
    const one = capacityV4(
      input({
        capacity: { a2b: 'A', b2a: 'B' },
        series: queries({ A: ready(speed([1e9])) }),
        end: endOf({ cap: '3M' }),
      })
    );
    expect([one.a2b, one.b2a]).toEqual([
      { amount: 1e9, source: 'series' },
      { amount: 3e6, source: 'attr', cellId: 'p1' },
    ]);
  });

  it('an own cap that does not parse does not read the end', () => {
    const r = capacityV4(input({ cap: 'abc', end: throws }));
    expect(r.a2b).toEqual({ source: 'none' });
    expect(r.report).toEqual([{ kind: 'bad-cap', attr: 'cap', value: 'abc', cellIds: ['e1'] }]);
  });

  it('bad-cap and cap-conflict of the end name the end cell', () => {
    expect(capacityV4(input({ end: endOf({ cap: 'x' }) })).report).toEqual([
      { kind: 'bad-cap', attr: 'cap', value: 'x', cellIds: ['p1'] },
    ]);
    expect(capacityV4(input({ end: endOf({ capacity: 'y' }) })).report).toEqual([
      { kind: 'bad-cap', attr: 'capacity', value: 'y', cellIds: ['p1'] },
    ]);
    const conflict = capacityV4(input({ end: endOf({ cap: '1G', capacity: '2G' }) }));
    expect(conflict.a2b.amount).toBe(1e9);
    expect(conflict.report).toEqual([{ kind: 'cap-conflict', cap: '1G', capacity: '2G', cellIds: ['p1'] }]);
  });
});
