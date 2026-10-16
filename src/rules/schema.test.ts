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
