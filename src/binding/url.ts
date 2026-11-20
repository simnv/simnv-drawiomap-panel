const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/** The scheme of a URL, in lower case, after the clean-up that a URL parser does; undefined for a relative URL. */
function schemeOf(url: string): string | undefined {
  // a URL parser removes leading C0 controls and spaces and every tab and line break, so the check does the same first
  const s = url.replace(/^[\u0000- ]+/, '').replace(/[\t\n\r]/g, '');
  return SCHEME.exec(s)?.[1].toLowerCase();
}

/**
 * True when the URL is relative or uses http, https or ssh. `ssh://` opens the SSH client of the system (the browser
 * hands it to the app that handles the scheme); it runs nothing in the page.
 */
export function isAllowedUrl(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme === undefined || scheme === 'http' || scheme === 'https' || scheme === 'ssh';
}

/** True when the browser hands the URL to an app of the system (`ssh://`): a new tab for it would stay blank. */
export function opensApp(url: string): boolean {
  return schemeOf(url) === 'ssh';
}
