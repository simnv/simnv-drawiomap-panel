# Security of the draw.io editor

Date: 2026-10-17. draw.io 32.4.1. Tested on Grafana 12.4.13 and 13.2.4.

## Threat

Dashboard editors write diagrams (panel UI, API, provisioning). Editors and admins open the draw.io editor. Viewers
never load draw.io. A diagram can contain HTML labels, links and images. A bug in the draw.io sanitizer can run
script from a diagram in the editor frame. If that frame has the Grafana origin, the script can use the session of
the user who opens the editor: it can read the Grafana page, call the Grafana API, and read the Grafana
localStorage. An editor can then attack an admin (stored XSS).

## Decision

The bundled editor runs in an **opaque origin**. Script in the editor frame cannot use the Grafana page, the Grafana
cookies, the Grafana storage or the Grafana API, also when draw.io has a bug. The frame talks to the panel only
through one message channel with a fixed protocol.

The plugin does not offer the bundled editor on the Grafana origin. The opaque-origin frame works on Grafana 12.4 and
13.2, with and without the frontend sandbox, with `content_security_policy = true`, and with `app_sub_url`. A
same-origin fallback would only add risk.

## How the isolation works

| Part | What it does | File |
|---|---|---|
| `<iframe srcdoc>` | Grafana sends `X-Frame-Options: deny` for plugin files, so the frame cannot load `drawio/index.html`. A srcdoc document is not subject to `X-Frame-Options`. | `src/editor/target.ts` |
| `sandbox="allow-scripts allow-popups allow-downloads allow-modals"` | No `allow-same-origin`: the document has an opaque origin (`window.origin === 'null'`). No `allow-top-navigation`, no `allow-popups-to-escape-sandbox`, no `allow-forms`. | `src/editor/target.ts` (`EDITOR_SANDBOX`) |
| `<base href=".../public/plugins/simnv-drawiomap-panel/drawio/">` | Absolute URLs for all draw.io files. Scripts, styles and images load cross-origin. Grafana sends no `Cross-Origin-Resource-Policy`, so the browser does not block them. | `src/editor/target.ts` |
| CSP `<meta>` | draw.io can load files only from `drawio/` (plus `data:` and `blob:`). Frames, objects and forms are blocked. The frame also inherits the Grafana CSP. | `src/editor/target.ts` (`editorCsp`) |
| Text resources as scripts | XHR from an opaque origin to Grafana fails (no CORS). The vendor script converts `resources/dia*.txt` to `resources/dia*.txt.js`. The shim loads the script file when draw.io requests the text file, and finishes the XHR without a network request. | `scripts/vendor-drawio.sh`, `src/editor/drawio-shim.js` |
| Message channel | See below. | `src/editor/protocol.ts`, `src/editor/drawio-shim.js`, `src/editor/DrawioModal.tsx` |
| Image files for the export | The frame cannot read image bytes of `drawio/img` (no CORS), but the export must embed images as `data:` URLs. The frame asks the panel through the channel. The panel reads only image files (png, gif, jpg, svg, webp) inside `drawio/`, without credentials and without redirects, up to 10 MB. | `src/editor/files.ts` |

### Message channel

The Grafana frontend sandbox does not let the plugin read `iframe.contentWindow` (it throws `iframe.contentWindow is
not allowed in sandboxed plugins`). It also throws `SecurityError` on `event.source` for a cross-origin frame. So
the panel cannot compare the sender with the frame window, and it cannot reply to the frame window. A transferred
`MessagePort` works with and without the sandbox. The channel uses it:

1. Each editor modal makes a new random 128-bit token (`crypto.getRandomValues`) and writes it into the srcdoc
   (`<meta name="dmap-channel">`).
2. The shim in the frame makes a `MessageChannel` and sends one hello `{"dmapHello": <token>}` to the panel. The hello
   transfers one port.
3. The panel accepts the port only if `event.origin === 'null'`, the token is correct, and the hello has exactly one
   port. If the panel can read the frame window and the sender (no frontend sandbox), the sender must also be the
   frame window. There is no "first sender wins" rule: a message without the token never binds.
4. After that, protocol messages and replies go only through the port. The panel does not post anything to a window.
5. In the frame, the shim sets `window.parent` to the port. draw.io sends with `window.parent.postMessage` and accepts
   messages whose source is `window.parent`, so draw.io talks only through the port.

Only the frame and script on the Grafana page can read the token. Script on the Grafana page already has full access.

The plugin has no external editor. An `editorUrl` value that an older version saved is ignored.

## What script in the bundled editor frame can do

| Action | Result | Proof |
|---|---|---|
| Read `window.top.document` | `SecurityError` | `tests/editor.spec.ts` |
| Read `document.cookie` | `SecurityError` | `tests/editor.spec.ts` |
| Use `localStorage` | `SecurityError` | `tests/editor.spec.ts` |
| `fetch` a plugin file (CSP allows it) | `TypeError` (no CORS) | `tests/editor.spec.ts` |
| `fetch` the Grafana API | blocked by the CSP `<meta>`. Without the CSP: no CORS, so the frame cannot read the answer | manual check (CSP violation in the console) |
| Send protocol messages | yes: this is the editor. A save stores the diagram in the panel options. The panel sanitizes the SVG (`src/render/sanitize.ts`). | `src/editor/protocol.ts` |
| Read files through the panel | only image files inside `drawio/`. These are public plugin files. | `src/editor/files.test.ts` |
| Open a popup | yes. The popup inherits the sandbox (no `allow-popups-to-escape-sandbox`). | browser rule, not tested |
| Navigate the frame | yes. The new document is also sandboxed and has no channel. With a copy of the token it can open a channel, but it gets nothing that the frame does not have already. | analysis, not tested |

## Trade-offs

- draw.io cannot save its settings (`.drawio-config`) between two opens: the opaque origin has no localStorage.
  Before, draw.io wrote them into the Grafana localStorage.
- The UI language is English. draw.io uses the browser language only on its own hosts. The other 60 languages load
  on demand (Extras > Language or a `lang` parameter), tested with `de`.
- Images in diagrams: the export embeds the image files of `drawio/` through the panel. Images on other hosts stay as
  URLs; the panel sanitizer and the CSP decide about them.
- The panel answers file requests of the frame. This adds code on the panel side. The URL check uses the URL parser
  (it removes dot segments, also `%2e%2e`), a prefix check on `drawio/`, and a list of image types.
- Plugin CDN (not tested): scripts and images load cross-origin and need no CORS. The panel reads export images with
  `fetch`, which needs CORS on the CDN, and the Grafana CSP must allow the CDN in `connect-src`. Without that, images
  stay as URLs.

## Test results

`tests/editor.spec.ts` has 2 tests: edit and save with the isolation probes, and image embedding. The sandbox and
CSP rows use `docker-compose.spike.yaml` with a separate compose project
(`docker compose -p drawiomap-iso -f docker-compose.spike.yaml up -d <service>`).

| Grafana | Setting | Port | Result |
|---|---|---|---|
| 12.4.13 | default | 3012 | 3 passed |
| 13.2.4 | default | 3013 | 3 passed |
| 12.4.13 | frontend sandbox | 3122 | 3 passed |
| 13.2.4 | frontend sandbox | 3123 | 3 passed |
| 13.2.4 | `content_security_policy = true` | 3133 | 3 passed |
| 13.2.4 | frontend sandbox + CSP | 3143 | 3 passed |
| 13.2.4 | `app_sub_url = /grafana` | 3153 | 3 passed |

The table is from the time when the file had a third test, for the removed external editor. That test is deleted. The
bundled editor works with the frontend sandbox.
