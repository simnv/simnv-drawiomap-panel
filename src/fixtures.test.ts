import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const svg = (n: string) => readFileSync(resolve(__dirname, '..', 'fixtures', 'demo', 'svg', `${n}.svg`), 'utf8');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('fixtures', () => {
  it('demo-l3 carries the portograph contract', () => {
    const s = svg('demo-l3');
    expect(count(s, /data-cell-id="/g)).toBe(108);
    expect(count(s, /data-meta-pg-kind="link"/g)).toBe(10);
    expect(count(s, /data-meta-pg-kind="node"/g)).toBe(10);
    expect(count(s, /data-meta-pg-kind="port"/g)).toBe(20);
    expect(count(s, /data-meta-pg-kind="link-label"/g)).toBe(8);
    expect(s).toContain('data-meta-pg-schema="1"');
    expect(s).toContain('data-meta-pg-id="isp-a:pppoe-&gt;rtr-a:wan1"');
  });
  it('portograph fixtures carry native text labels, no HTML labels and no PNG fallbacks', () => {
    for (const n of ['demo-l1', 'demo-l3']) {
      const s = svg(n);
      expect(count(s, /<foreignObject/g)).toBe(0);
      expect(count(s, /<switch/g)).toBe(0);
      expect(count(s, /<image[^>]*data:image\/png/g)).toBe(0);
      expect(count(s, /<text/g)).toBeGreaterThan(50);
    }
  });
  it('legacy-html-labels keeps the HTML-label path covered', () => {
    // An html=1 variant of demo-l3: <switch><foreignObject/><image PNG/></switch>.
    const s = svg('legacy-html-labels');
    expect(count(s, /<foreignObject/g)).toBe(53);
    expect(count(s, /<switch/g)).toBe(54);
    expect(s).toContain('data-meta-pg-kind="node"');
  });
  it('demo-l1 carries author meta attributes, explicit link ids and parallel links', () => {
    const s = svg('demo-l1');
    expect(s).toContain('data-meta-job="node-rtr-a"');
    expect(s).toContain('data-meta-device="eth1"');
    expect(s).toContain('data-meta-capacity="1000000000"');
    expect(s).toContain('data-meta-pg-id="wan-a"');
    expect(s).toContain('data-meta-pg-id="rtr-a:eth1-&gt;sw-a1:p16"');
    expect(s).toContain('data-meta-pg-id="rtr-a:eth2-&gt;sw-a1:p15"');
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
    for (const n of ['demo-l1', 'demo-l3', 'hand-drawn', 'legacy-html-labels']) {
      expect(svg(n)).toMatch(/<svg[^>]*viewBox="0 0 [\d.]+ [\d.]+"/);
    }
  });
});
