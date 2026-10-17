import type { DisplayValue, LinkModel, ScopedVars } from '@grafana/data';
import { isAllowedUrl } from '../binding/url';
import type { BindStatus, CellPatch, SeriesInfo } from '../types';

export interface Primary {
  status: BindStatus;
  series?: SeriesInfo;
  display?: DisplayValue;
  value?: number;
  percent?: number;
  label?: string;
}

export function primaryOf(patch: CellPatch): Primary {
  const h = patch.link?.a2b ?? patch.link?.b2a;
  if (h) {
    return {
      status: h.status,
      series: h.series,
      display: h.display,
      value: h.value,
      percent: h.percent,
      label: h.label,
    };
  }
  const s = patch.shape;
  if (s) {
    return { status: s.status, series: s.series, display: s.display, value: s.value, label: s.text };
  }
  return { status: 'nodata' };
}

export function buildScopedVars(patch: CellPatch, primary: Primary): ScopedVars {
  const vars: ScopedVars = {
    cell: { text: 'cell', value: patch.scope.cell },
  };
  if (patch.scope.from) {
    vars.from = { text: 'from', value: patch.scope.from };
  }
  if (patch.scope.to) {
    vars.to = { text: 'to', value: patch.scope.to };
  }
  if (primary.series) {
    vars.__series = { text: 'Series', value: { name: primary.series.name, refId: primary.series.refId } };
    vars.__field = { text: 'Field', value: { name: primary.series.field.name, labels: primary.series.labels } };
  }
  if (primary.display) {
    vars.__value = {
      text: 'Value',
      value: { raw: primary.value, numeric: primary.display.numeric, text: primary.display.text },
    };
  }
  return vars;
}

/** The path of a Grafana dashboard: /d/<uid>, also below a sub path and on another host. */
const DASHBOARD_PATH = /(?:^|\/)d\/[^/]+/;

/** The footer title of a rule url without urlTitle: "Open dashboard" for a dashboard url, else "Open <card title>". */
export function defaultUrlTitle(href: string, cardTitle: string): string {
  // remove the scheme and host, then the query and the fragment
  const path = href.replace(/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*/i, '').replace(/[?#].*$/, '');
  return DASHBOARD_PATH.test(path) ? 'Open dashboard' : `Open ${cardTitle}`;
}

export function resolveLinks(
  patch: CellPatch,
  primary: Primary,
  replaceVariables: (s: string, v?: ScopedVars) => string,
  cardTitle: string
): LinkModel[] {
  const vars = buildScopedVars(patch, primary);
  const out: LinkModel[] = [];
  for (const u of patch.urls) {
    // a dashboard variable can put a scheme into the url, so check the final text again
    const href = replaceVariables(u.url, vars);
    if (isAllowedUrl(href)) {
      const title = u.title !== undefined ? replaceVariables(u.title, vars) : defaultUrlTitle(href, cardTitle);
      out.push({ title, href, target: '_blank', origin: patch });
    }
  }
  const field = primary.series?.field;
  if (field?.getLinks) {
    const row = Math.max(0, (primary.series?.values.length ?? 1) - 1);
    out.push(...field.getLinks({ valueRowIndex: row, calculatedValue: primary.display }));
  }
  return out;
}
