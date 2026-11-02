import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetProbes, initialLoad, nextLoad, PROBE_TIMEOUT_MS, probeEditor, rememberProbe } from './availability';

const BASE = 'http://g/public/plugins/p/drawio/';

describe('probeEditor', () => {
  it('reads js/main.js of the editor base once, from the panel origin', async () => {
    const fetchFn = vi.fn(
      async () => new Response('x', { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' } })
    );
    expect(await probeEditor(BASE, fetchFn)).toBe('ok');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(BASE + 'js/main.js', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });
  it('accepts the other JavaScript content types', async () => {
    const fetchFn = async () => new Response('x', { headers: { 'content-type': 'application/javascript' } });
    expect(await probeEditor(BASE, fetchFn)).toBe('ok');
  });
  it('gives missing for the Grafana 404 (JSON "Plugin file not found")', async () => {
    const fetchFn = async () =>
      new Response('{"message":"Plugin file not found"}', {
        status: 404,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
      });
    expect(await probeEditor(BASE, fetchFn)).toBe('missing');
  });
  it('gives missing for a 2xx response that is not JavaScript (an HTML fallback page of a proxy)', async () => {
    const fetchFn = async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    expect(await probeEditor(BASE, fetchFn)).toBe('missing');
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('gives unreachable and stops the request when no response comes in time', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    // A proxy that accepts the request and never answers. The mock ignores the abort.
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const probe = probeEditor(BASE, fetchFn);
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    expect(await probe).toBe('unreachable');
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops the request when the caller aborts (the modal closes)', async () => {
    const ctrl = new AbortController();
    let signal: AbortSignal | undefined;
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const probe = probeEditor(BASE, fetchFn, ctrl.signal);
    ctrl.abort();
    expect(await probe).toBe('unreachable');
    expect(signal?.aborted).toBe(true);
  });
  it('gives unreachable for a network error', async () => {
    const fetchFn = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await probeEditor(BASE, fetchFn)).toBe('unreachable');
  });
});

describe('nextLoad', () => {
  it('starts the frame only after a good probe', () => {
    expect(nextLoad('probing', 'probe-ok')).toBe('starting');
    expect(nextLoad('probing', 'probe-missing')).toBe('missing');
    expect(nextLoad('probing', 'probe-unreachable')).toBe('unreachable');
    expect(nextLoad('probing', 'hello')).toBe('probing');
    expect(nextLoad('probing', 'timeout')).toBe('probing');
  });
  it('is ready after the channel hello, and a timeout before the hello is an error', () => {
    expect(nextLoad('starting', 'hello')).toBe('ready');
    expect(nextLoad('starting', 'timeout')).toBe('timeout');
    expect(nextLoad('ready', 'timeout')).toBe('ready');
    // A reload of the frame sends a new hello.
    expect(nextLoad('ready', 'hello')).toBe('ready');
  });
  it('waits again for a hello when the frame gets a new document (theme change)', () => {
    expect(nextLoad('ready', 'reload')).toBe('starting');
    expect(nextLoad('starting', 'reload')).toBe('starting');
    expect(nextLoad('probing', 'reload')).toBe('probing');
  });
  it('keeps an error: no event starts the editor again', () => {
    for (const failed of ['missing', 'unreachable', 'timeout'] as const) {
      for (const event of ['probe-ok', 'probe-missing', 'probe-unreachable', 'hello', 'timeout', 'reload'] as const) {
        expect(nextLoad(failed, event)).toBe(failed);
      }
    }
  });
});

describe('initialLoad', () => {
  afterEach(forgetProbes);
  it('probes each base until a good probe of it, then starts at once for the session', () => {
    expect(initialLoad(BASE)).toBe('probing');
    rememberProbe(BASE, 'missing');
    rememberProbe(BASE, 'unreachable');
    expect(initialLoad(BASE)).toBe('probing');
    rememberProbe(BASE, 'ok');
    expect(initialLoad(BASE)).toBe('starting');
    expect(initialLoad('http://g/other/drawio/')).toBe('probing');
    forgetProbes();
    expect(initialLoad(BASE)).toBe('probing');
  });
});
