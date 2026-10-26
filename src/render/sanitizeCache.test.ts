import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSanitizeCache,
  PURIFY_CONFIG,
  sanitizeCacheStats,
  SANITIZER_VERSION,
  sanitizeSvg,
  sanitizeSvgUncached,
} from './sanitize';
import { mountSvg } from './svgStage';

const demo = (n: string) => readFileSync(resolve(__dirname, `../../fixtures/demo/svg/${n}.svg`), 'utf8');
const NAMES = ['demo-l1', 'demo-l3', 'legacy-html-labels', 'hand-drawn', 'bare-end-dot'];
const svgOf = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;
const distinct = (i: number) => svgOf(`<rect data-cell-id="c${i}" width="${i + 1}" height="1"/>`);
const rects = (n: number) => '<rect width="1" height="1"/>'.repeat(n);

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16);
};

beforeEach(() => clearSanitizeCache());

describe('sanitizeSvg cache: same output as the uncached sanitizer', () => {
  it.each(NAMES)('%s: first and second call equal the uncached result', (n) => {
    const text = demo(n);
    const expected = sanitizeSvgUncached(text);
    expect(sanitizeSvg(text)).toEqual(expected);
    expect(sanitizeSvg(text)).toEqual(expected);
  });

  it('adversarial input gives the same result', () => {
    const text = svgOf('<script>alert(1)</script><rect onclick="y()" width="1" height="1"/><use href="http://x/y#z"/>');
    expect(sanitizeSvg(text)).toEqual(sanitizeSvgUncached(text));
    expect(sanitizeSvg(text)).toEqual(sanitizeSvgUncached(text));
  });

  it('runs the sanitizer once for the same input', () => {
    const text = demo('demo-l3');
    sanitizeSvg(text);
    sanitizeSvg(text);
    sanitizeSvg(text);
    expect(sanitizeCacheStats().misses).toBe(1);
    expect(sanitizeCacheStats().hits).toBe(2);
  });

  it('does not store an input that throws', () => {
    expect(() => sanitizeSvg('not xml <')).toThrow(/Not an SVG/);
    expect(() => sanitizeSvg('not xml <')).toThrow(/Not an SVG/);
    expect(sanitizeCacheStats().entries).toBe(0);
  });
});

describe('sanitizeSvg cache: a different input never hits', () => {
  it('inputs that differ by one character give their own output', () => {
    const a = svgOf('<rect data-cell-id="a" width="1" height="1"/>');
    const b = svgOf('<rect data-cell-id="b" width="1" height="1"/>');
    const ra = sanitizeSvg(a);
    const rb = sanitizeSvg(b);
    expect(ra.svg).not.toBe(rb.svg);
    expect(ra.svg).toContain('data-cell-id="a"');
    expect(rb.svg).toContain('data-cell-id="b"');
    expect(sanitizeCacheStats().misses).toBe(2);
    expect(sanitizeCacheStats().hits).toBe(0);
  });

  it('the sanitized output of an input is its own entry when it is sanitized again', () => {
    const once = sanitizeSvg(demo('legacy-html-labels'));
    const twice = sanitizeSvg(once.svg);
    expect(twice).toEqual(sanitizeSvgUncached(once.svg));
    expect(sanitizeCacheStats().entries).toBe(2);
  });
});

