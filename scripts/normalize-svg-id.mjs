// Replaces the random id that draw.io gives the root <svg> (ge-svg-<random>) with ge-svg-<name>.
// Usage: node scripts/normalize-svg-id.mjs <file.svg> <name>
// Only these places change: the id attribute of the root element, the selector #<id> in <style> text, and
// the references url(#<id>) and href="#<id>" in attributes. Text, comments, CDATA and other attribute
// values keep the same bytes, even when they contain the same string.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^[>]*(?:\[[\s\S]*?\][^>]*)?>|<\?[\s\S]*?\?>|<[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+/g;
const ATTR = /([^\s=/>]+)(\s*=\s*)("([^"]*)"|'([^']*)')/g;
const REF_ATTRS = new Set(['href', 'xlink:href']);
// attributes that can hold url(#id); a data-* value is text and stays as it is
const URL_ATTRS = new Set([
  'style',
  'fill',
  'stroke',
  'filter',
  'clip-path',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The id of the first start tag <svg>. The declaration, comments and a DOCTYPE come before it and are skipped. */
function rootId(tokens) {
  for (const t of tokens) {
    if (t[0] !== '<' || /^<[!?]/.test(t)) {
      continue;
    }
    if (!/^<svg[\s>/]/.test(t)) {
      return null;
    }
    for (const m of t.matchAll(ATTR)) {
      if (m[1] === 'id') {
        return m[4] ?? m[5];
      }
    }
    return null;
  }
  return null;
}

export function normalizeSvgId(svg, name) {
  const tokens = svg.match(TOKEN) ?? [];
  const old = rootId(tokens);
  if (!old || !old.startsWith('ge-svg-')) {
    return svg;
  }
  const to = `ge-svg-${name}`;
  const tail = '(?![A-Za-z0-9_-])';
  const selector = new RegExp(`#${escapeRe(old)}${tail}`, 'g');
  const urlRef = new RegExp(`url\\(\\s*(["']?)#${escapeRe(old)}\\1\\s*\\)`, 'g');
  let seenRoot = false;
  let inStyle = false;
  const out = tokens.map((t) => {
    if (t.startsWith('<!--') || t.startsWith('<![CDATA[') || /^<[!?]/.test(t)) {
      return t;
    }
    if (t[0] !== '<') {
      return inStyle ? t.replace(selector, `#${to}`) : t;
    }
    if (/^<\/style[\s>]/.test(t)) {
      inStyle = false;
      return t;
    }
    const isRoot = !seenRoot;
    seenRoot = true;
    if (/^<style[\s>]/.test(t) && !t.endsWith('/>')) {
      inStyle = true;
    }
    return t.replace(ATTR, (all, attr, eq, quoted, dq, sq) => {
      const q = quoted[0];
      const value = dq ?? sq;
      let next = value;
      if (attr === 'id' && isRoot && value === old) {
        next = to;
      } else if (REF_ATTRS.has(attr) && value === `#${old}`) {
        next = `#${to}`;
      } else if (URL_ATTRS.has(attr)) {
        next = value.replace(urlRef, (_m, _q) => `url(#${to})`);
      }
      return next === value ? all : `${attr}${eq}${q}${next}${q}`;
    });
  });
  return out.join('');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, name] = process.argv.slice(2);
  writeFileSync(file, normalizeSvgId(readFileSync(file, 'utf8'), name));
}
