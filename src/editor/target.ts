import { buildEditorUrl, editorOrigin } from './protocol';

declare const __webpack_public_path__: string | undefined;

const PLUGIN_PATH = 'public/plugins/simnv-drawiomap-panel/';

/** How the modal loads the editor: a URL (external draw.io) or a srcdoc document (the bundled draw.io). */
export type EditorTarget =
  { kind: 'url'; src: string; origin: string } | { kind: 'bundled'; srcDoc: string; origin: string };

/**
 * Base URL of the draw.io webapp in dist/drawio. Grafana serves it next to module.js.
 * The webpack public path is relative (public/plugins/<id>/) or absolute (plugin CDN); the document base URL
 * includes the Grafana sub path (app_sub_url).
 */
export function bundledEditorBase(publicPath?: string, baseURI = document.baseURI): string {
  const path = publicPath ?? (typeof __webpack_public_path__ === 'string' ? __webpack_public_path__ : PLUGIN_PATH);
  return new URL('drawio/', new URL(path || PLUGIN_PATH, baseURI)).href;
}

/**
 * Policy of the srcdoc document, in addition to the inherited Grafana policy: draw.io may load files only from
 * dist/drawio (plus data: and blob: URLs that it makes itself). It cannot stop script in the frame from using
 * window.parent: the frame has the Grafana origin.
 */
export function editorCsp(b: string): string {
  return [
    `default-src ${b}`,
    `script-src ${b} 'unsafe-inline' 'unsafe-eval'`,
    `style-src ${b} 'unsafe-inline'`,
    `img-src ${b} data: blob:`,
    `font-src ${b} data:`,
    `connect-src ${b} data: blob:`,
    `frame-src 'none'`,
    `worker-src ${b} blob:`,
    `object-src 'none'`,
    `form-action 'none'`,
    `base-uri ${b}`,
  ].join('; ');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Document for the bundled editor. Grafana sends X-Frame-Options: deny for plugin files (allow_embedding = false),
 * so the iframe cannot load drawio/index.html. A srcdoc document is not subject to X-Frame-Options and has the
 * Grafana origin. <base> resolves the draw.io scripts and resources to dist/drawio. The patched bootstrap.js
 * (scripts/vendor-drawio.sh) reads the URL parameters from <meta name="dmap-search">.
 * The srcdoc document inherits the Grafana CSP. With content_security_policy = true the policy has
 * 'strict-dynamic' and a nonce: the two script tags need the nonce, draw.io adds its other scripts from them.
 * The CSP <meta> (editorCsp) only adds restrictions.
 */
export function buildEditorSrcdoc(base: string, search: string, nonce?: string): string {
  const n = nonce ? ` nonce="${escapeAttr(nonce)}"` : '';
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(editorCsp(base))}">` +
    `<base href="${escapeAttr(base)}">` +
    `<meta name="dmap-search" content="${escapeAttr(search)}">` +
    '<link rel="stylesheet" type="text/css" href="styles/grapheditor.css">' +
    `<script${n} src="js/bootstrap.js"></script>` +
    '</head><body class="geEditor geClassic"><div id="geInfo"><div id="geStatus"></div></div>' +
    `<script${n} src="js/main.js"></script></body></html>`
  );
}

/** An empty editor URL selects the bundled editor. */
export function editorTarget(editorUrl: string, isDark: boolean, hostOrigin = window.location.origin): EditorTarget {
  if (editorUrl.trim() !== '') {
    return { kind: 'url', src: buildEditorUrl(editorUrl, isDark), origin: editorOrigin(editorUrl) };
  }
  const base = bundledEditorBase();
  const search = new URL(buildEditorUrl(base, isDark)).search;
  return { kind: 'bundled', srcDoc: buildEditorSrcdoc(base, search, cspNonce()), origin: hostOrigin };
}

/**
 * Nonce of the Grafana CSP (content_security_policy = true). Grafana sets window.nonce. The frontend sandbox hides
 * that global from the plugin, so the fallback reads the nonce of a Grafana script element.
 */
export function cspNonce(): string | undefined {
  const fromWindow = (window as unknown as { nonce?: string }).nonce;
  if (fromWindow) {
    return fromWindow;
  }
  return document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce || undefined;
}
