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

/**
 * The declarations of an inline style of a descendant: a `;` inside quotes or parentheses does not split. Undefined
 * when the style is not in the small grammar this scan reads, and the whole attribute must go: a backslash (a CSS
 * escape), a comment, a line break (CSS ends a string there and recovers; this scan does not), or a quote or a
 * parenthesis that is not closed. draw.io writes none of these in a style attribute. The scan fails closed: without
 * them the grammar left is plain declarations with quotes and parentheses, which the scan reads exactly.
 */
function splitDeclarations(style: string): string[] | undefined {
  if (/[\\\n\r\f]|\/\*/.test(style)) {
    return undefined;
  }
  const out: string[] = [];
  let quote = '';
  let depth = 0;
  let start = 0;
  for (let i = 0; i < style.length; i++) {
    const c = style[i];
    if (quote) {
      if (c === quote) {
        quote = '';
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      if (depth === 0) {
        return undefined;
      }
      depth--;
    } else if (c === ';' && depth === 0) {
      out.push(style.slice(start, i));
      start = i + 1;
    }
  }
  if (quote || depth !== 0) {
    return undefined;
  }
  out.push(style.slice(start));
  return out;
}

/**
 * True for a declaration that a descendant must not keep: `color-scheme` in any case, and any declaration whose
 * name hides behind a CSS escape (`color\-scheme`, `\63 olor-scheme`) or a comment (`color-scheme/**\/:`). draw.io
 * writes neither, so a strict drop loses nothing real. The value is not read.
 */
function setsColorScheme(declaration: string): boolean {
  const colon = declaration.indexOf(':');
  const name = (colon < 0 ? declaration : declaration.slice(0, colon)).trim();
  return !!name && (/[\\/*]/.test(name) || name.toLowerCase() === 'color-scheme');
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

const PURIFY_CONFIG: Config = {
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

export function sanitizeSvg(text: string): SanitizeResult {
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
  // The colour scheme is the panel's: it writes it on the root from the Grafana theme. A descendant must not turn
  // the OS preference back on for its subtree, else a light-dark() paint under it changes with no theme change.
  for (const el of Array.from(root.querySelectorAll('[style]'))) {
    const style = el.getAttribute('style') ?? '';
    const declarations = splitDeclarations(style);
    if (!declarations) {
      el.removeAttribute('style');
      removed.attributes++;
      continue;
    }
    const kept = declarations.filter((declaration) => !setsColorScheme(declaration));
    if (kept.length !== declarations.length) {
      const joined = kept
        .map((d) => d.trim())
        .filter(Boolean)
        .join('; ');
      if (joined) {
        el.setAttribute('style', joined);
      } else {
        el.removeAttribute('style');
      }
      removed.attributes++;
    }
  }
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const name of Array.from(el.attributes, (a) => a.name)) {
      if (name.toLowerCase() === 'color-scheme') {
        el.removeAttribute(name);
        removed.attributes++;
      }
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
