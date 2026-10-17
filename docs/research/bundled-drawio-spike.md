# Spike: bundle the draw.io editor inside the plugin

Date: 2026-10-17. Branch: `spike-bundled-drawio`. draw.io version: 32.4.1 (`draw.war`).

## Question

Can the plugin ship the draw.io webapp (jgraph/drawio, Apache-2.0) in its own `dist/`, so that Grafana serves it at
`/public/plugins/simnv-drawiomap-panel/drawio/` and the edit modal loads it from there: same origin, offline, with no
external editor host?

## Verdict

**Works, with caveats.** The prototype passes the editor e2e test (open, edit, save, panel updates) on Grafana
12.4.13 and 13.2.4, with the frontend sandbox on, with `content_security_policy = true`, with both, and with
`app_sub_url`. The editor sends no request to a host other than Grafana.

The main caveat: Grafana sends `X-Frame-Options: deny` for plugin files. An `<iframe src=".../drawio/index.html">`
does not load unless the admin sets `allow_embedding = true`. The prototype uses `<iframe srcdoc>` instead, which
puts draw.io on the Grafana origin. The other caveats are security, size, and the plugin CDN (see below).

## How the prototype works

| Part | File |
|---|---|
| Downloads the pinned `draw.war` from the GitHub release, checks sha256, removes unused files, writes the offline configuration, patches `bootstrap.js`, writes `NOTICE` and `LICENSE`. Builds in a temporary folder; `--if-missing` skips when the pinned version is present | `scripts/vendor-drawio.sh` (called by `npm run build` and `npm run dev`) |
| Copies `.drawio/webapp` to `dist/drawio` (no Terser) | `webpack.config.ts` (root, extends `.config/`) |
| Selects the editor: empty Editor URL = bundled editor, other value = external editor | `src/editor/target.ts` |
| iframe with `srcDoc` (bundled) or `src` (external) | `src/editor/DrawioModal.tsx` |
| Test stack: Grafana 12.4/13.2 on 3112/3113, sandbox on 3122/3123, CSP on 3132/3133, sandbox + CSP on 3143, `app_sub_url` on 3153 | `docker-compose.spike.yaml` |

The srcdoc document:

```html
<meta http-equiv="Content-Security-Policy" content="default-src <base>; script-src <base> 'unsafe-inline' 'unsafe-eval';
  style-src <base> 'unsafe-inline'; img-src <base> data: blob:; font-src <base> data:; connect-src <base> data: blob:;
  frame-src 'none'; worker-src <base> blob:; object-src 'none'; form-action 'none'; base-uri <base>">
<base href="<grafana>/public/plugins/simnv-drawiomap-panel/drawio/">
<meta name="dmap-search" content="?embed=1&proto=json&configure=1&spin=1&...&dark=0">
<link rel="stylesheet" href="styles/grapheditor.css">
<script nonce="<grafana nonce>" src="js/bootstrap.js"></script>
... <script nonce="<grafana nonce>" src="js/main.js"></script>
```

- `<base>` comes from `__webpack_public_path__` resolved against `document.baseURI`, so `app_sub_url` works.
- A srcdoc document has no query string and its URL is `about:srcdoc`. Two one-line patches in `bootstrap.js` read the
  parameters from `<meta name="dmap-search">` and stop the http(s) redirect. The vendor script stops if a patch
  target is not found exactly once.
- `js/PreConfig.js` sets `offline=1`, `stealth=1`, `lockdown=1`, `pwa=0` (no service worker), turns off all cloud
  storages (`db`, `gh`, `tr`, `gapi`, `od`, `gl`), and sets `EXPORT_URL`, `PLANT_URL`, `DRAWIO_BASE_URL` to null.
- The srcdoc document inherits the Grafana CSP. The CSP `<meta>` adds a second policy: draw.io can load files only
  from `drawio/` (plus `data:` and `blob:` URLs). Both policies must allow a request.
- With `content_security_policy = true`, the Grafana policy has `'strict-dynamic'` and a nonce. The two script tags
  get the nonce: `window.nonce`, or the `nonce` of a Grafana `<script>` element when the frontend sandbox hides
  `window.nonce`.
