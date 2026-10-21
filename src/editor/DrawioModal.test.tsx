import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawioModal } from './DrawioModal';
import { HELLO_TIMEOUT_MS } from './availability';

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
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const open = () =>
    render(<DrawioModal xml="" title="t" mode="edit" isDark={false} onSave={() => {}} onClose={onClose} />);

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
