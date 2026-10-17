# Bundling draw.io inside a Grafana panel plugin: limits research

Sources were read on 2026-10-17. Labels: [V] = verified from source or docs, [I] = inferred.
- Grafana main @ 3392442 (13.3.0-pre). Same code and paths checked at tags v12.0.0 and v12.3.0 (lines differ by 1-30).
- plugin-validator main @ d149c8b.  jgraph/drawio master @ 9034053 (VERSION 32.4.1).
- GH = https://github.com/grafana/grafana/blob/3392442829842df6485c9305a23c30943147ebe6
- PV = https://github.com/grafana/plugin-validator/blob/d149c8b35b96f1d4df297e16d291c975b278f3c9
- DX = https://github.com/jgraph/drawio/blob/9034053fba80a435e27d68d374bc564b83917ae9

## 0. What the draw.io webapp weighs (measured, local clone)
- [V] src/main/webapp = 109 MB raw, 3117 files. js/ = 64 MB, img 11 MB, resources 7.9 MB, templates 5.4 MB, WEB-INF 4.8 MB (Java servlet part, exclude).
- [V] Biggest: js/integrate.min.js 19.9 MB, js/app.min.js 10.1 MB, viewer-static 4.4 MB, extensions 3.9 MB, stencils 3.9 MB, templates/network/fortinet.xml 3.4 MB.
- [V] `zip -9` of webapp minus WEB-INF/META-INF = 37.9 MB; also minus templates, *.map, mxgraph/src = 33.4 MB.
- [V] 1772 .svg, 644 .png, 389 .js, 162 .xml; no plugin.json, no module.js, no dotfiles, no executables, no symlinks.
- [V] WEB-INF contains files named *_client_secret (github, gitlab, dropbox, google). Contents not read. Never ship WEB-INF.

## 1. Archive size limits
- [V] Local install, `grafana-cli plugins install --pluginUrl` / catalog download: `Client.Download` writes to a temp file with `io.Copy`, uses an HTTP client with no timeout, and has no size check. GH/pkg/plugins/repo/client.go:36,52-60,159-183.
- [V] Extraction (`FS.Extract`) copies each zip member with `io.Copy`, no byte cap. Guards are for path traversal and symlinks only. GH/pkg/plugins/storage/fs.go:45,230,336-377. grep for LimitReader/MaxBytes/size in pkg/plugins and pkg/services/pluginsintegration found nothing for archives.
- [V] Startup with a folder copied to plugins/: no size check anywhere in loader. A signed plugin is hashed in full on every start (`verifyHash` per MANIFEST file). GH/pkg/plugins/manager/signature/manifest.go:196-205.
- [V] Serving cost: `FS.File` does `io.ReadAll` of the whole file into RAM per request, then `bytes.NewReader` to `http.ServeContent`. A 20 MB integrate.min.js is fully read into memory on every request (cache header is only `public, max-age=3600`). GH/pkg/plugins/manager/filestore/fs.go:37; GH/pkg/api/plugins.go:382-400.
- [V] Catalog / plugin-validator: no max archive size, no max file size. Only size constants in the repo are 500 KB (checksum fetch, LLM tool file read), 2 MB (go.mod), 4 MB and 16 MB (CLI output capture) - none apply to the archive. PV/pkg/analysis/passes/checksum/checksum.go:136; PV/pkg/llmclient/agentic_tools.go:19.
- [V] Docs: the packaging example shows a 34,324,077 byte zip (clickhouse datasource) with no limit stated. https://grafana.com/developers/plugin-tools/publish-a-plugin/package-a-plugin.md (line 54). Pages publish-a-plugin, publish-faqs, publishing-best-practices, sign-a-plugin (.md) mention no size limit.
- [I] Grafana Labs may enforce a limit at upload on grafana.com (not open source) or reject for review reasons; no public number found. Plugin-validator's `plugin-validator` page 404s on .md; the policy page below is the only criteria text.
- [I] Grafana Cloud / plugin CDN limits are not in OSS code. Ask Grafana support before relying on a 35-110 MB plugin.

## 2. plugin-validator analyzers vs draw.io files
Registered list: PV/pkg/analysis/passes/analysis.go. Which part of the input each analyzer reads decides if it fires.

