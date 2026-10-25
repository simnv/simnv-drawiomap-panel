import { describe, expect, it } from 'vitest';
import { extractThemeVars } from './themeVars';

const ID = 'ge-svg-FsRRRb8MO-OGrmC6xf82';
const DRAWIO = `@supports (color: light-dark(#000, #fff)) { #${ID} { --ge-adaptive-bg: light-dark(#ffffff, var(--ge-dark-color, #121212)); } }`;
const one = (css: string, id: string | null = ID) => extractThemeVars([css], id);

describe('extractThemeVars', () => {
  it('reads the verbatim draw.io block', () => {
    expect(one(DRAWIO).get('--ge-adaptive-bg')).toBe('light-dark(#ffffff, #121212)');
  });
  it('ignores a rule for another selector, also a wrong id', () => {
    expect(one(`#other { --ge-a: #fff; } .x { --ge-b: #fff; } svg { --ge-c: #fff; }`).size).toBe(0);
    expect(one(DRAWIO, 'ge-svg-other').size).toBe(0);
    expect(one(DRAWIO, null).size).toBe(0);
    expect(one(`#${ID} .child { --ge-a: #fff; }`).size).toBe(0);
  });
  it('ignores names that are not --ge-*', () => {
    const r = one(`#${ID} { --x: #fff; color: red; background: #000; --ge-ok: #abc; --GE-up: #fff; }`);
    expect([...r.keys()].sort()).toEqual(['--ge-ok', '--ge-up'].sort());
  });
  it('accepts plain colours', () => {
    const r = one(
      `#${ID} { --ge-a: #fff; --ge-b: #ffff; --ge-c: #112233; --ge-d: #11223344; --ge-e: rgb(1, 2, 3); --ge-f: rgba(1,2,3,.5); --ge-g: white; }`
    );
    expect(r.size).toBe(7);
  });
  it('uses a declared --ge-dark-color instead of the fallback', () => {
    const r = one(
      `#${ID} { --ge-dark-color: #222222; --ge-adaptive-bg: light-dark(#ffffff, var(--ge-dark-color, #121212)); }`
    );
    expect(r.get('--ge-adaptive-bg')).toBe('light-dark(#ffffff, #222222)');
  });
  it('uses the fallback when the declared variable is hostile', () => {
    const r = one(
      `#${ID} { --ge-dark-color: url(https://evil.example/x); --ge-adaptive-bg: light-dark(#fff, var(--ge-dark-color, #121212)); }`
    );
    expect(r.has('--ge-dark-color')).toBe(false);
    expect(r.get('--ge-adaptive-bg')).toBe('light-dark(#fff, #121212)');
  });
  it('rejects hostile values', () => {
    const bad = [
      'url(https://evil.example/x)',
      'url(#a)',
      'expression(alert(1))',
      'image-set("a" 1x)',
      'attr(x)',
      'calc(1px + 2px)',
      '#fff !important',
      '#12',
      'light-dark(#fff, url(x))',
      'light-dark(#fff)',
      'light-dark(#fff, #000, #111)',
      'light-dark(light-dark(#fff, #000), #000)',
      'rgb(1, 2, var(--x, 3))',
      'var(--ge-x)',
      'var(--other, #fff)',
      'var(--ge-x, var(--ge-y, #fff))',
      'light-dark(#fff, #000) extra',
      'darkmagenta',
    ];
    for (const v of bad) {
      expect(one(`#${ID} { --ge-v: ${v}; }`).size, v).toBe(0);
    }
  });
  it('rejects a } injection: the rule that follows is ignored', () => {
    const r = one(`#${ID} { --ge-a: #fff } body { --ge-b: #000; } #${ID} { --ge-c: red }`);
    expect([...r.keys()].sort()).toEqual(['--ge-a', '--ge-c']);
    expect(one(`#${ID} { --ge-a: #fff; } } } body { --ge-b: #000 }`).size).toBe(1);
  });
  it('rejects escapes and comments', () => {
    expect(one(`#${ID} { --ge-a: \\75rl(x); }`).size).toBe(0);
    expect(one(`#${ID} { --ge-a: #fff; --ge-b: #/**/fff; }`).size).toBe(0);
    expect(one(`/* x */ ${DRAWIO}`).size).toBe(0);
  });
  it('reads a var() one level deep only', () => {
    const r = one(`#${ID} { --ge-c: #333; --ge-b: var(--ge-c, #111); --ge-a: light-dark(#fff, var(--ge-b, #000)); }`);
    expect(r.get('--ge-b')).toBe('#333');
    // --ge-b came from a var(), so --ge-a does not read it and uses its own fallback.
    expect(r.get('--ge-a')).toBe('light-dark(#fff, #000)');
    expect(one(`#${ID} { --ge-a: var(--ge-b, var(--ge-c, #fff)); }`).size).toBe(0);
  });
  it('ignores a very long input', () => {
    const big = `#${ID} { --ge-a: #fff; ${'--ge-x: #000; '.repeat(1000)} }`;
    expect(one(big).size).toBe(0);
  });
  it('limits the number of declarations', () => {
    const many = Array.from({ length: 60 }, (_, i) => `--ge-v${i}: #fff;`).join(' ');
    expect(one(`#${ID} { ${many} }`).size).toBeLessThanOrEqual(16);
  });
  it('ignores an unknown at-rule', () => {
    expect(one(`@import url(x); #${ID} { --ge-a: #fff; }`).size).toBe(0);
    expect(one(`@media all { #${ID} { --ge-a: #fff; } }`).size).toBe(0);
  });
});
