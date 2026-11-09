import { describe, expect, it } from 'vitest';
import {
  acceptChannelHello,
  channelHello,
  newChannelToken,
  editorSearch,
  eventSource,
  frameWindow,
  handleMessage,
  initialState,
  parseMessage,
} from './protocol';

const xml = '<mxfile><diagram/></mxfile>';
const svgB64 = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
const opts = { mode: 'edit' as const, title: 'map', isDark: false };

describe('editorSearch', () => {
  it('sets the embed parameters and dark from the theme', () => {
    expect(editorSearch(false)).toBe(
      '?embed=1&proto=json&configure=1&spin=1&libraries=1&ui=min&saveAndExit=1&noExitBtn=0&dark=0'
    );
    expect(new URLSearchParams(editorSearch(true)).get('dark')).toBe('1');
  });
});

describe('parseMessage', () => {
  it('accepts JSON strings with an event and rejects others', () => {
    expect(parseMessage('{"event":"init"}')).toEqual({ event: 'init' });
    expect(parseMessage('nope')).toBeUndefined();
    expect(parseMessage(42)).toBeUndefined();
    expect(parseMessage('{"x":1}')).toBeUndefined();
  });
});

describe('frameWindow / eventSource', () => {
  const editor = { name: 'editor frame' };

  it('returns the frame window, or undefined when the frontend sandbox forbids iframe.contentWindow', () => {
    expect(frameWindow({ contentWindow: editor } as never)).toBe(editor);
    expect(frameWindow(null)).toBeNull();
    const sandboxed = {
      get contentWindow(): Window {
        throw new Error('iframe.contentWindow is not allowed in sandboxed plugins');
      },
    };
    expect(frameWindow(sandboxed as never)).toBeUndefined();
  });
  it('returns the sender window, or undefined when the frontend sandbox hides it', () => {
    const blocked = {
      get source(): unknown {
        throw new Error('SecurityError: Blocked a frame from accessing a cross-origin frame.');
      },
    };
    expect(eventSource(blocked)).toBeUndefined();
    expect(eventSource({ source: editor })).toBe(editor);
    expect(eventSource({ source: null })).toBeNull();
  });
});

describe('channel of the bundled editor (token + MessagePort)', () => {
  const TOKEN = 'a'.repeat(32);
  const port = { name: 'port' };
  const frame = { name: 'editor frame' };
  const hello = (over: Partial<{ origin: string; source: unknown; data: unknown; ports: unknown[] }> = {}) => ({
    origin: 'null',
    source: frame,
    data: channelHello(TOKEN),
    ports: [port],
    ...over,
  });
  const throwing = (over: Partial<{ origin: string; data: unknown; ports: unknown[] }> = {}) => ({
    origin: 'null',
    data: channelHello(TOKEN),
    ports: [port],
    ...over,
    get source(): unknown {
      throw new Error('SecurityError: Blocked a frame from accessing a cross-origin frame.');
    },
  });

  it('makes a new random 128-bit token for each editor', () => {
    const a = newChannelToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newChannelToken()).not.toBe(a);
  });
  it('accepts the port of a hello with the token, the editor origin and the frame window as sender', () => {
    expect(acceptChannelHello(hello(), 'null', TOKEN, frame)).toBe(port);
    expect(acceptChannelHello(hello({ origin: 'http://g' }), 'http://g', TOKEN, frame)).toBe(port);
  });
  it('accepts the port by token and origin when the frontend sandbox hides the frame window and the sender', () => {
    expect(acceptChannelHello(throwing(), 'null', TOKEN, undefined)).toBe(port);
  });
  it('rejects a wrong token, a wrong origin, a missing port, another sender and other payloads', () => {
    expect(acceptChannelHello(hello({ data: channelHello('b'.repeat(32)) }), 'null', TOKEN, frame)).toBeUndefined();
    expect(acceptChannelHello(hello({ data: channelHello('') }), 'null', '', frame)).toBeUndefined();
    expect(acceptChannelHello(hello({ origin: 'http://g' }), 'null', TOKEN, frame)).toBeUndefined();
    expect(acceptChannelHello(throwing({ origin: 'https://evil.example' }), 'null', TOKEN, undefined)).toBeUndefined();
    expect(acceptChannelHello(hello({ ports: [] }), 'null', TOKEN, frame)).toBeUndefined();
    expect(acceptChannelHello(hello({ ports: [port, port] }), 'null', TOKEN, frame)).toBeUndefined();
    expect(acceptChannelHello(hello({ source: { name: 'other' } }), 'null', TOKEN, frame)).toBeUndefined();
    expect(acceptChannelHello(hello({ data: '{"event":"init"}' }), 'null', TOKEN, frame)).toBeUndefined();
    expect(acceptChannelHello(hello({ data: { dmapHello: TOKEN } }), 'null', TOKEN, frame)).toBeUndefined();
    expect(acceptChannelHello(hello({ data: 'not json' }), 'null', TOKEN, frame)).toBeUndefined();
  });
});

