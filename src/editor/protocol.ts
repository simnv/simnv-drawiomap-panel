import { decodeDataUri } from './decode';

/** Required embed parameters. A parameter already present in the configured URL wins (for example ui=sketch). */
export const EMBED_PARAMS: Record<string, string> = {
  embed: '1',
  proto: 'json',
  configure: '1',
  spin: '1',
  libraries: '1',
  ui: 'min',
  saveAndExit: '1',
  noExitBtn: '0',
};

export function buildEditorUrl(base: string, isDark = false): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(EMBED_PARAMS)) {
    if (!u.searchParams.has(k)) {
      u.searchParams.set(k, v);
    }
  }
  u.searchParams.set('dark', isDark ? '1' : '0');
  return u.toString();
}

export function editorOrigin(base: string): string {
  return new URL(base).origin;
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
  | { action: 'exit' };

export interface ProtocolState {
  phase: 'init' | 'loaded' | 'exporting' | 'done';
  xml: string;
  pendingExit: boolean;
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

const EXPORT: EditorAction = {
  action: 'export',
  format: 'xmlsvg',
  embedCellMetadata: true,
  embedImages: true,
  theme: 'auto',
  spin: 'Saving',
};

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
      if (state.phase !== 'exporting' || !msg.data) {
        return noop;
      }
      const svg = decodeDataUri(msg.data);
      const xml = msg.xml ?? state.xml;
      const close = state.pendingExit || opts.mode === 'export-only';
      return {
        state: { phase: close ? 'done' : 'loaded', xml, pendingExit: false },
        send: [],
        result: { xml, svg },
        close,
      };
    }
    case 'exit':
      return { state: { ...state, phase: 'done' }, send: [], close: true };
    default:
      return noop;
  }
}
