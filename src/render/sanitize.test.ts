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
    expect(r.removed.images).toBe(52);
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
    expect((r.svg.match(/data-cell-id="/g) ?? []).length).toBe(100);
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

// Hostile inputs that are well-formed XML (parseSvg rejects anything else before the sanitiser runs). Each one
// checks two things: the dangerous part is gone, and the output sanitises again to the same string (stored diagrams
// are sanitised twice). The structure of the tree is what the HTML parser makes of the serialised XML; a change of
// the DOMPurify input (string or node) changes what these inputs produce. See docs/security.md.
const XH = 'http://www.w3.org/1999/xhtml';
const fo = (inner: string) =>
  `<switch><foreignObject width="10" height="10"><div xmlns="${XH}">${inner}</div></foreignObject></switch>`;

/** The sanitised output, which must be a fixed point of the sanitiser. */
function clean(text: string): string {
  const once = sanitizeSvgUncached(text).svg;
  expect(sanitizeSvgUncached(once).svg).toBe(once);
  return once;
}

describe('sanitizeSvg: namespace confusion and mXSS', () => {
  it('removes an HTML element that is not inside a foreignObject', () => {
    const out = clean(wrap(`<p xmlns="${XH}"><img src="x" onerror="alert(1)"/></p><text>after</text>`));
    expect(out).not.toMatch(/<p[ >]|<img|onerror/);
  });
  it('removes an element with an HTML name in the svg namespace', () => {
    const out = clean(wrap('<p>x<rect width="1" height="1"/></p><div>y</div><text>after</text>'));
    expect(out).not.toMatch(/<p[ >]|<div/);
  });
  it('removes a font element that breaks out of the svg in the HTML parser', () => {
    const out = clean(
      wrap(
        '<font color="red"><image href="data:image/png;base64,AAAA" src="x"/><a href="https://example.org"><text>t</text></a></font><text>after</text>'
      )
    );
    expect(out).not.toMatch(/<font|<img|src="x"/);
  });
  it('removes handlers from elements written in another case', () => {
    const out = clean(wrap('<Rect width="1" height="1" onclick="1" onClick="2" ONLOAD="3"/><LINEARGRADIENT id="g"/>'));
    expect(out).not.toMatch(/onclick|onload/i);
  });
  it('keeps a tag in text as text', () => {
    const out = clean(
      wrap(
        '<title>&lt;img src=x onerror=alert(1)&gt;</title><desc>&lt;/desc&gt;&lt;script&gt;1&lt;/script&gt;</desc><text>a&lt;b</text>'
      )
    );
    expect(out).not.toMatch(/<img|<script|<\/desc><\/desc>/);
    expect(out).toContain('&lt;img');
    expect(out).toContain('a&lt;b');
  });
  it('keeps a CDATA section as text', () => {
    const out = clean(wrap('<desc><![CDATA[<img src=x onerror=alert(1)>]]></desc>'));
    expect(out).not.toMatch(/<img|CDATA/);
  });
  it('removes a comment with a tag and a processing instruction', () => {
    const out = clean(
      wrap(
        '<!-- <img src=x onerror=alert(1)> --><!-- plain --><?xml-stylesheet href="https://evil.example/a.css"?><rect/>'
      )
    );
    expect(out).not.toMatch(/onerror|xml-stylesheet|evil\.example/);
    expect(out).toContain('<rect/>');
  });
  it('removes an attribute value that closes a style or a title element', () => {
    const out = clean(wrap('<rect title="&lt;/style&gt;&lt;img src=x onerror=alert(1)&gt;" data-x="--!&gt;"/>'));
    expect(out).not.toMatch(/title=|data-x=|onerror/);
    expect(out).toContain('<rect/>');
  });
  it('removes animation of a URL attribute', () => {
    const out = clean(
      wrap(
        '<a><animate attributeName="href" values="javascript:alert(1)"/><set attributeName="href" to="javascript:alert(1)"/><text>t</text></a>'
      )
    );
    expect(out).not.toContain('javascript:');
  });
  it('removes MathML inside and outside a foreignObject', () => {
    const out = clean(
      wrap(
        `<math xmlns="http://www.w3.org/1998/Math/MathML"><mtext><img src="x" onerror="alert(1)"/></mtext></math>${fo('<math xmlns="http://www.w3.org/1998/Math/MathML"><annotation-xml encoding="text/html"><img src="x" onerror="alert(1)"/></annotation-xml></math>')}`
      )
    );
    expect(out).not.toMatch(/<math|annotation-xml|<img|onerror/);
  });
  it('removes a noscript with a closing tag in an attribute', () => {
    const out = clean(
      wrap(fo('<noscript><p title="&lt;/noscript&gt;&lt;img src=x onerror=alert(1)&gt;"></p></noscript>'))
    );
    expect(out).not.toMatch(/noscript|onerror/);
  });
  it('removes meta, link, base, template, form and ping', () => {
    const out = clean(
      wrap(
        `<a href="https://example.org" ping="https://evil.example"><rect/></a>${fo('<meta http-equiv="refresh" content="0;url=https://evil.example"/><link rel="stylesheet" href="https://evil.example/a.css"/><base href="https://evil.example/"/><template><img src="x" onerror="alert(1)"/></template><form action="https://evil.example"><input name="a"/><button formaction="javascript:1">x</button></form>')}`
      )
    );
    expect(out).not.toMatch(/<meta|<link|<base|<template|<form|<input|<button|ping=|evil\.example|onerror/);
    expect(out).toContain('href="https://example.org"');
  });
  it('removes handlers from HTML inside a lowercase foreignobject', () => {
    const out = clean(
      wrap(
        `<foreignobject width="10" height="10"><div xmlns="${XH}"><img src="x" onerror="alert(1)"/>label</div></foreignobject>`
      )
    );
    expect(out).not.toContain('onerror');
    expect(out).toContain('label');
  });
  it('removes an id or a name that clobbers a document property', () => {
    const out = clean(wrap('<rect id="location"/><rect id="body"/><a name="cookie"><rect/></a><rect id="fine"/>'));
    expect(out).not.toMatch(/location|cookie|id="body"/);
    expect(out).toContain('id="fine"');
  });
  it('removes a data: URL on an element that is not an image', () => {
    const out = clean(wrap('<a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"><rect/></a>'));
    expect(out).not.toContain('data:text/html');
  });
  it('keeps a data: image, a local use and a plain href', () => {
    const out = clean(
      wrap(
        '<defs><rect id="ok" width="1" height="1"/></defs><image href="data:image/png;base64,AAAA" width="1" height="1"/><use href="#ok"/><a href="https://example.org/x" target="_blank"><text>t</text></a>'
      )
    );
    expect(out).toContain('data:image/png;base64,AAAA');
    expect(out).toContain('href="#ok"');
    expect(out).toContain('href="https://example.org/x"');
  });
});
