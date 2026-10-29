import type { ScopedVars } from '@grafana/data';
import {
  checkTemplate,
  formatBareVariables,
  resolveTemplateV4,
  shieldV4,
  unshieldV4,
  type TemplateScopeV4,
} from '../binding/template';
import { isAllowedUrl } from '../binding/url';

/** The path of a Grafana dashboard: /d/<uid>, also below a sub path and on another host. */
const DASHBOARD_PATH = /(?:^|\/)d\/[^/]+/;

/** The footer title of a rule url without urlTitle: "Open dashboard" for a dashboard url, else "Open <card title>". */
export function defaultUrlTitle(href: string, cardTitle: string): string {
  // remove the scheme and host, then the query and the fragment
  const path = href.replace(/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*/i, '').replace(/[?#].*$/, '');
  return DASHBOARD_PATH.test(path) ? 'Open dashboard' : `Open ${cardTitle}`;
}

/**
 * Step 1 of the URL and title order: the scope placeholders. `encode` must end in shieldV4, so that neither a value
 * nor the text around it (`$${key}`, `[[${key}]]`) gives a dashboard variable. Null when the text has a schema error
 * or a placeholder that the cell cannot fill: the panel does not show the item.
 */
function substituteV4(
  text: string,
  place: 'url' | 'title',
  scope: TemplateScopeV4,
  encode: (v: string) => string
): string | null {
  if (checkTemplate(text, place).length > 0) {
    return null;
  }
  const r = resolveTemplateV4(text, scope, encode);
  return r.missing.length > 0 || r.unresolved.length > 0 ? null : r.text;
}

/**
 * The URL order of spec 3.3 (A17): the scope placeholders with shieldV4(encodeURIComponent(value)), the bare dashboard
 * variables as ${name:percentencode}, replaceVariables, unshieldV4, then isAllowedUrl on the final text.
 * Null when the panel does not show the URL.
 */
export function resolveUrlV4(
  url: string,
  scope: TemplateScopeV4,
  replaceVariables: (s: string, v?: ScopedVars) => string
): string | null {
  const text = substituteV4(url, 'url', scope, (v) => shieldV4(encodeURIComponent(v)));
  if (text === null) {
    return null;
  }
  const href = unshieldV4(replaceVariables(formatBareVariables(text)));
  return isAllowedUrl(href) ? href : null;
}

/**
 * A title (urlTitle, a drilldown label) is text: the scope placeholders with shieldV4(value), replaceVariables, then
 * unshieldV4. No encoding and no format step. Null when the panel does not show the title.
 */
export function resolveTitleV4(
  title: string,
  scope: TemplateScopeV4,
  replaceVariables: (s: string, v?: ScopedVars) => string
): string | null {
  const text = substituteV4(title, 'title', scope, shieldV4);
  return text === null ? null : unshieldV4(replaceVariables(text));
}
