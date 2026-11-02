/**
 * Start-up of the bundled editor. The host cannot see script errors in the editor frame: the frame has an opaque
 * origin, so the browser blocks the 404 responses (ORB) and the frame stays empty. Without these checks the modal
 * waits for the channel hello for ever. Thus the panel (same origin as the plugin files) reads js/main.js before it
 * makes the frame, and the modal stops to wait for the hello after HELLO_TIMEOUT_MS. A good probe holds for the
 * session (initialLoad): the next modal of the same base makes the frame at once.
 */

/** Time for the channel hello. js/dmap-shim.js sends it before draw.io loads, so it comes quickly. */
export const HELLO_TIMEOUT_MS = 15_000;

/** Time for the probe. A proxy can accept the request and never answer. */
export const PROBE_TIMEOUT_MS = 10_000;

/** ok: the editor files are there. missing: dist/drawio is not in the plugin build. unreachable: network error. */
export type EditorProbe = 'ok' | 'missing' | 'unreachable';

/** Start-up state of the editor. missing, unreachable and timeout are final: there is no retry. */
export type EditorLoad = 'probing' | 'starting' | 'ready' | 'missing' | 'unreachable' | 'timeout';

/** reload: the frame gets a new srcdoc document (theme change) and must send a new hello. */
export type EditorLoadEvent = 'probe-ok' | 'probe-missing' | 'probe-unreachable' | 'hello' | 'timeout' | 'reload';

const JS_TYPE = /\b(?:java|ecma)script\b/i;

/**
 * Reads <base>js/main.js once. A response that is not 2xx or not JavaScript means that dist/drawio is missing:
 * Grafana answers 404 with JSON {"message":"Plugin file not found"}. No response in PROBE_TIMEOUT_MS, or an abort
 * of signal, stops the request and gives unreachable.
 */
export async function probeEditor(
  base: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<EditorProbe> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  const stopped = new Promise<EditorProbe>((resolve) => {
    stop = () => {
      ctrl.abort();
      resolve('unreachable');
    };
    timer = setTimeout(stop, PROBE_TIMEOUT_MS);
  });
  signal?.addEventListener('abort', stop);
  if (signal?.aborted) {
    stop();
  }
  const read = async (): Promise<EditorProbe> => {
    try {
      const res = await fetchFn(`${base}js/main.js`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      return res.ok && JS_TYPE.test(res.headers.get('content-type') ?? '') ? 'ok' : 'missing';
    } catch {
      return 'unreachable';
    }
  };
  try {
    return await Promise.race([read(), stopped]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

// Bases with a good probe in this session. A failed probe or a failed start drops the base: the next modal waits for
// its probe again.
const goodBases = new Set<string>();

/**
 * First start-up state of a modal: starting when an earlier modal of this session had a good probe of base (the
 * files were there, so the frame comes at once), else probing. The modal probes in both cases: a probe that fails
 * after a fast start still ends in missing or unreachable (nextLoad).
 */
export function initialLoad(base: string): EditorLoad {
  return goodBases.has(base) ? 'starting' : 'probing';
}

/** Keeps a good probe of base for the session. A failed probe drops the base. */
export function rememberProbe(base: string, probe: EditorProbe): void {
  if (probe === 'ok') {
    goodBases.add(base);
  } else {
    goodBases.delete(base);
  }
}

/** Drops base: the next modal waits for its probe (a failed start). */
export function forgetProbe(base: string): void {
  goodBases.delete(base);
}

/** Drops the kept probes. For tests. */
export function forgetProbes(): void {
  goodBases.clear();
}

function failedProbe(event: EditorLoadEvent): EditorLoad | undefined {
  return event === 'probe-missing' ? 'missing' : event === 'probe-unreachable' ? 'unreachable' : undefined;
}

/** Next start-up state. */
export function nextLoad(load: EditorLoad, event: EditorLoadEvent): EditorLoad {
  switch (load) {
    case 'probing':
      return event === 'probe-ok'
        ? 'starting'
        : event === 'probe-missing'
          ? 'missing'
          : event === 'probe-unreachable'
            ? 'unreachable'
            : load;
    // The probe of a fast start (initialLoad) can fail after the frame is there: the files went away.
    case 'starting':
      return event === 'hello' ? 'ready' : event === 'timeout' ? 'timeout' : failedProbe(event) ?? load;
    case 'ready':
      return event === 'reload' ? 'starting' : (failedProbe(event) ?? load);
    default:
      return load;
  }
}