- The srcdoc frame has the Grafana origin. The host accepts messages with `origin === window.location.origin`. The
  existing `event.source` check against `iframe.contentWindow` stays.
- The editor e2e test now checks that no request goes to a host other than Grafana and that no CSP violation occurs.

## Test results

| Grafana | Setting | Port | Bundled editor e2e | Full e2e suite |
|---|---|---|---|---|
| 12.4.13 | default | 3112 | pass | 9/9 |
| 13.2.4 | default | 3113 | pass | 9/9 |
| 12.4.13 | frontend sandbox | 3122 | pass | 8/9 (1) |
| 13.2.4 | frontend sandbox | 3123 | pass | 8/9 (1) |
| 12.4.13 | `content_security_policy = true` | 3132 | pass (2) | 9/9 |
| 13.2.4 | `content_security_policy = true` | 3133 | pass (2) | 9/9 |
| 13.2.4 | sandbox + CSP | 3143 | pass (3) | 8/9 (1) |
| 13.2.4 | `app_sub_url = /grafana`, `serve_from_sub_path` | 3153 | pass | 9/9 |

(1) `no-drawio.spec.ts` expects zero iframes in view mode. The sandbox adds its own iframe. No draw.io file loads.
This failure is not caused by the bundled editor.
(2) Fails before the nonce fix: the srcdoc document inherits the Grafana CSP (`'strict-dynamic'` + nonce), so script
tags without the nonce do not run. The fix reads `window.nonce`.
(3) Fails with `window.nonce` only: the sandbox hides that global. The fix falls back to the `nonce` property of a
Grafana `<script>` element.

All rows are from the final build (stricter CSP meta, nonce fallback). The editor test also checks that no CSP
violation occurs and that no request goes to a host other than Grafana. With `app_sub_url`, `<base>` is
`http://localhost:3153/grafana/public/plugins/simnv-drawiomap-panel/drawio/`.

**Frontend sandbox:** same origin fixes the handshake. With the sandbox on, the external editor
(`http://localhost:8080`) stays in phase `init` and shows the "editor cannot start" alert (near-membrane throws on a
cross-origin `event.source`). The bundled editor loads and saves.

**MIME types** (both versions): `.html` text/html, `.js` and `.mjs` text/javascript, `.css` text/css, `.txt`
text/plain, `.xml` text/xml, `.svg` image/svg+xml, `.json` application/json, `.wasm` application/wasm, `.png`,
`.gif`, `.ttf` font/ttf, `.ico`. Grafana uses Go `mime.TypeByExtension` and sends `nosniff`. The webapp has no
`.wasm` file; a test file got the correct type.

**Network:** opening the editor loads 13 files from `drawio/`, all from Grafana. Expanding all sidebar palettes,
"More shapes", and shape search load no more files and make no external request:

`js/bootstrap.js, js/main.js, js/PreConfig.js, js/PostConfig.js, js/app.min.js, js/extensions.min.js,
js/stencils.min.js, js/shapes-14-6-5.min.js, styles/grapheditor.css, mxgraph/css/common.css,
mxgraph/images/maximize.gif, resources/dia.txt, images/github-logo-white.svg`

Not tested: export to PDF/PNG, Mermaid, PlantUML, math, image shapes from `img/lib`, other UI languages.

## Sizes

| Set | Raw | zip -9 | Files |
|---|---|---|---|
| `draw.war` (download) | 48.4 MB (archive) | | |
| Full webapp without `WEB-INF`, `META-INF` | 112 MB | 44.0 MB | 3089 |
| Trimmed (prototype default) | 54 MB | 21.7 MB | 2402 |
| Files loaded when the editor opens | 20.3 MB | 6.6 MB (gzip) | 13 |
| Plugin code (`module.js`) | 176 KB | | |

