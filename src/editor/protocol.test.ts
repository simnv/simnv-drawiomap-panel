import { describe, expect, it } from 'vitest';
import {
  acceptChannelHello,
  channelHello,
  EditorAction,
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
  Step,
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
  const exportAction = (seq: number) => ({
    action: 'export',
    format: 'xmlsvg',
    embedCellMetadata: true,
    embedImages: true,
    theme: 'auto',
    spin: 'Saving',
    seq,
  });
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
    const again = handleMessage({ ...loaded, seq: 1 }, { event: 'save', xml: '<mxfile>3</mxfile>' }, opts);
    expect(again.send[0]).toMatchObject({ action: 'export', seq: 2 });
    expect(again.state).toEqual({ phase: 'exporting', xml: '<mxfile>3</mxfile>', pendingExit: false, seq: 2 });
  });
  it('keeps one export in flight: a save during an export waits, and the latest one follows the reply', () => {
    // The bundled draw.io runs an export only when its spinner is free (spinner.spin returns false while it spins),
    // so a second request during an export gets no reply. The host sends the next export after the reply.
    const first = handleMessage(loaded, { event: 'save', xml: '<mxfile>1</mxfile>' }, opts);
    const second = handleMessage(first.state, { event: 'save', xml: '<mxfile>2</mxfile>' }, opts);
    expect(second.send).toEqual([]);
    expect(second.state).toEqual({ ...first.state, pending: { xml: '<mxfile>2</mxfile>', exit: false } });
    // The latest save wins, with its exit flag.
    const third = handleMessage(second.state, { event: 'save', xml: '<mxfile>3</mxfile>', exit: true }, opts);
    expect(third.send).toEqual([]);
    expect(third.state.pending).toEqual({ xml: '<mxfile>3</mxfile>', exit: true });
    const got = handleMessage(third.state, reply(1, { xml: '<mxfile>c1</mxfile>' }), opts);
    expect(got.state.phase).toBe('inflating');
    expect(got.export?.xml).toBe('<mxfile>c1</mxfile>');
    // A save during the inflate waits too.
    const fourth = handleMessage(got.state, { event: 'save', xml: '<mxfile>4</mxfile>' }, opts);
    expect(fourth.send).toEqual([]);
    expect(fourth.state).toEqual({ ...got.state, pending: { xml: '<mxfile>4</mxfile>', exit: false } });
    // The first snapshot is stored, then the export of the latest save starts; the modal stays open.
    const done = exportDone(fourth.state, 1, { xml: '<mxfile>u1</mxfile>', svg: '<svg/>' }, opts);
    expect(done.result).toEqual({ xml: '<mxfile>u1</mxfile>', svg: '<svg/>' });
    expect(done.close).toBe(false);
    expect(done.send).toEqual([{ ...exportAction(2) }]);
    expect(done.state).toEqual({ phase: 'exporting', xml: '<mxfile>4</mxfile>', pendingExit: false, seq: 2 });
  });
  it('drops the waiting save when the export fails', () => {
    const exporting = { ...loaded, phase: 'exporting' as const, seq: 1, pending: { xml: '<mxfile>2</mxfile>', exit: true } };
    const s = exportFailed(exporting, 1, 'no reply');
    expect(s.send).toEqual([]);
    expect(s.state).toEqual({ phase: 'loaded', xml, pendingExit: false, seq: 1, failure: 'no reply', busy: 1 });
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
  it('exportFailed keeps the editor open with the reason; a timeout leaves the editor busy, an inflate failure does not', () => {
    const exporting = { ...loaded, phase: 'exporting' as const, pendingExit: true, seq: 1 };
    const s = exportFailed(exporting, 1, 'no reply');
    expect(s).toEqual({
      state: { phase: 'loaded', xml, pendingExit: false, seq: 1, failure: 'no reply', busy: 1 },
      send: [],
      close: false,
    });
    const inflating = exportFailed({ ...exporting, phase: 'inflating' }, 1, 'bad page');
    expect(inflating.state).toEqual({ phase: 'loaded', xml, pendingExit: false, seq: 1, failure: 'bad page' });
    expect(exportFailed(exporting, 0, 'old').state).toBe(exporting);
    expect(exportFailed(loaded, 0, 'late').state).toBe(loaded);
    // After an inflate failure the editor is free: the next save exports at once.
    const saved = handleMessage(inflating.state, { event: 'save', xml: '<mxfile>3</mxfile>' }, opts);
    expect(saved.state).toEqual({ phase: 'exporting', xml: '<mxfile>3</mxfile>', pendingExit: false, seq: 2 });
    expect(saved.send).toHaveLength(1);
  });
  it('after a timeout the editor may still export: a save waits, and the late reply is stored and frees it', () => {
    const timedOut = exportFailed({ ...loaded, phase: 'exporting', seq: 1 }, 1, 'no reply').state;
    // The late reply with no newer save: it is still what the user asked to save.
    const late = handleMessage(timedOut, reply(1, { xml: '<mxfile>c1</mxfile>' }), opts);
    expect(late.export?.xml).toBe('<mxfile>c1</mxfile>');
    expect(late.state).toEqual({ phase: 'inflating', xml, pendingExit: false, seq: 1 });
    const stored = exportDone(late.state, 1, { xml: '<mxfile>u1</mxfile>', svg: '<svg/>' }, opts);
    expect(stored.result?.xml).toBe('<mxfile>u1</mxfile>');
    expect(stored.state).toEqual({ phase: 'loaded', xml: '<mxfile>u1</mxfile>', pendingExit: false, seq: 1 });
    // A save while the editor is busy waits with no request; a stale or unknown reply does not free the editor.
    const retry = handleMessage(timedOut, { event: 'save', xml: '<mxfile>2</mxfile>', exit: true }, opts);
    expect(retry.send).toEqual([]);
    expect(retry.state).toEqual({ ...timedOut, failure: undefined, pending: { xml: '<mxfile>2</mxfile>', exit: true } });
    expect(handleMessage(retry.state, reply(0), opts).state).toBe(retry.state);
    expect(handleMessage(retry.state, reply(2), opts).state).toBe(retry.state);
    // The late reply frees the editor: its snapshot is stored, then the export of the waiting save starts.
    const freed = handleMessage(retry.state, reply(1, { xml: '<mxfile>c1</mxfile>' }), opts);
    expect(freed.state).toEqual({ phase: 'inflating', xml, pendingExit: false, seq: 1, pending: { xml: '<mxfile>2</mxfile>', exit: true } });
    const next = exportDone(freed.state, 1, { xml: '<mxfile>u1</mxfile>', svg: '<svg/>' }, opts);
    expect(next.result?.xml).toBe('<mxfile>u1</mxfile>');
    expect(next.send).toEqual([exportAction(2)]);
    expect(next.state).toEqual({ phase: 'exporting', xml: '<mxfile>2</mxfile>', pendingExit: true, seq: 2 });
  });
  it('a new frame drops the busy fence of the old one: after its init and load, a save exports at once', () => {
    // A theme change replaces the srcdoc document: the old frame, its port and its export are gone.
    const timedOut = exportFailed({ ...loaded, phase: 'exporting', seq: 1 }, 1, 'no reply').state;
    const init = handleMessage(timedOut, { event: 'init' }, opts);
    expect(init.send[0]).toMatchObject({ action: 'load', xml });
    expect(init.state).toEqual({ phase: 'init', xml, pendingExit: false, seq: 1, failure: 'no reply' });
    const ready = handleMessage(init.state, { event: 'load' }, opts);
    expect(ready.send).toEqual([]);
    expect(ready.state.phase).toBe('loaded');
    const saved = handleMessage(ready.state, { event: 'save', xml: '<mxfile>2</mxfile>' }, opts);
    expect(saved.send).toEqual([exportAction(2)]);
    expect(saved.state).toEqual({ phase: 'exporting', xml: '<mxfile>2</mxfile>', pendingExit: false, seq: 2 });
    const got = handleMessage(saved.state, reply(2), opts);
    const done = exportDone(got.state, 2, { xml: '<mxfile>u2</mxfile>', svg: '<svg/>' }, opts);
    expect(done.result?.xml).toBe('<mxfile>u2</mxfile>');
    expect(done.state.phase).toBe('loaded');
  });
  it('a new frame carries the save that waited or was in flight: it loads that xml and exports it after the load', () => {
    // The save that waited for the busy editor: the new frame loads its xml, the old failure is gone.
    const waiting = { ...loaded, seq: 1, failure: 'no reply', busy: 1, pending: { xml: '<mxfile>2</mxfile>', exit: true } };
    const init = handleMessage(waiting, { event: 'init' }, opts);
    expect(init.send[0]).toMatchObject({ action: 'load', xml: '<mxfile>2</mxfile>' });
    expect(init.state).toEqual({
      phase: 'init',
      xml: '<mxfile>2</mxfile>',
      pendingExit: false,
      seq: 1,
      pending: { xml: '<mxfile>2</mxfile>', exit: true },
    });
    const ready = handleMessage(init.state, { event: 'load' }, opts);
    expect(ready.send).toEqual([exportAction(2)]);
    expect(ready.state).toEqual({ phase: 'exporting', xml: '<mxfile>2</mxfile>', pendingExit: true, seq: 2 });
    // The save in flight on the old frame: its reply can never come, so the new frame exports it again.
    for (const phase of ['exporting', 'inflating'] as const) {
      const inFlight = { ...loaded, phase, xml: '<mxfile>3</mxfile>', pendingExit: false, seq: 1 };
      const again = handleMessage(inFlight, { event: 'init' }, opts);
      expect(again.state).toEqual({ phase: 'init', xml: '<mxfile>3</mxfile>', pendingExit: false, seq: 1, pending: { xml: '<mxfile>3</mxfile>', exit: false } });
      // The late work of the old frame is fenced.
      expect(exportDone(again.state, 1, { xml: '<mxfile>u1</mxfile>', svg: '<svg/>' }, opts).result).toBeUndefined();
      expect(handleMessage(again.state, reply(1), opts).state).toBe(again.state);
    }
    // A newer waiting save wins over the one in flight.
    const both = { ...loaded, phase: 'exporting' as const, xml: '<mxfile>3</mxfile>', seq: 1, pending: { xml: '<mxfile>4</mxfile>', exit: false } };
    expect(handleMessage(both, { event: 'init' }, opts).state.xml).toBe('<mxfile>4</mxfile>');
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

describe('the protocol against the spinner gate of the bundled editor', () => {
  /**
   * A stand-in for draw.io: an export runs only while no export is in flight (EditorUi.spinner.spin returns false
   * while the spinner is active, and the export handler returns without a reply). The reply comes when the test
   * lets the "images embed" end.
   */
  function editor() {
    let inFlight: number | undefined;
    const ignored: number[] = [];
    return {
      take(actions: EditorAction[]) {
        for (const a of actions) {
          if (a.action !== 'export') {
            continue;
          }
          if (inFlight !== undefined) {
            ignored.push(a.seq);
          } else {
            inFlight = a.seq;
          }
        }
      },
      reply(): EditorMessage {
        const seq = inFlight!;
        inFlight = undefined;
        return { event: 'export', data: svgB64, xml: `<mxfile>c${seq}</mxfile>`, message: { seq } };
      },
      inFlight: () => inFlight,
      ignored,
    };
  }

  it('a Save & Exit during an export is exported after the reply and closes the editor', () => {
    const drawio = editor();
    let state = { phase: 'loaded' as const, xml, pendingExit: false, seq: 0 };
    const results: Array<{ xml: string; svg: string }> = [];
    const run = (step: Step) => {
      state = step.state as typeof state;
      drawio.take(step.send);
      if (step.result) {
        results.push(step.result);
      }
      return step;
    };
    run(handleMessage(state, { event: 'save', xml: '<mxfile>1</mxfile>' }, opts));
    run(handleMessage(state, { event: 'save', xml: '<mxfile>2</mxfile>', exit: true }, opts));
    expect(drawio.ignored).toEqual([]);
    run(handleMessage(state, drawio.reply(), opts));
    const first = run(exportDone(state, state.seq, { xml: '<mxfile>u1</mxfile>', svg: '<svg/>' }, opts));
    expect(first.close).toBe(false);
    expect(drawio.inFlight()).toBe(2);
    run(handleMessage(state, drawio.reply(), opts));
    const second = run(exportDone(state, state.seq, { xml: '<mxfile>u2</mxfile>', svg: '<svg/>' }, opts));
    expect(second.close).toBe(true);
    expect(results.map((r) => r.xml)).toEqual(['<mxfile>u1</mxfile>', '<mxfile>u2</mxfile>']);
    expect(drawio.ignored).toEqual([]);
    expect(drawio.inFlight()).toBeUndefined();
  });

  it('after the host deadline, Save again waits for the late reply, which frees the spinner; then the retry succeeds', () => {
    const drawio = editor();
    let state = { phase: 'loaded' as const, xml, pendingExit: false, seq: 0 };
    const results: Array<{ xml: string; svg: string }> = [];
    const run = (step: Step) => {
      state = step.state as typeof state;
      drawio.take(step.send);
      if (step.result) {
        results.push(step.result);
      }
      return step;
    };
    run(handleMessage(state, { event: 'save', xml: '<mxfile>1</mxfile>' }, opts));
    // The host deadline passes while draw.io still embeds the images of export 1.
    run(exportFailed(state, 1, 'no reply'));
    expect(state.phase).toBe('loaded');
    run(handleMessage(state, { event: 'save', xml: '<mxfile>2</mxfile>' }, opts));
    // No request went to the busy editor: nothing for its spinner gate to drop.
    expect(drawio.ignored).toEqual([]);
    expect(drawio.inFlight()).toBe(1);
    run(handleMessage(state, drawio.reply(), opts));
    run(exportDone(state, state.seq, { xml: '<mxfile>u1</mxfile>', svg: '<svg/>' }, opts));
    expect(drawio.inFlight()).toBe(2);
    run(handleMessage(state, drawio.reply(), opts));
    const last = run(exportDone(state, state.seq, { xml: '<mxfile>u2</mxfile>', svg: '<svg/>' }, opts));
    expect(last.state.phase).toBe('loaded');
    expect(results.map((r) => r.xml)).toEqual(['<mxfile>u1</mxfile>', '<mxfile>u2</mxfile>']);
    expect(drawio.ignored).toEqual([]);
  });
});