| Analyzer (rule names) | File | Reads | Fires on draw.io? |
|---|---|---|---|
| jsMap (`js-map-not-found`, `js-map-invalid`, `js-map-no-match`) | passes/jssourcemap/jssourcemap.go:19-22,49 | only `**/module.js` and its `module.js.map`; needs `sourceCodeUri` | [V] No. Glob is `/**/module.js`; draw.io has none. No source map is required for app.min.js. |
| trackingscripts (`tracking-scripts`) | passes/trackingscripts/trackingscripts.go:14,36-50 | only module.js content (via modulejs), ~15k-host blocklist `list.txt`, matches `https?://\S+` by substring | [V] No for draw.io files (not module.js). [V] I also checked 102 hosts from app.min.js + integrate.min.js against list.txt: 0 matches. [V] No google-analytics/gtag/googletagmanager string in either file. |
| modulejs (`missing-modulejs`) | passes/modulejs/modulejs.go:13,35 | module.js | [V] Plugin's own module.js still required; unaffected. |
| unsafesvg (`unsafe-svg-file`) | passes/unsafesvg/unsafesvg.go:15,38; pkg/svgvalidate/svgvalidate.go:15-34 | every `*.svg` in archive; forbidden elements (script, iframe, noscript, math, template...), any `on*` attribute | [V] Rule runs on all 1772 svgs. [I] My python scan (elements + on* attrs + XML parse) found 0 hits, so expected pass. Go's strict XML decoder may differ on odd entities. |
| virusscan (`virus-scan-failed`) | passes/virusscan/virusscan.go:21,67-90 | `clamscan -r` over whole archive + source | [I] Possible false positive on huge minified JS; skipped if clamscan missing or SKIP_CLAMAV set. No evidence either way. |
| manifest (`unsigned-plugin`, `undeclared-files`, `invalid-sha-sum`, `wrong-permissions`) | passes/manifest/manifest.go:19-28,120-185 | walks every archive file; each must be in MANIFEST.txt with right sha256, mode readable by u/g/o | [V] ~3000 files all need signing; mode must have 0444 bits. Unsigned is only a Warning for new plugins. |
| coderules / semgrep (`code-rules-*`) | passes/coderules/semgrep-rules.yaml, coderules.go:96-120 | `sourceCodeUri` repo (its `pkg/` dir if present) - NOT the archive | [V] JS rules include `src/**/*.ts|tsx`, and exclude `*.js`; only `access-old-react-internals` also scans `**/*.js`. [V] That string is absent from the webapp. So vendored draw.io is safe if kept out of repo `src/`, [I] and probably even inside it. |
| osvscanner (`osv-scanner-*`) | passes/osvscanner/osvscanner.go:79-110 | `yarn.lock`/`package-lock.json`/go.mod in source repo | [V] No lockfile for vendored JS; bundled libs (DOMPurify 3.4.16, jQuery 3.6.0, pako 2.2.0, jszip 3.10.1) are invisible to it. |
| llmreview, codediff | passes/llmreview/llmreview.go:50-60; pkg/llmvalidate/llmvalidate.go:22-60 | source repo files; ignore list includes `dist/**`, `**/*.min.js`, `**/external/**`, `node_modules/**` | [V] Minified files and dist are ignored. [I] Un-minified vendored JS in `src/` would be sent to the LLM. Skipped if any blocking analyzer errors. |
| binarypermissions (`binary-executable-found`...) | passes/binarypermissions/binarypermissions.go:17 | only when plugin.json has `executable` | [V] Not for a frontend-only panel. |
| nestedmetadata / includesnested | passes/nestedmetadata, passes/includesnested | nested plugin.json files | [V] None in draw.io. Do not ship any file named plugin.json. |
| metadatapaths (`path-not-exists`, `invalid-relative-path`) | passes/metadatapaths/metadatapaths.go | logo/screenshot/link paths in plugin.json | [V] Not affected by extra dirs. |
| restrictivedep, safelinks, brokenlinks, jargon, license, readme, logos | passes/<name>/ | plugin.json + README | [V] Not affected by webapp. `license` accepts only listed SPDX of the plugin itself. |
| archive (`dist`, `more-than-one-dir`, `no-root-dir`) | passes/archive/archive.go:14-17 | zip layout | [V] Archive must have one root dir named as plugin id; draw.io goes inside it. |