Removed in the trimmed set: Java servlet part, other host pages (`dropbox.html`, `teams.html`, ...), service worker,
development sources (`js/diagramly`, `js/grapheditor`, `mxgraph/src`), `integrate.min.js` (19 MB, Confluence/Jira),
`viewer*.min.js` (14 MB), `templates/` (5.5 MB, CC BY 4.0), `shapes/` (in `shapes-14-6-5.min.js`), `plugins/`.

Largest items that remain: `js/` 25 MB (`app.min.js` 10 MB, `extensions.min.js` 4.4 MB, `stencils.min.js` 3.7 MB),
`img/` 11 MB (shape images), `resources/` 7.9 MB (61 languages), `images/` 6.5 MB, `math4/` 2 MB. More trimming
(only some languages, no `math4`, `img/lib` subsets) breaks features for some users; it is not worth it before the
size limit is known.

Transfer: Grafana does not compress by default (`[server] enable_gzip = false`). The first editor open transfers
20 MB, or 6.6 MB with `enable_gzip = true` or a compressing reverse proxy. Later opens revalidate
(`Last-Modified`, `Cache-Control: public, max-age=3600` in production mode). Viewers never load these files.

## Limits and policy

Details and source links: [bundled-drawio-limits.md](bundled-drawio-limits.md) (Grafana `pkg/api/plugins.go`,
`pkg/middleware`, grafana/plugin-validator, grafana.com/legal/plugins, jgraph/drawio licenses).

- **Size limit:** none in Grafana code for local or `grafana-cli` install, none in plugin-validator. The packaging docs
  show a 34 MB zip. grafana.com upload and Grafana Cloud limits are not public. **Ask Grafana before catalog
  submission.**
- **Plugin-validator:** no analyzer reads minified JS other than `module.js`. `js-map-not-found` and
  `tracking-scripts` check only `module.js`. `unsafe-svg-file` checks all 1772 SVG files (local scan: 0 hits).
  `virus-scan-failed` (ClamAV) on large minified files is not tested. A signed plugin must list all 2402 files in
  `MANIFEST.txt` (`sign-plugin` does this).
- **Manual review:** the policy forbids "embedding multiple plugins into a single plugin" and "derivative works"
  at the discretion of the reviewer. A vendored third-party web app is a review risk. No rule says so directly.
- **Grafana asset handler:** reads each file fully into memory per request (10 MB `app.min.js`). Acceptable for an
  editor that only editors open.
- **License:** Apache-2.0, no NOTICE file upstream. The vendor script ships `drawio/LICENSE` and `drawio/NOTICE`
  (source, version, sha256, changed files, trademark note). Bundled parts with other terms: `js/libavoid-js`
  (LGPL-2.1, separate file, orthogonal routing; the catalog license list names LGPL-3.0 only), ELK in
  `extensions.min.js` and `js/elk` (probably EPL-2.0), pako (MIT and Zlib), DOMPurify (Apache-2.0 or MPL-2.0),
  JSZip (MIT or GPLv3). Shape images (`img`, `stencils`) must not go into Atlassian products; no conflict.
- **Trademark:** "draw.io" is an EU trademark. Do not use the draw.io name or logo as the plugin name or logo.
  The NOTICE says the plugin is not affiliated with JGraph.
- **Plugin CDN** (Grafana Cloud, catalog plugins with CDN): Grafana answers `/public/plugins/<id>/*` with a 307 to
  the CDN, and `__webpack_public_path__` is the CDN URL. Scripts load cross-origin, but draw.io XHR for
  `resources/*.txt` needs CORS on the CDN. Not tested; CDN headers are not public.

## Security

The bundled editor runs on the Grafana origin. Before, the external editor ran on its own origin and could reach
Grafana only through the validated postMessage channel. Now script in the frame can use `window.parent` with the
user's session.

- Who can write a diagram: dashboard editors (UI, API, provisioning). Who opens the editor: editors and admins.
  Viewers never load draw.io. A draw.io sanitizer bypass (HTML labels, links, SVG images) becomes stored XSS from an
  editor to an admin.
- `sandbox` without `allow-same-origin` (opaque origin) is not possible now: draw.io loads `resources/*.txt` with
  XHR, Grafana sends no CORS headers, and the sandboxed plugin would see a cross-origin `event.source` again. It is
  possible if the vendor script converts the XHR resources to script files. This is the structural fix.
