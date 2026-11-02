import { CHANNEL_META, editorSearch } from './protocol';

declare const __webpack_public_path__: string | undefined;

const PLUGIN_PATH = 'public/plugins/simnv-drawiomap-panel/';

/**
 * iframe sandbox of the bundled editor. No allow-same-origin: draw.io runs in an opaque origin and cannot use
 * window.parent, the Grafana cookies, the Grafana localStorage or the Grafana API.
 */
export const EDITOR_SANDBOX = 'allow-scripts allow-popups allow-downloads allow-modals';

/**
 * How the modal loads the editor: the bundled draw.io in a srcdoc document in a sandboxed frame (opaque origin). Its
 * channel hello comes from origin 'null'. Replies go through the MessagePort of the hello (protocol.ts,
 * acceptChannelHello). base is the URL of dist/drawio (bundledEditorBase).
 */
export interface EditorTarget {
  srcDoc: string;
  origin: 'null';
  sandbox: string;
  base: string;
}

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
 * dist/drawio (plus data: and blob: URLs that it makes itself). The policy does not keep the frame away from the
 * Grafana page: the iframe sandbox (EDITOR_SANDBOX) does that.
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
 * Scripts that draw.io adds to the document after js/bootstrap.js, in load order. bootstrap.js adds js/PreConfig.js,
 * then js/app.min.js (10 MB) and js/PostConfig.js. App.main adds the shapes, the stencils and the extensions (10 MB)
 * after the text resources. Without preloads each stage waits for the one before it. A preload link for each script
 * starts its download at once; the script elements that draw.io adds later take the response from the preload cache.
 * The names come from the vendored draw.io (scripts/vendor-drawio.sh). target.test.ts checks them against
 * .drawio/webapp. A stale name costs one 404 and changes nothing else.
 */
export const EDITOR_PRELOADS = [
  'js/PreConfig.js',
  'js/app.min.js',
  'js/PostConfig.js',
  'js/shapes-14-6-5.min.js',
  'js/stencils.min.js',
  'js/extensions.min.js',
];

/**
 * The text resource that App.main reads first (mxResources, the default bundle). The vendor script converts it to a
 * script file that calls dmapVfs.put. The srcdoc loads that script directly, so the shim answers the request of
 * draw.io from memory, without a request in the middle of the start-up.
 */
export const EDITOR_RESOURCE_SCRIPT = 'resources/dia.txt.js';

/**
 * Document for the bundled editor. Grafana sends X-Frame-Options: deny for plugin files (allow_embedding = false),
 * so the iframe cannot load drawio/index.html. A srcdoc document is not subject to X-Frame-Options. <base> resolves
 * the draw.io scripts and resources to dist/drawio by absolute URL. In the sandboxed frame the document has an
 * opaque origin: scripts, styles and images load cross-origin (Grafana sends no Cross-Origin-Resource-Policy), but
 * XHR fails (no CORS). js/dmap-shim.js (src/editor/drawio-shim.js) answers draw.io XHR for its text resources from
 * script files, and sends the channel hello with the token of <meta name="dmap-channel">.
 * The patched bootstrap.js reads the URL parameters from <meta name="dmap-search">.
 * The srcdoc document inherits the Grafana CSP. With content_security_policy = true the policy has
 * 'strict-dynamic' and a nonce: the script tags and the preload links need the nonce, draw.io adds its other
 * scripts from them. The CSP <meta> (editorCsp) only adds restrictions.
 * The document loads the same draw.io files as before, in the same order of execution: the preload links
 * (EDITOR_PRELOADS) and the early resource script (EDITOR_RESOURCE_SCRIPT) only move the downloads to the start.
 */
export function buildEditorSrcdoc(base: string, search: string, opts: { token: string; nonce?: string }): string {
  const n = opts.nonce ? ` nonce="${escapeAttr(opts.nonce)}"` : '';
  const preloads = EDITOR_PRELOADS.map((src) => `<link${n} rel="preload" as="script" href="${src}">`).join('');
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(editorCsp(base))}">` +
    `<base href="${escapeAttr(base)}">` +
    `<meta name="dmap-search" content="${escapeAttr(search)}">` +
    `<meta name="${CHANNEL_META}" content="${escapeAttr(opts.token)}">` +
    preloads +
    '<link rel="stylesheet" type="text/css" href="styles/grapheditor.css">' +
    `<script${n} src="js/dmap-shim.js"></script>` +
    // defer: the resource script runs after the parser, before the load event that starts App.main.
    `<script${n} defer src="${EDITOR_RESOURCE_SCRIPT}"></script>` +
    `<script${n} src="js/bootstrap.js"></script>` +
    '</head><body class="geEditor geClassic"><div id="geInfo"><div id="geStatus"></div></div>' +
    `<script${n} src="js/main.js"></script></body></html>`
  );
}

/** Target of the bundled editor in an opaque-origin frame (docs/security.md). token is the channel token. */
export function editorTarget(isDark: boolean, token: string): EditorTarget {
  const base = bundledEditorBase();
  const srcDoc = buildEditorSrcdoc(base, editorSearch(isDark), { token, nonce: cspNonce() });
  return { srcDoc, origin: 'null', sandbox: EDITOR_SANDBOX, base };
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
