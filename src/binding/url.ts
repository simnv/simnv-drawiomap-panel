const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * True when the URL is relative or uses http or https. A URL parser removes leading
 * C0 controls and spaces and every tab and line break, so the check does the same first.
 */
export function isAllowedUrl(url: string): boolean {
  const s = url.replace(/^[\u0000- ]+/, '').replace(/[\t\n\r]/g, '');
  const m = SCHEME.exec(s);
  return !m || /^https?$/i.test(m[1]);
}
