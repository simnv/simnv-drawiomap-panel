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
    }
  | { action: 'export'; format: 'xml' }
  | { action: 'exit' };

export interface ProtocolState {
  phase: 'init' | 'loaded' | 'exporting' | 'done';
  xml: string;
  pendingExit: boolean;
  /** The SVG of the xmlsvg export, while the host waits for the xml export of the same state. */
  svg?: string;
}

export interface Step {
  state: ProtocolState;
  send: EditorAction[];
  result?: { xml: string; svg: string };
  close: boolean;
}

export interface ProtocolOptions {
  mode: 'edit' | 'export-only';
  title?: string;
  isDark: boolean;
}

export function initialState(xml: string): ProtocolState {
  return { phase: 'init', xml, pendingExit: false };
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

const EXPORT: EditorAction = {
  action: 'export',
  format: 'xmlsvg',
  embedCellMetadata: true,
  embedImages: true,
  theme: 'auto',
  spin: 'Saving',
};

/**
 * The xmlsvg export of draw.io compresses the pages of its xml (EditorUi.getFileData with uncompressed=false),
 * whatever the compressXml setting. The panel has no inflate code (spec 5.5): it asks for the xml export, which
 * honours compressXml:false, and stores that XML with the SVG of the xmlsvg export. draw.io answers an xml export
 * at once, from the same state as the SVG.
 */
const EXPORT_XML: EditorAction = { action: 'export', format: 'xml' };

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
        return { state: { ...state, phase: 'exporting', pendingExit: true }, send: [EXPORT], close: false };
      }
      return { ...noop, state: { ...state, phase: 'loaded' } };
    case 'save':
      return {
        state: { phase: 'exporting', xml: msg.xml ?? state.xml, pendingExit: !!msg.exit },
        send: [EXPORT],
        close: false,
      };
    case 'export': {
      if (state.phase !== 'exporting') {
        return noop;
      }
      if (msg.format !== 'xml') {
        if (!msg.data) {
          return noop;
        }
        return { state: { ...state, svg: decodeDataUri(msg.data) }, send: [EXPORT_XML], close: false };
      }
      if (state.svg === undefined) {
        return noop;
      }
      const xml = msg.xml ?? state.xml;
      const close = state.pendingExit || opts.mode === 'export-only';
      return {
        state: { phase: close ? 'done' : 'loaded', xml, pendingExit: false },
        send: [],
        result: { xml, svg: state.svg },
        close,
      };
    }
    case 'exit':
      return { state: { ...state, phase: 'done' }, send: [], close: true };
    default:
      return noop;
  }
}
