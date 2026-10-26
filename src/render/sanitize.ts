import DOMPurify, { type Config } from 'dompurify';

export interface SanitizeResult {
  svg: string;
  removed: { elements: number; attributes: number; images: number };
  foreignObjects: number;
  warnings: string[];
}

import { extractThemeVars } from './themeVars';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function parseSvg(text: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS || doc.querySelector('parsererror')) {
    throw new Error('Not an SVG document');
  }
  return root as unknown as SVGSVGElement;
}

/** true when a CSS text references anything that is not a local #id */
function hasExternalUrl(cssText: string): boolean {
  if (/@import/i.test(cssText)) {
    return true;
  }
  const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssText))) {
    if (!m[1].trim().startsWith('#')) {
      return true;
    }
  }
  return false;
}

export const PURIFY_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  // DOMPurify forbids foreignObject by default; the spec keeps HTML labels. The html profile
  // sanitises their content; iframe/object/embed/script are forbidden below.
  // DOMPurify does not allow `use`. Pass 1 removes every `use` that does not point to a local #id.
  ADD_TAGS: ['foreignObject', 'switch', 'use'],
  // Without this, DOMPurify removes every HTML element inside foreignObject (the label text).
  HTML_INTEGRATION_POINTS: { foreignobject: true, 'annotation-xml': true },
  ADD_ATTR: ['data-cell-id', 'pointer-events', 'requiredFeatures', 'color-scheme', 'xml:space'],
  FORBID_TAGS: [
    'iframe',
    'object',
    'embed',
    'script',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'link',
    'meta',
    'base',
    'template',
    'math',
    'audio',
    'video',
    'style',
  ],
  FORBID_ATTR: ['srcdoc', 'formaction', 'action', 'ping'],
  ADD_DATA_URI_TAGS: ['image'],
  ALLOW_DATA_ATTR: true,
  RETURN_DOM: true,
};

export function sanitizeSvgUncached(text: string): SanitizeResult {
  const root = parseSvg(text);
  const removed = { elements: 0, attributes: 0, images: 0 };

  // Pass 1: structural.
  // draw.io 32 writes <switch><foreignObject>HTML</foreignObject><image href="data:image/png..."/></switch>;
  // browsers take the foreignObject branch, so the PNG is dead weight.
  for (const sw of Array.from(root.querySelectorAll('switch'))) {
    for (const child of Array.from(sw.children)) {
      if (child.localName === 'image') {
        child.remove();
        removed.images++;
      }
    }
  }
  root.removeAttribute('content'); // embedded copy of the diagram XML (xmlsvg export)
  for (const use of Array.from(root.querySelectorAll('use'))) {
    const refs = [use.getAttribute('href'), use.getAttribute('xlink:href')].filter((h): h is string => h !== null);
    if (!refs.length || refs.some((h) => !h.trim().startsWith('#'))) {
      use.remove();
      removed.elements++;
    }
  }
  // A <style> element applies to the whole page, not only to the SVG: it can hide or restyle Grafana.
  // draw.io writes inline style attributes only, so remove every <style> element.
  // Before that, keep the --ge-* colour variables (draw.io auto theme) in a strict, value-checked form.
  const themeVars = extractThemeVars(
    Array.from(root.querySelectorAll('style'), (st) => st.textContent ?? ''),
    root.getAttribute('id')
  );
  for (const st of Array.from(root.querySelectorAll('style'))) {
    st.remove();
    removed.elements++;
  }
  for (const el of [root, ...Array.from(root.querySelectorAll('[style]'))]) {
    const style = el.getAttribute('style');
    if (style && hasExternalUrl(style)) {
      el.removeAttribute('style');
      removed.attributes++;
    }
  }

  // Pass 2: DOMPurify.
  const serialized = new XMLSerializer().serializeToString(root);
  const body = DOMPurify.sanitize(serialized, PURIFY_CONFIG) as unknown as HTMLElement;
  removed.elements += DOMPurify.removed.filter((r) => 'element' in r).length;
  removed.attributes += DOMPurify.removed.filter((r) => 'attribute' in r).length;
  const svg = body.querySelector('svg');
  if (!svg) {
    throw new Error('Not an SVG document');
  }
  const foreignObjects = svg.querySelectorAll('foreignObject').length;
  const warnings: string[] = [];
  if (foreignObjects) {
    warnings.push(
      `${foreignObjects} HTML labels (foreignObject). Turn off Formatted Text (html=0) on labels for smaller, native text.`
    );
  }
  // XML serialisation: the output must parse again as image/svg+xml (stored diagrams are sanitised twice).
  // Literal xmlns attributes (e.g. on HTML label divs) make XMLSerializer write xmlns twice; it declares namespaces itself.
  for (const el of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    el.removeAttribute('xmlns');
  }
  if (themeVars.size) {
    // The values are plain colours (themeVars.ts), so a string append cannot add a property or close the attribute.
    const decls = [...themeVars].map(([name, value]) => `${name}: ${value};`).join(' ');
    const current = (svg.getAttribute('style') ?? '').trim();
    svg.setAttribute('style', current ? `${current}${current.endsWith(';') ? '' : ';'} ${decls}` : decls);
  }
  return { svg: new XMLSerializer().serializeToString(svg), removed, foreignObjects, warnings };
}

/**
 * Names the sanitizer code that the cache key stands for: PURIFY_CONFIG, the structural pass, the theme variable step
 * and the serialisation. Raise it when any of them changes. A test pins a digest of PURIFY_CONFIG.
 */
export const SANITIZER_VERSION = 'o7-1';

const MAX_ENTRIES = 8;
/** 2 bytes per UTF-16 character of the key and of the output */
const MAX_BYTES = 8 * 1024 * 1024;

interface CacheEntry {
  result: SanitizeResult;
  bytes: number;
}

// Strings and numbers only, never a DOM node: every caller parses its own copy of `svg`.
// The Map compares keys by full string equality, so no other input can reach this output.
const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;
let hits = 0;
let misses = 0;

const copyOf = (r: SanitizeResult): SanitizeResult => ({
  svg: r.svg,
  removed: { ...r.removed },
  foreignObjects: r.foreignObjects,
  warnings: [...r.warnings],
});

/**
 * sanitizeSvgUncached with a bounded LRU cache keyed by the exact input string (and SANITIZER_VERSION).
 * It returns what sanitizeSvgUncached returns for that input. An input that throws is not cached.
 */
export function sanitizeSvg(text: string): SanitizeResult {
  const key = `${SANITIZER_VERSION}\n${text}`;
  const hit = cache.get(key);
  if (hit) {
    hits++;
    cache.delete(key); // re-insert: the newest entry goes last
    cache.set(key, hit);
    return copyOf(hit.result);
  }
  misses++;
  const result = sanitizeSvgUncached(text);
  const bytes = 2 * (key.length + result.svg.length);
  if (bytes <= MAX_BYTES) {
    cache.set(key, { result: copyOf(result), bytes });
    cacheBytes += bytes;
    for (const [oldKey, old] of cache) {
      if (cache.size <= MAX_ENTRIES && cacheBytes <= MAX_BYTES) {
        break;
      }
      cache.delete(oldKey);
      cacheBytes -= old.bytes;
    }
  }
  return result;
}

export function clearSanitizeCache(): void {
  cache.clear();
  cacheBytes = 0;
  hits = 0;
  misses = 0;
}

export function sanitizeCacheStats() {
  return { entries: cache.size, bytes: cacheBytes, maxBytes: MAX_BYTES, hits, misses };
}
