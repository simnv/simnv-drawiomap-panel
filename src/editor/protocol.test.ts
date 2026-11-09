import { describe, expect, it } from 'vitest';
import {
  acceptChannelHello,
  channelHello,
  EditorMessage,
  exportDone,
  exportFailed,
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
  const loaded = { phase: 'loaded' as const, xml, pendingExit: false, seq: 0 };
  const reply = (seq: number, over: Partial<EditorMessage> = {}): EditorMessage => ({
    event: 'export',
    format: 'svg',
    data: svgB64,
    xml: '<mxfile>c</mxfile>',
    message: { action: 'export', seq },
    ...over,
  });

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
  it('requests one xmlsvg export on save, with a new id each time, and remembers exit', () => {
    const s = handleMessage(loaded, { event: 'save', xml: '<mxfile>2</mxfile>', exit: true }, opts);
    expect(s.send).toEqual([
      { action: 'export', format: 'xmlsvg', embedCellMetadata: true, embedImages: true, theme: 'auto', spin: 'Saving', seq: 1 },
    ]);
    expect(s.state).toEqual({ phase: 'exporting', xml: '<mxfile>2</mxfile>', pendingExit: true, seq: 1 });
    const again = handleMessage(s.state, { event: 'save', xml: '<mxfile>3</mxfile>' }, opts);
    expect(again.send[0]).toMatchObject({ action: 'export', seq: 2 });
    expect(again.state).toEqual({ phase: 'exporting', xml: '<mxfile>3</mxfile>', pendingExit: false, seq: 2 });
  });
  it('hands the reply of the current export to the host for the inflate and waits', () => {
    const exporting = { ...loaded, phase: 'exporting' as const, xml: '<mxfile>2</mxfile>', seq: 1 };
    const s = handleMessage(exporting, reply(1), opts);
    expect(s.export).toEqual({ xml: '<mxfile>c</mxfile>', svg: '<svg/>' });
    expect(s.result).toBeUndefined();
    expect(s.close).toBe(false);
    expect(s.state).toEqual({ ...exporting, phase: 'inflating' });
    // A reply with no xml: the xml of the save event.
    expect(handleMessage(exporting, reply(1, { xml: undefined }), opts).export?.xml).toBe('<mxfile>2</mxfile>');
  });
  it('ignores a stale reply, a reply with no id, a reply with no data and a reply outside an export', () => {
    const exporting = { ...loaded, phase: 'exporting' as const, seq: 2 };
    for (const msg of [reply(1), reply(3), reply(2, { message: undefined }), reply(2, { data: undefined })]) {
      expect(handleMessage(exporting, msg, opts)).toEqual({ state: exporting, send: [], close: false });
    }
    expect(handleMessage(loaded, reply(0), opts).state).toBe(loaded);
    const inflating = { ...exporting, phase: 'inflating' as const };
    expect(handleMessage(inflating, reply(2), opts).state).toBe(inflating);
  });
  it('stores the inflated diagram with exportDone and closes only when exit was requested', () => {
    const inflating = { ...loaded, phase: 'inflating' as const, xml: '<mxfile>2</mxfile>', seq: 1 };
    const diagram = { xml: '<mxfile>u</mxfile>', svg: '<svg/>' };
    const s1 = exportDone(inflating, 1, diagram, opts);
    expect(s1.result).toBe(diagram);
    expect(s1.close).toBe(false);
    expect(s1.state).toEqual({ phase: 'loaded', xml: '<mxfile>u</mxfile>', pendingExit: false, seq: 1 });
    const s2 = exportDone({ ...inflating, pendingExit: true }, 1, diagram, opts);
    expect(s2.result).toBe(diagram);
    expect(s2.close).toBe(true);
    expect(s2.state.phase).toBe('done');
  });
  it('exportDone ignores an old export and any phase but inflating', () => {
    const inflating = { ...loaded, phase: 'inflating' as const, seq: 2 };
    const diagram = { xml: '<mxfile>u</mxfile>', svg: '<svg/>' };
    expect(exportDone(inflating, 1, diagram, opts)).toEqual({ state: inflating, send: [], close: false });
    const exporting = { ...inflating, phase: 'exporting' as const };
    expect(exportDone(exporting, 2, diagram, opts)).toEqual({ state: exporting, send: [], close: false });
    expect(exportDone(loaded, 0, diagram, opts).result).toBeUndefined();
  });
  it('exportFailed keeps the editor open with the reason, in exporting and in inflating, and a save clears it', () => {
    const exporting = { ...loaded, phase: 'exporting' as const, pendingExit: true, seq: 1 };
    const s = exportFailed(exporting, 1, 'no reply');
    expect(s).toEqual({
      state: { phase: 'loaded', xml, pendingExit: false, seq: 1, failure: 'no reply' },
      send: [],
      close: false,
    });
    expect(exportFailed({ ...exporting, phase: 'inflating' }, 1, 'bad page').state.failure).toBe('bad page');
    expect(exportFailed(exporting, 0, 'old').state).toBe(exporting);
    expect(exportFailed(loaded, 0, 'late').state).toBe(loaded);
    const saved = handleMessage(s.state, { event: 'save', xml: '<mxfile>3</mxfile>' }, opts);
    expect(saved.state).toEqual({ phase: 'exporting', xml: '<mxfile>3</mxfile>', pendingExit: false, seq: 2 });
    expect(saved.state.failure).toBeUndefined();
  });
  it('closes on exit', () => {
    expect(handleMessage(loaded, { event: 'exit' }, opts).close).toBe(true);
  });
  it('ignores unknown events', () => {
    const s = handleMessage(loaded, { event: 'autosave', xml: 'x' }, opts);
    expect(s.send).toEqual([]);
    expect(s.state.xml).toBe(xml);
  });
});

describe('handleMessage in export-only mode', () => {
  const eo = { ...opts, mode: 'export-only' as const };
  it('exports right after load, hands the reply to the inflate, and closes after exportDone', () => {
    const s = handleMessage(initialState(xml), { event: 'load' }, eo);
    expect(s.send[0]).toMatchObject({ action: 'export', format: 'xmlsvg', seq: 1 });
    expect(s.state).toEqual({ phase: 'exporting', xml, pendingExit: true, seq: 1 });
    const got = handleMessage(s.state, { event: 'export', data: svgB64, xml, message: { seq: 1 } }, eo);
    expect(got.export).toEqual({ xml, svg: '<svg/>' });
    expect(got.close).toBe(false);
    const done = exportDone(got.state, 1, { xml: '<mxfile>u</mxfile>', svg: '<svg/>' }, eo);
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
