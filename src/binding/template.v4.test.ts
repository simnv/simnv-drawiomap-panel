import { describe, expect, it } from 'vitest';
import {
  checkTemplate,
  formatBareVariables,
  missingAttrHint,
  resolveTemplateV4,
  shield,
  type TemplateScopeV4,
} from './template';

const attrs = (o: Record<string, string>) => (n: string) => o[n];

const scope: TemplateScopeV4 = {
  attr: attrs({ id: 'c1', key: 'sw-a', 'path-role': 'uplink', label: 'Switch A', cellTitle: 'T', percent: '7' }),
  from: attrs({ key: 'rtr-a', port: 'wan1' }),
  to: attrs({ key: 'sw-a', port: 'ge0' }),
  labels: { job: 'node', instance: 'sw-a:9100' },
  value: '41 Mb/s',
};

const BAD_DOLLAR = 'write ${attr} for a cell attribute, $var or ${var:format} for a dashboard variable';
const METADATA_VAR = 'a metadata text reads no dashboard variable';

describe('resolveTemplateV4', () => {
  it('substitutes the cell attributes, the edge ends, the labels and the value', () => {
    const r = resolveTemplateV4('${id} ${key} ${from.key}:${from.port} ${to.port} ${labels.job} ${value}', scope);
    expect(r).toEqual({ text: 'c1 sw-a rtr-a:wan1 ge0 node 41 Mb/s', missing: [], unresolved: [] });
  });

  it('reads a name with "-" as an attribute', () => {
    expect(resolveTemplateV4('${path-role}', scope).text).toBe('uplink');
  });

  it('reads ${label} as the attribute label', () => {
    expect(resolveTemplateV4('${label}', scope).text).toBe('Switch A');
  });

  it('reads the dropped v3 roots as attributes (A5)', () => {
    const r = resolveTemplateV4('${cell.key} ${cellTitle} ${percent}', scope);
    expect(r.text).toBe('${cell.key} T 7');
    expect(r.missing).toEqual(['cell.key']);
  });

  it('gives a missing attribute in missing and keeps the placeholder', () => {
    const r = resolveTemplateV4('/d/x?p=${port}&q=${from.nope}', scope);
    expect(r.text).toBe('/d/x?p=${port}&q=${from.nope}');
    expect(r.missing).toEqual(['port', 'from.nope']);
    expect(r.unresolved).toEqual([]);
  });

  it('gives a missing edge end as a missing from. or to. attribute', () => {
    const r = resolveTemplateV4('${from.key} ${to.key}', { attr: attrs({}) });
    expect(r.missing).toEqual(['from.key', 'to.key']);
  });

  it('counts an empty attribute value as present', () => {
    const r = resolveTemplateV4('[${port}]', { attr: attrs({ port: '' }) });
    expect(r).toEqual({ text: '[]', missing: [], unresolved: [] });
  });

  it('reads ${__url_time_range} as a missing attribute, with the Grafana variable hint', () => {
    const r = resolveTemplateV4('/d/x?${__url_time_range}', scope);
    expect(r.missing).toEqual(['__url_time_range']);
    expect(missingAttrHint('__url_time_range')).toBe('write $__name for a Grafana variable');
    expect(missingAttrHint('port')).toBeUndefined();
  });

  it('gives ${labels.x} and ${value} with no single status series in unresolved (template-unresolved)', () => {
    const r = resolveTemplateV4('${labels.job} ${value}', { attr: attrs({}) });
    expect(r.unresolved).toEqual(['labels.job', 'value']);
    expect(r.missing).toEqual([]);
    expect(r.text).toBe('${labels.job} ${value}');
  });

  it('gives an absent label of the one status series as an empty string, as PromQL does', () => {
    expect(resolveTemplateV4('[${labels.site}]', scope).text).toBe('[]');
  });

  it('leaves the dashboard variable forms and the bad ${ forms as they are', () => {
    const t = '$job $__url_time_range ${job:csv} ${__from:date:iso} ${job.x:csv} ${} ${a b';
    expect(resolveTemplateV4(t, scope)).toEqual({ text: t, missing: [], unresolved: [] });
  });

  it('applies encode to the substituted values only', () => {
    const r = resolveTemplateV4('/d/x?a=${key}&b=$job', { attr: attrs({ key: 'a&b c' }) }, encodeURIComponent);
    expect(r.text).toBe('/d/x?a=a%26b%20c&b=$job');
  });

  it('does not read a placeholder in a substituted value', () => {
    const r = resolveTemplateV4('${key}', { attr: attrs({ key: '${port}', port: 'x' }) }, shield);
    expect(r.text).toBe(shield('${port}'));
    expect(r.missing).toEqual([]);
  });
});

