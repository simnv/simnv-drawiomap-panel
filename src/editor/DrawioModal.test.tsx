import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawioModal, EXPORT_TIMEOUT_MS } from './DrawioModal';
import { forgetProbes, HELLO_TIMEOUT_MS, initialLoad, PROBE_TIMEOUT_MS } from './availability';
import { PluginDialog } from './popup/PluginDialog';

// The inflate of the export is a browser stream: the tests of this file control when it settles.
const inflate = vi.hoisted(() => ({ pages: vi.fn<(xml: string) => Promise<string>>() }));
vi.mock('./inflate', () => ({ inflatePages: inflate.pages }));

vi.hoisted(() => {
  if (!window.localStorage) {
    Object.defineProperty(window, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
  }
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});

const MISSING = 'The draw.io editor is not installed with this plugin build (dist/drawio is missing).';

function jsResponse() {
  return new Response('x', { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' } });
}

function notFound() {
  return new Response('{"message":"Plugin file not found"}', {
    status: 404,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
}

function hello() {
  const frame = screen.getByTitle('draw.io') as HTMLIFrameElement;
  const token = new DOMParser()
    .parseFromString(frame.srcdoc, 'text/html')
    .querySelector('meta[name="dmap-channel"]')!
    .getAttribute('content');
  const port = {
    onmessage: undefined as ((event: { data: string }) => void) | undefined,
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  act(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'null',
        source: frame.contentWindow,
        data: JSON.stringify({ dmapHello: token }),
        ports: [port as unknown as MessagePort],
      })
    )
  );
  return port;
}

/** Lets the probe promise settle. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('editor dialog responsive geometry', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => notFound())
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['draw.io', 'Edit bindings'])('%s fills narrow and short landscape viewports', async (editor) => {
    const view = render(
      editor === 'draw.io' ? (
        <DrawioModal xml="" title="t" mode="edit" isDark={false} onSave={() => {}} onClose={() => {}} />
      ) : (
        <PluginDialog title="Edit bindings" onDismiss={() => {}}>
          <button>Binding</button>
        </PluginDialog>
      )
    );
    if (editor === 'draw.io') {
      await screen.findByRole('alert');
    }
    const dialog = screen.getByRole('dialog');
    // jsdom does not evaluate media queries. Inspect the emitted rules that target the actual dialog instead.
    const rules = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules));
    const fullscreen = rules
      .filter((rule): rule is CSSMediaRule => 'media' in rule)
      .flatMap((media) =>
        Array.from(media.cssRules)
          .filter((rule): rule is CSSStyleRule => 'selectorText' in rule)
          .filter((rule) => dialog.matches(rule.selectorText) && ['100%', '100vw'].includes(rule.style.width))
          .map((rule) => ({ media: media.media.mediaText, style: rule.style }))
      );
    expect(fullscreen).toHaveLength(1);
    // The comma is OR: includes 620x800, the 640px/480px boundaries and landscape phones such as 844x390.
    expect(fullscreen[0].media).toBe('(max-width: 640px), (max-height: 480px)');
    expect(fullscreen[0].style.height).toBe('100dvh');
    expect(fullscreen[0].style.getPropertyValue('border-radius')).toBe('0px');
    const desktop = rules
      .filter((rule): rule is CSSStyleRule => 'selectorText' in rule)
      .find((rule) => dialog.matches(rule.selectorText) && rule.style.width === '96vw');
    expect(desktop?.style.height).toBe('94dvh');
    view.unmount();
  });
});

describe('DrawioModal start-up', () => {
  const onClose = vi.fn();
  const fetchFn = vi.fn<typeof fetch>();
  // Grafana icons also use fetch. Count only the probes of the editor files.
  const probes = () =>
    fetchFn.mock.calls.map(([url]) => String(url)).filter((url) => url.endsWith('/drawio/js/main.js'));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchFn);
    onClose.mockReset();
    fetchFn.mockReset();
    forgetProbes();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const open = () =>
    render(<DrawioModal xml="" title="t" mode="edit" isDark={false} onSave={() => {}} onClose={onClose} />);

  it('makes the frame at once in the next modal of the session after a good probe, and probes in the background', async () => {
    fetchFn.mockImplementation(async () => jsResponse());
    const first = open();
    await settle();
    expect(probes()).toHaveLength(1);
    first.unmount();
    open();
    expect(screen.getByTitle('draw.io')).toBeTruthy();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('starting');
    await settle();
    expect(probes()).toHaveLength(2);
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('starting');
    // The hello timeout runs from the mount.
    await settle(HELLO_TIMEOUT_MS);
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('timeout');
  });

  it('shows the missing-editor error after a fast start when js/main.js went away, also after the hello', async () => {
    fetchFn.mockImplementation(async () => jsResponse());
    const first = open();
    await settle();
    hello();
    first.unmount();
    // An incomplete plugin build: the shim still loads and sends its hello, main.js answers 404.
    fetchFn.mockImplementation(async () => notFound());
    const second = open();
    expect(screen.getByTitle('draw.io')).toBeTruthy();
    hello();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('ready');
    await settle();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('missing');
    expect(screen.getByRole('alert').textContent).toContain(MISSING);
    expect(screen.queryByTitle('draw.io')).toBeNull();
    await settle(10 * HELLO_TIMEOUT_MS);
    expect(screen.getByRole('alert').textContent).toContain(MISSING);
    expect(probes()).toHaveLength(2);
    // The base is dropped: the next modal waits for its probe.
    second.unmount();
    open();
    expect(screen.queryByTitle('draw.io')).toBeNull();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('probing');
  });

  /** Whether the base of the modal is kept for the session (the next modal starts at once). */
  const kept = () =>
    initialLoad(new URL('public/plugins/simnv-drawiomap-panel/drawio/', document.baseURI).href) === 'starting';

  /** A fast start (kept base) whose probe answers only when the test says so. */
  async function openWithLateProbe() {
    fetchFn.mockImplementation(async () => jsResponse());
    const first = open();
    await settle();
    first.unmount();
    let answer!: (r: Response) => void;
    fetchFn.mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));
    const view = open();
    expect(screen.getByTitle('draw.io')).toBeTruthy();
    const port = hello();
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'init' }) }));
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'load' }) }));
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('running');
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-phase')).toBe('loaded');
    expect(screen.queryByRole('status')).toBeNull();
    return { view, answer: (r: Response) => answer(r) };
  }

  const editorStays = () => {
    expect(screen.getByTitle('draw.io')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('running');
  };

  it('keeps a working editor when the probe fails after the init of draw.io, and drops the base for the next modal', async () => {
    const { view, answer } = await openWithLateProbe();
    expect(kept()).toBe(true);
    answer(notFound());
    await settle();
    editorStays();
    await settle(10 * HELLO_TIMEOUT_MS);
    editorStays();
    expect(kept()).toBe(false);
    view.unmount();
    open();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('probing');
  });

  it('keeps a working editor when the probe times out after the init of draw.io', async () => {
    await openWithLateProbe();
    await settle(PROBE_TIMEOUT_MS + 1);
    editorStays();
    expect(probes()).toHaveLength(2);
    expect(kept()).toBe(false);
  });

  it('waits for the probe again in the next modal after a hello timeout', async () => {
    fetchFn.mockImplementation(async () => jsResponse());
    const first = open();
    await settle();
    first.unmount();
    const second = open();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('starting');
    await settle(HELLO_TIMEOUT_MS);
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('timeout');
    second.unmount();
    open();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('probing');
  });

  it('probes again in the next modal after a failed probe', async () => {
    fetchFn.mockImplementation(async () => notFound());
    const first = open();
    await settle();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('missing');
    first.unmount();
    fetchFn.mockImplementation(async () => jsResponse());
    open();
    expect(screen.queryByTitle('draw.io')).toBeNull();
    await settle();
    expect(probes()).toHaveLength(2);
    expect(screen.getByTitle('draw.io')).toBeTruthy();
  });

  it('makes no editor frame before the probe of js/main.js', async () => {
    fetchFn.mockImplementation(async () => jsResponse());
    open();
    expect(screen.queryByTitle('draw.io')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading the draw.io editor');
    await settle();
    expect(probes()).toEqual([
      expect.stringMatching(/\/public\/plugins\/simnv-drawiomap-panel\/drawio\/js\/main\.js$/),
    ]);
    expect(screen.getByTitle('draw.io')).toBeTruthy();
  });

  it('puts the help text in a focusable info button next to the title, not in the body', async () => {
    fetchFn.mockImplementation(async () => jsResponse());
    open();
    await settle();
    const help = screen.getByTestId('dmap-editor-help');
    expect(help.tagName).toBe('BUTTON');
    expect(help.getAttribute('aria-label')).toBe('About this editor');
    expect(screen.getByTestId('dmap-editor-modal').textContent).not.toContain('Move or resize');
    fireEvent.click(help);
    await settle();
    expect(screen.getByTestId('dmap-editor-help-text').textContent).toContain(
      'Keep cell IDs unchanged to retain bindings. Assign queries and chart settings'
    );
  });

  it('shows the missing-editor message and no frame when dist/drawio is missing, and Close closes', async () => {
    fetchFn.mockImplementation(async () => notFound());
    open();
    await settle();
    expect(screen.queryByTitle('draw.io')).toBeNull();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('missing');
    expect(screen.getByRole('alert').textContent).toContain(MISSING);
    expect(screen.getByRole('alert').textContent).toContain('npm run build');
    fireEvent.click(screen.getByTestId('dmap-editor-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an error when the files cannot be read', async () => {
    fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));
    open();
    await settle();
    expect(screen.queryByTitle('draw.io')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
  });

  it('stops to wait for the channel hello after the timeout, removes the frame and does not try again', async () => {
    fetchFn.mockImplementation(async () => jsResponse());
    open();
    await settle();
    expect(screen.getByTitle('draw.io')).toBeTruthy();
    await settle(HELLO_TIMEOUT_MS - 1);
    expect(screen.queryByRole('alert')).toBeNull();
    await settle(1);
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('timeout');
    expect(screen.getByRole('alert').textContent).toContain('did not start in 15 s');
    expect(screen.queryByTitle('draw.io')).toBeNull();
    // No retry loop: no other probe and no new frame, also much later.
    await settle(10 * HELLO_TIMEOUT_MS);
    expect(probes()).toHaveLength(1);
    expect(screen.queryByTitle('draw.io')).toBeNull();
  });

  it('waits again for the hello of the new document after a theme change', async () => {
    fetchFn.mockImplementation(async () => jsResponse());
    const view = open();
    await settle();
    hello();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('ready');
    view.rerender(<DrawioModal xml="" title="t" mode="edit" isDark={true} onSave={() => {}} onClose={onClose} />);
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('starting');
    expect(screen.getByRole('status').textContent).toContain('Loading the draw.io editor');
    await settle(HELLO_TIMEOUT_MS);
    expect(screen.getByRole('alert').textContent).toContain('did not start in 15 s');
  });

  it('keeps the editor after the channel hello: no timeout error', async () => {
    fetchFn.mockImplementation(async () => jsResponse());
    const view = open();
    await settle();
    hello();
    // The parent renders again (for example a dashboard refresh) with new callbacks.
    view.rerender(<DrawioModal xml="" title="t" mode="edit" isDark={false} onSave={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('ready');
    await settle(2 * HELLO_TIMEOUT_MS);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTitle('draw.io')).toBeTruthy();
  });
});

describe('DrawioModal during panel refreshes', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsResponse())
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the frame, the srcdoc and the channel when the parent renders again with new callbacks', async () => {
    const props = { xml: '<mxfile/>', title: 't', mode: 'edit' as const, isDark: false };
    const firstSave = vi.fn();
    const view = render(<DrawioModal {...props} onSave={firstSave} onClose={() => {}} />);
    const frame = (await screen.findByTitle('draw.io')) as HTMLIFrameElement;
    const srcdoc = frame.srcdoc;
    const port = hello();
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'init' }) }));
    expect(JSON.parse(port.postMessage.mock.calls[0][0]).xml).toBe(props.xml);
    const listen = vi.spyOn(window, 'addEventListener');
    const unlisten = vi.spyOn(window, 'removeEventListener');
    // A dashboard refresh renders the panel and its editor again: the inline callbacks are new functions.
    const lastSave = vi.fn();
    for (let i = 0; i < 2; i++) {
      view.rerender(<DrawioModal {...props} onSave={i ? lastSave : vi.fn()} onClose={() => {}} />);
    }
    expect(screen.getByTitle('draw.io')).toBe(frame);
    expect(frame.srcdoc).toBe(srcdoc);
    expect(port.close).not.toHaveBeenCalled();
    expect(listen.mock.calls.filter(([type]) => type === 'message')).toEqual([]);
    expect(unlisten.mock.calls.filter(([type]) => type === 'message')).toEqual([]);
    // The channel uses the newest callbacks.
    inflate.pages.mockImplementation(async (xml) => xml.replace('c', 'u'));
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'save', xml: '<mxfile id="b"/>' }) }));
    const seq = JSON.parse(port.postMessage.mock.lastCall![0]).seq;
    await act(async () => {
      port.onmessage?.({ data: JSON.stringify({ event: 'export', data: SVG_URI, xml: '<mxfile id="c"/>', message: { seq } }) });
    });
    expect(lastSave).toHaveBeenCalledWith({ xml: '<mxfile id="u"/>', svg: '<svg/>' });
    expect(firstSave).not.toHaveBeenCalled();
  });
});

