import { describe, expect, it } from 'vitest';
import {
  acceptChannelHello,
  acceptEditorMessage,
  buildEditorUrl,
  channelHello,
  classifyEditorMessage,
  newChannelToken,
  editorOrigin,
  eventSource,
  frameWindow,
  handleMessage,
  initialState,
  parseMessage,
} from './protocol';

const xml = '<mxfile><diagram/></mxfile>';
const svgB64 = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
const opts = { mode: 'edit' as const, title: 'map', isDark: false };

describe('buildEditorUrl / editorOrigin', () => {
  it('merges each embed parameter separately and sets dark from the theme', () => {
    expect(buildEditorUrl('http://localhost:8080', false)).toBe(
      'http://localhost:8080/?embed=1&proto=json&configure=1&spin=1&libraries=1&ui=min&saveAndExit=1&noExitBtn=0&dark=0'
    );
    const u = new URL(buildEditorUrl('https://embed.diagrams.net/?ui=sketch&embed=1&lang=en', true));
    expect(u.searchParams.get('ui')).toBe('sketch');
    expect(u.searchParams.get('lang')).toBe('en');
    expect(u.searchParams.get('proto')).toBe('json');
    expect(u.searchParams.get('configure')).toBe('1');
    expect(u.searchParams.get('dark')).toBe('1');
    expect(u.searchParams.getAll('embed')).toEqual(['1']);
    expect(editorOrigin('http://localhost:8080/?x=1')).toBe('http://localhost:8080');
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

describe('frameWindow / acceptEditorMessage', () => {
  const editor = { name: 'editor frame' };
  const other = { name: 'other frame' };
  const ORIGIN = 'http://localhost:8080';
  const ev = (over: Partial<{ origin: string; source: unknown; data: unknown }> = {}) => ({
    origin: ORIGIN,
    source: editor,
    data: '{"event":"init"}',
    ...over,
  });

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
  it('reports the sender, or undefined when near-membrane throws on a cross-origin window', () => {
    const blocked = {
      origin: ORIGIN,
      get source(): unknown {
        throw new Error('SecurityError: Blocked a frame from accessing a cross-origin frame.');
      },
    };
    expect(eventSource(blocked)).toBeUndefined();
    expect(eventSource(ev())).toBe(editor);
    expect(eventSource(ev({ source: null }))).toBeNull();
  });
  it('accepts an editor event only from the frame window and the editor origin', () => {
    expect(classifyEditorMessage(ev(), ORIGIN, editor)).toEqual({ kind: 'accept', msg: { event: 'init' } });
    expect(acceptEditorMessage(ev(), ORIGIN, editor)).toEqual({ event: 'init' });
  });
  it('rejects a wrong origin, another sender and a payload without a JSON event', () => {
    expect(acceptEditorMessage(ev({ origin: 'https://evil.example' }), ORIGIN, editor)).toBeUndefined();
    expect(acceptEditorMessage(ev({ source: other }), ORIGIN, editor)).toBeUndefined();
    expect(acceptEditorMessage(ev({ source: null }), ORIGIN, editor)).toBeUndefined();
    expect(acceptEditorMessage(ev({ data: 'GrafanaAppInit' }), ORIGIN, editor)).toBeUndefined();
    expect(acceptEditorMessage(ev({ data: { event: 'init' } }), ORIGIN, editor)).toBeUndefined();
  });
  it('fails closed when the frame window or the sender is not known: no first-sender pinning', () => {
    // The frame is not mounted or was removed.
    expect(acceptEditorMessage(ev(), ORIGIN, null)).toBeUndefined();
    // The Grafana frontend sandbox forbids iframe.contentWindow.
    expect(classifyEditorMessage(ev(), ORIGIN, undefined)).toEqual({ kind: 'blocked' });
    // near-membrane throws on event.source.
    const blockedSource = {
      origin: ORIGIN,
      data: '{"event":"configure"}',
      get source(): unknown {
        throw new Error('SecurityError');
      },
    };
    expect(classifyEditorMessage(blockedSource, ORIGIN, editor)).toEqual({ kind: 'blocked' });
    // Messages that are not editor events, or from another origin, never report a blocked editor.
    expect(classifyEditorMessage(ev({ data: 'x' }), ORIGIN, undefined)).toEqual({ kind: 'ignore' });
    expect(classifyEditorMessage(ev({ origin: 'https://evil.example' }), ORIGIN, undefined)).toEqual({
      kind: 'ignore',
    });
    // A second message from the same sender is still compared with the frame window.
    expect(acceptEditorMessage(ev({ source: other }), ORIGIN, editor)).toBeUndefined();
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
  it('returns the result on export and closes only when exit was requested', () => {
    const s1 = handleMessage(
      { phase: 'exporting', xml: '<mxfile>2</mxfile>', pendingExit: false },
      { event: 'export', format: 'xmlsvg', data: svgB64, xml: '<mxfile>3</mxfile>' },
      opts
    );
    expect(s1.result).toEqual({ xml: '<mxfile>3</mxfile>', svg: '<svg/>' });
    expect(s1.close).toBe(false);
    expect(s1.state.phase).toBe('loaded');
    const s2 = handleMessage(
      { phase: 'exporting', xml: '<mxfile>2</mxfile>', pendingExit: true },
      { event: 'export', data: svgB64 },
      opts
    );
    expect(s2.result).toEqual({ xml: '<mxfile>2</mxfile>', svg: '<svg/>' });
    expect(s2.close).toBe(true);
    expect(s2.state.phase).toBe('done');
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
    const done = handleMessage(s.state, { event: 'export', data: svgB64, xml }, eo);
    expect(done.result?.svg).toBe('<svg/>');
    expect(done.close).toBe(true);
  });
  it('hides the save button in load', () => {
    expect(handleMessage(initialState(xml), { event: 'init' }, eo).send[0]).toMatchObject({
      action: 'load',
      noSaveBtn: '1',
    });
  });
});