Bottom line [V+I]: no validator rule scans non-module.js JS for eval/new Function, external URLs, or missing source maps. The minified draw.io bundle is not machine-flagged by the rules above. Risk sits in manual and policy review (section 5).
- [V] Raw counts in webapp js: `new Function` 1 (app.min.js) / 4 (integrate.min.js); `eval(` 7 / 7; `googleapis.com` 14 / 9; `app.diagrams.net` 25 / 23; external hosts include accounts.google.com, apis.google.com, fonts.googleapis.com, generativelanguage.googleapis.com, cdn3.iconfinder.com, log.diagrams.net, convert.diagrams.net, viewer.diagrams.net.
- [V] `log.diagrams.net` is set only when location hostname ends in diagrams.net/draw.io (DRAWIO_LOG_URL branch in app.min.js), so no log URL on a Grafana host. [I] verify at runtime with devtools network tab.
- [V] Grafana plugin policy bans "Embedding tracking code", "Sending data to 3rd parties for analytics", "Embedding multiple plugins into a single plugin", "Forking of an existing plugin or creating derivative works"; reviewer has "sole discretion". https://grafana.com/legal/plugins/ ("Privacy and security", "Restrictions"). Also "Do not include hidden files" (none in draw.io).
- [V] Catalog licence whitelist: AGPL-3.0, Apache-2.0, BSD, GPL-3.0, LGPL-3.0, MIT (same page). That is for the plugin itself.

## 3. Grafana asset handler for /public/plugins/<id>/*
- [V] Route: `r.Get("/public/plugins/:pluginId/*", hs.getPluginAssets)`. GH/pkg/api/api.go:265 (v12.3.0 line 243). Registered after the global middleware chain, so it gets those headers.
- [V] Handler: plugin must exist in store; path through `CleanRelativePath` (`filepath.Clean("/"+p)`, kills `..`). If CDN enabled for this plugin: 307 redirect to CDN. Else `serveLocalPluginAsset`. GH/pkg/api/plugins.go:355-400; GH/pkg/plugins/filepath.go:158-167.
- [V] MIME: no custom table. `http.ServeContent(c.Resp, c.Req, assetPath, ...)` -> Go `mime.TypeByExtension(filepath.Ext(name))`, if empty then `DetectContentType` of first 512 bytes. GH/pkg/api/plugins.go:399; Go src net/http/fs.go (serveContent) and mime/type.go builtin table: .js and .mjs = `text/javascript; charset=utf-8`, .css, .html/.htm, .json = `application/json`, .svg = `image/svg+xml`, .png/.jpg/.gif/.webp, .wasm = `application/wasm`, .txt = `text/plain; charset=utf-8`. [I] .ttf and .map are not in the builtin table: Linux hosts read /etc/mime.types; else sniffing gives a font or octet type. Matters little for draw.io.
- [V] `X-Content-Type-Options: nosniff` is on by default (`x_content_type_options = true`), so JS must have a JS MIME. GH/pkg/middleware/middleware.go:84-86; GH/conf/defaults.ini:549.
- [V] No allowlist of extensions, no "only files in MANIFEST" rule when serving. `LocalFS.Open` rejects: directories, files outside plugin dir, symlinks whose target is outside plugin dir. Dotfiles are served. GH/pkg/plugins/localfiles.go:38-80,110-130. [I] `Open` calls `os.Stat` (follows symlinks) before the symlink test, so that test is weak; irrelevant to the plan.
- [V] Signature: a signed plugin with any file not in MANIFEST.txt gets status "modified" (rejected) - "files were not included in the signature". Every file must be signed. GH/pkg/plugins/manager/signature/manifest.go:216-240.
- [V] X-Frame-Options: `AddDefaultResponseHeaders` runs for every response, with no path exception for /public/plugins. If `allow_embedding=false` (default) and no `X-Allow-Embedding: allow` header on the response, it sets `X-Frame-Options: deny`. Nothing in OSS sets X-Allow-Embedding. GH/pkg/middleware/middleware.go:32-67,99-101; GH/pkg/api/http_server.go:712. Docs: https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/index.md (`allow_embedding`, default false).
  - [I] Consequence: `<iframe src="/public/plugins/<id>/drawio/index.html">` is blocked by default, even same-origin (DENY has no same-origin exception). Needs `allow_embedding = true` (global clickjacking trade-off) or a non-HTTP document (srcdoc/blob built from fetched HTML) - untested.
- [V] CSP: `ContentSecurityPolicy` middleware is added to the global chain only if `content_security_policy` or report-only is true (default false). When on, it sets `Content-Security-Policy` on every response, including plugin static files, not only index HTML. GH/pkg/middleware/csp.go:18-29,45-53; GH/pkg/api/http_server.go:741-743; default template GH/conf/defaults.ini:558-563.
  - [V] Default template: `script-src 'self' 'unsafe-eval' 'unsafe-inline' 'strict-dynamic' $NONCE; object-src 'none'; font-src 'self'; style-src 'self' 'unsafe-inline' blob:; img-src * data: blob:; base-uri 'self'; connect-src 'self' grafana.com *.cartocdn.com ws://$ROOT_PATH wss://$ROOT_PATH; manifest-src 'self'; media-src 'none'; form-action 'self' ...`.
  - [I] With CSP on, draw.io's index.html (plain `<script src>` tags, no nonce) would lose: `'strict-dynamic'` + nonce makes browsers ignore 'self' and 'unsafe-inline' for scripts. Also `connect-src` blocks its calls to googleapis/diagrams.net; `font-src 'self'` blocks Google Fonts. CSP is default-off, so this only hits hardened installs.
