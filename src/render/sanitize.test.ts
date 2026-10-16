import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from './sanitize';

const l3 = readFileSync(resolve(__dirname, '../../fixtures/svg/l3-routing.svg'), 'utf8');
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
    expect(r.svg).toContain('.a{fill:red}');
    expect(r.svg).toContain('url(#grad)');
    expect(r.svg).toContain('light-dark(');
  });
  it('keeps data URI images and drops nothing that is needed', () => {
    const r = sanitizeSvg(wrap('<image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>'));
    expect(r.svg).toContain('data:image/png;base64,iVBORw0KGgo=');
  });
});

describe('sanitizeSvg: draw.io export', () => {
  it('drops PNG label fallbacks inside <switch> and keeps foreignObject', () => {
    const r = sanitizeSvg(l3);
    expect(r.removed.images).toBe(53);
    expect(r.svg).not.toMatch(/<image[^>]*data:image\/png/);
    expect(r.foreignObjects).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/foreignObject/);
    expect(r.svg.length).toBeLessThan(l3.length / 2);
  });
  it('keeps data-cell-id, data-meta-*, pointer-events and light-dark styles', () => {
    const r = sanitizeSvg(l3);
    expect((r.svg.match(/data-cell-id="/g) ?? []).length).toBe(100);
    expect(r.svg).toContain('data-meta-pg-id="wan1:pppoe->rtr-a:wan1"');
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
