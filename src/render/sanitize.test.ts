import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeSvg, sanitizeSvgUncached } from './sanitize';

const l3 = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/demo-l3.svg'), 'utf8');
// An html=1 variant of demo-l3: every label is <switch><foreignObject/><image PNG/></switch>.
const legacy = readFileSync(resolve(__dirname, '../../fixtures/demo/svg/legacy-html-labels.svg'), 'utf8');
const wrap = (inner: string, rootAttrs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" ${rootAttrs}>${inner}</svg>`;

describe('sanitizeSvg: adversarial input', () => {
  it('removes scripts and event handlers', () => {
    const r = sanitizeSvg(wrap('<script>alert(1)</script><rect onclick="y()" width="1" height="1"/>', 'onload="x()"'));
    expect(r.svg).not.toContain('<script');
    expect(r.svg).not.toContain('onload');
    expect(r.svg).not.toContain('onclick');
    expect(r.removed.elements).toBeGreaterThanOrEqual(1);
    expect(r.removed.attributes).toBeGreaterThanOrEqual(2);
  });
  it('removes javascript: hrefs but keeps safe links', () => {
    const r = sanitizeSvg(
      wrap(
        '<a href="javascript:alert(1)"><rect width="1" height="1"/></a><a href="https://example.org/x"><rect width="1" height="1"/></a>'
      )
    );
    expect(r.svg).not.toContain('javascript:');
    expect(r.svg).toContain('https://example.org/x');
  });
  it('removes iframe, object and embed inside foreignObject but keeps the HTML label', () => {
    const r = sanitizeSvg(
      wrap(
        '<switch><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><iframe srcdoc="&lt;script&gt;1&lt;/script&gt;"></iframe><object data="x.swf"></object><embed src="x"/><div>label</div></div></foreignObject><image href="data:image/png;base64,AAAA"/></switch>'
      )
    );
    expect(r.svg).not.toMatch(/<iframe|<object|<embed|srcdoc/);
    expect(r.svg).toContain('<foreignObject');
    expect(r.svg).toContain('label');
    expect(r.foreignObjects).toBe(1);
  });
  it('removes external <use> references and keeps local ones', () => {
    const r = sanitizeSvg(
      wrap(
        '<defs><rect id="ok" width="1" height="1"/></defs><use href="#ok"/><use xlink:href="https://evil.example/x.svg#a"/><use href="x.svg#b"/>'
      )
    );
    expect(r.svg).toContain('href="#ok"');
    expect(r.svg).not.toContain('evil.example');
    expect(r.svg).not.toContain('x.svg#b');
  });
  it('removes styles with external url() or @import and keeps local url(#id)', () => {
    const r = sanitizeSvg(
      wrap(
        '<style>@import url(https://evil.example/a.css);</style><style>.a{fill:red}</style><rect style="fill: url(http://evil.example/p.svg#g)" width="1" height="1"/><rect style="fill: url(#grad); stroke: light-dark(#000, #fff)" width="1" height="1"/>'
      )
    );
    expect(r.svg).not.toContain('evil.example');
    expect(r.svg).toContain('url(#grad)');
    expect(r.svg).toContain('light-dark(');
  });
  it('removes every <style> element, also inside foreignObject, and keeps inline style attributes', () => {
    // A stylesheet is global to the page: it can hide or change Grafana elements outside the panel.
    const r = sanitizeSvg(
      wrap(
        '<style>.a{fill:red}</style><switch><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><style>body .grafana-app { display: none !important }</style><STYLE>.x{color:blue}</STYLE><div style="color: red">label</div></div></foreignObject></switch><defs><style type="text/css">svg ~ * { visibility: hidden }</style></defs>'
      )
    );
    expect(r.svg).not.toMatch(/<style/i);
    expect(r.svg).not.toContain('display: none');
    expect(r.svg).not.toContain('visibility');
    expect(r.svg).not.toContain('.a{fill:red}');
    expect(r.svg).toContain('style="color: red"');
    expect(r.svg).toContain('label');
    expect(r.removed.elements).toBeGreaterThanOrEqual(3);
  });
  it('turns the draw.io theme <style> into variables on the root and removes the <style>', () => {
    const id = 'ge-svg-FsRRRb8MO-OGrmC6xf82';
    const css = `@supports (color: light-dark(#000, #fff)) { #${id} { --ge-adaptive-bg: light-dark(#ffffff, var(--ge-dark-color, #121212)); } }`;
    const text = `<svg xmlns="http://www.w3.org/2000/svg" id="${id}" viewBox="0 0 10 10" style="color-scheme: light dark;"><defs><style type="text/css">${css}</style></defs><rect width="1" height="1" style="fill: var(--ge-adaptive-bg, #ffffff);"/></svg>`;
    const r = sanitizeSvg(text);
    expect(r.svg).not.toMatch(/<style/i);
    const root = new DOMParser().parseFromString(r.svg, 'image/svg+xml').documentElement;
    expect(root.getAttribute('style')).toContain('--ge-adaptive-bg: light-dark(#ffffff, #121212)');
    expect(root.getAttribute('style')).toContain('color-scheme');
    expect(r.svg).toContain('var(--ge-adaptive-bg, #ffffff)');
    expect(sanitizeSvg(r.svg).svg).toBe(r.svg);
  });
  it('sets no variable from a hostile <style>', () => {
    const r = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" id="a1" viewBox="0 0 10 10"><style>#a1 { --ge-x: url(https://evil.example/p) } svg { --ge-y: #fff }</style></svg>'
    );
    expect(r.svg).not.toContain('--ge-');
    expect(r.svg).not.toContain('evil.example');
  });
  it('keeps data URI images and drops nothing that is needed', () => {
    const r = sanitizeSvg(wrap('<image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>'));
    expect(r.svg).toContain('data:image/png;base64,iVBORw0KGgo=');
  });
});

