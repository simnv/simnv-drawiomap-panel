import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const svg = (n: string) => readFileSync(resolve(__dirname, '..', 'fixtures', 'svg', `${n}.svg`), 'utf8');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('fixtures', () => {
  it('l3-routing carries the portograph contract', () => {
    const s = svg('l3-routing');
    expect(count(s, /data-cell-id="/g)).toBe(100);
    expect(count(s, /data-meta-pg-kind="link"/g)).toBe(10);
    expect(count(s, /data-meta-pg-kind="node"/g)).toBe(10);
    expect(count(s, /data-meta-pg-kind="port"/g)).toBe(20);
    expect(count(s, /data-meta-pg-kind="link-label"/g)).toBe(8);
    expect(s).toContain('data-meta-pg-schema="1"');
    expect(s).toContain('data-meta-pg-id="wan1:pppoe-&gt;rtr-a:wan1"');
  });
  it('l2-link carries author meta attributes', () => {
    const s = svg('l2-link');
    expect(s).toContain('data-meta-job="node-rtr-a"');
    expect(s).toContain('data-meta-capacity="1000000000"');
  });
  it('hand-drawn carries custom object attributes and no pg attributes', () => {
    const s = svg('hand-drawn');
    expect(s).toContain('data-meta-host="rtr-b"');
    expect(s).toContain('data-meta-capacity="100000000"');
    expect(s).not.toContain('data-meta-pg-kind');
    expect(count(s, /<text/g)).toBeGreaterThanOrEqual(5);
    expect(count(s, /data-cell-id="/g)).toBe(10);
    // the curved edge inside the group exports with Bezier commands
    expect(s).toMatch(/data-cell-id="edge-cd"[^]*?<path d="[^"]*[QC][^"]*"/);
  });
  it('all fixtures are draw.io SVG with a viewBox', () => {
    for (const n of ['l1-physical', 'l2-link', 'l3-routing', 'l4-exits', 'hand-drawn']) {
      expect(svg(n)).toMatch(/<svg[^>]*viewBox="0 0 [\d.]+ [\d.]+"/);
    }
  });
});
