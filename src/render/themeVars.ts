/**
 * Theme variables of a draw.io export.
 *
 * draw.io (auto theme) paints some shapes with `var(--ge-adaptive-bg, #ffffff)` and defines the variable in one
 * <style> element. The sanitiser removes every <style> element, so the variable is lost. This module reads the
 * custom-property declarations only, with a strict parser, and returns plain colour values. The caller sets them on
 * the svg root. See docs/security.md ("Theme variables").
 */

const MAX_STYLE_LENGTH = 4096;
const MAX_STYLE_ELEMENTS = 8;
const MAX_DECLARATIONS = 16;

const NAMED = '(?:white|black|transparent|red|green|blue|gray|grey|yellow|orange)';
const NUM = '\\d{1,3}(?:\\.\\d{1,4})?';
const PCT = '\\d{1,3}(?:\\.\\d{1,4})?%';
const ALPHA = '(?:\\d{1,3}(?:\\.\\d{1,4})?%?|\\.\\d{1,4})';
const COLOR_SRC =
  `(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|${NAMED}` +
  `|rgba?\\(\\s*(?:${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}|${PCT}\\s*,\\s*${PCT}\\s*,\\s*${PCT})\\s*(?:,\\s*${ALPHA}\\s*)?\\))`;
const COLOR = new RegExp(`^${COLOR_SRC}$`, 'i');
const NAME = /^--ge-[a-z0-9-]+$/;
// var(--ge-x) or var(--ge-x, <plain colour>). The fallback cannot hold a second var().
const VAR = new RegExp(`^var\\(\\s*(--ge-[a-z0-9-]+)\\s*(?:,\\s*(${COLOR_SRC})\\s*)?\\)$`, 'i');
const SUPPORTS = /^@supports\s*\(\s*color\s*:\s*light-dark\(\s*#[0-9a-f]{3,8}\s*,\s*#[0-9a-f]{3,8}\s*\)\s*\)\s*\{/i;
const RULE = /^([^{}@]+)\{([^{}]*)\}/;
const LIGHT_DARK_OPEN = /^light-dark\(/i;
const HAS_VAR = /var\(/i;

function isPlain(v: string): boolean {
  return COLOR.test(v);
}

/** One colour position: a plain colour, or one var() with a plain fallback. null = reject. */
function resolvePlain(raw: string, plainVars: Map<string, string>): string | null {
  const v = raw.trim();
  if (isPlain(v)) {
    return v;
  }
  const m = VAR.exec(v);
  if (!m) {
    return null;
  }
  const declared = plainVars.get(m[1]);
  return declared !== undefined ? declared : (m[2] ?? null);
}

/** A whole value: a colour position, or `light-dark(<position>, <position>)`. null = reject. */
function resolveValue(raw: string, plainVars: Map<string, string>): string | null {
  const v = raw.trim();
  if (!LIGHT_DARK_OPEN.test(v)) {
    return resolvePlain(v, plainVars);
  }
  if (!v.endsWith(')')) {
    return null;
  }
  const inner = v.slice('light-dark('.length, -1);
  // The one top-level comma: colour arguments hold commas only inside rgb() and var().
  let depth = 0;
  let split = -1;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth < 0) {
        return null;
      }
    } else if (c === ',' && depth === 0) {
      if (split !== -1) {
        return null;
      }
      split = i;
    }
  }
  if (depth !== 0 || split === -1) {
    return null;
  }
  const light = resolvePlain(inner.slice(0, split), plainVars);
  const dark = resolvePlain(inner.slice(split + 1), plainVars);
  return light !== null && dark !== null ? `light-dark(${light}, ${dark})` : null;
}

/** The declaration bodies of the rules whose selector is exactly `#<rootId>`. Unparsable text stops the scan. */
function ruleBodies(css: string, rootId: string): string[] {
  const bodies: string[] = [];
  let rest = css.trim();
  let open = 0;
  while (rest) {
    if (rest.startsWith('}')) {
      if (open === 0) {
        break;
      }
      open--;
      rest = rest.slice(1).trimStart();
      continue;
    }
    const sup = SUPPORTS.exec(rest);
    if (sup) {
      open++;
      rest = rest.slice(sup[0].length).trimStart();
      continue;
    }
    const rule = RULE.exec(rest);
    if (!rule) {
      break;
    }
    if (rule[1].trim() === `#${rootId}`) {
      bodies.push(rule[2]);
    }
    rest = rest.slice(rule[0].length).trimStart();
  }
  return bodies;
}

/**
 * Accepted `--ge-*` declarations from the text of the <style> elements of an svg whose root id is `rootId`.
 * Values are plain colours or `light-dark(<plain>, <plain>)`; nothing else passes.
 */
export function extractThemeVars(styleTexts: string[], rootId: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!rootId || !/^[A-Za-z][\w-]{0,127}$/.test(rootId)) {
    return out;
  }
  // CSS custom property names are case-sensitive. The last declaration of a name wins.
  const pending = new Map<string, string>();
  for (const css of styleTexts.slice(0, MAX_STYLE_ELEMENTS)) {
    if (css.length > MAX_STYLE_LENGTH || css.includes('\\') || css.includes('/*')) {
      continue;
    }
    for (const body of ruleBodies(css, rootId)) {
      for (const decl of body.split(';')) {
        const i = decl.indexOf(':');
        const name = i < 0 ? '' : decl.slice(0, i).trim();
        if (NAME.test(name) && (pending.has(name) || pending.size < MAX_DECLARATIONS)) {
          pending.set(name, decl.slice(i + 1).trim());
        }
      }
    }
  }
  // Pass 1: values with no var(). Pass 2: values with var(); a var() reads only a plain colour from pass 1.
  const none = new Map<string, string>();
  for (const [name, value] of pending) {
    const r = HAS_VAR.test(value) ? null : resolveValue(value, none);
    if (r !== null) {
      out.set(name, r);
    }
  }
  const plainVars = new Map([...out].filter(([, v]) => isPlain(v)));
  for (const [name, value] of pending) {
    if (!out.has(name) && HAS_VAR.test(value)) {
      const r = resolveValue(value, plainVars);
      if (r !== null) {
        out.set(name, r);
      }
    }
  }
  return out;
}