- The CSP `<meta>` in the srcdoc lets draw.io load scripts, styles, images, fonts and XHR only from `drawio/`, and
  blocks frames, objects, forms and other `<base>` URLs. It does not stop `window.parent` access.
- Message spoofing: the host accepts messages with the Grafana origin. When `iframe.contentWindow` is not readable
  (sandbox), the first sender with that origin is pinned. A same-origin script can already read the panel options
  and call the Grafana API, so a spoofed message gives it nothing new. A fail-closed check (no pinning without a
  verified frame window) is still cheap and is a must-fix item below.
- draw.io writes its settings (`.drawio-config`) to the Grafana localStorage.

## Update path

1. Set `DRAWIO_VERSION` and `DRAWIO_SHA256` in `scripts/vendor-drawio.sh` (sha256 of `draw.war` from
   https://github.com/jgraph/drawio/releases).
2. Run `npm run build`. It runs `scripts/vendor-drawio.sh --if-missing`, which vendors the new version and stops if a
   `bootstrap.js` patch target changed.
3. Run the editor e2e on 12.4 and 13.2, with the sandbox and with CSP.

draw.io releases about once a week. A pinned version updated monthly, and at once for security fixes, is enough.
The build needs network access to GitHub for the first download (cached in `.drawio/cache`). CI calls
`npm run build`, so it downloads the war file on each run; cache `.drawio/cache` or mirror the war file.
`npm run lint` and `npm run typecheck` do not need the vendored files.

## Recommendation

**Make the bundled editor the default after three must-fix items; keep the external Editor URL as an option.**

- Only the bundled editor works with the frontend sandbox, and it needs no extra service, no network access, and no
  third-party host that receives the diagrams. The current default (`http://localhost:8080`) works only in the dev
  stack.
- Keep the external URL for admins who want a newer draw.io, a smaller install, or an origin boundary.

Must-fix before the default changes:

1. Plugin CDN: if `__webpack_public_path__` has another origin than Grafana, do not use the bundled editor. Show a
   clear message and ask for an Editor URL.
2. Message pinning fails closed: no pinning when the frame window is not readable, or bind the channel to a random
   token that the host puts in the srcdoc.
3. CI: cache `.drawio/cache` and run the editor e2e with the sandbox and with CSP.

Dissent (Codex review): keep the bundled editor opt-in until the editor has an origin boundary (opaque-origin frame),
because a draw.io XSS on the Grafana origin reaches the user's session. A panel plugin has no admin-level setting, so
"opt-in" means a per-panel Editor URL value (for example `bundled`) that dashboard editors set. The user decides.

Other items:

- Before a catalog release: ask Grafana about size and review policy, test on a plugin CDN setup, decide about
  `libavoid-js` (LGPL-2.1), and document `enable_gzip`.
- If size or review blocks the catalog release, publish two builds: the catalog build without `drawio/` (external
  URL required) and a full build from GitHub releases.

Top risks and mitigations:

| Risk | Mitigation |
|---|---|
| draw.io XSS runs on the Grafana origin | Pin and update draw.io; keep the CSP meta; document that diagram XML is trusted at the editor level; follow-up: opaque-origin frame with script-loaded resources |
| Plugin CDN: cross-origin base, XHR without CORS | Detect a cross-origin `__webpack_public_path__`, show a clear message, fall back to the Editor URL; test before catalog submission |
| 22 MB archive, weekly upstream releases, review of a patched third-party app | Trimmed set, NOTICE and LICENSE, pinned version with sha256, asserted patches, e2e on each update |

## Open items

- Remove `docker-compose.spike.yaml` or move the sandbox and CSP variants into the main compose file.
- `no-drawio.spec.ts`: count only iframes inside the panel, so the test passes with the sandbox.
- Existing dashboards with `editorUrl: http://localhost:8080` keep the external editor. Decide about a migration.
- Test export formats, Mermaid, math, `img/lib` images, and UI languages offline.
