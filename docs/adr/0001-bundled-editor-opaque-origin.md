# 1. Bundled draw.io editor in an opaque-origin frame

- Status: accepted
- Date: 2026-10-17

## Context and problem statement

Edit mode opens the draw.io editor on a diagram from the panel options. Dashboard editors write these diagrams, and
editors and admins open them. A diagram can contain HTML labels, links and images. A bug in the draw.io sanitizer can
run script from a diagram in the editor frame. Where does the editor run, so that such script cannot use the Grafana
session of the user?

## Decision drivers

- Script in the editor frame must not read the Grafana page, cookies, storage or API.
- The editor must work without access to the internet.
- The editor must work on Grafana 12.4 and 13.2, with and without the frontend sandbox, with
  `content_security_policy = true`, and with `app_sub_url`.
- View mode loads no draw.io code.

## Considered options

1. An editor URL option: a self-hosted `jgraph/drawio` or `embed.diagrams.net`.
2. The bundled editor on the Grafana origin (an iframe on `public/plugins/.../drawio/index.html`).
3. The bundled editor in an `<iframe srcdoc sandbox>` without `allow-same-origin` (opaque origin).

## Decision outcome

Option 3. The plugin vendors a pinned draw.io release into `dist/drawio` (`scripts/vendor-drawio.sh`, with a sha256
check). The panel opens it in an iframe with `srcdoc` and a sandbox without `allow-same-origin`. The frame talks to
the panel only through a `MessagePort` that a token in the srcdoc binds. The plugin has no editor URL option.

### Consequences

- Good: script in the frame gets `SecurityError` on `window.top.document`, `document.cookie` and `localStorage`.
  `tests/editor.spec.ts` checks this on each Grafana version.
- Good: no external service and no extra container. The editor works offline.
- Good: the editor works in the frontend sandbox, with CSP and with a sub-path (`docs/security.md`, "Test results").
- Bad: the plugin zip is about 21 MB, most of it draw.io.
- Bad: draw.io cannot keep its settings between two opens (no storage in an opaque origin).
- Bad: the vendor script patches `js/bootstrap.js` and converts text resources to scripts. A new draw.io release can
  need new patches.

Option 1 gives the session to an external host or to a second origin that the operator must run. Option 2 gives a
draw.io bug the full Grafana session.

## More information

`docs/security.md`, `docs/research/bundled-drawio-spike.md`, `docs/research/bundled-drawio-limits.md`.
