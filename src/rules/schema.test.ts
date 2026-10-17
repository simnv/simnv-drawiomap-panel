import { describe, expect, it } from 'vitest';
import { parseRulesYaml, rulesToYaml, ruleSchema } from './schema';

const yaml = `
- name: uplinks
  select: { kind: link, attrs: { kind: wan } }
  link:
    a2b: { refId: A, match: { job: "node-\${from.node}", device: "\${from.port}" } }
    b2a: { refId: B, match: { job: "node-\${to.node}", device: "\${to.port}" } }
    capacity: "\${cell.capacity}"
  reducer: last
  label: "\${value} · \${percent}"
  thresholds: { mode: percent, steps: [[0, green], [60, yellow], [85, red]] }
  url: "https://grafana/d/iface?var-host=\${from.node}"
- name: hosts up
  select: { kind: node }
  shape:
    series: { refId: C, match: { job: "node-\${cell.pg-id}" } }
    fill: true
    sparkline: { refId: D, match: { job: "node-\${cell.pg-id}" }, position: bottom }
`;

describe('parseRulesYaml', () => {
  it('parses the spec example', () => {
    const r = parseRulesYaml(yaml);
    expect(r.errors).toEqual([]);
    expect(r.rules).toHaveLength(2);
    expect(r.rules?.[0].link?.capacity).toBe('${cell.capacity}');
    expect(r.rules?.[0].thresholds?.steps[1]).toEqual([60, 'yellow']);
    expect(r.rules?.[1].shape?.sparkline?.position).toBe('bottom');
  });
  it('reports a bad reducer with a path', () => {
    const r = parseRulesYaml('- name: x\n  select: { kind: node }\n  reducer: median\n');
    expect(r.rules).toBeUndefined();
    expect(r.errors[0]).toMatch(/\[0\]\.reducer/);
  });
  it('reports YAML syntax errors', () => {
    const r = parseRulesYaml('- name: [');
    expect(r.errors.length).toBe(1);
  });
  it('accepts an empty document as zero rules', () => {
    expect(parseRulesYaml('').rules).toEqual([]);
  });
  it('round-trips through rulesToYaml', () => {
    const rules = parseRulesYaml(yaml).rules!;
    expect(parseRulesYaml(rulesToYaml(rules)).rules).toEqual(rules);
  });
  it('rejects unknown keys', () => {
    expect(ruleSchema.safeParse({ name: 'x', select: {}, bogus: 1 }).success).toBe(false);
  });
});

describe('matcher validation', () => {
  const rule = (select: object, extra: object = {}) => ({ name: 'x', select, ...extra });
  it('finding 1: rejects an invalid regex with a clear message and path', () => {
    const r = parseRulesYaml('- name: x\n  select: { label: "/[/" }\n');
    expect(r.rules).toBeUndefined();
    expect(r.errors[0]).toMatch(/\[0\]\.select\.label: .*invalid regex/i);
    expect(ruleSchema.safeParse(rule({ attrs: { a: '/(/' } })).success).toBe(false);
    expect(ruleSchema.safeParse(rule({ attrs: { a: '/x/z' } })).success).toBe(false);
    expect(ruleSchema.safeParse(rule({ kind: 'node' }, { shape: { series: { name: '/(/' } } })).success).toBe(false);
    expect(ruleSchema.safeParse(rule({ kind: 'node' }, { shape: { series: { match: { job: '/[/' } } } })).success).toBe(
      false
    );
  });
  it('finding 2: rejects the stateful g and y flags', () => {
    const r = parseRulesYaml('- name: x\n  select: { attrs: { host: "/router/g" } }\n');
    expect(r.errors[0]).toMatch(/\[0\]\.select\.attrs\.host: .*flag/i);
    expect(ruleSchema.safeParse(rule({ label: '/router/y' })).success).toBe(false);
  });
  it('accepts valid regexes, plain strings and templates', () => {
    expect(ruleSchema.safeParse(rule({ label: '/^r[0-9]+$/i', attrs: { a: 'plain [' } })).success).toBe(true);
    expect(
      ruleSchema.safeParse(rule({ kind: 'node' }, { shape: { series: { match: { job: 'node-${cell.pg-id}' } } } }))
        .success
    ).toBe(true);
  });
});

describe('hover card schema', () => {
  const node = (shape: object) => ({ name: 'x', select: { kind: 'node' }, shape });
  it('accepts shape.target icon, shape and stroke and rejects other values', () => {
    for (const target of ['icon', 'shape', 'stroke']) {
      expect(ruleSchema.safeParse(node({ target })).success).toBe(true);
    }
    expect(ruleSchema.safeParse(node({ target: 'fill' })).success).toBe(false);
  });
  it('accepts shape.card rows and rejects unknown row keys', () => {
    const r = parseRulesYaml(`
- name: cpu
  select: { kind: node }
  shape:
    card:
      - { title: CPU, refId: E, match: { job: "node-\${cell.pg-id}" }, unit: percent, decimals: 0, url: "/d/cpu" }
`);
    expect(r.errors).toEqual([]);
    expect(r.rules?.[0].shape?.card?.[0]).toEqual({
      title: 'CPU',
      refId: 'E',
      match: { job: 'node-${cell.pg-id}' },
      unit: 'percent',
      decimals: 0,
      url: '/d/cpu',
    });
    expect(ruleSchema.safeParse(node({ card: [{ refId: 'E', position: 'bottom' }] })).success).toBe(false);
    expect(ruleSchema.safeParse(node({ card: [{ match: { job: '/[/' } }] })).success).toBe(false);
  });
  it('accepts link.card with url and title', () => {
    const rule = { name: 'l', select: { kind: 'link' }, link: { card: { url: '/d/if', title: '${from.node}' } } };
    expect(ruleSchema.safeParse(rule).success).toBe(true);
    expect(ruleSchema.safeParse({ ...rule, link: { card: { color: 'red' } } }).success).toBe(false);
  });
  it('accepts urlTitle next to url', () => {
    const rule = { name: 'u', select: { kind: 'node' }, url: '/d/x', urlTitle: 'Host ${cell.pg-id}' };
    expect(ruleSchema.safeParse(rule).success).toBe(true);
    expect(ruleSchema.safeParse({ ...rule, urlTitle: 1 }).success).toBe(false);
  });
  it('still accepts the removed shape.sparkline and label keys (old dashboards)', () => {
    expect(parseRulesYaml(yaml).errors).toEqual([]);
  });
});