describe('sanitizeSvg: draw.io export', () => {
  it('drops PNG label fallbacks inside <switch> and keeps foreignObject', () => {
    const r = sanitizeSvg(legacy);
    expect(r.removed.images).toBe(53);
    expect(r.svg).not.toMatch(/<image[^>]*data:image\/png/);
    expect(r.foreignObjects).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/foreignObject/);
    expect(r.svg.length).toBeLessThan(legacy.length / 2);
  });
  it('passes native text labels through with no warning', () => {
    const r = sanitizeSvg(l3);
    expect(r.foreignObjects).toBe(0);
    expect(r.removed.images).toBe(0);
    expect(r.warnings).toEqual([]);
    expect((r.svg.match(/<text/g) ?? []).length).toBe((l3.match(/<text/g) ?? []).length);
  });
  it('keeps data-cell-id, data-meta-*, pointer-events and light-dark styles', () => {
    const r = sanitizeSvg(l3);
    expect((r.svg.match(/data-cell-id="/g) ?? []).length).toBe(108);
    expect(r.svg).toContain('data-meta-pg-id="isp-a:pppoe-&gt;rtr-a:wan1"');
    expect(r.svg).toContain('pointer-events="stroke"');
    expect(r.svg).toContain('light-dark(');
    expect(r.svg).toMatch(/<svg[^>]*viewBox="0 0 /);
  });
  it('strips the embedded diagram copy and the XML prolog', () => {
    const r = sanitizeSvg(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" content="&lt;mxfile&gt;"><g/></svg>'
    );
    expect(r.svg.startsWith('<svg')).toBe(true);
    expect(r.svg).not.toContain('content=');
  });
  it('throws on a non-SVG document', () => {
    expect(() => sanitizeSvg('<html><body/></html>')).toThrow(/Not an SVG/);
    expect(() => sanitizeSvg('not xml <')).toThrow(/Not an SVG/);
  });
});

describe('sanitizeSvg: idempotence', () => {
  it('produces output that sanitizes again without a parse error', () => {
    const once = sanitizeSvg(legacy);
    const twice = sanitizeSvg(once.svg);
    expect(twice.warnings.join(' ')).not.toMatch(/Not an SVG/i);
    expect(twice.svg).toContain('data-cell-id="pg-node~rtr-a"');
    expect(twice.foreignObjects).toBe(once.foreignObjects);
  });
});

describe('sanitizeSvgUncached in the Grafana frontend sandbox', () => {
  it('does not need structuredClone: the sandbox cannot clone the options of the plugin', () => {
    const original = globalThis.structuredClone;
    globalThis.structuredClone = () => {
      throw new DOMException('#<Object> could not be cloned.', 'DataCloneError');
    };
    try {
      const { svg } = sanitizeSvgUncached(
        '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="a"><rect/></g></svg>'
      );
      expect(svg).toContain('data-cell-id="a"');
    } finally {
      globalThis.structuredClone = original;
    }
  });
});