describe('checkTemplate', () => {
  it('accepts the scope placeholders and the dashboard variable forms in a URL', () => {
    const url = '/d/x?a=${key}&b=${from.port}&c=$job&${__url_time_range:raw}&${job:queryparam}&d=${job:csv}';
    expect(checkTemplate(url, 'url')).toEqual([]);
    expect(checkTemplate('$__url_time_range ${labels.job} ${value} ${__from:date:iso}', 'url')).toEqual([]);
  });

  it('accepts ${name:format} in a title', () => {
    expect(checkTemplate('Open ${job:csv}', 'title')).toEqual([]);
  });

  it('gives a schema message for ${name:format} in a metadata text', () => {
    expect(checkTemplate('host ${job:csv}', 'metadata')).toEqual([{ message: METADATA_VAR }]);
    expect(checkTemplate('host ${key} $job', 'metadata')).toEqual([]);
  });

  it('gives a schema message for a ${ that starts no known form', () => {
    for (const place of ['url', 'title', 'metadata'] as const) {
      expect(checkTemplate('/d/x?a=${job.x:csv}', place)).toEqual([{ message: BAD_DOLLAR }]);
      expect(checkTemplate('/d/x?a=${}', place)).toEqual([{ message: BAD_DOLLAR }]);
    }
    expect(checkTemplate('${a b}', 'url')).toEqual([{ message: BAD_DOLLAR }]);
    expect(checkTemplate('${key', 'url')).toEqual([{ message: BAD_DOLLAR }]);
    expect(checkTemplate('${path-role:csv}', 'url')).toEqual([{ message: BAD_DOLLAR }]);
    expect(checkTemplate('${job:}', 'url')).toEqual([{ message: BAD_DOLLAR }]);
  });

  it('gives one message per bad placeholder', () => {
    expect(checkTemplate('${} ${job:csv} ${}', 'metadata')).toHaveLength(3);
  });

  it('lets a $ that starts no ${ pass as text', () => {
    expect(checkTemplate('cost $5 $ $$', 'metadata')).toEqual([]);
  });
});

describe('formatBareVariables', () => {
  it('gives a bare ordinary dashboard variable the format percentencode', () => {
    expect(formatBareVariables('/d/host?var-job=$job&var-x=$job_2')).toBe(
      '/d/host?var-job=${job:percentencode}&var-x=${job_2:percentencode}'
    );
  });

  it('keeps a Grafana global variable and an explicit format as they are', () => {
    const url = '/d/host?$__url_time_range&${job:queryparam}&a=${job:csv}&b=${key}&c=$__from';
    expect(formatBareVariables(url)).toBe(url);
  });

  it('gives the old form [[name]] the format percentencode and keeps [[__name]] and [[name:format]]', () => {
    expect(formatBareVariables('/d/x?a=[[job]]&[[__url_time_range]]&b=[[job:csv]]')).toBe(
      '/d/x?a=${job:percentencode}&[[__url_time_range]]&b=[[job:csv]]'
    );
  });

  it('reads a bare name as replaceVariables does, also with a digit first', () => {
    expect(formatBareVariables('/d/x?a=$1x&b=$_y&c=$5')).toBe(
      '/d/x?a=${1x:percentencode}&b=${_y:percentencode}&c=${5:percentencode}'
    );
  });

  it('does not change a shielded $', () => {
    expect(formatBareVariables(`/d/x?a=${shield('$job')}`)).toBe(`/d/x?a=${shield('$job')}`);
  });
});
