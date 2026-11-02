import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawioModal } from './DrawioModal';
import { forgetProbes, HELLO_TIMEOUT_MS } from './availability';
import { PluginDialog } from './popup/PluginDialog';

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
    expect(fullscreen[0].style.getPropertyValue('border-radius')).toBe('0');
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

  it('makes the frame at once in the next modal of the session after a good probe', async () => {
    fetchFn.mockImplementation(async () => jsResponse());
    const first = open();
    await settle();
    expect(probes()).toHaveLength(1);
    first.unmount();
    open();
    expect(screen.getByTitle('draw.io')).toBeTruthy();
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('starting');
    await settle();
    expect(probes()).toHaveLength(1);
    // The hello timeout runs from the mount.
    await settle(HELLO_TIMEOUT_MS);
    expect(screen.getByTestId('dmap-editor-modal').getAttribute('data-dmap-editor-load')).toBe('timeout');
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
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'save', xml: '<mxfile id="b"/>' }) }));
    act(() => port.onmessage?.({ data: JSON.stringify({ event: 'export', data: 'data:image/svg+xml,%3Csvg%2F%3E' }) }));
    expect(lastSave).toHaveBeenCalledWith({ xml: '<mxfile id="b"/>', svg: '<svg/>' });
    expect(firstSave).not.toHaveBeenCalled();
  });
});
