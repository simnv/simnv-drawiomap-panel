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

/** The longest compressed page text that the host inflates (characters). */
export const MAX_PAGE_TEXT = 16 * 1024 * 1024;
/** The most inflated bytes of one file. */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

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
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.length;
      if (total > budget) {
        await reader.cancel();
        throw new Error(`The inflated diagram is over ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('The inflated diagram')) {
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

/** The page XML from the inflated bytes: URI-encoded text of an `<mxGraphModel>`. */
function decodePage(bytes: Uint8Array, page: number): string {
  let model: string;
  try {
    model = decodeURIComponent(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`The compressed page ${page} does not decode.`);
  }
  if (!/^\s*<mxGraphModel[\s>]/.test(model)) {
    throw new Error(`The compressed page ${page} is not a draw.io page.`);
  }
  return model;
}
