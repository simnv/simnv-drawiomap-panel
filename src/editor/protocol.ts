import { decodeDataUri } from './decode';

/** Embed parameters of the bundled editor. */
const EMBED_PARAMS: Record<string, string> = {
  embed: '1',
  proto: 'json',
  configure: '1',
  spin: '1',
  libraries: '1',
  ui: 'min',
  saveAndExit: '1',
  noExitBtn: '0',
};

/** URL parameters (with the leading "?") for the bundled editor. dark follows the Grafana theme. */
export function editorSearch(isDark = false): string {
  return `?${new URLSearchParams({ ...EMBED_PARAMS, dark: isDark ? '1' : '0' }).toString()}`;
}

export interface EditorMessage {
  event: string;
  xml?: string;
  data?: string;
  format?: string;
  exit?: boolean;
  modified?: boolean;
  /** The request that an export reply answers: draw.io echoes it (`Ba.message = E`). */
  message?: { seq?: unknown; [key: string]: unknown };
}

export type EditorAction =
  | { action: 'configure'; config: Record<string, unknown> }
  | {
      action: 'load';
      xml: string;
      autosave: 0 | 1;
      title?: string;
      modified?: string;
      saveAndExit?: string;
      noSaveBtn?: string;
      noExitBtn?: string;
      dark?: boolean;
    }
  | {
      action: 'export';
      format: 'xmlsvg';
      embedCellMetadata: boolean;
      embedImages: boolean;
      theme: 'auto';
      spin?: string;
      /** The id of this export. draw.io echoes the request in its reply, so the host can drop a stale reply. */
      seq: number;
    }
  | { action: 'exit' };

/**
 * The phases of one editor. `exporting`: the host waits for the reply of the export `seq`. `inflating`: the host
 * inflates the pages of that reply (`exportDone` or `exportFailed` ends it). At most one export is in flight: the
 * bundled draw.io runs an export only while its spinner is free, so a second request during an export would get
 * no reply. A save during an export or an inflate waits in `pending` (the latest one wins), and `exportDone`
 * sends its export after the reply. A reply with another `seq` is stale and is dropped.
 */
export interface ProtocolState {
  phase: 'init' | 'loaded' | 'exporting' | 'inflating' | 'done';
  xml: string;
  pendingExit: boolean;
  /** The id of the newest export request. */
  seq: number;
  /** The latest save that came during the export in flight, or while the editor is busy. */
  pending?: { xml: string; exit: boolean };
  /** Why the last export stored nothing. The next save clears it. */
  failure?: string;
  /**
   * The export `seq` got no reply in time, and draw.io may still run it (its spinner stays active until it ends,
   * and it drops a request in that time). A save waits in `pending` until the late reply frees the editor.
   */
  busy?: number;
}

export interface Step {
  state: ProtocolState;
  send: EditorAction[];
  /** The reply of the current export: the SVG and the xml with compressed pages. The host inflates the pages. */
  export?: { xml: string; svg: string };
  /** The diagram to store. */
  result?: { xml: string; svg: string };
  close: boolean;
}

export interface ProtocolOptions {
  mode: 'edit' | 'export-only';
  title?: string;
  isDark: boolean;
}

export function initialState(xml: string): ProtocolState {
  return { phase: 'init', xml, pendingExit: false, seq: 0 };
}

