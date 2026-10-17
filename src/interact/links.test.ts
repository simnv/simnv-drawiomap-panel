import { describe, expect, it, vi } from 'vitest';
import type { Field, LinkModel } from '@grafana/data';
import type { CellPatch, SeriesInfo } from '../types';
import { buildScopedVars, primaryOf, resolveLinks } from './links';

const fieldLink: LinkModel<Field> = { href: '/d/field', title: 'Field link', target: '_blank', origin: {} as Field };
const series: SeriesInfo = {
  refId: 'A',
  name: 'tx',
  labels: { job: 'node-rtr-a', device: 'wan1' },
  values: [1, 2],
  times: [1, 2],
  field: { getLinks: vi.fn(() => [fieldLink]) } as unknown as Field,
  frame: { fields: [], length: 2 },
};
const patch: CellPatch = {
  cellId: 'e1',
  ruleNames: ['links'],
  scope: { cell: { 'pg-id': 'x' }, from: { node: 'a', port: 'p' }, to: { node: 'b', port: 'q' } },
  urls: [{ title: 'links', url: '/d/iface?var-job=node-a&from=${__from}' }],
  warnings: [],
  link: {
    a2b: {
      status: 'ok',
      color: '#0f0',
      width: 2,
      label: '41',
      stepIndex: 0,
      value: 41e6,
      percent: 41,
      display: { text: '41 Mb/s', numeric: 41e6 },
      series,
    },
  },
};

describe('primaryOf', () => {
  it('prefers a2b, then b2a, then shape', () => {
    expect(primaryOf(patch).value).toBe(41e6);
    expect(primaryOf({ ...patch, link: { b2a: patch.link!.a2b } }).value).toBe(41e6);
    expect(
      primaryOf({
        ...patch,
        link: undefined,
        shape: { status: 'ok', color: '#f00', target: 'icon', stepIndex: 0, value: 1 },
      }).value
    ).toBe(1);
    expect(primaryOf({ ...patch, link: undefined }).status).toBe('nodata');
  });
});

describe('buildScopedVars', () => {
  it('exposes field labels, value and cell scope', () => {
    const v = buildScopedVars(patch, primaryOf(patch));
    expect(v.__field?.value.labels).toEqual(series.labels);
    expect(v.__value?.value.numeric).toBe(41e6);
    expect(v.__value?.value.text).toBe('41 Mb/s');
    expect(v.cell?.value['pg-id']).toBe('x');
    expect(v.from?.value.node).toBe('a');
  });
});

describe('resolveLinks', () => {
  it('returns rule urls through replaceVariables then field links', () => {
    const replace = vi.fn((s: string) => s.replace('${__from}', '123'));
    const links = resolveLinks(patch, primaryOf(patch), replace);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ title: 'links', href: '/d/iface?var-job=node-a&from=123', target: '_blank' });
    expect(links[1]).toBe(fieldLink);
    expect(series.field.getLinks).toHaveBeenCalledWith({
      valueRowIndex: 1,
      calculatedValue: { text: '41 Mb/s', numeric: 41e6 },
    });
  });
  it('drops a rule url that a dashboard variable turns into another scheme', () => {
    const p = { ...patch, urls: [{ title: 'v', url: '${target:raw}' }] };
    expect(resolveLinks(p, primaryOf(p), () => 'javascript:alert(1)').map((l) => l.title)).toEqual(['Field link']);
  });
  it('works without a series', () => {
    const p = { ...patch, link: undefined };
    expect(resolveLinks(p, primaryOf(p), (s) => s)).toHaveLength(1);
  });
});
