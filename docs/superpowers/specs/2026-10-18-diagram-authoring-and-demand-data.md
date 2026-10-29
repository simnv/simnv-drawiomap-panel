# Diagram authoring and demand-loaded data

Status: superseded by the binding model v4 (`2026-10-28-binding-model-v4-design.md`), 2026-10-29. The config, the popup and the demand model of this spec are gone.

Date: 2026-10-18. Product direction approved in the architecture interview.
Baseline inspected: `881f4dfa9ddf6412cf4eccfd9a3440594876e38d`.
Implementation and runtime compatibility have not been validated.

## Purpose

Make repeated device/link bindings easy to edit and make visualizations easier to extend.
The primary view answers what is abnormal at a glance without filling every device
with charts. The plugin is unshipped; saved configuration compatibility may break.
Recreating plugin configuration is acceptable, but existing dashboards must not be
silently deleted or overwritten.

This spec supersedes the 2026-10-17 PoC spec on query ownership, chart placement,
hover contents, normal-state styling, and binding authoring. Preserve unrelated
working behavior and security constraints unless a task explicitly changes them.

## Approved product behavior

### Quiet topology

- Colored links and compact device statuses form the primary view.
- Normal operation is visually calm. Abnormalities have a visible marker and short
  reason; understanding the main view does not require hover or color perception.
- An explicit health metric is preferred. Deliberately configured threshold rules
  can also determine status; high resource utilization is not automatically failure.
- Distinguish down, zero traffic, missing data, stale data, and incomplete coverage.
  Staleness uses sample age and an explicit expected data cadence, not chart query step.
- Group identical widespread conditions into a summary while keeping affected
  elements identifiable. Preserve different causes and make details available.

### Explicit visualizations

- Users place a small number of chart regions anywhere in draw.io. Association with
  a node or link is optional; an aggregate metric can have its own chart region.
- No default sparkline is added to every device or link.
- Initially use small trend charts with adjacent values, units, and optional
  drilldown links. Full chart axes, legends, zoom, and multi-series exploration are
  deferred to drilldown destinations.
- Bar gauges are available for deliberately selected bounded quantities. Round
  gauges are excluded from this scope. A rate with no meaningful maximum gets a
  numeric readout rather than an invented percentage scale.
- Reuse public Grafana Sparkline, BarGauge, tooltip, display formatting, and loading
  primitives where suitable. Keep query execution separate from presentation.
- Empty, single-sample, stale, and failed histories remain understandable. A blank
  Sparkline component alone is not an adequate missing-data state.

### Geometry and identity

- Draw.io owns placement and dimensions. The plugin owns data, status rules, units,
  thresholds, visualization behavior, and hover configuration.
- Use stable explicit identity metadata to relate diagram entities to metric labels.
  Permit manual overrides; display names are not durable identities.
- Preserve identity through editor save/export, SVG indexing, and selection.
- Chart regions follow SVG transforms, panel fitting, resizing, pan, and zoom.
  They must not intercept unrelated diagram interactions.

### Queries and demand

- A panel has named query definitions. Each can select a datasource; a panel default
  avoids repetition. One diagram may mix datasources.
- Target any Grafana datasource with a compatible query interface and result shape.
  This is a design target, not a claim that every datasource has been tested.
- Preserve datasource-native query objects and delegate query editing/interpolation
  to supported datasource facilities. Do not create a universal query-string format.
- Sparkline rendering consumes numeric time series. Other result shapes receive
  explicit validation and user-facing explanations.
- Visible statuses/links require their normal data. Explicit chart regions request
  history when displayed. All hover-only data, including extra scalar values, waits
  until the corresponding card is displayed.
- Reuse results already needed by visible content. Deferring rendering alone does
  not satisfy deferred fetching. Hover-only targets cannot remain in an eager query set.
- Visible and hover histories inherit the selected dashboard time range and variables.
- Close/change/unmount stops unnecessary refresh work and releases subscriptions.
  Ignore obsolete responses even when a datasource cannot cancel server work.

### Panel-local cache

- Cache fetched samples and hover values in bounded panel-local memory.
- Populate entries only from actual display demand; no initial hover prefetch.
- Share identical in-flight requests and reuse fresh entries on reopening.
- Refresh active content as needed. Inactive hover content does not keep refreshing.
- Account for datasource, query, element parameters, dashboard context, time range,
  and resolution. Data for one element must not appear in another element's card.