describe('handleMessage in edit mode', () => {
  it('answers configure with compressXml:false', () => {
    const s = handleMessage(initialState(xml), { event: 'configure' }, opts);
    expect(s.send[0]).toMatchObject({ action: 'configure', config: { compressXml: false } });
  });
  it('answers init with load', () => {
    const s = handleMessage(initialState(xml), { event: 'init' }, opts);
    expect(s.send[0]).toMatchObject({ action: 'load', xml, autosave: 0, title: 'map', saveAndExit: '1' });
    expect(s.state.phase).toBe('init');
  });
  it('moves to loaded on load and does not export in edit mode', () => {
    const s = handleMessage(initialState(xml), { event: 'load' }, opts);
    expect(s.state.phase).toBe('loaded');
    expect(s.send).toEqual([]);
  });
  it('requests an xmlsvg export on save and remembers exit', () => {
    const s = handleMessage(
      { phase: 'loaded', xml, pendingExit: false },
      { event: 'save', xml: '<mxfile>2</mxfile>', exit: true },
      opts
    );
    expect(s.send[0]).toMatchObject({
      action: 'export',
      format: 'xmlsvg',
      embedCellMetadata: true,
      embedImages: true,
      theme: 'auto',
    });
    expect(s.state).toMatchObject({ phase: 'exporting', xml: '<mxfile>2</mxfile>', pendingExit: true });
  });
  it('asks for the uncompressed XML after the SVG export, then returns the result', () => {
    // The xmlsvg export of draw.io compresses the pages of its xml (getFileData with uncompressed=false), so the
    // host asks for the xml export (which honours compressXml:false) and keeps the SVG while it waits.
    const compressed = '<mxfile><diagram id="p">7Vxbc9...</diagram></mxfile>';
    const s1 = handleMessage(
      { phase: 'exporting', xml: '<mxfile>2</mxfile>', pendingExit: false },
      { event: 'export', format: 'svg', data: svgB64, xml: compressed },
      opts
    );
    expect(s1.result).toBeUndefined();
    expect(s1.close).toBe(false);
    expect(s1.send).toEqual([{ action: 'export', format: 'xml' }]);
    expect(s1.state).toMatchObject({ phase: 'exporting', xml: '<mxfile>2</mxfile>', pendingExit: false });
    const s2 = handleMessage(s1.state, { event: 'export', format: 'xml', xml: '<mxfile>3</mxfile>' }, opts);
    expect(s2.result).toEqual({ xml: '<mxfile>3</mxfile>', svg: '<svg/>' });
    expect(s2.close).toBe(false);
    expect(s2.state).toEqual({ phase: 'loaded', xml: '<mxfile>3</mxfile>', pendingExit: false });
  });
  it('closes after the xml export only when exit was requested, and falls back to the saved xml', () => {
    const s1 = handleMessage(
      { phase: 'exporting', xml: '<mxfile>2</mxfile>', pendingExit: true },
      { event: 'export', data: svgB64 },
      opts
    );
    expect(s1.result).toBeUndefined();
    expect(s1.close).toBe(false);
    const s2 = handleMessage(s1.state, { event: 'export', format: 'xml' }, opts);
    expect(s2.result).toEqual({ xml: '<mxfile>2</mxfile>', svg: '<svg/>' });
    expect(s2.close).toBe(true);
    expect(s2.state.phase).toBe('done');
  });
  it('ignores an export outside the exporting phase, an SVG export with no data and an xml export before the SVG', () => {
    const loaded = { phase: 'loaded' as const, xml, pendingExit: false };
    expect(handleMessage(loaded, { event: 'export', format: 'svg', data: svgB64 }, opts)).toEqual({
      state: loaded,
      send: [],
      close: false,
    });
    const exporting = { phase: 'exporting' as const, xml, pendingExit: false };
    expect(handleMessage(exporting, { event: 'export', format: 'svg' }, opts).send).toEqual([]);
    const early = handleMessage(exporting, { event: 'export', format: 'xml', xml: '<mxfile>3</mxfile>' }, opts);
    expect(early.result).toBeUndefined();
    expect(early.state).toBe(exporting);
  });
  it('closes on exit', () => {
    expect(handleMessage({ phase: 'loaded', xml, pendingExit: false }, { event: 'exit' }, opts).close).toBe(true);
  });
  it('ignores unknown events', () => {
    const s = handleMessage({ phase: 'loaded', xml, pendingExit: false }, { event: 'autosave', xml: 'x' }, opts);
    expect(s.send).toEqual([]);
    expect(s.state.xml).toBe(xml);
  });
});

describe('handleMessage in export-only mode', () => {
  const eo = { ...opts, mode: 'export-only' as const };
  it('exports right after load and closes after export', () => {
    const s = handleMessage(initialState(xml), { event: 'load' }, eo);
    expect(s.send[0]).toMatchObject({ action: 'export', format: 'xmlsvg' });
    expect(s.state.phase).toBe('exporting');
    const svg = handleMessage(s.state, { event: 'export', format: 'svg', data: svgB64, xml }, eo);
    expect(svg.result).toBeUndefined();
    expect(svg.close).toBe(false);
    expect(svg.send).toEqual([{ action: 'export', format: 'xml' }]);
    const done = handleMessage(svg.state, { event: 'export', format: 'xml', xml: '<mxfile>u</mxfile>' }, eo);
    expect(done.result).toEqual({ xml: '<mxfile>u</mxfile>', svg: '<svg/>' });
    expect(done.close).toBe(true);
    expect(done.state.phase).toBe('done');
  });
  it('hides the save button in load', () => {
    expect(handleMessage(initialState(xml), { event: 'init' }, eo).send[0]).toMatchObject({
      action: 'load',
      noSaveBtn: '1',
    });
  });
});
