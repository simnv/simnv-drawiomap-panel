import { describe, expect, it } from 'vitest';

// @ts-expect-error the helper is a plain Node ES module with no types
import { normalizeSvgId } from '../scripts/normalize-svg-id.mjs';

const normalize = normalizeSvgId as (svg: string, name: string) => string;

const ID = 'ge-svg-aB3_x-9';
const head = '<?xml version="1.0"?>\n<!-- ' + ID + ' -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n';
const svg =
  head +
  `<svg xmlns="http://www.w3.org/2000/svg" id="${ID}"><style>#${ID} { --a: 1; } #${ID}-x { --b: 2; }</style>` +
  `<defs><linearGradient id="g"/></defs><rect fill="url(#${ID})" style="filter: url(#${ID})"/><use href="#${ID}"/>` +
  `<!-- #${ID} --><g data-cell-id="1" id="${ID}" data-meta-key="${ID}" data-meta-note="url(#${ID})"><text>${ID}</text></g></svg>`;

describe('scripts/normalize-svg-id.mjs', () => {
  const out = normalize(svg, 'demo');
  it('changes the id of the root svg and its real references', () => {
    expect(out).toContain('<svg xmlns="http://www.w3.org/2000/svg" id="ge-svg-demo">');
    expect(out).toContain('#ge-svg-demo { --a: 1; }');
    expect(out).toContain('fill="url(#ge-svg-demo)"');
    expect(out).toContain('style="filter: url(#ge-svg-demo)"');
    expect(out).toContain('<use href="#ge-svg-demo"/>');
  });
  it('keeps a label, a data-meta value, a comment, another id and a longer id that contain the same string', () => {
    expect(out).toContain(`<text>${ID}</text>`);
    expect(out).toContain(`data-meta-key="${ID}"`);
    expect(out).toContain(`data-meta-note="url(#${ID})"`);
    expect(out).toContain(`<g data-cell-id="1" id="${ID}"`);
    expect(out).toContain(`<!-- #${ID} -->`);
    expect(out.startsWith(head)).toBe(true);
    expect(out).toContain(`#${ID}-x { --b: 2; }`);
  });
  it('does nothing when the root has no generated id', () => {
    const plain = '<svg xmlns="http://www.w3.org/2000/svg" id="a"><text>x</text></svg>';
    expect(normalize(plain, 'demo')).toBe(plain);
  });
});