- Expire entries, evict least-recently-used inactive entries, and release everything
  on panel destruction. Distinguish cached age, metric sample age, and request failure.

### Patterns, hover, and inspector

- Patterns are panel-local. Configure one representative element, preview all matches
  and metric resolution failures, then apply. Cross-dashboard live synchronization
  is outside this scope; explicit pattern import/export is supported.
- A pattern defines shared bindings and hover content. Individual elements can override
  selected settings. Preserve deterministic precedence and expose the effective result.
- Hover content is selected explicitly: named values, metadata, optional histories,
  and drilldown links. A small default may show identity and current status only.
- Binding mode lives in Grafana's panel editing experience. Geometry edits open draw.io.
- Clicking an element selects/highlights it, opens or updates the side inspector,
  scrolls to relevant settings, and focuses the inspector heading. Hover does not
  move keyboard focus. Keyboard selection must offer the same behavior.
- Show identity, matched pattern, and overrides. Make edit scope explicit as
  `This element` or `All elements matching this pattern`; highlight affected elements.
- Preview uses draft configuration. Apply persists it; cancel discards the draft.
  Import/export validation reports conflicts and unresolved query references.

## Architecture responsibilities

| Module              | Owns                                                                      | Does not own                                  |
| ------------------- | ------------------------------------------------------------------------- | --------------------------------------------- |
| Diagram model       | Semantic identity, metadata, chart anchors                                | Queries or live DOM mutation                  |
| Query module        | Native execution, active demand, cache, formatting context                | SVG geometry or status policy                 |
| Binding module      | Pattern precedence, selectors, metric matching, status and display models | Network requests or DOM access                |
| Presentation module | SVG patches and bounded React visuals                                     | Query scheduling or saved configuration       |
| Authoring module    | Draft state, selection, inspector focus, preview and apply                | Independent query or renderer implementations |

Keep pure model evaluation testable without Grafana or a browser. Keep one query
lifecycle implementation for visible charts, hover cards, and editor previews.
Add small adapters around real variations, especially datasource execution and
Grafana visual components; avoid a generic extension framework before it is needed.

## Project constraints

- Keep plugin ID `simnv-drawiomap-panel` and plugin type unchanged.
- Keep Grafana dependency floor `>=12.4.0`; verify supported 12.x and 13.x environments.
- Use the supplied webpack configuration; do not modify `.config/` or bundle React.
- Use `@grafana/plugin-e2e` for browser tests and read `.config/AGENTS/e2e-testing.md`.
- Keep credentials out of options, logs, fixtures, reports, and screenshots.
- Preserve SVG sanitization, editor message validation, and existing sandbox protections.
- View mode loads no draw.io editor runtime.
- Use Orca orchestration with Sol/Luna workers for implementation grunt work.
- Omit all `Co-Authored-By` trailers from commits.

## Acceptance scenario

Use a small sanitized fixture based on a monitoring repo device/link patterns, with a repeated
device group, directional link, explicit standalone chart region, and configured hover.
Demonstrate selection-to-inspector focus, shared pattern preview and element override,
save/reopen identity, normal/abnormal/missing/stale states, and independent mixed sources.
Prove zero hover-only requests before opening; then prove lazy loading, reopen cache
reuse, invalidation, and rejection of late results after switching the selected element.
Inspect actual rendering at desktop size in light and dark themes, including pan/zoom.

## Evidence and implementation risks

- Existing panel/card code delays card construction but uses already-fetched histories:
  `src/components/DrawioMapPanel.tsx`, `src/interact/cardModel.ts`.
- Existing card sparklines use custom SVG: `src/interact/Card.tsx`.
- Installed Grafana 12.4.13 exports Sparkline and BarGauge. PanelRenderer is internal;
  the richer TimeSeries implementation uses deprecated GraphNG. Do not depend on those
  internal or deprecated paths for this feature.
- Query APIs accept native requests but datasource-specific interpolation, query editor
  requirements, transformations, cancellation, and result shapes need validation.
- Validate public communication between diagram selection and its inspector before
  choosing whether the inspector lives in the standard options area or inside the panel.
- Validate SVG anchor transforms and overlay clipping before building chart authoring.

Visualization references inspected: local `designing-visualizations` skill at
`~/.claude/skills/designing-visualizations/SKILL.md`, and the monitoring repo's
`scripts/gen_diagrams/{svg,htmlgfx,flow,dashboard}.py` plus `topology/topology.yml`.
Their relevant rules and product examples are captured above; these external paths
are supporting evidence, not build dependencies.