/** Parses a postMessage payload from the editor. Returns undefined for anything that is not a JSON event. */
export function parseMessage(data: unknown): EditorMessage | undefined {
  if (typeof data !== 'string' || !data.startsWith('{')) {
    return undefined;
  }
  try {
    const obj = JSON.parse(data);
    return obj && typeof obj.event === 'string' ? (obj as EditorMessage) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Window of the editor iframe. Undefined when it is unknown: the Grafana frontend sandbox
 * throws on every read of iframe.contentWindow.
 */
export function frameWindow(frame: HTMLIFrameElement | null): Window | null | undefined {
  try {
    return frame ? frame.contentWindow : null;
  } catch {
    return undefined;
  }
}

/**
 * Sender window of a message event. Undefined when it is unknown: in the Grafana frontend sandbox,
 * near-membrane throws a SecurityError when it wraps a cross-origin window.
 */
export function eventSource(e: { source: unknown }): unknown {
  try {
    return e.source ?? null;
  } catch {
    return undefined;
  }
}

/**
 * The bundled editor talks to the host through a MessageChannel, not through window messages: with the Grafana
 * frontend sandbox the host cannot read iframe.contentWindow or event.source, so it cannot verify the sender or
 * reply to the frame. The host puts a random token in the srcdoc document (<meta name="dmap-channel">). The shim in
 * the frame (src/editor/drawio-shim.js) sends one hello with the token and transfers a MessagePort. The host uses
 * only that port for the protocol. Only the frame and the Grafana page can read the token.
 */
export const CHANNEL_META = 'dmap-channel';

/** A new random 128-bit token (hex) for one editor frame. */
export function newChannelToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Payload of the hello message that the shim sends. */
export function channelHello(token: string): string {
  return JSON.stringify({ dmapHello: token });
}

/**
 * Fail-closed check of the hello of the bundled editor. Returns the transferred port, or undefined.
 * The origin must be the editor origin ('null' for the opaque frame) and the token must be the token of this
 * frame. When the host can read the frame window and the sender (no frontend sandbox), the sender must also be
 * the frame window.
 */
export function acceptChannelHello<P>(
  e: { origin: string; source: unknown; data: unknown; ports?: readonly P[] },
  origin: string,
  token: string,
  frame: unknown
): P | undefined {
  if (e.origin !== origin || token === '' || typeof e.data !== 'string' || !e.data.startsWith('{')) {
    return undefined;
  }
  let hello: unknown;
  try {
    hello = JSON.parse(e.data);
  } catch {
    return undefined;
  }
  if (!hello || (hello as { dmapHello?: unknown }).dmapHello !== token) {
    return undefined;
  }
  if (!e.ports || e.ports.length !== 1) {
    return undefined;
  }
  const source = eventSource(e);
  if (source === null || (source !== undefined && frame !== undefined && source !== frame)) {
    return undefined;
  }
  return e.ports[0];
}

/**
 * One xmlsvg export gives the SVG and the xml of one snapshot of the graph: draw.io reads both when it takes the
 * request, then embeds the images and replies. The xml of that reply has compressed pages (EditorUi.getFileData
 * with uncompressed=false, whatever the compressXml setting): the host inflates them (src/editor/inflate.ts). A
 * second request for the xml would read the live graph, which the user can change while the images embed.
 */
const exportAction = (seq: number): EditorAction => ({
  action: 'export',
  format: 'xmlsvg',
  embedCellMetadata: true,
  embedImages: true,
  theme: 'auto',
  spin: 'Saving',
  seq,
});

/** The state of a new export: the id of the request, no failure. */
function startExport(state: ProtocolState, xml: string, pendingExit: boolean): Step {
  const seq = state.seq + 1;
  return { state: { phase: 'exporting', xml, pendingExit, seq }, send: [exportAction(seq)], close: false };
}

/** Pure step of the draw.io embed protocol: one editor message in, the next state and the host replies out. */
export function handleMessage(state: ProtocolState, msg: EditorMessage, opts: ProtocolOptions): Step {
  const noop: Step = { state, send: [], close: false };
  switch (msg.event) {
    case 'configure':
      return {
        ...noop,
        send: [
          { action: 'configure', config: { compressXml: false, defaultAdaptiveColors: 'auto', autosaveDelay: 0 } },
        ],
      };
    case 'init': {
      const load: EditorAction = {
        action: 'load',
        xml: state.xml,
        autosave: 0,
        title: opts.title,
        modified: 'unsavedChanges',
        saveAndExit: '1',
        dark: opts.isDark,
        ...(opts.mode === 'export-only' ? { noSaveBtn: '1', noExitBtn: '1' } : {}),
      };
      return { ...noop, send: [load] };
    }
    case 'load':
      if (opts.mode === 'export-only') {
        return startExport(state, state.xml, true);
      }
      return { ...noop, state: { ...state, phase: 'loaded' } };
    case 'save': {
      const pending = { xml: msg.xml ?? state.xml, exit: !!msg.exit };
      if (state.phase === 'exporting' || state.phase === 'inflating') {
        return { ...noop, state: { ...state, pending } };
      }
      if (state.busy !== undefined) {
        return { ...noop, state: { ...state, pending, failure: undefined } };
      }
      return startExport(state, pending.xml, pending.exit);
    }
    case 'export': {
      // The reply of the export in flight, or the late reply of the export that the deadline gave up on. The
      // late one is still what the user asked to save, and it frees the editor for the save that waits.
      const expected = state.phase === 'exporting' ? state.seq : state.phase === 'loaded' ? state.busy : undefined;
      if (expected === undefined || !msg.data || msg.message?.seq !== expected) {
        return noop;
      }
      return {
        state: { ...state, phase: 'inflating', seq: expected, failure: undefined, busy: undefined },
        send: [],
        export: { xml: msg.xml ?? state.xml, svg: decodeDataUri(msg.data) },
        close: false,
      };
    }
    case 'exit':
      return { state: { ...state, phase: 'done' }, send: [], close: true };
    default:
      return noop;
  }
}

/**
 * The inflated diagram of the export `seq` is ready: store it. Then the export of the save that waited starts, or
 * the editor closes when the save asked for the exit.
 */
export function exportDone(
  state: ProtocolState,
  seq: number,
  diagram: { xml: string; svg: string },
  opts: ProtocolOptions
): Step {
  if (state.phase !== 'inflating' || seq !== state.seq) {
    return { state, send: [], close: false };
  }
  if (state.pending) {
    const next = startExport({ ...state, seq }, state.pending.xml, state.pending.exit);
    return { ...next, result: diagram };
  }
  const close = state.pendingExit || opts.mode === 'export-only';
  return {
    state: { phase: close ? 'done' : 'loaded', xml: diagram.xml, pendingExit: false, seq },
    send: [],
    result: diagram,
    close,
  };
}

/**
 * The export `seq` gave no diagram: keep the editor open with the reason. A save that waited is dropped too: the
 * reason tells the user to save again. With no reply in time (phase exporting) the editor stays busy: it may still
 * run the export, and a new request would be dropped. After a page that does not inflate (phase inflating) the
 * reply came, so the editor is free.
 */
export function exportFailed(state: ProtocolState, seq: number, reason: string): Step {
  if ((state.phase !== 'exporting' && state.phase !== 'inflating') || seq !== state.seq) {
    return { state, send: [], close: false };
  }
  const next: ProtocolState = { phase: 'loaded', xml: state.xml, pendingExit: false, seq, failure: reason };
  return { state: state.phase === 'exporting' ? { ...next, busy: seq } : next, send: [], close: false };
}
