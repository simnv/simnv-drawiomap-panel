import { describe, expect, it } from 'vitest';
import { buildEditorUrl, editorOrigin, handleMessage, initialState, parseMessage } from './protocol';

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
