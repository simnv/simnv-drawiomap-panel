/**
 * Build-time helper for webpack.config.ts. The catalogue rejects relative links and images in README.md, and GitHub
 * needs them. The repository README keeps relative paths. The build rewrites them in dist/README.md.
 * Absolute URLs, `//` URLs, `mailto:` links and `#anchors` stay as they are. Fenced code blocks and inline code spans stay as they are.
 */
const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;
/** `[text](target` or `![alt](target`. The text may hold one image, as in a linked picture. */
const REFERENCE = /(!?)\[((?:[^[\]]|!\[[^\]]*\]\([^)]*\))*)\]\(([^)\s]+)/g;

export function rewriteReadmeUrls(markdown: string, repo: string, version: string): string {
  const raw = `https://raw.githubusercontent.com/${repo}/v${version}/`;
  const blob = `https://github.com/${repo}/blob/v${version}/`;
  const rewriteText = (line: string): string =>
    line.replace(REFERENCE, (_m, bang: string, text: string, target: string) => {
      const base = bang ? raw : blob;
      const url = ABSOLUTE.test(target) ? target : base + target.replace(/^(\.\/|\/)+/, '');
      return `${bang}[${bang ? text : rewriteText(text)}](${url}`;
    });
  // An inline code span hides behind a placeholder while the line is rewritten, so a link can still hold a span.
  const rewriteLine = (line: string): string => {
    const spans: string[] = [];
    const masked = line.replace(/(`+)(?:(?!\1)[\s\S])+?\1/g, (span) => `\u0000${spans.push(span) - 1}\u0000`);
    return rewriteText(masked).replace(/\u0000(\d+)\u0000/g, (_m, i: string) => spans[Number(i)]);
  };
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      return fenced ? line : rewriteLine(line);
    })
    .join('\n');
}
