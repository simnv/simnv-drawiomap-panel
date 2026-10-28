import { describe, expect, it, vi } from 'vitest';
import { shield, type TemplateScopeV4 } from '../binding/template';
import { resolveTitleV4, resolveUrlV4 } from './links';

const attrs = (o: Record<string, string>) => (n: string) => o[n];
const cell = (o: Record<string, string>): TemplateScopeV4 => ({ attr: attrs(o) });

/** A replaceVariables that gives back its input, so that a test can read the text that reaches Grafana. */
const echo = () => vi.fn((s: string) => s);

/**
 * A small model of the Grafana formats (scenes formatRegistry), for a multi-value variable job = [a, b] and a
 * single-value site. percentencode gives a multi value as an encoded glob {a,b}.
 */
const VARIABLES: Record<string, string[]> = { job: ['a', 'b'], site: ['a&var-site=b#x'] };
function grafana(s: string): string {
  return s
    .replace(/\$__url_time_range/g, 'from=1&to=2')
    .replace(/\$\{(\w+):(\w+)\}/g, (whole, name: string, format: string) => {
      const v = VARIABLES[name];
      if (!v) {
        return whole;
      }
      switch (format) {
        case 'percentencode':
          return encodeURIComponent(v.length > 1 ? `{${v.join(',')}}` : v[0]);
        case 'queryparam':
          return v.map((x) => `var-${name}=${encodeURIComponent(x)}`).join('&');
        case 'csv':
          return v.join(',');
        default:
          return whole;
      }
    });
}

