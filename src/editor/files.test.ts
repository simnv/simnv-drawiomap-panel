import { describe, expect, it, vi } from 'vitest';
import { editorFileUrl, parseFileRequest, readEditorFile } from './files';

const BASE = 'http://g.local/grafana/public/plugins/simnv-drawiomap-panel/drawio/';

describe('parseFileRequest', () => {
  it('accepts {"dmapFetch":<id>,"url":<string>} and rejects others', () => {
    expect(parseFileRequest('{"dmapFetch":3,"url":"x.png"}')).toEqual({ id: 3, url: 'x.png' });
    expect(parseFileRequest('{"event":"init"}')).toBeUndefined();
    expect(parseFileRequest('{"dmapFetch":"3","url":"x.png"}')).toBeUndefined();
    expect(parseFileRequest('{"dmapFetch":3,"url":5}')).toBeUndefined();
    expect(parseFileRequest({ dmapFetch: 3, url: 'x.png' })).toBeUndefined();
    expect(parseFileRequest('nope')).toBeUndefined();
  });
});

describe('editorFileUrl', () => {
  it('accepts images inside the draw.io directory', () => {
    expect(editorFileUrl(BASE + 'img/lib/clip_art/computers/Server_128x128.png', BASE)).toEqual({
      href: BASE + 'img/lib/clip_art/computers/Server_128x128.png',
      type: 'image/png',
    });
    expect(editorFileUrl(BASE + 'img/lib/mscae/Azure%20API%20for%20FHIR.svg', BASE)?.type).toBe('image/svg+xml');
    expect(editorFileUrl(BASE + 'images/x.GIF', BASE)?.type).toBe('image/gif');
  });
  it('rejects other directories, other origins, other file types, queries and dot segments', () => {
    const bad = [
      'http://g.local/grafana/api/user',
      'http://g.local/grafana/public/plugins/simnv-drawiomap-panel/module.js',
      BASE + '../module.js',
      BASE + '%2e%2e/%2e%2e/other-plugin/logo.png',
      BASE + 'img/../../x.png',
      'http://evil.example/drawio/x.png',
      BASE + 'js/app.min.js',
      BASE + 'resources/dia.txt.js',
      BASE + 'img/x.png?v=1',
      BASE + 'img/x.png#a',
      'data:image/png;base64,AAAA',
      'img/x.png',
      'not a url',
    ];
    for (const u of bad) {
      expect(editorFileUrl(u, BASE)).toBeUndefined();
    }
  });
});

describe('readEditorFile', () => {
  it('reads the file without credentials and answers with a data: URL of the type of the extension', async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const reply = await readEditorFile({ id: 7, url: BASE + 'img/a.png' }, BASE, fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(BASE + 'img/a.png', { credentials: 'omit', redirect: 'error' });
    expect(JSON.parse(reply)).toEqual({ dmapFile: 7, dataUri: 'data:image/png;base64,AQID' });
  });
  it('answers with an empty data: URL for a rejected URL, an HTTP error or a fetch error', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 404 }));
    expect(JSON.parse(await readEditorFile({ id: 1, url: BASE + '../x.png' }, BASE, fetchFn))).toEqual({
      dmapFile: 1,
      dataUri: '',
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(JSON.parse(await readEditorFile({ id: 2, url: BASE + 'img/a.png' }, BASE, fetchFn)).dataUri).toBe('');
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(JSON.parse(await readEditorFile({ id: 3, url: BASE + 'img/a.png' }, BASE, failing)).dataUri).toBe('');
  });
  it('rejects files larger than the limit', async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array(11), { status: 200 }));
    const reply = await readEditorFile({ id: 4, url: BASE + 'img/a.png' }, BASE, fetchFn, 10);
    expect(JSON.parse(reply).dataUri).toBe('');
  });
});
