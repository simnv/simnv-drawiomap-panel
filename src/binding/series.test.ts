import { describe, expect, it } from 'vitest';
import { FieldType, toDataFrame } from '@grafana/data';
import { extractSeries, findSeries } from './series';

const frames = [
  toDataFrame({
    refId: 'A',
    fields: [
      { name: 'Time', type: FieldType.time, values: [1, 2, 3] },
      {
        name: 'Value',
        type: FieldType.number,
        values: [10, 20, 30],
        labels: { job: 'node-rtr-a', device: 'wan1' },
      },
    ],
  }),
  toDataFrame({
    refId: 'A',
    fields: [
      { name: 'Time', type: FieldType.time, values: [1, 2, 3] },
      { name: 'Value', type: FieldType.number, values: [1, 2, 3], labels: { job: 'node-wan1', device: 'pppoe' } },
    ],
  }),
  toDataFrame({
    refId: 'C',
    fields: [
      { name: 'Time', type: FieldType.time, values: [1] },
      { name: 'Value', type: FieldType.number, values: [0], labels: { job: 'node-lte' } },
    ],
  }),
];

describe('extractSeries', () => {
  it('yields one SeriesInfo per numeric field with labels, values and times', () => {
    const s = extractSeries(frames);
    expect(s).toHaveLength(3);
    expect(s[0].refId).toBe('A');
    expect(s[0].labels).toEqual({ job: 'node-rtr-a', device: 'wan1' });
    expect(s[0].values).toEqual([10, 20, 30]);
    expect(s[0].times).toEqual([1, 2, 3]);
    expect(s[0].name).toContain('node-rtr-a');
  });
});

describe('findSeries', () => {
  const s = extractSeries(frames);
  const scope = { cell: {}, from: { node: 'wan1', port: 'pppoe' }, to: { node: 'rtr-a', port: 'wan1' } };
  it('matches refId plus resolved label templates', () => {
    const r = findSeries({ refId: 'A', match: { job: 'node-${to.node}', device: '${to.port}' } }, s, scope);
    expect(r.series?.labels.device).toBe('wan1');
    expect(r.unresolved).toEqual([]);
  });
  it('supports regex label matchers and name matcher', () => {
    expect(findSeries({ match: { job: '/^node-op/' } }, s, scope).series?.labels.job).toBe('node-wan1');
    expect(findSeries({ name: '/node-lte/' }, s, scope).series?.refId).toBe('C');
  });
  it('returns unresolved when a template cannot resolve', () => {
    const r = findSeries({ refId: 'A', match: { job: 'node-${cell.pg-id}' } }, s, scope);
    expect(r.series).toBeUndefined();
    expect(r.unresolved).toEqual(['cell.pg-id']);
  });
  it('returns no series when nothing matches', () => {
    expect(findSeries({ refId: 'Z' }, s, scope).series).toBeUndefined();
  });
});