describe('resolveUrlV4', () => {
  it('gives a bare $job the format percentencode and keeps the other dashboard forms', () => {
    const spy = echo();
    const url = '/d/host?var-job=$job&$__url_time_range&${job:queryparam}&x=${job:csv}';
    expect(resolveUrlV4(url, cell({}), spy)).toBe(
      '/d/host?var-job=${job:percentencode}&$__url_time_range&${job:queryparam}&x=${job:csv}'
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(
      '/d/host?var-job=${job:percentencode}&$__url_time_range&${job:queryparam}&x=${job:csv}'
    );
  });

  it('substitutes ${job} from the cell and leaves ${job:queryparam} to Grafana', () => {
    const spy = echo();
    resolveUrlV4('/d/host?var-node=${job}&${job:queryparam}', cell({ job: 'cell-a' }), spy);
    expect(spy.mock.calls[0][0]).toBe('/d/host?var-node=cell-a&${job:queryparam}');
  });

  it('keeps a value of a dashboard variable from changing the query structure', () => {
    expect(resolveUrlV4('/d/host?var-site=$site', cell({}), grafana)).toBe('/d/host?var-site=a%26var-site%3Db%23x');
    expect(resolveUrlV4('/d/host?var-job=$job', cell({}), grafana)).toBe('/d/host?var-job=%7Ba%2Cb%7D');
    expect(resolveUrlV4('/d/host?var-site=[[site]]', cell({}), grafana)).toBe('/d/host?var-site=a%26var-site%3Db%23x');
    expect(resolveUrlV4('/d/host?${job:queryparam}&$__url_time_range', cell({}), grafana)).toBe(
      '/d/host?var-job=a&var-job=b&from=1&to=2'
    );
  });

  it('encodes a cell value, so that a $ and a ${site:csv} in it reach Grafana as text', () => {
    const spy = echo();
    const out = resolveUrlV4('/d/x?k=${key}', cell({ key: 'a$b ${site:csv}' }), spy);
    const sent = spy.mock.calls[0][0];
    expect(sent).not.toContain('$');
    expect(sent).not.toContain('${site');
    expect(out).toBe(`/d/x?k=${encodeURIComponent('a$b ${site:csv}')}`);
    expect(resolveUrlV4('/d/x?k=${key}', cell({ key: '${site:csv}' }), grafana)).toBe('/d/x?k=%24%7Bsite%3Acsv%7D');
  });

  it('does not let a $ before a placeholder join the cell value into a dashboard variable', () => {
    const spy = echo();
    expect(resolveUrlV4('/d/x?a=$${key}', cell({ key: 'site' }), spy)).toBe('/d/x?a=$site');
    expect(spy.mock.calls[0][0]).toBe(`/d/x?a=${shield('$')}site`);
    expect(resolveUrlV4('/d/x?a=$${job:csv}', cell({}), grafana)).toBe('/d/x?a=$a,b');
  });

  it('encodes the edge ends, the labels and the value', () => {
    const scope: TemplateScopeV4 = {
      attr: attrs({}),
      from: attrs({ key: 'a b' }),
      labels: { job: 'x&y' },
      value: '1 %',
    };
    expect(resolveUrlV4('/d/x?f=${from.key}&j=${labels.job}&v=${value}', scope, echo())).toBe(
      '/d/x?f=a%20b&j=x%26y&v=1%20%25'
    );
  });

  it('gives null for a missing attribute, also when a dashboard variable has the name', () => {
    expect(resolveUrlV4('/d/x?p=${port}', cell({}), grafana)).toBeNull();
    expect(resolveUrlV4('/d/x?j=${job}', cell({}), grafana)).toBeNull();
  });

  it('gives null for ${__url_time_range}: it is a cell attribute', () => {
    expect(resolveUrlV4('/d/x?${__url_time_range}', cell({}), grafana)).toBeNull();
  });

  it('gives null for ${labels.x} and ${value} with no single status series', () => {
    expect(resolveUrlV4('/d/x?j=${labels.job}', cell({}), grafana)).toBeNull();
    expect(resolveUrlV4('/d/x?v=${value}', cell({}), grafana)).toBeNull();
  });

  it('gives null for a schema error', () => {
    const spy = echo();
    expect(resolveUrlV4('/d/x?a=${job.x:csv}', cell({}), spy)).toBeNull();
    expect(resolveUrlV4('/d/x?a=${}', cell({}), spy)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('gives null when the final URL fails isAllowedUrl', () => {
    expect(resolveUrlV4('javascript:alert(1)', cell({}), echo())).toBeNull();
    expect(resolveUrlV4('${key}', cell({ key: 'javascript:alert(1)' }), echo())).toBe('javascript%3Aalert(1)');
    expect(resolveUrlV4('$target', cell({}), () => 'javascript:alert(1)')).toBeNull();
  });
});

describe('resolveTitleV4', () => {
  it('gets no format step and no encoding', () => {
    const spy = echo();
    expect(resolveTitleV4('Open ${key} $job ${job:csv}', cell({ key: 'a&b' }), spy)).toBe('Open a&b $job ${job:csv}');
    expect(spy.mock.calls[0][0]).toBe('Open a&b $job ${job:csv}');
  });

  it('shields a $ in a cell value from Grafana and gives it back after', () => {
    const spy = vi.fn(grafana);
    expect(resolveTitleV4('Open ${key}', cell({ key: '$job ${site:csv}' }), spy)).toBe('Open $job ${site:csv}');
    expect(spy.mock.calls[0][0]).toBe(`Open ${shield('$job ${site:csv}')}`);
  });

  it('does not let a $ before a placeholder join the cell value into a dashboard variable', () => {
    const spy = echo();
    expect(resolveTitleV4('Cost $${key}', cell({ key: '{site}' }), spy)).toBe('Cost ${site}');
    expect(spy.mock.calls[0][0]).toBe(shield('Cost ${site}'));
  });

  it('gives null for a missing attribute, an unresolved placeholder or a schema error', () => {
    expect(resolveTitleV4('Open ${port}', cell({}), echo())).toBeNull();
    expect(resolveTitleV4('Open ${value}', cell({}), echo())).toBeNull();
    expect(resolveTitleV4('Open ${}', cell({}), echo())).toBeNull();
  });
});
