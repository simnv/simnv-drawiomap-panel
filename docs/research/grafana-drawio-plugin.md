# Research: Grafana draw.io weathermap panel (`simnv-drawiomap-panel`)

Date: 2026-10-16. Research only; no code was scaffolded.

Evidence types used:

- Web docs and repositories (linked inline).
- Package registries (npm, Docker Hub, GitHub API).
- Local probe: draw.io Desktop 32.4.1 CLI (`/opt/homebrew/bin/drawio`) exported a small
  test diagram to SVG in a temporary directory. Results are marked "probe".

Contents:

1. Grafana plugin toolchain (late 2026)
2. Embedding the draw.io editor
3. View-mode rendering options
4. Prior art
5. Link visualization
6. Sparklines
7. Binding model and config schema
8. Recommendations
9. Open questions

---

## 1. Grafana plugin toolchain (late 2026)

### 1.1 Versions

| Item                           | State on 2026-10-16                                                                                      | Source                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `@grafana/create-plugin`       | 7.13.0, published 2026-10-15, Node `>=20`                                                                | [npm registry](https://registry.npmjs.org/@grafana/create-plugin/latest), [GitHub releases](https://github.com/grafana/plugin-tools/releases) |
| Template `@grafana/*` libs     | 13.x ("latest" since 7.12.0, 2026-09-22)                                                                 | [create-plugin CHANGELOG](https://raw.githubusercontent.com/grafana/plugin-tools/main/packages/create-plugin/CHANGELOG.md)                    |
| Template `@grafana/plugin-e2e` | 3.15.x (3.15.1 on npm, peer `@playwright/test ^1.52`)                                                    | npm registry                                                                                                                                  |
| `@grafana/ui`                  | 13.2.4, peer `react >=19`                                                                                | npm registry                                                                                                                                  |
| Grafana releases               | 13.0 on 2026-04-14 (React 19), 13.1 on 2026-06-23, 13.2 on 2026-08-18; patches 13.0.11 / 13.1.8 / 13.2.4 | [What's new 13.0](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/), [endoflife.date](https://endoflife.date/grafana)     |

### 1.2 Grafana version target and React

- Grafana 13.0 moved core to React 19. Grafana shares one React instance with all plugins, so the
  React version in the plugin `package.json` does not change the runtime. From `@grafana/* 13.2.0`
  the peer dependency is `react >=19`; the plugin must align `react`, `react-dom` and `@types/react`
  to 19.x or `npm install` fails with `ERESOLVE`.
  Sources: [React 19 blog](https://grafana.com/blog/react-19-is-coming-to-grafana-what-plugin-developers-need-to-know/),
  [13.1 to 13.2 migration guide](https://github.com/grafana/plugin-tools/blob/main/docusaurus/docs/migration-guides/update-from-grafana-versions/v13.1.x-v13.2.x.md).
- Scanner for React 19 breakage: `npm run build && npx -y @grafana/react-detect@latest`
  (finds `findDOMNode`, string refs, `defaultProps` on function components, legacy context, `ReactDOM.render`).
- Grafana 13.0 removed deprecated `@grafana/ui` Graph components (`Graph`, `GraphWithLegend`, ...).
  `config.apps` / `config.panels` in `@grafana/runtime` are removed in 13.2.
- Grafana 11 disabled Angular by default; this is why Flowcharting died (section 4).
- A plugin compiled against `@grafana/* 13.2` runs on Grafana 12 (React 18 runtime) if it avoids
  React 19-only APIs and 13-only `@grafana/ui` exports. `grafanaDependency` in `plugin.json` must be
  the earliest version that is actually tested ([best practices](https://grafana.com/developers/plugin-tools/key-concepts/best-practices)).
  Tip from the docs: use a prerelease suffix (`>=12.1.0-0`) if Grafana Cloud prerelease builds must install it.
- Scenes: dashboards are Scenes-based and the pre-Scenes toggle is gone in 13. Panel plugins are
  not affected: the `PanelProps` contract is unchanged. Scenes matter only for app plugins.
- Plugin Frontend Sandbox (public preview since 11.5, off by default, per-plugin opt-in via
  `enable_frontend_sandbox_for_plugins`): isolates plugin JS in a separate context. Known issues
  include CDN-loaded code and regex differences. A panel that mounts an `<iframe>` and listens to
  `window.postMessage` should be tested with the sandbox on, but the sandbox is not required.
  Source: [Plugin Frontend Sandbox docs](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-frontend-sandbox/).

### 1.3 Panel options API

- `new PanelPlugin<Options, FieldConfig>(Component).setPanelOptions(builder => ...)`.
  Builder methods: `addBooleanSwitch`, `addSelect`, `addRadio`, `addNumberInput`, `addTextInput`,
  `addSliderInput`, `addColorPicker`, `addCustomEditor`, `addNestedOptions`; every item supports
  `category: ['...']`, `showIf: (opts) => boolean`, `defaultValue`, `settings`.
- Custom editor: `builder.addCustomEditor({ id, path, name, editor: MyEditor, settings })`.
  `MyEditor` receives `StandardEditorProps<Value, Settings, Options>`: `value`, `onChange`,
  `item.settings`, and `context` (`context.data` = last query result frames; `context.options`).
  This is where the "Open draw.io editor" button and the binding-rule editor live.
  Source: [custom panel option editors](https://grafana.com/developers/plugin-tools/how-to-guides/panel-plugins/custom-panel-option-editors).
- Standard field config reuse: `.useFieldConfig({ standardOptions: { [FieldConfigProperty.Thresholds]: {...}, [FieldConfigProperty.Mappings]: {}, [FieldConfigProperty.Unit]: {}, [FieldConfigProperty.Links]: {}, [FieldConfigProperty.Color]: { settings: { byValueSupport: true } } }, disableStandardOptions: [...], useCustomConfig: builder => ... })`.
  Custom per-field properties support `shouldApply`, `category`, `showIf`, and overrides
  (`override`, `process: identityOverrideProcessor`).
  Source: [field overrides guide](https://github.com/grafana/plugin-tools/blob/main/docusaurus/docs/how-to-guides/panel-plugins/field-overrides.md).
- Value reduction, thresholds, mappings, units, colors in one call:

  ```ts
  const values = getFieldDisplayValues({
    fieldConfig, reduceOptions: { calcs: [ReducerID.lastNotNull], values: false },
    data: data.series, theme, replaceVariables, timeZone,
  });
  // values[i].display.{text,color,numeric}, values[i].field (FieldConfig), values[i].hasLinks, values[i].getLinks
  ```

  `display.color` already applies the thresholds / color mode / value mappings of that field,
  including per-series overrides the user set with "Fields with name matching regex".
  Source: [value mappings guide](https://grafana.com/developers/plugin-tools/how-to-guides/panel-plugins/add-value-mappings-support).

- Data links: `getFieldDisplayValues` attaches `hasLinks` / `getLinks` per field value. Wrap the
  clickable SVG element with `DataLinksContextMenu` and call `api.openMenu` on click. The guide
  casts the component type for cross-version compatibility.
  `getLinksSupplier` / `getFieldLinksSupplier` are internal (`public/app/features/panel/panellinks/linkSuppliers.ts`), not exported; do not depend on them.
  Source: [add datalinks support](https://grafana.com/developers/plugin-tools/how-to-guides/panel-plugins/add-datalinks-support).
- URL templates with series labels: `replaceVariables(template, scopedVars)` from `PanelProps`.
  Build `scopedVars` in the same shape Grafana uses for data links:
  `{ __series: { value: { name, refId } }, __field: { value: { name, labels } }, __value: { value: { raw, numeric, text, time } } }`
  so user templates can use `${__field.labels.instance}`, `${__value.numeric}`, `${__url_time_range}`.
  Sources: [data link variables](https://grafana.com/docs/grafana/latest/panels-visualizations/configure-data-links/),
  [linkSuppliers.ts](https://fossies.org/linux/grafana/public/app/features/panel/panellinks/linkSuppliers.ts),
  [interpolate variables guide](https://grafana.com/developers/plugin-tools/how-to-guides/panel-plugins/interpolate-variables).
- Field matchers available in `@grafana/data` (`FieldMatcherID`): `byName`, `byNames`, `byRegexp`,
  `byRegexpOrNames`, `byType`, `byTypes`, `byFrameRefID`, `byValue`, `numeric`, `time`, `first`,
  `firstTimeField`. There is no built-in "by label" matcher; label selection (e.g. `instance="r1", direction="in"`)
  must be implemented in the plugin against `field.labels`.
  Source: [matchers/ids.ts](https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/transformations/matchers/ids.ts).
- Useful `PanelProps` members: `onOptionsChange` (weathermap plugins use this for in-view editing),
  `replaceVariables`, `timeRange`, `timeZone`, `eventBus`, `width`, `height`, `fieldConfig`.

### 1.4 Docker dev environment and provisioning

- `create-plugin` scaffolds `docker-compose.yaml` that `extends` `.config/docker-compose-base.yaml`
  (build arg `grafana_version: ${GRAFANA_VERSION:-...}`, mounts `./dist` into
  `/var/lib/grafana/plugins/<id>`, `./provisioning` into `/etc/grafana/provisioning`, sets
  `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=<id>`, live reload). Run against another Grafana with
  `GRAFANA_VERSION=12.3.0 docker compose up --build`.
  Sources: [set up Docker](https://github.com/grafana/plugin-tools/blob/main/docusaurus/docs/set-up/set-up-docker.md),
  [13.2 migration guide](https://github.com/grafana/plugin-tools/blob/main/docusaurus/docs/migration-guides/update-from-grafana-versions/v13.1.x-v13.2.x.md),
  [example compose from a Grafana Labs plugin](https://github.com/grafana/grafana-resources-exporter-plugin/blob/main/docker-compose.yaml).
- Provision a Prometheus datasource (`provisioning/datasources/*.yaml`) and a test dashboard
  (`provisioning/dashboards/*.yaml` + JSON) so e2e tests have deterministic data. OrbStack runs
  standard Compose files; nothing special is needed.
- Plugin static files: anything copied to `dist/` (`src/img/**`, `src/static/**`) is served at
  `/public/plugins/<plugin-id>/...`. Use `plugin.meta.baseUrl` or the module URL to build the path,
  because Grafana can run under a sub-path.
  Sources: [community: static assets](https://community.grafana.com/t/include-additional-static-assets-with-source/60837),
  [Grafana commit on `/public/plugins/:pluginId/*`](https://github.com/grafana/grafana/commit/c37a3bebb7b5eb3a0bee5ffb26798282f0abead0).

### 1.5 End-to-end tests

- `@grafana/plugin-e2e` extends Playwright with fixtures (`panelEditPage`, `dashboardPage`,
  `getCustomOptions('...')`, `getStandardOptions()`, `getByGrafanaSelector(selectors...)`).
  Config pattern: `auth` project, then `run-tests` project with `storageState`.
  CI: `grafana/plugin-actions/e2e-version` builds a Grafana version matrix.
  Sources: [test a panel plugin](https://grafana.com/developers/plugin-tools/e2e-test-a-plugin/test-a-panel-plugin),
  [CI workflow](https://grafana.com/developers/plugin-tools/e2e-test-a-plugin/ci),
  [clock-panel playwright.config.ts](https://github.com/grafana/clock-panel/blob/main/playwright.config.ts).
- For this plugin, e2e should: load a provisioned dashboard, assert that an edge `<path>` gets the
  expected stroke color for a known test value, and open the editor modal and assert the iframe
  `src`. Testing the real draw.io editor inside the iframe is cross-origin; keep that test to
  "iframe appears and `init` event handshake completes" (postMessage can be observed from the page).

### 1.6 Signing for private use

- Options: (a) unsigned, `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=simnv-drawiomap-panel`;
  (b) private signature: Grafana Cloud account whose slug equals the plugin ID prefix (`simnv`),
  access-policy token with scope `plugins:write`, then `npx @grafana/sign-plugin --rootUrls https://grafana.example/`.
  `rootUrls` must equal the instance `root_url` exactly (scheme, host, port, sub-path); wildcards
  are not accepted. Signing creates `dist/MANIFEST.txt`.
  Sources: [sign a plugin](https://grafana.com/developers/plugin-tools/publish-a-plugin/sign-a-plugin),
  [forum: rootUrl without exact URL](https://community.grafana.com/t/can-i-sign-a-private-plugin-without-knowing-exact-rooturl/126383),
  [Volkov Labs: unsigned plugins](https://volkovlabs.io/grafana/allow-unsigned/).
- Practical: for a home/lab deployment, unsigned plus the env var is the normal choice; sign only
  if a Grafana Cloud account already exists with the `simnv` slug.

### 1.7 Supporting the latest Grafana 12.x and 13.x at the same time (required)

Release state on 2026-10-16 ([endoflife.date](https://endoflife.date/grafana)):

| Line | Latest patch         | Released   | Security support ends | React runtime |
| ---- | -------------------- | ---------- | --------------------- | ------------- |
| 12.4 | 12.4.13 (2026-10-13) | 2026-02-24 | 2027-05-24            | 18            |
| 12.3 | 12.3.11              | 2025-11-19 | 2026-08-19 (ended)    | 18            |
| 13.0 | 13.0.11              | 2026-04-14 | 2027-01-09            | 19            |
| 13.1 | 13.1.8               | 2026-06-23 | 2027-03-20            | 19            |
| 13.2 | 13.2.4               | 2026-08-18 | 2027-05-18            | 19            |

**`grafanaDependency`:** `">=12.4.0"`. Reasons: 12.4 is the only 12.x line still in security support;
the create-plugin 7.13 bundler externalises `react/jsx-runtime` and `react/jsx-dev-runtime` by
default ([externals.ts](https://raw.githubusercontent.com/grafana/plugin-tools/main/packages/create-plugin/templates/common/.config/bundler/externals.ts)),
and Grafana provides those modules to plugins only from 12.3.0 (plus a few backport patches), so a
scaffolded plugin cannot load on older 12.x anyway ([React 19 blog](https://grafana.com/blog/react-19-is-coming-to-grafana-what-plugin-developers-need-to-know/),
[12.x to 13.x migration guide](https://raw.githubusercontent.com/grafana/plugin-tools/main/docusaurus/docs/migration-guides/update-from-grafana-versions/v12.x-v13.x.md)).
No upper bound: `grafana cli plugins install` (12.0+) enforces `grafanaDependency`, and a
`<14` cap would block future patches for no gain.

**`@grafana/*` packages to build against:** two valid strategies.

1. Oldest-supported (recommended): `@grafana/data|ui|runtime|schema = 12.4.x` with
   `react`/`react-dom`/`@types/react` 18.3.x. TypeScript then rejects APIs that do not exist at
   runtime on 12.4, which is the real risk of a dual-version plugin. React 18 types are a subset
   of what React 19 runtime accepts for this plugin's needs.
2. Newest (13.2.x) with React 19 types: required only if a 13-only API is needed. Then every
   13-only import must be guarded, and the plugin must still be tested on 12.4.
   Note: `@grafana/* 13.2+` declare peer `react >=19`, so npm forces React 19 in `package.json`
   (types only; runtime is Grafana's).

Either way: do not bundle React; never pin a different React than the peer; run
`npx -y @grafana/react-detect@latest` after `npm run build` in CI.

**API changes and deprecations between 12 and 13 that touch panel plugins:**

| Area                           | Grafana 12.x                                                                                                  | Grafana 13.x                                                                                                | Effect on this plugin                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React                          | 18                                                                                                            | 19 (core from 13.0; `@grafana/*` peer `>=19` from 13.2)                                                     | No `findDOMNode`, string refs, `defaultProps` on function components, legacy context, `ReactDOM.render`; avoid libraries that touch `__SECRET_INTERNALS` (`react-draggable` < 4.4, old `rc-*`, `react-window`, `@tanstack/react-query` without the jsx-runtime fix). Iframe + `postMessage` code is plain DOM and unaffected |
| Angular                        | Removed in 12.0 (toggle gone)                                                                                 | Removed                                                                                                     | None; React-only plugin. Confirms Flowcharting cannot be revived                                                                                                                                                                                                                                                             |
| Dashboards                     | Scenes-based; dynamic dashboards and schema v2 experimental (one-way migration)                               | Dynamic dashboards GA; pre-Scenes fallback removed; `/api` deprecated in favour of `/apis`                  | `PanelProps` unchanged. Do not read or write dashboard JSON from the panel; store everything in panel `options`/`fieldConfig`. If the plugin ever calls Grafana HTTP APIs, prefer `/apis`                                                                                                                                    |
| Panel options and field config | `PanelPlugin.setPanelOptions`, `useFieldConfig`, `addCustomEditor`, `addNestedOptions`, `showIf`, `category`  | Same                                                                                                        | Stable; safe to rely on                                                                                                                                                                                                                                                                                                      |
| Data links                     | `DataLinksContextMenu` lost its `actions` prop in 12.0; actions and one-click links exist in field config     | Same; `getFieldDisplayValues` -> `hasLinks`/`getLinks` unchanged                                            | Use the documented cast pattern; do not pass `actions`. Panel "Actions" (HTTP calls) are field-config features that come for free through `getLinks`                                                                                                                                                                         |
| `@grafana/ui`                  | Deprecated `Graph*` components still exported                                                                 | `Graph`, `GraphWithLegend`, `GraphContextMenu`, `GraphSeriesToggler` and one more component removed in 13.0 | Do not import them; `Sparkline`, `Modal`, `DataLinksContextMenu`, `useStyles2`, `useTheme2` remain                                                                                                                                                                                                                           |
| `@grafana/runtime`             | `config.apps`, `config.panels` available                                                                      | Deprecated, removed in 13.2                                                                                 | Do not use; use `PluginMeta` from `PanelProps`/`usePluginContext`                                                                                                                                                                                                                                                            |
| UI extensions API              | Legacy `configureExtensionLink` removed in 12.0; `addLink()` `category` deprecated in 13 (use `group`)        | Same                                                                                                        | Not used by a panel plugin                                                                                                                                                                                                                                                                                                   |
| `plugin.json`                  | `dependencies.grafanaDependency` enforced by CLI since 12.0; `languages` (i18n) and `extensions` object exist | Same; no new required fields for panels found                                                               | Keep `type: panel`, `id: simnv-drawiomap-panel`, `dependencies.grafanaDependency: ">=12.4.0"`, `info.*`. Optional `languages: ["en-US"]` if `@grafana/i18n` is used (works from 11.0; Grafana 13.1 stops loading `@grafana/i18n` at runtime for plugins, so bundle it)                                                       |
| CSP                            | Default template has no `frame-src`; `[security] content_security_policy` off by default                      | Same defaults; `enable_gzip` on by default in 13.0                                                          | Document the `frame-src` addition for hardened installs; nothing version-specific                                                                                                                                                                                                                                            |
| Frontend sandbox               | Public preview since 11.5, off by default, opt-in per plugin                                                  | Same                                                                                                        | Test once with `enable_frontend_sandbox_for_plugins = simnv-drawiomap-panel` on both versions; do not depend on globals                                                                                                                                                                                                      |
| Build tooling                  | create-plugin 7.x, webpack 5 + SWC, externals incl. jsx-runtime                                               | Same                                                                                                        | Run `npx @grafana/create-plugin@latest update` when new minor versions ship                                                                                                                                                                                                                                                  |

Sources: [What's new 12.0](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v12-0/),
[What's new 13.0](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/),
[13.1 to 13.2 guide](https://github.com/grafana/plugin-tools/blob/main/docusaurus/docs/migration-guides/update-from-grafana-versions/v13.1.x-v13.2.x.md),
[AngularJS removal blog](https://grafana.com/blog/angularjs-support-will-be-removed-in-grafana-12-what-you-need-to-know/),
[plugin.json reference](https://github.com/grafana/plugin-tools/blob/main/docusaurus/docs/reference/metadata.md),
[i18n guide](https://grafana.com/developers/plugin-tools/how-to-guides/plugin-internationalization).

**e2e matrix for both versions in Docker Compose:**

- The scaffolded `docker-compose.yaml` takes `GRAFANA_IMAGE` (`grafana` or `grafana-enterprise`)
  and `GRAFANA_VERSION` build args, so one Compose file covers all versions:

  ```sh
  for v in 12.4.13 13.2.4; do
    GRAFANA_IMAGE=grafana GRAFANA_VERSION=$v docker compose up -d --build
    npx playwright test            # @grafana/plugin-e2e fixtures
    docker compose down -v
  done
  ```

  Use `grafana/grafana:<tag>` (`GRAFANA_IMAGE=grafana`) for OSS parity with the lab; the default
  template image is `grafana-enterprise`. Add `GRAFANA_VERSION=main` (or `grafana-dev`) as an
  optional nightly job. Docker Hub tags follow `grafana/grafana:12.4.13`, `grafana/grafana:13.2.4`.

- Provision the same Prometheus datasource and test dashboard for every version; dashboards saved
  by Grafana 13 (schema v2 when dynamic dashboards are on) do not load in 12, so keep the provisioned
  dashboard JSON in the classic schema and let each version migrate it in memory.
- `plugin-e2e` 3.15 supports Grafana 12 and 13 fixtures; the `panelEditPage` selectors abstract
  the Scenes edit UI differences.
- GitHub Actions: `grafana/plugin-actions/e2e-version` with the default
  `version-resolver-type: plugin-grafana-dependency` resolves "latest patch of every minor that
  satisfies `grafanaDependency`" (capped at 6) plus the dev image; with `>=12.4.0` that is
  12.4.x, 13.0.x, 13.1.x, 13.2.x and `grafana-dev`. Matrix entries expose `GRAFANA_IMAGE.NAME`
  and `GRAFANA_IMAGE.VERSION`, passed to `docker compose up`. Inputs `limit`,
  `skip-grafana-dev-image`, and `skip-grafana-react-19-preview-image` tune the set.
  Sources: [CI workflow](https://grafana.com/developers/plugin-tools/e2e-test-a-plugin/ci),
  [e2e-version README](https://github.com/grafana/plugin-actions/blob/main/e2e-version/README.md).
- Local OrbStack: the same Compose file; pass the two versions from a `justfile`/`make e2e-matrix`
  target. Keep separate Compose project names (`-p drawiomap-12`, `-p drawiomap-13`) if both must
  run at once on different host ports.

---

## 2. Embedding the draw.io editor

### 2.1 JSON embed protocol (official)

Source: [Embed mode](https://www.drawio.com/doc/faq/embed-mode), [URL parameters](https://www.drawio.com/docs/reference/supported-url-parameters/),
[embedding walkthrough](https://www.drawio.com/blog/embedding-walkthrough), [configure the editor](https://www.drawio.com/docs/reference/configure-diagram-editor/).

- URL: `https://embed.diagrams.net/?embed=1&proto=json&configure=1&spin=1&libraries=1&ui=<kennedy|min|atlas|dark|sketch|simple>&dark=<0|1|auto>&noExitBtn=1&saveAndExit=1&lang=en`.
  Official docs say embed mode "is only supported on embed.diagrams.net", but the same webapp build
  in the Docker image / `.war` / GitHub Pages fork accepts `embed=1`; GitLab self-hosts it this way
  ([GitLab integration doc](https://docs.gitlab.com/development/fe_guide/diagrams_net_integration/)).
- Handshake (editor -> host -> editor):
  1. `{event:'configure'}` -> host answers `{action:'configure', config:{...}}` (only if `configure=1`).
  2. `{event:'init'}` -> host answers `{action:'load', xml, autosave:1, title, dark, theme, fit:1, modified:'unsavedChanges', noSaveBtn, saveAndExit, exportProtocol:1}`.
     `xml` can be draw.io XML, or SVG/PNG with embedded XML.
  3. `{event:'load', bounds,...}`; then `{event:'autosave', xml}` on each change if `autosave:1`.
  4. User clicks Save: `{event:'save', xml, exit?:true}`; Exit: `{event:'exit', modified}`.
  5. Host may send `{action:'export', format:'svg'|'xmlsvg'|'xml'|'png'|'xmlpng', embedImages, embedFonts, embedCellMetadata, scale, border, shadow, keepTheme, theme:'light'|'dark'|'auto', background, layerIds, pageId}` and receives `{event:'export', format, data (data URI), xml}`.
  6. Other useful actions: `fit`, `viewbox`, `status`, `spinner`, `dialog`, `merge`, `patch`/`getDiff` (diff sync), `snapshot` (SVG with load-time settings), `invokeAction`, `remoteInvoke`, `layout` (elk/organic presets).
  7. `suppressNewWindows=1` turns link clicks into `{event:'openLink', href, target}` for the host.
- Configure keys that matter here: `compressXml:false` (store readable XML in panel options),
  `defaultLibraries`/`enabledLibraries` (e.g. `general;network;cisco`), `defaultEdgeStyle`,
  `defaultVertexStyle`, `customFonts`, `globalVars` (placeholders), `defaultAdaptiveColors:'auto'|'simple'|'none'`
  (dark mode behaviour), `autosaveDelay`.
- The classic recipe (from the draw.io blog) is: `save` -> host asks `export xmlsvg` -> host stores both
  XML and SVG -> host closes the editor on `export`/`exit`. This is the recipe this plugin needs
  (section 3 explains why the SVG is stored).

### 2.2 Hosting options for the editor

| Option                                            | Size                                                                                                     | Pros                                                                           | Cons                                                                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://embed.diagrams.net` (public)             | 0 in plugin                                                                                              | Zero maintenance, always current                                               | Needs internet from the browser; diagram XML goes to the browser iframe only (not uploaded) but fonts/stencils load from diagrams.net; version drift (unpinned)                 |
| `jgraph/drawio` Docker image, own Compose service | ~400 MB image (Docker Hub `full_size`, tag 32.4.1, 2026-10-12)                                           | Air-gap friendly, pinned version, same embed protocol, `DRAWIO_*` env config   | One more container (Tomcat + JRE); must be reachable from the browser; needs its own TLS/host; panel option for "editor URL"                                                    |
| Bundle the webapp inside the plugin `dist/`       | `draw.war` 48 MB (release v32.4.1); Desktop `app.asar` 60 MB; served from `/public/plugins/<id>/drawio/` | No extra service, same origin as Grafana (simpler CSP, no cross-origin issues) | Plugin zip 50 MB+; Grafana serves static files fine, but plugin catalog/size hygiene suffers; license and trademark notes below; updating draw.io means re-releasing the plugin |

Sources: [Docker Hub tags API](https://hub.docker.com/v2/repositories/jgraph/drawio/tags?page_size=5),
[jgraph/drawio releases (gh api, `draw.war` 48,442,174 bytes)](https://github.com/jgraph/drawio/releases),
[fossengineer self-hosting](https://fossengineer.com/selfhosting-drawio-with-docker/).

Licensing and trademark:

- `jgraph/drawio` source is Apache-2.0; icons/stencils/templates are CC BY 4.0 with third-party
  terms where applicable; the README states "We do not accept pull requests" and in late 2024 some
  sources were replaced by minified files. The Atlassian-restriction clause added in 24.7.8 was
  reverted in 25.0.2. `docker-drawio` and `drawio-desktop` packaging repos are GPL-3.0.
  Sources: [jgraph/drawio README](https://github.com/jgraph/drawio), [Wikipedia: Diagrams.net](https://en.wikipedia.org/wiki/Diagrams.net),
  [jgraph org page](https://github.com/jgraph).
- "draw.io" is a registered EU trademark (#018062448). Do not use the name or logo in a way that
  implies endorsement. A plugin ID like `simnv-drawiomap-panel` and the phrase "draw.io diagrams" in
  descriptions are normal usage; do not use the draw.io logo as plugin logo.

### 2.3 CSP, offline, and air-gap

- Grafana's default CSP template (when `content_security_policy = true`) has no `frame-src`,
  `child-src`, or `default-src`, so iframes to any origin are allowed by default. If an operator
  customised the template with `default-src`, they must add `frame-src https://embed.diagrams.net`
  (or the self-hosted editor origin). `connect-src` is `'self' grafana.com ws:// wss://`; this only
  affects fetches made by the plugin page itself (e.g. loading a diagram from a URL), not the iframe.
  Sources: [configure security hardening](https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/configure-security-hardening/),
  [configure Grafana](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/),
  [MDN frame-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-src).
- `allow_embedding` / `frame-ancestors` are about embedding Grafana elsewhere; not relevant here.
- postMessage hygiene: validate `event.origin` against the configured editor URL and set
  `targetOrigin` on `postMessage`; GitLab's integration also sandboxes the iframe.
- Offline: public editor needs internet; self-hosted image works offline except fonts you did not
  bundle; `stealth=1` disables external service calls in the editor.

### 2.4 How existing plugins did it

- Flowcharting (agenty): "Edit Draw" button opened the editor by URL (default later changed to
  `embed.diagrams.net`), user clicked Save, XML came back into the panel's "Source Content". Users
  could also paste XML from "Extras > Edit Diagram". Source: [Flowcharting draw.io doc](https://algenty.github.io/flowcharting-repository/DRAWIO.html),
  [README changelog](https://github.com/algenty/grafana-flowcharting/blob/master/README.md).
- GitLab: iframe + `postMessage`, `configure` for theme, `init` -> `load`, `export` event with SVG,
  SVG uploaded as an attachment; admin-configurable self-hosted URL.
- Neos `sandstorm/MxGraph`: `embed=1&configure=1&proto=json`, stores XML.
  Source: [sandstorm/MxGraph](https://github.com/sandstorm/MxGraph).

Modal in Grafana: `@grafana/ui` `Modal` renders in a portal; a custom option editor can open a
near-full-viewport modal (`width: 95vw; height: 92vh`) containing the iframe. Panel edit mode in
Grafana 12/13 is itself a full-page Scenes view, so the modal must be above it (portal z-index is
handled by `Modal`).

---

## 3. View-mode rendering options

### 3.1 Probe: what draw.io actually emits in SVG (draw.io 32.4.1 CLI)

Test diagram: one stencil shape (`shape=mxgraph.cisco.routers.router`) as `<object>` with custom
attributes `data-key`, `host`, one rounded rect with a two-line HTML label, one orthogonal edge
with a label plus a child `edgeLabel` cell. Command:
`drawio -x -f svg -u --embed-svg-metadata -o out.svg in.drawio`.

Findings:

1. Every cell, including layer cells `0` and `1`, is wrapped in `<g data-cell-id="<id>">`. Nested
   edge labels are nested `<g>` inside the edge group. `data-cell-id` is on by default (draw.io
   24.6+; see [drawio#4532](https://github.com/jgraph/drawio/issues/4532)).
2. `--embed-svg-metadata` (same as the "Cell Metadata" checkbox, or `embedCellMetadata:true` in the
   embed `export` action) adds every `<object>` attribute as `data-meta-<name>` on the group,
   including `data-meta-label`, `data-meta-data-key="r1"`, `data-meta-host="rtr-b"`.
   Sources: [drawio-desktop PR #2566](https://github.com/jgraph/drawio-desktop/pull/2566), probe.
3. Edge structure: `<g data-cell-id="edge"><g><path d="M .. L .. L .." fill="none" stroke=".." stroke-width="2" pointer-events="stroke"/><path d="(arrow polygon)" fill=".." pointer-events="all"/></g><g>label</g><g data-cell-id="child-label">...</g></g>`.
   The first `<path>` is the polyline; the arrow head is a separate filled path. Both are plain
   geometry, so `getTotalLength()` / `getPointAtLength()` work on the first path.
4. Shape structure: `<g data-cell-id="node"><g transform="translate(0.5,0.5)"><rect|path .../></g><g>label</g></g>`.
   The Cisco stencil rendered as inline `<path>` elements; no external stencil fetch at view time.
5. Colors are emitted twice: presentation attribute `fill="#ffffff"` AND
   `style="fill: light-dark(rgb(255,255,255), rgb(18,18,18))"`. The `style` attribute wins over
   the attribute, so setting `el.setAttribute('fill', ...)` does nothing visible. This is exactly
   what broke the Flow panel on draw.io 26 ([flow-panel #127](https://github.com/andymchugh/andrewbmchugh-flow-panel/issues/127)).
   To recolor: set `el.style.fill` / `el.style.stroke` (or strip the `style` attribute once at load).
   `--theme light` (CLI) or `theme:'light'` (embed export) removes `light-dark()` entirely (probe:
   `light-dark(` count 12 -> 0).
6. Labels, default (`html=1`): `<switch><foreignObject requiredFeatures=...>HTML</foreignObject><image href="data:image/png;base64,..."/></switch>`.
   The new fallback is a rasterised PNG of the label per cell; 3 labels made the file 33 KB.
   Browsers render the `foreignObject` branch; the PNG is dead weight.
7. Labels with `convertToSvg=1` in the cell style (draw.io >= 28.0.3, per-cell option "Convert labels
   to SVG"): native `<g fill=".." font-family=".." text-anchor="middle" font-size="11px"><g transform="translate(x,y)"><text><tspan>10G</tspan></text></g></g>`.
   No `foreignObject`, no PNG. Same diagram: 3.8 KB (3.3 KB with `--theme light`). Multi-line
   labels become multiple `<tspan>`. Word wrap is supported since 29.6.7. Unsupported HTML
   (tables, lists, links, background colours) blocks the option.
   Sources: [Convert labels to SVG](https://www.drawio.com/docs/manual/text/svg-labels/),
   [discussion #5165](https://github.com/jgraph/drawio/discussions/5165), probe.
8. `html=0` (unformatted text) also yields `<text>` but keeps a `<switch>` warning block; `convertToSvg=1` is the cleaner path.
9. The root `<svg>` has `viewBox`, `width`/`height` in px, `color-scheme: light dark` and a scoped
   `<style>` with `--ge-adaptive-bg`. There is no `content="<mxfile>"` attribute unless the
   "Include a copy of my diagram" / `-e` option is used (`xmlsvg` format in embed mode).

Conclusion for the YAML->drawio generator: emit `convertToSvg=1` on every labelled cell, put the
binding key in an `<object>` attribute, and export with `--embed-svg-metadata --theme light -u`
(or request the same via the embed `export` action). The resulting SVG is small, text is real
`<text>`, and every cell is addressable by `data-cell-id` and `data-meta-*`.

### 3.2 Option (a): draw.io viewer (`viewer-static.min.js`, `GraphViewer`)

- Size (jsDelivr, tag v32.4.1): 4,360,162 bytes raw, 934 KB gzip, 922 KB brotli.
  The file hard-codes `STENCIL_PATH`, `SHAPES_PATH`, `STYLE_PATH`, `GRAPH_IMAGE_PATH`, `mxBasePath`
  to `https://viewer.diagrams.net/...`; they can be overridden by defining `window.STENCIL_PATH`
  etc. before the script loads, but then the stencil XML/shape JS must also be shipped (the
  `stencils/` and `shapes/` folders of the webapp). Without them, `shape=mxgraph.*` cells degrade to
  plain rectangles ([obsidian-drawio #33](https://github.com/doge-liang/obsidian-drawio/issues/33)).
  Sources: [self-hosted viewer doc](https://www.drawio.com/doc/faq/configure-javascript-viewer-drawio-confluence-server),
  [drawio-mcp README (GraphViewer usage)](https://github.com/jgraph/drawio-mcp/blob/main/mcp-app-server/README.md), curl probe.
- API: `<div class="mxgraph" data-mxgraph='{"xml": "...", "highlight": "#0000ff", "nav": true, "resize": true, "toolbar": "zoom layers", "dark-mode": "auto"}'>` then `GraphViewer.processElements()`; container needs non-zero `offsetWidth`.
  Live updates would require reaching into the internal `mxGraph` instance (`viewer.graph`) and
  calling `graph.setCellStyles(...)` on model cells, then relying on the viewer's redraw. It is a
  global-namespace script (`mxGraph`, `Graph`, `GraphViewer` on `window`), which clashes with the
  Frontend Sandbox and with two panels on one dashboard loading different versions.
- Verdict: highest fidelity (it is draw.io), but ~1 MB gzip per page load, global namespace, and
  the data-driven restyle path is awkward. Not recommended for the hot view path.

### 3.3 Option (b): maxGraph (`@maxgraph/core`)

- 0.25.0 (2026-10-06), Apache-2.0, 626 KB minified / 169 KB gzip full build, zero dependencies,
  ESM and tree-shakeable (`BaseGraph` to pick features). `ModelXmlSerializer` (experimental since
  0.6.0) imports/exports model XML; maintainers state XML compatibility with mxGraph, but legacy
  `mxGraphModel` support should be verified on real files.
  Sources: [bundlephobia](https://bundlephobia.com/api/size?package=@maxgraph/core), [maxGraph releases](https://github.com/maxGraph/maxGraph/releases),
  [ModelXmlSerializer API](https://maxgraph.github.io/maxGraph/api-docs/classes/ModelXmlSerializer.html), [maxGraph intro](https://maxgraph.github.io/maxGraph/docs/intro/).
- Fidelity gap: draw.io ships 200+ stencil XML files plus JS-implemented shapes in `Shapes.js`
  (`mxgraph.*` families, sketch/rough rendering, gradients, `light-dark()` theming, HTML labels).
  maxGraph has the stencil mechanism but ships none of draw.io's stencils or shape JS; each would
  need to be registered (`StencilShapeRegistry`) or ported. Edge label placement, edge styles
  (orthogonal, entity relation, elbow) exist in maxGraph, but draw.io has extra routing/perimeters.
  Sources: [drawio-themer #52](https://github.com/tbrandenburg/drawio-themer/issues/52), [#63](https://github.com/tbrandenburg/drawio-themer/issues/63),
  [draw.io style reference](https://www.drawio.com/docs/reference/diagram-generation/style-reference/).
- Verdict: good if the plugin wanted its own interactive canvas (pan/zoom/select), but it is a
  re-implementation of draw.io rendering with a permanent fidelity gap. Not recommended.

### 3.4 Option (c): store draw.io's exported SVG and manipulate the SVG DOM (recommended)

- The SVG is produced by draw.io itself (embed `export` action at save time, or the generator's
  CLI export), so fidelity is 100% for shapes, stencils, sketch style, label positions. No draw.io
  code runs at view time; the panel bundle stays small (React + a few KB of DOM code).
- Mapping cells reliably: `svg.querySelector('[data-cell-id="<id>"]')` (CSS.escape the id), plus
  `[data-meta-data-key="<key>"]` when metadata is embedded. Within a cell group:
  - shape: first descendant `rect|path|ellipse|polygon|image` that is not inside a label group;
  - edge line: first `path[fill="none"]` with `pointer-events="stroke"`; arrow heads: following
    `path` with `pointer-events="all"`;
  - label: `text` (with `convertToSvg=1`) or `foreignObject div` (HTML labels).
    Because `data-cell-id` is on the wrapper only (not on inner primitives), the plugin needs these
    small heuristics; they are stable across draw.io 24-32 in the probe and in Flow panel's experience.
- Restyle via `element.style.fill/stroke/strokeWidth` (not attributes, see 3.1 item 5) and batch
  updates with a single `requestAnimationFrame` per data refresh. Keep a `Map<cellId, {group, shape, line, arrows, label}>`
  built once per SVG load (`useMemo` on the SVG string) so each refresh is O(bound cells).
- Overlays (half-links, sparklines, badges): add a sibling `<g class="dmap-overlay">` appended to the
  root `<g>` so it sits above the diagram, in the same user coordinate system (`viewBox` of the root).
- Zoom/fit: wrap the SVG in a container and control the root `viewBox` (fit = original viewBox,
  configurable zoom = scale the viewBox or apply `transform` to the root group); use
  `preserveAspectRatio="xMidYMid meet"`. Pan/zoom with wheel only when enabled, like the weathermap plugin.
- Inserting the SVG: parse with `DOMParser` (`image/svg+xml`) and append the `documentElement`, or
  `dangerouslySetInnerHTML`. Grafana does not sanitise panel-rendered DOM; sanitise the SVG once on
  save with DOMPurify (`USE_PROFILES: {svg: true, svgFilters: true}`, allow `data-*`, allow
  `foreignObject` only if HTML labels are kept) because dashboards are shared artefacts.
- Dark theme: keep draw.io's `light-dark()` output and set `color-scheme` on the container to
  follow Grafana's theme (`theme.isDark`), or export `theme:'light'`/`'dark'` twice. Simpler v1:
  export with `theme:'auto'` and set `style="color-scheme: dark"` on the wrapper when Grafana is dark.
- Storage: the SVG with `convertToSvg=1` labels and no fallback PNGs is a few KB per dozen cells;
  stencil-heavy diagrams are tens to a few hundred KB. Dashboard JSON has no hard limit, community
  guidance is to stay under ~1 MB per dashboard; alternatively load SVG/XML from a URL (Flow panel
  supports both) or a Grafana datasource. Source: [dashboard size guidance](https://khimananda.com/blog/grafana-dashboards-a-practical-guide).
- Known limitation: HTML labels (`foreignObject`) can't be measured with `getBBox()` reliably and
  double file size with PNG fallbacks; mandate `convertToSvg=1` from the generator and warn in the
  editor flow when `foreignObject` is detected.

### 3.5 Option (d): parse `mxGraphModel` XML and render our own SVG

- Full control, tiny bundle, but every shape, stencil, edge router, label layout, and style key is
  re-implemented. The Graphviz panel (Grafana Labs, private preview) chose "render engine output
  SVG and bind to it", not "re-render the model", which supports option (c).
  Source: [grafana-graphviz-panel](https://github.com/grafana/grafana-graphviz-panel).
- Verdict: only as a fallback for geometry we need but the SVG does not carry. The XML stays useful
  as the editable source and as a side channel: cell ids, `<object>` attributes, `source`/`target`
  of edges (for direction), and `mxGeometry` points are trivial to read from it.

### 3.6 Comparison

| Criterion              | (a) draw.io viewer      | (b) maxGraph          | (c) SVG DOM                  | (d) own renderer |
| ---------------------- | ----------------------- | --------------------- | ---------------------------- | ---------------- |
| Bundle added           | ~930 KB gzip + stencils | ~170 KB gzip (full)   | ~0                           | ~0               |
| Shape/stencil fidelity | exact                   | partial, ongoing work | exact                        | poor             |
| Edge label positions   | exact                   | approximate           | exact                        | must implement   |
| Many updates/sec       | redraw via mxGraph      | redraw via maxGraph   | style writes on cached nodes | depends          |
| Offline                | needs stencils shipped  | yes                   | yes                          | yes              |
| Editing in view        | yes (not needed)        | yes (not needed)      | no                           | no               |
| Risk                   | globals, size           | fidelity gap          | SVG structure heuristics     | huge scope       |

Recommendation: (c), with the XML kept alongside as the source of truth for the editor and as the
geometry fallback.

---

## 4. Prior art

### 4.1 Flowcharting (`agenty-flowcharting-panel`, algenty/grafana-flowcharting)

- Status: AngularJS plugin; last push 2023-04-12, 1,042 stars; release 1.0.0d built 2022-06-06;
  Grafana 11 disabled Angular by default, so it no longer loads. Not archived, but dead.
  Sources: GitHub API; [issue #411](https://github.com/algenty/grafana-flowcharting/issues/411);
  [forum: Canvas as alternative](https://community.grafana.com/t/canvas-panel-as-an-alternative-for-the-flowchart-plugin/123877).
- Architecture: bundled draw.io's mxGraph (`src/libs/drawio/`, `Graph_custom.js`, `mxgraph_custom.js`),
  parsed the diagram XML and rendered it live with mxGraph; rules engine (`rule_class.ts`,
  `metric_class.ts`, `state_class.ts`, `threshold_class.ts`, `mapping_class.ts`) matched metrics to
  cells by id or label, with regex, aggregations, thresholds, and actions (color, text, link,
  tooltip with chartist graphs, shape swap, width). Dependencies included AngularJS, jQuery, lodash,
  pako, chroma-js, Caja sanitizer.
- Lessons: the rules model (selector -> metric -> reducer -> threshold -> action) is what users
  loved ("simple data binding", "XML import from draw.io"). The pains: Angular lock-in, a bundled
  copy of mxGraph that drifted from draw.io, "external images from diagrams.net not displayed",
  flow animation on arrows never finished, large bundle.

### 4.2 Flow panel (`andrewbmchugh-flow-panel`, andymchugh)

- Status: v1.20.1 (2025-12-15 on the catalog), ~10k active instances; repo push 2026-01-01; Grafana >= 10.
  Sources: [catalog page](https://grafana.com/grafana/plugins/andrewbmchugh-flow-panel/), [src/README](https://raw.githubusercontent.com/andymchugh/andrewbmchugh-flow-panel/main/src/README.md).
- Architecture: SVG from draw.io ("Export as SVG", svgdata plugin so ids survive, draw.io prefixes
  ids with `cell-`), YAML `panelConfig` (cells keyed by id: `dataRef`, `label`, `labelColor`,
  `fillColor`, `strokeColor` with thresholds, `link`, `fillLevel` via clip-path, `flowAnimation`
  with sign-based direction and duration bounds, bespoke mathjs attribute drives, `datapoint: lastNotNull`),
  optional `siteConfig` for shared thresholds/links/colors, time-slider over fetched data, thread
  highlighter, variable substitution incl. `${cell.name}`. Config can be inline YAML or a URL.
- Pains worth avoiding: svgdata plugin requirement (we use `data-cell-id` instead); YAML-only
  editing inside Grafana; draw.io 26 `light-dark()` styles broke colour drives until v1.17 and
  still need `colorMappings`; multi-line labels not drivable; `dataRef` names depend on datasource
  display names. The `clab-io-draw` project (containerlab -> draw.io -> Flow panel) shows demand for a
  generator-driven pipeline and documents the same draw.io 26 gotcha.
  Source: [clab-io-draw grafana.md](https://github.com/srl-labs/clab-io-draw/blob/main/docs/grafana.md).

### 4.3 Network Weathermap (`knightss27-weathermap-panel`) and `-ng` fork

- Original: archived 2025-11-23 (last push 2023-08-24), Grafana 9+, v0.2.8.
  Fork `allamiro/grafana-network-weathermap-ng`: active (push 2026-10-16), release v1.6.19
  (2026-10-06), Grafana 11 through 13, React 18/19 safe, Playwright e2e, signed releases.
  Sources: [knightss27 repo](https://github.com/knightss27/grafana-network-weathermap), [-ng repo](https://github.com/allamiro/grafana-network-weathermap-ng), [-ng docs](https://allamiro.github.io/grafana-network-weathermap-ng/), GitHub API.
- Architecture (from `WeathermapPanel.tsx`, `types.ts`, `utils.ts`): one React-managed `<svg>`;
  `Link { nodes:[A,Z], sides:{A:LinkSide, Z:LinkSide}, units, arrows:{width,height,offset}, stroke }`,
  `LinkSide { bandwidth, bandwidthQuery?, query?, labelOffset, anchor, dashboardLink }`;
  each link renders two `<line>`s (A side and Z side) each with an arrow `<polygon>` pointing to
  the middle, usage label `<g><rect/><text/></g>` per side; colour from `scale: {percent,color}[]`;
  data: last value of `fields[1]` per frame keyed by display name, side query strings match that
  name; zoom via `viewBox` scaled by `1.2^zoomScale`, pan via translate offset, both persisted with
  `onOptionsChange`; tooltip is an absolutely positioned div with a `TimeSeries` chart; links open
  with `window.open`. The `-ng` fork adds moving-dot traffic animation, VIAs, parallel links, incident
  replay slider, hostile-data tests.
- Borrow: the A/Z half-link model, percent-of-bandwidth scale, label-per-side, `onOptionsChange`
  persistence for zoom. Avoid: matching series by display-name string only; `window.open` instead
  of Grafana data links; hand-drawn node layout (we get it from draw.io).

### 4.4 Grafana Canvas (core)

- Connections with arrows (fixed or sign-of-field driven direction), colour/size/line-style driven
  by field values, midpoint bend control, snapping; elements: shapes, metric value, text, icon
  (custom SVG), server, button, experimental; data links and actions per element; inline editing.
  No import from draw.io, no stencil libraries, no sparklines on elements, limited routing.
  Source: [Canvas docs](https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/canvas/).
- The forum thread shows what Canvas lacks for Flowcharting users: XML import, easy binding,
  conditional animated lines. Our plugin should reuse Canvas vocabulary where it fits (field-driven
  colour/size, data links/actions UI) rather than invent new terms.

### 4.5 Other 2024-2026 diagram panels

- `grafana/grafana-graphviz-panel` (Grafana Labs, private preview, push 2026-10-16): diagram-as-code
  (DOT) rendered to SVG with live data binding; modern reference for create-plugin layout,
  Playwright e2e, coverage, signing workflow. No draw.io support.
- No React-based Grafana plugin that embeds the draw.io editor or renders mxGraph XML natively was
  found for 2024-2026 besides Flow (SVG) and Flowcharting (dead). This confirms the niche.
- Related tooling: `jgraph/drawio-mcp` (`@drawio/mcp`) and draw.io's `--layout`/`--normalize` CLI
  options (32.x) are useful for the YAML generator pipeline.

---

## 5. Link visualization

### 5.1 Two halves for in/out (weathermap style)

- Geometry source: the edge's first `<path>` (`d="M x0 y0 L x1 y1 L x2 y2"`), total length `L = path.getTotalLength()`,
  midpoint `path.getPointAtLength(L/2)`. For the half-link overlays, sample the path every N px
  (or at vertices parsed from `d`) and build two `<polyline>`s: A-half from 0 to L/2, Z-half from
  L/2 to L. Coordinates are in the path's user space; the draw.io edge group has no transform in the
  probe, but apply `getCTM()` relative to the root `<g>` to be safe.
  Source: [MDN getPointAtLength](https://developer.mozilla.org/en-US/docs/Web/API/SVGGeometryElement/getPointAtLength) (Baseline, widely available).
- Direction: `source`/`target` from the mxGraph XML (or the arrow-head path position in the SVG) define
  the "A -> Z" orientation. Map `in`/`out` series to halves by rule (`direction: a2z|z2a`).
- Drawing: overlay polylines with `stroke-width` from the width scale, `stroke` from the threshold
  colour, `stroke-linecap: butt`, and an arrow marker at the midpoint for each half pointing toward
  the midpoint (weathermap) or outward (preference). Use `<marker>` with `markerUnits="userSpaceOnUse"`
  so arrow size does not scale with stroke width, or draw polygons like the weathermap code.
- Hide the original draw.io edge stroke under the overlay by setting its `style.stroke` to the
  background or `opacity: 0` when a rule binds that edge; keep the original arrow head if desired.

### 5.2 Labels and placement

- Value labels per half at `getPointAtLength(L/4)` and `getPointAtLength(3L/4)`, offset by the
  normal vector (`(-dy, dx)` normalised) times `labelOffset`; draw `<rect>` background +
  `<text>`; measure with a cached canvas `measureText` (weathermap) or `getBBox()` after mount.
- draw.io's own edge labels (`edgeLabel` child cells) are positioned relative to the edge; the SVG
  already has them placed, so a rule can simply rewrite that label's `<text>`/`<tspan>` content
  (`%value%` style placeholders in the label text are a cheap binding).

### 5.3 Width scaling

- `strokeWidth = min + (max - min) * clamp(load, 0, 1)` or log scale for traffic; persist
  `[min,max]` in panel options. For draw.io edges, write `style.strokeWidth` on the line path only
  (not the arrow path) and keep the hit-area `pointer-events="stroke"`.

### 5.4 Animated flow and its cost

- Technique: `stroke-dasharray: 8 8; animation: dash 1s linear infinite; @keyframes dash { to { stroke-dashoffset: -16 } }`;
  `pathLength="100"` normalises. Direction by the sign of the offset; speed from the load.
  Source: [CSS-Tricks SVG line animation](https://css-tricks.com/svg-line-animation-works/).
- Cost: `stroke-dashoffset` is a paint-level property; every animated path is repainted every frame
  on the main thread, not composited. Fine for a handful of links, visibly costly for dozens on a
  dashboard that also runs uPlot panels. Flow panel exposes a pause control for this reason.
  Mitigations: animate only bound links above a load threshold, cap concurrent animations, stop
  animation when the panel is off-screen (`IntersectionObserver`), use a pre-dashed stroke moved with
  `transform` under a mask for compositor-driven motion, or use moving dots (`-ng` fork) with
  `animateMotion` which is also paint-bound. Default: animations off; opt-in per rule.
  Sources: [scroll-driven dashoffset note](https://codefronts.com/motion/css-scroll-animations/scroll-driven-svg-stroke-draw/),
  [SVG animation performance guide](https://www.svgai.org/blog/research/svg-animation-encyclopedia-complete-guide).

---

## 6. Sparklines

- `@grafana/ui` exports `Sparkline` (`SparklineProps { width, height, sparkline: FieldSparkline { y: Field, x?: Field, timeRange? }, config?: FieldConfig<GraphFieldConfig>, showHighlights?, showTooltip?, onHover?, theme }`),
  rendered with uPlot inside a `<div>`; memoised; hover throttled to one event per frame.
  Source: [Sparkline.tsx](https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-ui/src/components/Sparkline/Sparkline.tsx).
  uPlot is already part of Grafana's runtime, so it adds no bundle size, but each instance creates
  a `<canvas>` and a uPlot object: tens of sparklines per panel are acceptable, hundreds are not.
  To place it on the diagram it must sit in a `<foreignObject>` inside the SVG overlay or in an
  absolutely positioned HTML layer aligned by converting SVG coordinates with `getScreenCTM()`.
- Plain SVG polyline: compute `points` from the field values (min/max normalised to the box), one
  `<polyline>` plus optional area `<path>`; no canvas, no library, scales to hundreds of elements,
  trivially follows `viewBox` zoom. No tooltip/hover unless added.
- Recommendation: plain `<polyline>` sparklines in the overlay layer for v1 (cheap, zoom-correct,
  theme colour from the threshold). Offer `Sparkline` from `@grafana/ui` later in the tooltip/hover
  card (one instance at a time), like the weathermap's hover `TimeSeries`.

---

## 7. Binding model

### 7.1 Identifying cells

| Selector                                                          | Where it lives                                                    | Survives editor edits                                           | Notes                                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `mxCell@id`                                                       | XML and `data-cell-id` in SVG                                     | Yes, unless cell is deleted/recreated; copy/paste makes new ids | Best primary key. Generator can set readable ids (`node-r1`, `link-r1-r2`) since draw.io keeps arbitrary string ids (probe) |
| Custom attribute on `<object>` (e.g. `data-key`, `host`, `iface`) | XML (`Edit Data`), SVG as `data-meta-*` with cell metadata export | Yes; copied with the cell                                       | Best semantic key; supports placeholders `%host%` in labels when `placeholders="1"`                                         |
| Label text                                                        | XML `value`/`label`, SVG `<text>`                                 | Fragile (user renames)                                          | Use only for regex convenience matching                                                                                     |
| Tags (`tags` attribute, draw.io "Tags" feature)                   | XML `tags="a b"` on object                                        | Yes                                                             | Good for group rules ("all core links")                                                                                     |
| Edge `source`/`target`                                            | XML only                                                          | Yes                                                             | Lets a rule target "edge between node X and Y" and gives direction                                                          |

Sources: [draw.io placeholders](https://www.drawio.com/docs/manual/advanced/placeholders/),
[shape data](https://www.drawio.com/docs/manual/shapes/shape-data/), [diagram generation reference (`placeholders="1"` on object)](https://www.drawio.com/docs/reference/diagram-generation/), probe.

Recommendation: the generator writes `id` and `data-key` (plus `host`, `iface`, `dir` when known);
the panel matches by `data-key` first, then `id`, then regex on label; `embedCellMetadata` is always
requested on export so the SVG alone carries the keys.

### 7.2 Series selection

Prometheus frames arrive as one frame per series with `field.labels` (`{instance, ifName, direction}`)
and `refId`. Selection must support: `refId`, label equality / regex, and name regex.
Implement a small matcher: `{ refId?: string, name?: regex, labels?: Record<string, string|/regex/> }`.
Allow template variables inside selectors (`${router}`), interpolated with `replaceVariables`.

### 7.3 Recommended schema (panel options, editable in UI and importable as YAML)

```yaml
version: 1
diagram:
  xml: "<mxfile>...</mxfile>"       # editor source (uncompressed)
  svg: "<svg>...</svg>"             # view source, exported by draw.io at save time
  svgSource: inline | url           # or load svg/xml from a URL (variables allowed)
view:
  zoom: fit | number
  panZoom: false
  theme: auto | light | dark
  animations: false
defaults:
  reducer: lastNotNull              # ReducerID
  thresholds: { mode: percentage, steps: [...] }   # reuse Grafana ThresholdsConfig
  linkWidth: { min: 2, max: 10 }
rules:
  - name: "Core links in/out"
    select:                         # cell selector; all keys ANDed, any list member ORed
      kind: edge                    # edge | vertex | any
      key: /^link-/                 # data-key / data-meta-data-key
      # id: ..., label: /regex/, tags: [core], between: [node-a, node-b]
    bind:
      - half: a2z                   # a2z | z2a | whole (vertex: whole)
        series: { refId: A, labels: { ifName: "${cell.iface}", direction: in } }
        reducer: lastNotNull
        limit: { series: { labels: { ifName: "${cell.iface}" } , refId: B } }  # or fixed: 10e9
      - half: z2a
        series: { refId: A, labels: { ifName: "${cell.iface}", direction: out } }
    style:
      colorBy: thresholds           # from field config (percent of limit) or rule-local thresholds
      widthBy: percent              # none | percent | value(min,max)
      label: "${__value.text} (${__percent}%)"
      animate: false
      sparkline: { position: mid, size: [60, 18] }
    links:
      - { title: "Interface", url: "/d/abc?var-if=${__field.labels.ifName}&${__url_time_range}" }
  - name: "Device status"
    select: { kind: vertex, tags: [device] }
    bind:
      - series: { refId: C, labels: { instance: "${cell.host}" } }
        reducer: last
    style:
      fill: byValueMapping          # value mappings from field config: 0 -> red "DOWN"
      stroke: byThresholds
      text: "${cell.label}\n${__value.text}"
      blinkWhen: "value == 0"
    links: [{ title: "Host dashboard", url: "/d/host?var-host=${cell.host}" }]
```

Design notes:

- `${cell.*}` resolves from the cell's `<object>` attributes (`data-meta-*`), giving one rule for
  many cells (the generator stamps `host`/`iface`). This is the "rule once, apply to N cells" model
  that Flowcharting users valued and that Flow panel's per-cell YAML lacks.
- Colour, units, decimals, thresholds and value mappings come from Grafana field config
  (`getFieldDisplayValues`); rule-local overrides exist for percent-of-limit cases where the
  threshold must apply to a computed ratio, not the raw series. Compute `percent = value / limit`
  into a synthetic field so the standard thresholds pipeline colours it.
- Store compiled selectors in memory; re-run binding only when `data`, `options`, or the SVG change.
- Legacy import: a Flow panel `panelConfig.cells` YAML or Flowcharting rules can be converted with a
  one-off script later; not v1.

---

## 8. Recommendations

Architecture:

1. Toolchain: `npx @grafana/create-plugin@latest` (7.13), panel template, TypeScript.
   Dual support for latest 12.x and 13.x (section 1.7): `grafanaDependency: ">=12.4.0"`, build
   against `@grafana/* 12.4.x` with React 18 types (oldest-supported strategy), no bundled React,
   `@grafana/react-detect` in CI, Playwright matrix `grafana/grafana:12.4.13` and `:13.2.4` (plus
   `main` nightly) through the scaffolded Compose file. Unsigned in the lab via
   `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS`. Run one e2e pass with the Frontend Sandbox enabled.
2. Editor: iframe to draw.io in embed mode (`embed=1&proto=json&configure=1&spin=1&libraries=1&ui=min&dark=auto&noExitBtn=0&saveAndExit=1`)
   inside a `@grafana/ui` `Modal` opened from a custom option editor. Editor URL is a panel option
   with default `https://embed.diagrams.net`; document the self-hosted Docker image (`jgraph/drawio`,
   ~400 MB) as the air-gap option. Do not bundle the 48 MB webapp in v1. Configure `compressXml:false`.
   On `save`: request `export` with `format:'xmlsvg'` (or `svg` + `xml`), `embedCellMetadata:true`,
   `embedImages:true`, `theme:'auto'`; store `xml` and `svg` in options; close on `export`/`exit`.
   Validate `event.origin`, use `targetOrigin`.
3. View renderer: option (c). Insert draw.io's exported SVG, index `data-cell-id`/`data-meta-*`
   groups once, write `style.fill/stroke/strokeWidth` on cached nodes per refresh, overlay `<g>` for
   half-links, arrows, labels, sparklines. Zoom by `viewBox`, default fit. No mxGraph/maxGraph code
   in the view bundle. Keep the XML for direction (`source`/`target`) and as the editor source.
4. Generator contract (YAML -> drawio): stable `id`s, `<object>` with `data-key`, `host`, `iface`,
   `tags`, `placeholders="1"`; `convertToSvg=1` on every labelled cell; export with
   `drawio -x -f svg -u --embed-svg-metadata --theme auto` (or let the panel export via the editor).
   Avoid HTML-only label features (tables, lists, background colour) so native `<text>` is possible.
5. Binding: rule list as in 7.3; selectors by key/id/tag/label/between; series by refId + labels;
   reducers via `ReducerID`; colours/units/mappings/thresholds from Grafana field config via
   `getFieldDisplayValues`; data links through `DataLinksContextMenu`, plus URL templates with
   `${cell.*}` and `__field/__value` scoped vars via `replaceVariables`.
6. Sparklines: plain `<polyline>` in the overlay; `@grafana/ui` `Sparkline` only in the hover card.
7. Animation: off by default; dash animation per bound edge, capped, paused when off-screen.

Top risks:

- draw.io SVG structure changes between versions (26 added `light-dark()` styles and broke Flow
  panel; 32 added PNG label fallbacks). Mitigation: pin draw.io version in the generator, keep
  heuristics in one module with fixture SVGs from several draw.io versions in unit tests, write
  styles via `style.*` not attributes.
- Public `embed.diagrams.net` dependency: unpinned version, internet needed. Mitigation: editor URL
  option + documented self-hosted image.
- HTML labels (`foreignObject`) in user-edited diagrams: larger files and no `getBBox`. Mitigation:
  generator sets `convertToSvg=1`; panel warns when `foreignObject` is detected.
- Dashboard JSON growth from inline SVG+XML. Mitigation: URL source option; strip PNG fallbacks on save.
- React 18 (12.4) vs React 19 (13.x) dual support and the optional Frontend Sandbox. Mitigation:
  build against 12.4 packages, e2e matrix on both images, `react-detect`, no globals, no
  `findDOMNode`, no React-19-only APIs, dependencies with known React 19 issues avoided.
- Animation CPU cost on big maps. Mitigation: defaults off, caps, visibility pause.

---

## 9. Open questions for the user

1. Build strategy for dual support: pin `@grafana/*` to 12.4.x (React 18 types; TypeScript
   guards against 13-only APIs) or to 13.2.x (React 19 types; needs runtime guards)? Which exact
   Grafana version runs in your lab today, and is `grafana/grafana` (OSS) the image to test with?
2. Editor hosting default: public `embed.diagrams.net`, or add a `jgraph/drawio` service to the
   Compose stack from day one (air-gap, pinned version)? Should the plugin support both via option?
3. Where should the diagram live: inline in panel options (SVG + XML), by URL (e.g. Forgejo raw
   file produced by the generator), or both? Is the Grafana dashboard the source of truth or the YAML?
4. Do you need in-Grafana editing of the binding rules (UI editor), or is a YAML/JSON text editor
   with validation enough for v1 (faster to build, matches a generator-driven workflow)?
5. Half-link semantics: arrows pointing toward the midpoint (classic Cacti/PHP Weathermap) or away
   from the source node? Labels as absolute (`Mb/s`) or percent, or both?
6. Series binding source: should a rule bind to a Grafana query (`refId` + label matchers) or should
   the panel own the PromQL template (e.g. `rate(ifHCInOctets{instance="$host", ifName="$iface"}[5m])`)
   via a datasource query it issues itself? The first is standard Grafana; the second removes query
   setup but needs a datasource-aware panel.
7. Should the panel load stencil-heavy diagrams (Cisco/AWS libraries) often? That decides whether
   SVG size (inline paths) matters enough to add the URL source early.
8. Signing: do you have or want a Grafana Cloud account with slug `simnv` for private signing, or
   is unsigned-with-allowlist acceptable permanently?
9. Dark mode: follow Grafana theme with draw.io's `light-dark()` output (one SVG), or export two
   themed SVGs at save time?
10. Flow-panel YAML import (migration path for `clab-io-draw`-style configs): needed?

---

## Appendix A: probe commands and outputs

```text
drawio 32.4.1 (/opt/homebrew/bin/drawio)
drawio -x -f svg -u --embed-svg-metadata -o sample-meta.svg sample.drawio
  -> 33,231 bytes; data-cell-id x6 (0,1,node-a,node-b,edge-ab,lbl-edge);
     data-meta-label/data-meta-data-key/data-meta-host/data-meta-placeholders;
     foreignObject x4, <text> x1, <image> PNG fallbacks x4, light-dark() x12
same diagram with convertToSvg=1 on all cells
  -> 3,820 bytes; foreignObject 0, <text> 5, <image> 0
same + --theme light
  -> 3,262 bytes; light-dark() 0
html=0 variant
  -> 19,338 bytes; mixed (<text> for plain labels, foreignObject/PNG for the stencil label)
viewer-static.min.js @v32.4.1 via jsDelivr: 4,360,162 B raw, 934,425 B gzip, 921,753 B brotli
jgraph/drawio Docker tags 32.4.1 / latest: 400.35 MB (Docker Hub full_size), 2026-10-12
jgraph/drawio release v32.4.1 asset draw.war: 48,442,174 B
draw.io Desktop app.asar: 60 MB
```

## Appendix B: key links

- Grafana plugin tools: https://grafana.com/developers/plugin-tools/
- Panel datalinks guide: https://grafana.com/developers/plugin-tools/how-to-guides/panel-plugins/add-datalinks-support
- Field overrides guide: https://github.com/grafana/plugin-tools/blob/main/docusaurus/docs/how-to-guides/panel-plugins/field-overrides.md
- plugin-e2e: https://grafana.com/developers/plugin-tools/e2e-test-a-plugin/test-a-panel-plugin
- Sign a plugin: https://grafana.com/developers/plugin-tools/publish-a-plugin/sign-a-plugin
- Frontend sandbox: https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-frontend-sandbox/
- draw.io embed mode: https://www.drawio.com/doc/faq/embed-mode
- draw.io URL parameters: https://www.drawio.com/docs/reference/supported-url-parameters/
- draw.io editor configuration: https://www.drawio.com/docs/reference/configure-diagram-editor/
- draw.io convert labels to SVG: https://www.drawio.com/docs/manual/text/svg-labels/
- draw.io placeholders: https://www.drawio.com/docs/manual/advanced/placeholders/
- drawio-desktop metadata flag PR: https://github.com/jgraph/drawio-desktop/pull/2566
- drawio data-cell-id issue: https://github.com/jgraph/drawio/issues/4532
- Flow panel: https://grafana.com/grafana/plugins/andrewbmchugh-flow-panel/ and https://github.com/andymchugh/andrewbmchugh-flow-panel
- Flow panel draw.io 26 issue: https://github.com/andymchugh/andrewbmchugh-flow-panel/issues/127
- Flowcharting: https://github.com/algenty/grafana-flowcharting
- Weathermap: https://github.com/knightss27/grafana-network-weathermap and https://github.com/allamiro/grafana-network-weathermap-ng
- Canvas: https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/canvas/
- Graphviz panel: https://github.com/grafana/grafana-graphviz-panel
- maxGraph: https://github.com/maxGraph/maxGraph, https://bundlephobia.com/package/@maxgraph/core
- clab-io-draw Grafana pipeline: https://github.com/srl-labs/clab-io-draw/blob/main/docs/grafana.md
- MDN getPointAtLength: https://developer.mozilla.org/en-US/docs/Web/API/SVGGeometryElement/getPointAtLength
- CSS-Tricks line animation: https://css-tricks.com/svg-line-animation-works/