describe('sanitizeSvg cache: bounds', () => {
  it('keeps at most 8 entries and evicts the oldest', () => {
    for (let i = 0; i < 9; i++) {
      sanitizeSvg(distinct(i));
    }
    expect(sanitizeCacheStats().entries).toBe(8);
    const before = sanitizeCacheStats().misses;
    sanitizeSvg(distinct(0)); // evicted: runs again
    expect(sanitizeCacheStats().misses).toBe(before + 1);
  });

  it('a hit keeps an entry alive', () => {
    for (let i = 0; i < 8; i++) {
      sanitizeSvg(distinct(i));
    }
    sanitizeSvg(distinct(0)); // now the newest
    sanitizeSvg(distinct(8)); // evicts distinct(1)
    const before = sanitizeCacheStats();
    sanitizeSvg(distinct(0));
    expect(sanitizeCacheStats().hits).toBe(before.hits + 1);
    sanitizeSvg(distinct(1));
    expect(sanitizeCacheStats().misses).toBe(before.misses + 1);
  });

  it('the byte cap evicts the oldest entries', () => {
    for (let i = 0; i < 4; i++) {
      sanitizeSvg(svgOf(`<g data-cell-id="g${i}">${rects(30000)}</g>`));
    }
    const s = sanitizeCacheStats();
    expect(s.bytes).toBeLessThanOrEqual(s.maxBytes);
    expect(s.entries).toBeLessThan(4);
    expect(s.entries).toBeGreaterThan(0);
  }, 60000);

  it('an entry above the cap is not stored', () => {
    const huge = svgOf(`<g>${rects(80000)}</g>`);
    expect(sanitizeSvg(huge).svg.length).toBeGreaterThan(0);
    expect(sanitizeCacheStats().entries).toBe(0);
    sanitizeSvg(huge);
    expect(sanitizeCacheStats().misses).toBe(2);
  }, 60000);
});

describe('sanitizeSvg cache: a caller cannot change the cache', () => {
  it('changing the returned counts and warnings does not change the next result', () => {
    const text = demo('legacy-html-labels');
    const first = sanitizeSvg(text);
    const snapshot = structuredClone(first);
    first.removed.elements = 999;
    first.warnings.push('x');
    first.svg = 'changed';
    expect(sanitizeSvg(text)).toEqual(snapshot);
  });

  it('changing a mounted DOM does not change the next result', () => {
    const text = demo('demo-l3');
    const expected = sanitizeSvgUncached(text).svg;
    const root = mountSvg(document.createElement('div'), sanitizeSvg(text).svg);
    root.replaceChildren();
    root.setAttribute('onload', 'x()');
    expect(sanitizeSvg(text).svg).toBe(expected);
    const again = mountSvg(document.createElement('div'), sanitizeSvg(text).svg);
    expect(again.childElementCount).toBeGreaterThan(0);
    expect(again.hasAttribute('onload')).toBe(false);
  });
});

describe('sanitizeSvg cache: key inputs', () => {
  it('the exported options are frozen and the same before and after a sanitize', () => {
    const before = JSON.stringify(PURIFY_CONFIG);
    expect(Object.isFrozen(PURIFY_CONFIG)).toBe(true);
    expect(Object.isFrozen(PURIFY_CONFIG.ADD_TAGS)).toBe(true);
    sanitizeSvgUncached(demo('legacy-html-labels'));
    expect(JSON.stringify(PURIFY_CONFIG)).toBe(before);
  });

  it('pins the sanitizer options to the version constant', () => {
    // When this fails, you changed PURIFY_CONFIG. Raise SANITIZER_VERSION and update the pin.
    expect([SANITIZER_VERSION, fnv(JSON.stringify(PURIFY_CONFIG))]).toEqual(['o7-1', '63ac6b03']);
  });
});

describe('sanitizeSvg cache: cost', () => {
  it('a hit on a 2,000 cell diagram costs a small part of a miss', () => {
    let cells = '';
    for (let i = 0; i < 2000; i++) {
      cells += `<g data-cell-id="c${i}"><rect x="${(i % 50) * 30}" y="${Math.floor(i / 50) * 30}" width="20" height="20" style="fill: red"/><text x="1" y="2">N${i}</text></g>`;
    }
    const text = svgOf(cells);
    const t0 = performance.now();
    const first = sanitizeSvg(text);
    const t1 = performance.now();
    const second = sanitizeSvg(text);
    const t2 = performance.now();
    console.log(`O7 cost: miss ${(t1 - t0).toFixed(1)} ms, hit ${(t2 - t1).toFixed(2)} ms`);
    expect(second).toEqual(first);
    expect(t2 - t1).toBeLessThan((t1 - t0) * 0.05);
  }, 60000);
});