- [V] Cache: `Cache-Control: public, max-age=3600` (no-cache in dev env). Gzip only if `enable_gzip`. GH/pkg/api/plugins.go:390-396; GH/pkg/api/http_server.go:692.

## 4. Plugin CDN
- [V] OSS mechanism: `[plugins] cdn_base_url` + per-plugin `[plugin.<id>] cdn=true`. Then (a) frontend settings carry `pluginsCDNBaseURL`; (b) `/public/plugins/<id>/*` answers `307 Temporary Redirect` to `{cdn_base}/{id}/{version}/public/plugins/{id}/{assetPath}`. GH/pkg/plugins/pluginscdn/pluginscdn.go:14-60; url_constructor.go; GH/pkg/api/plugins.go:402-427; GH/pkg/api/frontendsettings/frontendsettings.go:231-236; GH/pkg/setting/setting_plugins.go:214.
- [V] Frontend rewrites plugin JS served from the CDN: regex replaces every `(/?)public/plugins` in module source with `<cdn origin+path>/public/plugins`. So a literal string like `"public/plugins/<id>/drawio/index.html"` in module.js becomes an absolute CDN URL. GH/public/app/features/plugins/cdn/utils.ts:6-36; used in GH/public/app/features/plugins/loader/systemjsHooks.ts:165-168 and sandbox/codeLoader.ts. `isHostedOnCDN(path)` = path starts with `config.pluginsCDNBaseURL` (loader/utils.ts:54).
- [V] The webpack template sets `__webpack_public_path__` from the AMD module URI (`amdMetaModule.uri` up to last `/`), falling back to `public/plugins/<id>/`. Local file: .config/webpack/webpack.config.ts:30-38. So on a CDN, chunk and asset URLs resolve to the CDN origin.
- [I] An iframe pointing at plugin static files would therefore be cross-origin to Grafana on CDN installs: no shared storage, `postMessage` needs explicit origin, and a hard-coded same-origin check fails. Use a relative URL built from `__webpack_public_path__` (not a literal `/public/plugins/...` string) and check `event.origin` against it.
- [V] Loading strategy changes to `fetch` for CDN plugins (not `script`), plus SRI module hash only for CDN plugins. GH/pkg/plugins/pluginassets/loadingstrategy.go:24-52; modulehash/modulehash.go:109-115.
- [V] No plugin-tools doc page (all 150+ pages in llms.txt were grepped) mentions the plugin CDN; the only CDN doc is the Grafana `cdn_url` setting for core assets.
- [not verifiable] Which files/extensions the Grafana-run CDN serves, its CORS and framing headers, and its size caps are not in the OSS repo. The OSS code uses `{id}/{version}/public/plugins/{id}/{assetPath}` for any path, which suggests the whole archive is mirrored [I]. Ask Grafana.