const SVG_URI = 'data:image/svg+xml,%3Csvg%2F%3E';

describe('DrawioModal export', () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  /** One controllable inflate for each export reply. */
  const pending: Array<{ resolve: (xml: string) => void; reject: (e: Error) => void }> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsResponse())
    );
    forgetProbes();
    onSave.mockReset();
    onClose.mockReset();
    pending.length = 0;
    inflate.pages.mockReset();
    inflate.pages.mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const open = async (mode: 'edit' | 'export-only' = 'edit') => {
    const view = render(
      <DrawioModal xml="<mxfile/>" title="t" mode={mode} isDark={false} onSave={onSave} onClose={onClose} />
    );
    // The probe of the editor files settles under the fake timers.
    await settle();
    const port = hello();
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'init' }) }));
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'load' }) }));
    return { view, port };
  };
  const modal = () => screen.getByTestId('dmap-editor-modal');
  const requests = (port: ReturnType<typeof hello>) =>
    port.postMessage.mock.calls.map(([m]) => JSON.parse(m)).filter((a) => a.action === 'export');
  const save = (port: ReturnType<typeof hello>, xml: string, exit = false) => {
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'save', xml, exit }) }));
    return requests(port).at(-1)!.seq as number;
  };
  const reply = (port: ReturnType<typeof hello>, seq: number, xml: string) =>
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'export', data: SVG_URI, xml, message: { seq } }) }));

  it('stores the SVG and the inflated XML of one export reply', async () => {
    const { port } = await open();
    const seq = save(port, '<mxfile>s</mxfile>');
    expect(modal().getAttribute('data-dmap-editor-phase')).toBe('exporting');
    reply(port, seq, '<mxfile>c</mxfile>');
    expect(modal().getAttribute('data-dmap-editor-phase')).toBe('inflating');
    expect(inflate.pages).toHaveBeenCalledWith('<mxfile>c</mxfile>');
    await act(async () => pending[0].resolve('<mxfile>u</mxfile>'));
    expect(onSave).toHaveBeenCalledWith({ xml: '<mxfile>u</mxfile>', svg: '<svg/>' });
    expect(modal().getAttribute('data-dmap-editor-phase')).toBe('loaded');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps one export in flight: a Save & Exit during an export follows the reply, then the editor closes', async () => {
    const { port } = await open();
    const first = save(port, '<mxfile>1</mxfile>');
    // The editor runs no second export while its spinner is active: the host sends none.
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'save', xml: '<mxfile>2</mxfile>', exit: true }) }));
    expect(requests(port)).toHaveLength(1);
    reply(port, first, '<mxfile>c1</mxfile>');
    await act(async () => pending[0].resolve('<mxfile>u1</mxfile>'));
    expect(onSave).toHaveBeenCalledWith({ xml: '<mxfile>u1</mxfile>', svg: '<svg/>' });
    expect(onClose).not.toHaveBeenCalled();
    const second = requests(port).at(-1)!.seq;
    expect(second).toBe(first + 1);
    expect(modal().getAttribute('data-dmap-editor-phase')).toBe('exporting');
    // A late reply of the first export is stale.
    reply(port, first, '<mxfile>c1</mxfile>');
    expect(inflate.pages).toHaveBeenCalledTimes(1);
    reply(port, second, '<mxfile>c2</mxfile>');
    await act(async () => pending[1].resolve('<mxfile>u2</mxfile>'));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith({ xml: '<mxfile>u2</mxfile>', svg: '<svg/>' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('after a timeout, a theme change replaces the frame: the busy fence goes with it, and a save completes', async () => {
    const { port, view } = await open();
    const first = save(port, '<mxfile>1</mxfile>');
    await settle(EXPORT_TIMEOUT_MS);
    expect(screen.getByRole('alert').textContent).toMatch(/did not finish/);
    // The theme change makes a new srcdoc document: the old port closes, the new document sends its hello.
    view.rerender(<DrawioModal xml="<mxfile/>" title="t" mode="edit" isDark={true} onSave={onSave} onClose={onClose} />);
    const next = hello();
    expect(port.close).toHaveBeenCalled();
    act(() => next.onmessage?.({ data: JSON.stringify({ event: 'init' }) }));
    // The new frame loads the content of the save that timed out.
    expect(JSON.parse(next.postMessage.mock.calls[0][0])).toMatchObject({ action: 'load', xml: '<mxfile>1</mxfile>' });
    act(() => next.onmessage?.({ data: JSON.stringify({ event: 'load' }) }));
    expect(modal().getAttribute('data-dmap-editor-phase')).toBe('loaded');
    const second = save(next, '<mxfile>2</mxfile>');
    expect(second).toBe(first + 1);
    expect(requests(next)).toHaveLength(1);
    reply(next, second, '<mxfile>c2</mxfile>');
    await act(async () => pending[0].resolve('<mxfile>u2</mxfile>'));
    expect(onSave).toHaveBeenCalledWith({ xml: '<mxfile>u2</mxfile>', svg: '<svg/>' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('settles an inflate under a React Strict Mode replay of the effects', async () => {
    render(
      <React.StrictMode>
        <DrawioModal xml="<mxfile/>" title="t" mode="edit" isDark={false} onSave={onSave} onClose={onClose} />
      </React.StrictMode>
    );
    await settle();
    const port = hello();
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'init' }) }));
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'load' }) }));
    const seq = save(port, '<mxfile>s</mxfile>');
    reply(port, seq, '<mxfile>c</mxfile>');
    await act(async () => pending[0].resolve('<mxfile>u</mxfile>'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(modal().getAttribute('data-dmap-editor-phase')).toBe('loaded');
  });

  it('gives up on an export with no reply and keeps the editor open; the late reply is still stored', async () => {
    const { port } = await open();
    const seq = save(port, '<mxfile>s</mxfile>', true);
    await settle(EXPORT_TIMEOUT_MS);
    expect(modal().getAttribute('data-dmap-editor-phase')).toBe('loaded');
    expect(screen.getByRole('alert').textContent).toMatch(/did not finish in 60 s/);
    expect(onClose).not.toHaveBeenCalled();
    // The editor still ran the export: its late reply is what the user asked to save.
    reply(port, seq, '<mxfile>c</mxfile>');
    expect(modal().getAttribute('data-dmap-editor-phase')).toBe('inflating');
    await act(async () => pending[0].resolve('<mxfile>u</mxfile>'));
    expect(onSave).toHaveBeenCalledWith({ xml: '<mxfile>u</mxfile>', svg: '<svg/>' });
    expect(screen.queryByRole('alert')).toBeNull();
    // The editor stays open: the user saw the failure, an exit now would surprise.
    expect(onClose).not.toHaveBeenCalled();
    const next = save(port, '<mxfile>n</mxfile>');
    expect(next).toBe(seq + 1);
  });

  it('a Save again after the deadline waits for the busy editor, then follows its late reply', async () => {
    const { port } = await open();
    const first = save(port, '<mxfile>1</mxfile>');
    await settle(EXPORT_TIMEOUT_MS);
    expect(screen.getByRole('alert').textContent).toMatch(/did not finish/);
    // Save again: no request goes to the editor while it may still export, and the state says so.
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'save', xml: '<mxfile>2</mxfile>' }) }));
    expect(requests(port)).toHaveLength(1);
    expect(modal().getAttribute('data-dmap-editor-phase')).toBe('loaded');
    expect(screen.getByRole('status').textContent).toMatch(/still running the previous export/);
    // The late reply frees the editor: its snapshot is stored, and the export of the new save follows.
    reply(port, first, '<mxfile>c1</mxfile>');
    await act(async () => pending[0].resolve('<mxfile>u1</mxfile>'));
    expect(onSave).toHaveBeenCalledWith({ xml: '<mxfile>u1</mxfile>', svg: '<svg/>' });
    const second = requests(port).at(-1)!.seq;
    expect(second).toBe(first + 1);
    expect(screen.queryByRole('status')).toBeNull();
    reply(port, second, '<mxfile>c2</mxfile>');
    await act(async () => pending[1].resolve('<mxfile>u2</mxfile>'));
    expect(onSave).toHaveBeenLastCalledWith({ xml: '<mxfile>u2</mxfile>', svg: '<svg/>' });
    expect(modal().getAttribute('data-dmap-editor-phase')).toBe('loaded');
  });

  it('shows the inflate failure and stores nothing', async () => {
    const { port } = await open();
    const seq = save(port, '<mxfile>s</mxfile>', true);
    reply(port, seq, '<mxfile>c</mxfile>');
    await act(async () => pending[0].reject(new Error('The compressed page 1 is not a draw.io page.')));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(modal().getAttribute('data-dmap-editor-phase')).toBe('loaded');
    expect(screen.getByRole('alert').textContent).toContain('The compressed page 1 is not a draw.io page.');
  });

  it('drops a reply and an inflate that end after the modal closed', async () => {
    const { port, view } = await open();
    const seq = save(port, '<mxfile>s</mxfile>');
    reply(port, seq, '<mxfile>c</mxfile>');
    view.unmount();
    expect(port.close).toHaveBeenCalled();
    await act(async () => pending[0].resolve('<mxfile>u</mxfile>'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('in export-only mode closes after the inflate, and stays open with the error when the export fails', async () => {
    const { port } = await open('export-only');
    const [request] = requests(port);
    expect(request).toMatchObject({ format: 'xmlsvg', seq: 1 });
    reply(port, 1, '<mxfile>c</mxfile>');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => pending[0].resolve('<mxfile>u</mxfile>'));
    expect(onSave).toHaveBeenCalledWith({ xml: '<mxfile>u</mxfile>', svg: '<svg/>' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('in export-only mode a missing reply shows the error with a close button; a late reply still imports', async () => {
    const { port } = await open('export-only');
    await settle(EXPORT_TIMEOUT_MS);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/did not finish/);
    fireEvent.click(screen.getByTestId('dmap-editor-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    // The user did not close yet (the parent unmounts on close): the late reply completes the import.
    reply(port, 1, '<mxfile>c</mxfile>');
    await act(async () => pending[0].resolve('<mxfile>u</mxfile>'));
    expect(onSave).toHaveBeenCalledWith({ xml: '<mxfile>u</mxfile>', svg: '<svg/>' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
