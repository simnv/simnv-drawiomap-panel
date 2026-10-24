import { describe, expect, it, vi } from 'vitest';
import type { Field, LinkModel } from '@grafana/data';
import type { CellPatch, SeriesInfo } from '../types';
import { buildScopedVars, defaultUrlTitle, primaryOf, resolveLinks } from './links';
import { resolveTemplate, shield } from '../binding/template';

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
    const links = resolveLinks(patch, primaryOf(patch), replace, 'a ↔ b');
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
    expect(resolveLinks(p, primaryOf(p), () => 'javascript:alert(1)', 'x').map((l) => l.title)).toEqual(['Field link']);
  });
  it('works without a series', () => {
    const p = { ...patch, link: undefined };
    expect(resolveLinks(p, primaryOf(p), (s) => s, 'x')).toHaveLength(1);
  });
  it('a rule url title goes through replaceVariables', () => {
    const p = { ...patch, urls: [{ title: 'Port ${__value.text}', url: '/x' }] };
    expect(resolveLinks(p, primaryOf(p), (s) => s.replace('${__value.text}', '41'), 'x')[0].title).toBe('Port 41');
  });
  describe('no double expansion', () => {
    // A value of the diagram can hold text like ${var}. The template pass has resolved it already; the pass of Grafana
    // (replaceVariables) must not expand it again. Only text that the author typed in the template is for Grafana.
    const expand = (s: string) => s.replaceAll('${evil}', 'EXPANDED').replaceAll('${dash}', 'dashboard value');
    const scope = { ...patch.scope, from: { node: 'a', port: '${evil}' } };
    it('a resolved value in urlTitle stays literal; a variable that the author typed is expanded', () => {
      const title = resolveTemplate('Port ${from.port} on ${dash}', scope, shield);
      const p = { ...patch, urls: [{ title: title.text, url: '/x' }] };
      expect(resolveLinks(p, primaryOf(p), expand, 'x')[0].title).toBe('Port ${evil} on dashboard value');
    });
    it('a resolved value in a url is encoded, so it stays literal', () => {
      const url = resolveTemplate('/d/x?port=${from.port}&v=${dash}', scope, encodeURIComponent);
      const p = { ...patch, urls: [{ url: url.text }] };
      const href = resolveLinks(p, primaryOf(p), expand, 'x')[0].href;
      expect(href).toBe('/d/x?port=%24%7Bevil%7D&v=dashboard value');
    });
  });
  it('a rule url without a title gets a default from the url and the card title', () => {
    const titles = (url: string) =>
      resolveLinks({ ...patch, urls: [{ url }] }, primaryOf(patch), (s) => s, 'a ↔ b')[0].title;
    expect(titles('/d/iface?var-job=x')).toBe('Open dashboard');
    expect(titles('/explore?left=1')).toBe('Open a ↔ b');
  });
});

describe('defaultUrlTitle', () => {
  it('names Grafana dashboard paths "Open dashboard", other urls "Open <card title>"', () => {
    for (const u of [
      '/d/abc',
      '/d/abc/slug?var-x=1',
      '/grafana/d/abc/slug',
      'd/abc',
      'https://g.example/d/abc#p',
      '//g.example/sub/d/abc',
    ]) {
      expect(defaultUrlTitle(u, 'Host')).toBe('Open dashboard');
    }
    for (const u of [
      '/d/',
      '/dashboards',
      '/explore?x=/d/abc',
      'https://d/x',
      'https://example.com/docs/d',
      '/x#/d/a',
    ]) {
      expect(defaultUrlTitle(u, 'Host')).toBe('Open Host');
    }
  });
});
