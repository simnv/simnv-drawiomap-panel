const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/** The URL after the clean-up that a URL parser does: no leading C0 controls and spaces, no tab and no line break. */
const cleaned = (url: string) => url.replace(/^[\u0000- ]+/, '').replace(/[\t\n\r]/g, '');

/** The scheme of a URL, in lower case; undefined for a relative URL. */
function schemeOf(url: string): string | undefined {
  return SCHEME.exec(cleaned(url))?.[1].toLowerCase();
}

/** A host name, an IPv4 address or a bracketed IPv6 address: no `%`, no space, nothing that a shell or ssh reads. */
const SSH_HOST = /^(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])$/;

/**
 * An `ssh://` URL with a host that an SSH client cannot read as an option: the user and the host (also after percent
 * decoding) do not start with `-` (a value such as `-oProxyCommand=...` from a label must not reach the client as an
 * option), and the host is only a name or an address. `ssh:` without `//` has no host and is refused.
 */
function isSafeSsh(url: string): boolean {
  const s = cleaned(url);
  if (!/^ssh:\/\//i.test(s)) {
    return false;
  }
  try {
    const u = new URL(s);
    const user = decodeURIComponent(u.username);
    const host = decodeURIComponent(u.hostname);
    return SSH_HOST.test(host) && !host.startsWith('-') && !user.startsWith('-');
  } catch {
    return false;
  }
}

/**
 * True when the URL is relative, uses http or https, or is a safe `ssh://` URL (see isSafeSsh). `ssh://` opens the SSH
 * client of the system (the browser hands it to the app that handles the scheme); it runs nothing in the page.
 */
export function isAllowedUrl(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme === undefined || scheme === 'http' || scheme === 'https' || (scheme === 'ssh' && isSafeSsh(url));
}

/** True when the browser hands the URL to an app of the system (`ssh://`): a new tab for it would stay blank. */
export function opensApp(url: string): boolean {
  return schemeOf(url) === 'ssh';
}
