import { describe, expect, it } from 'vitest';
import {
  acceptEditorMessage,
  buildEditorUrl,
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
  it('accepts an editor event from the editor origin when the frame window is unknown (sandbox)', () => {
    expect(acceptEditorMessage(ev(), ORIGIN, undefined, undefined)).toEqual({ event: 'init' });
  });
  it('rejects a wrong origin, a missing source and a payload without a JSON event', () => {
    expect(acceptEditorMessage(ev({ origin: 'https://evil.example' }), ORIGIN, undefined, undefined)).toBeUndefined();
    expect(acceptEditorMessage(ev({ source: null }), ORIGIN, undefined, undefined)).toBeUndefined();
    expect(acceptEditorMessage(ev({ data: 'GrafanaAppInit' }), ORIGIN, undefined, undefined)).toBeUndefined();
    expect(acceptEditorMessage(ev({ data: { event: 'init' } }), ORIGIN, undefined, undefined)).toBeUndefined();
  });
  it('compares the source with the frame window when the window is readable', () => {
    expect(acceptEditorMessage(ev(), ORIGIN, editor, undefined)).toEqual({ event: 'init' });
    expect(acceptEditorMessage(ev({ source: other }), ORIGIN, editor, undefined)).toBeUndefined();
    expect(acceptEditorMessage(ev(), ORIGIN, null, undefined)).toBeUndefined();
  });
  it('accepts by origin and shape when the sandbox blocks event.source, and reports the source as unknown', () => {
    // near-membrane throws a SecurityError when it wraps a cross-origin window.
    const blocked = (origin = ORIGIN) => ({
      origin,
      data: '{"event":"configure"}',
      get source(): unknown {
        throw new Error('SecurityError: Blocked a frame from accessing a cross-origin frame.');
      },
    });
    expect(eventSource(blocked())).toBeUndefined();
    expect(eventSource(ev())).toBe(editor);
    expect(eventSource(ev({ source: null }))).toBeNull();
    expect(acceptEditorMessage(blocked(), ORIGIN, undefined, undefined)).toEqual({ event: 'configure' });
    expect(acceptEditorMessage(blocked('https://evil.example'), ORIGIN, undefined, undefined)).toBeUndefined();
  });
  it('accepts later messages only from the source of the first accepted message', () => {
    expect(acceptEditorMessage(ev(), ORIGIN, undefined, editor)).toEqual({ event: 'init' });
    expect(acceptEditorMessage(ev({ source: other }), ORIGIN, undefined, editor)).toBeUndefined();
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
