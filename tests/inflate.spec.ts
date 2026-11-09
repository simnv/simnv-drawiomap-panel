import { buildSync } from 'esbuild';
import { deflateRawSync } from 'node:zlib';
import { expect, test } from '@grafana/plugin-e2e';

/**
 * The inflate of the editor export runs in the browser (DecompressionStream). jsdom cannot show that a compressed
 * bomb stops early in Chromium: Chromium inflates the whole output of one input chunk before it gives any of it to
 * the reader. The test runs the real module (src/editor/inflate.ts, bundled by esbuild) in the page.
 */
const bundle = buildSync({
  entryPoints: ['src/editor/inflate.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'dmapInflate',
  logLevel: 'silent',
}).outputFiles[0].text;

/** The page text of a compressed draw.io file: Graph.compress (deflateRaw of the URI-encoded XML, base64). */
const compress = (xml: string) => deflateRawSync(encodeURIComponent(xml)).toString('base64');

declare const dmapInflate: {
  inflatePages: (xml: string, limits?: { maxBytes?: number }) => Promise<string>;
  INPUT_CHUNK: number;
};

test('the inflate of a compressed page runs in the browser and stops a bomb at the limit', async ({ page }) => {
  await page.goto('/login');
  await page.addScriptTag({ content: bundle });
  const model = '<mxGraphModel><root><mxCell id="0"/><object id="a" label="α"><mxCell parent="0"/></object></root></mxGraphModel>';
  const plain = await page.evaluate((xml) => dmapInflate.inflatePages(xml), `<mxfile><diagram id="p">${compress(model)}</diagram></mxfile>`);
  expect(plain).toBe(`<mxfile><diagram id="p">${model}</diagram></mxfile>`);

  // 256 MB of one character packs to about 250 KB. The limit is 8 MB: the inflate must stop near it, fast.
  const bomb = deflateRawSync(
    Buffer.concat([
      Buffer.from(encodeURIComponent('<mxGraphModel>')),
      Buffer.alloc(256 * 1024 * 1024, '0'),
      Buffer.from(encodeURIComponent('</mxGraphModel>')),
    ])
  ).toString('base64');
  expect(bomb.length).toBeLessThan(1024 * 1024);
  const limit = 8 * 1024 * 1024;
  const run = await page.evaluate(
    async ({ xml, maxBytes }) => {
      const start = performance.now();
      const message = await dmapInflate.inflatePages(xml, { maxBytes }).then(
        () => 'resolved',
        (e: Error) => e.message
      );
      return { message, ms: performance.now() - start, chunk: dmapInflate.INPUT_CHUNK };
    },
    { xml: `<mxfile><diagram id="p">${bomb}</diagram></mxfile>`, maxBytes: limit }
  );
  expect(run.message).toMatch(/over 8388608 bytes/);
  const stopped = Number(/stopped at (\d+)/.exec(run.message)?.[1]);
  expect(stopped).toBeGreaterThan(limit);
  // The output that the limit cannot see is the inflate of one input chunk (at most about 1032:1).
  expect(stopped).toBeLessThanOrEqual(limit + run.chunk * 1032);
  expect(run.ms).toBeLessThan(5000);
});
