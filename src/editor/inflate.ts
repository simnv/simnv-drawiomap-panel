/**
 * The pages of a draw.io file that the editor compressed: `Graph.compress` writes `base64(deflateRaw(
 * encodeURIComponent(xml)))` as the text of `<diagram>`. The export of the bundled editor always compresses its
 * pages (src/editor/protocol.ts). The host inflates them before it stores the diagram, so that the panel can write
 * to page 1 (src/editor/setCellAttrs.ts) and read the edge ends (src/binding/edgeEnds.ts).
 *
 * The input comes from the editor frame (docs/security.md). The inflate is bounded: a page text over
 * `MAX_PAGE_TEXT` and an output over `MAX_INFLATED_BYTES` (for the whole file) are failures, and the inflated text
 * must be an `<mxGraphModel>`. The browser does the work (`DecompressionStream`, deflate-raw); a failure stores
 * nothing and the editor shows the reason.
 */

import { parseXml } from '../util/xml';

/** The longest compressed page text that the host inflates (characters). */
export const MAX_PAGE_TEXT = 16 * 1024 * 1024;
/** The most inflated bytes of one file. */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;
/**
 * The bytes of compressed input that go into the stream at one time. Chromium inflates the whole output of one
 * input chunk before it gives any of it to the reader, so the output of one chunk is the memory the limit cannot
 * see. Deflate expands at most about 1032:1: a 4 KB chunk gives at most about 4 MB, and the input is at most
 * `MAX_PAGE_TEXT`, so the stream sees at most 4096 chunks for a page.
 */
export const INPUT_CHUNK = 4096;

export interface InflateLimits {
  maxPageText?: number;
  maxBytes?: number;
}

/** A page with a text and no child element: the compressed form. The text is base64 (no `<`, no `&`). */
const PAGE = /(<diagram\b[^>]*>)([^<]*)(<\/diagram>)/g;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Inflates every compressed page of a draw.io file. Other text does not change. */
export async function inflatePages(xml: string, limits: InflateLimits = {}): Promise<string> {
  const maxPageText = limits.maxPageText ?? MAX_PAGE_TEXT;
  const maxBytes = limits.maxBytes ?? MAX_INFLATED_BYTES;
  let budget = maxBytes;
  let page = 0;
  let out = '';
  let last = 0;
  for (const m of xml.matchAll(PAGE)) {
    page++;
    const text = m[2].trim();
    if (text === '') {
      continue;
    }
    if (text.length > maxPageText) {
      throw new Error(`The compressed page ${page} is too large (over ${maxPageText} characters).`);
    }
    const bytes = await inflatePage(text, page, budget, maxBytes);
    budget -= bytes.length;
    const model = decodePage(bytes, page);
    out += xml.slice(last, m.index) + m[1] + model + m[3];
    last = m.index + m[0].length;
  }
  return out + xml.slice(last);
}

/** The inflated bytes of one page: base64, then deflate-raw through the browser. */
async function inflatePage(text: string, page: number, budget: number, maxBytes: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser has no DecompressionStream: it cannot inflate the compressed page.');
  }
  if (!BASE64.test(text)) {
    throw new Error(`The compressed page ${page} is not base64.`);
  }
  let input: Uint8Array<ArrayBuffer>;
  try {
    input = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    throw new Error(`The compressed page ${page} is not base64.`);
  }
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  class Overflow extends Error {}
  // The reader counts every output chunk as it comes. The stream has no output queue (highWaterMark 0), so the
  // writer waits for the reader before it gives the next input chunk: the count runs ahead of the inflate.
  const drain = async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      total += value.length;
      if (total > budget) {
        throw new Overflow(`The inflated diagram is over ${maxBytes} bytes (stopped at ${total}).`);
      }
      chunks.push(value);
    }
  };
  const feed = async () => {
    for (let at = 0; at < input.length; at += INPUT_CHUNK) {
      await writer.write(input.subarray(at, at + INPUT_CHUNK));
    }
    await writer.close();
  };
  try {
    await Promise.all([drain(), feed()]);
  } catch (e) {
    // Stop both ends at once: no more input goes in, and the output in flight is dropped.
    await Promise.allSettled([writer.abort(e), reader.cancel(e)]);
    if (e instanceof Overflow) {
      throw e;
    }
    throw new Error(`The compressed page ${page} does not inflate.`);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/** The page XML from the inflated bytes: URI-encoded text of one well-formed `<mxGraphModel>` document. */
function decodePage(bytes: Uint8Array, page: number): string {
  let model: string;
  try {
    model = decodeURIComponent(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`The compressed page ${page} does not decode.`);
  }
  const doc = parseXml(model);
  if (!doc || doc.documentElement.localName !== 'mxGraphModel') {
    throw new Error(`The compressed page ${page} is not a draw.io page.`);
  }
  return model;
}
