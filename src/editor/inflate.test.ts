import { deflateRawSync, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inflatePages, MAX_INFLATED_BYTES, MAX_PAGE_TEXT } from './inflate';

/** The page text of a compressed draw.io file: Graph.compress (deflateRaw of the URI-encoded XML, base64). */
const compress = (xml: string) => deflateRawSync(encodeURIComponent(xml)).toString('base64');
const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="a" label="Host α &amp; β"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel>';

afterEach(() => vi.unstubAllGlobals());

describe('inflatePages', () => {
  it('inflates every compressed page of a draw.io file and keeps the rest of the text', async () => {
    const xml = `<mxfile host="x"><diagram id="p1" name="One">${compress(model)}</diagram>\n<diagram id="p2" name="Two">${compress('<mxGraphModel><root/></mxGraphModel>')}</diagram></mxfile>`;
    expect(await inflatePages(xml)).toBe(
      `<mxfile host="x"><diagram id="p1" name="One">${model}</diagram>\n<diagram id="p2" name="Two"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>`
    );
  });
  it('leaves an uncompressed page, an empty page and a bare model as they are', async () => {
    const plain = `<mxfile><diagram id="p1">${model}</diagram><diagram id="p2"></diagram><diagram id="p3">\n</diagram></mxfile>`;
    expect(await inflatePages(plain)).toBe(plain);
    expect(await inflatePages(model)).toBe(model);
  });
  it('rejects a page that is not base64, not deflate-raw, not a model, or too large', async () => {
    const page = (text: string) => `<mxfile><diagram id="p">${text}</diagram></mxfile>`;
    await expect(inflatePages(page('not base64!'))).rejects.toThrow(/page 1/);
    await expect(inflatePages(page(deflateSync(encodeURIComponent(model)).toString('base64')))).rejects.toThrow(/page 1/);
    await expect(inflatePages(page(compress('<svg/>')))).rejects.toThrow(/page 1/);
    await expect(inflatePages(page(compress(model)), { maxBytes: 10 })).rejects.toThrow(/10 bytes/);
    await expect(inflatePages(page(compress(model)), { maxPageText: 10 })).rejects.toThrow(/page 1/);
    expect(MAX_PAGE_TEXT).toBeGreaterThan(1024 * 1024);
    expect(MAX_INFLATED_BYTES).toBeGreaterThan(MAX_PAGE_TEXT);
  });
  it('rejects when the browser has no DecompressionStream', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(inflatePages(`<mxfile><diagram id="p">${compress(model)}</diagram></mxfile>`)).rejects.toThrow(
      /DecompressionStream/
    );
  });
});
