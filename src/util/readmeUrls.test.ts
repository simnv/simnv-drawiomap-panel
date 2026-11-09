import { describe, expect, it } from 'vitest';

import { rewriteReadmeUrls } from './readmeUrls';

const repo = 'simnv/simnv-drawiomap-panel';

describe('rewriteReadmeUrls', () => {
  it('rewrites relative images to raw URLs', () => {
    expect(rewriteReadmeUrls('![a](src/img/x.png)', repo, '1.2.3')).toBe(
      '![a](https://raw.githubusercontent.com/simnv/simnv-drawiomap-panel/v1.2.3/src/img/x.png)'
    );
  });

  it('rewrites relative links to blob URLs and keeps anchors', () => {
    expect(rewriteReadmeUrls('[g](docs/guide/index.md#x) [t](./CONTRIBUTING.md)', repo, '1.2.3')).toBe(
      '[g](https://github.com/simnv/simnv-drawiomap-panel/blob/v1.2.3/docs/guide/index.md#x) ' +
        '[t](https://github.com/simnv/simnv-drawiomap-panel/blob/v1.2.3/CONTRIBUTING.md)'
    );
  });

  it('leaves absolute URLs, mailto and anchors alone', () => {
    const md = '[a](https://example.com/a) ![b](https://example.com/b.png) [c](#c) [d](mailto:a@example.com)';
    expect(rewriteReadmeUrls(md, repo, '1.2.3')).toBe(md);
  });

  it('handles an image inside a link and skips fenced code', () => {
    const out = rewriteReadmeUrls('[![a](i.png)](docs/a.md)\n```\n[x](y.md)\n```', repo, '1.0.0');
    expect(out).toContain('[![a](https://raw.githubusercontent.com/simnv/simnv-drawiomap-panel/v1.0.0/i.png)](');
    expect(out).toContain('](https://github.com/simnv/simnv-drawiomap-panel/blob/v1.0.0/docs/a.md)');
    expect(out).toContain('\n[x](y.md)\n');
  });

  const blob = 'https://github.com/simnv/simnv-drawiomap-panel/blob/v1.0.0/';

  it('keeps the title of a link', () => {
    expect(rewriteReadmeUrls('[a](b.md "t")', repo, '1.0.0')).toBe(`[a](${blob}b.md "t")`);
  });

  it('keeps a query string', () => {
    expect(rewriteReadmeUrls('[a](b.md?x=1&y=2)', repo, '1.0.0')).toBe(`[a](${blob}b.md?x=1&y=2)`);
  });

  it('leaves an anchor-only link alone', () => {
    expect(rewriteReadmeUrls('[a](#top "t")', repo, '1.0.0')).toBe('[a](#top "t")');
  });

  it('skips inline code spans', () => {
    expect(rewriteReadmeUrls('`[a](b.md)` and [c](d.md) and ``[e](f.md)``', repo, '1.0.0')).toBe(
      `\`[a](b.md)\` and [c](${blob}d.md) and \`\`[e](f.md)\`\``
    );
  });

  it('rewrites a link whose text holds a code span', () => {
    expect(rewriteReadmeUrls('[`x`](d.md)', repo, '1.0.0')).toBe(`[\`x\`](${blob}d.md)`);
  });
});
