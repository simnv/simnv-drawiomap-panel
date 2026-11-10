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
/** What the page records about the writes into the real DecompressionStream (see `instrument`). */
declare const dmapWrites: { sizes: number[]; aborted: boolean; cancelled: boolean };

/**
 * Wraps the DecompressionStream of the page: every write into the stream and the abort of its writable side are
 * recorded, and so is the cancel of its readable side. The inflate module reads the global when it runs.
 */
const instrument = () => {
  const Real = DecompressionStream;
  const writes = { sizes: [] as number[], aborted: false, cancelled: false };
  (window as unknown as { dmapWrites: typeof writes }).dmapWrites = writes;
  class Recorded extends Real {
    private out?: ReadableStream<Uint8Array>;
    private sink?: WritableStream<BufferSource>;
    get writable() {
      if (!this.sink) {
        const writer = super.writable.getWriter();
        this.sink = new WritableStream<BufferSource>({
          write: (chunk) => {
            writes.sizes.push(chunk.byteLength);
            return writer.write(chunk);
          },
          close: () => writer.close(),
          abort: (reason) => {
            writes.aborted = true;
            return writer.abort(reason);
          },
        });
      }
      return this.sink;
    }
    get readable() {
      if (!this.out) {
        const reader = super.readable.getReader();
        this.out = new ReadableStream<Uint8Array>({
          pull: async (controller) => {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
            } else {
              controller.enqueue(value);
            }
          },
          cancel: (reason) => {
            writes.cancelled = true;
            return reader.cancel(reason);
          },
        });
      }
      return this.out;
    }
  }
  (window as unknown as { DecompressionStream: unknown }).DecompressionStream = Recorded;
};

test('the inflate of a compressed page runs in the browser and stops a bomb at the limit', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(instrument);
  await page.addScriptTag({ content: bundle });
  const model =
    '<mxGraphModel><root><mxCell id="0"/><object id="a" label="α"><mxCell parent="0"/></object></root></mxGraphModel>';
  const plain = await page.evaluate(
    (xml) => dmapInflate.inflatePages(xml),
    `<mxfile><diagram id="p">${compress(model)}</diagram></mxfile>`
  );
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
      return { message, ms: performance.now() - start, chunk: dmapInflate.INPUT_CHUNK, writes: dmapWrites };
    },
    { xml: `<mxfile><diagram id="p">${bomb}</diagram></mxfile>`, maxBytes: limit }
  );
  expect(run.message).toMatch(/over 8388608 bytes/);
  const stopped = Number(/stopped at (\d+)/.exec(run.message)?.[1]);
  expect(stopped).toBeGreaterThan(limit);
  // The output that the limit cannot see is the inflate of one input chunk (at most about 1032:1).
  expect(stopped).toBeLessThanOrEqual(limit + run.chunk * 1032);
  expect(run.ms).toBeLessThan(5000);
  // The input went in chunk by chunk, the feed stopped long before the end of the input, and both ends stopped.
  const { sizes, aborted, cancelled } = run.writes;
  const compressedBytes = Buffer.from(bomb, 'base64').length;
  expect(Math.max(...sizes)).toBeLessThanOrEqual(run.chunk);
  expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(compressedBytes / 2);
  expect(sizes.length).toBeGreaterThan(0);
  expect({ aborted, cancelled }).toEqual({ aborted: true, cancelled: true });
});
