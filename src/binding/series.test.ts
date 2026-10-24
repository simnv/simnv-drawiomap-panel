import { describe, expect, it } from 'vitest';
import { FieldType, toDataFrame } from '@grafana/data';
import { extractSeries } from './series';

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
      { name: 'Value', type: FieldType.number, values: [1, 2, 3], labels: { job: 'node-isp-a', device: 'pppoe' } },
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