## 5. draw.io licence and trademark
- [V] No NOTICE file in the repo or webapp (`find -iname 'NOTICE*'` = none). Licence files: LICENSE (Apache-2.0), src/main/webapp/{stencils,shapes,img}/LICENSE (Atlassian restriction), templates/LICENSE (CC BY 4.0), js/libavoid-js/LICENSE (LGPL-2.1). DX/README.md.
- [V] Apache-2.0 sec. 4 duties when redistributing (DX/LICENSE:89-121): (a) give recipients a copy of the licence; (b) mark modified files; (c) keep copyright/attribution notices in source; (d) copy NOTICE text only if a NOTICE exists (none). Ship LICENSE as `drawio/LICENSE` and a THIRD-PARTY note. Sec. 6: no trademark grant (DX/LICENSE:138-141).
- [V] Trademark (DX/README.md "Trademark"): "draw.io is a registered EU trademark (#018062448). Do not use the draw.io name or logo in ways that suggest affiliation with, endorsement by, or sponsorship by draw.io. Do not use draw.io logos for your own business, product, project, domain, or social media presence. Do not modify the draw.io logos. Use of draw.io trademarks requires prior written permission." [I] Do not use "draw.io" in the plugin id/name (current `drawiomap` is a nominative reference; keep "Not affiliated with draw.io" in the README), and do not ship the draw.io logo as plugin logo. Consider removing the logo from the embedded UI and `img/` brand assets.
- [V] README restriction on icon sets/stencils/img (also in each LICENSE): may not be "incorporated into Atlassian products or ... the Atlassian marketplace or plugin ecosystem". [I] Not a Grafana plugin conflict.
- [V] README claims all bundled JS is compatible with Apache-2.0, "no GPL or AGPL".
- Bundled third-party parts (banners read from files; versions as shipped):
  - mxGraph (js/grapheditor, mxgraph/): Apache-2.0, copyright JGraph/draw.io AG headers. Keep headers.
  - DOMPurify 3.4.16 (js/sanitizer/purify.min.js): banner "Apache license 2.0 and Mozilla Public License 2.0" - dual; choose Apache-2.0, keep banner.
  - pako 2.2.0: "(MIT AND Zlib)" - both texts apply; keep banner. Notice-requirement.
  - JSZip 3.10.1: banner "Dual licenced under the MIT license or GPLv3". Choose MIT; keep banner. Notice-requirement.
  - jQuery 3.6.0, CryptoJS 4.2.0 (MIT, banner), rough.js, spin.js 2.0.0, simple-peer 9.10.0, Dropbox SDK 2.5.13: MIT-type [I for those without explicit banner]. Keep banners.
  - Bridge.NET 15.6.0 + OrgChart.Layout (js/orgchart): banner "@license: See license.txt ... bridgedotnet/Bridge/LICENSE.md"; Bridge is Apache-2.0 [I]; OrgChart.Layout licence not stated in file [I - check].
  - libavoid (js/libavoid-js/libavoid.min.js, 560 KB): README says built from Adaptagrams libavoid, LGPL-2.1. [V] Only non-permissive copyleft. Notices and relinkable source needed; it is a separate file so the user can swap it. [I] Catalog whitelist names LGPL-3.0 not LGPL-2.1: safest to delete libavoid-js/ and `LibavoidRouting.js` loading (loses "Orthogonal Routing" menu).
  - drawio-elk.min.js (904 KB, `@drawio/elk`): uses Eclipse ELK property names (`org.eclipse.elk.*`). ELK is EPL-2.0. Bundle has no licence banner and the jgraph/drawio-elk repo is not public via API. [I] EPL-2.0 notice likely needed (weak copyleft on modified files, source offer).
  - drawio-mermaid.min.js (1.0 MB; Mermaid MIT; bundles dagre/d3/cytoscape-type libs with MIT/ISC/BSD licences) [I]. drawio-plantuml.min.js (1.1 MB): own TS converter, mentions LGPL ditaa only as unsupported [V in strings]; [I] licence not stated. drawio-vsd.min.js: banner "(c) JGraph Ltd | Apache-2.0".
  - MathJax (math4/es5/drawio-mathjax.min.js, 2 MB): MathJax 3/4 is Apache-2.0 [I]; no banner found in the first bytes. Fonts/ttf: styles/fonts/ArchitectsDaughter-Regular.ttf (OFL or Apache upstream [I]).
  - templates/ : CC BY 4.0 - attribution required; drop templates/ (5.4 MB) to avoid it.
  - Omit: WEB-INF/lib/*.jar (Java: gson, httpclient, ehcache, commons-*, all Apache-2.0; not needed), `*.map`, `mxgraph/src`, `monday-app-association.json`.

## 6. Suggested pruning checklist for the spike
- [I] Ship: index.html, js/ (minus *.map, libavoid, plantuml/vsd if unused), styles/, images/, img/, resources/ (only needed locales), stencils/, shapes/, mxgraph/ (css, images, mxClient.js), math4/ if math wanted, plugins/. Drop WEB-INF, META-INF, templates, service-worker*.js (service worker cannot register under /public/plugins scope).
- [I] Expected zip ~25-33 MB after pruning (measured 33.4 MB without templates/maps). Largest single file is integrate.min.js (19.9 MB); check whether the chosen entry point loads it, and drop it if not (untested).
- [I] Keep draw.io out of repo `src/` (vendor at build time into `dist/drawio/`) so semgrep and the LLM review ignore it; keep a pinned version + checksum list, and ship LICENSE + THIRD-PARTY-NOTICES in `dist/`.
- [I] Test with: `allow_embedding` false (iframe blocked), `content_security_policy=true`, and `plugins.cdn_base_url` set.
