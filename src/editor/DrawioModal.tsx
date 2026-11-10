import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Alert, Button, Icon, Modal, Spinner, Toggletip } from '@grafana/ui';
import type { DrawioModalProps } from '../types';
import {
  acceptChannelHello,
  EditorMessage,
  exportDone,
  exportFailed,
  frameWindow,
  handleMessage,
  initialState,
  newChannelToken,
  parseMessage,
  ProtocolState,
  Step,
} from './protocol';
import { inflatePages } from './inflate';
import { useOverlay } from './popup/overlayStack';
import { dialogModalClass } from './dialogSize';
import { parseFileRequest, readEditorFile } from './files';
import { bundledEditorBase, editorTarget } from './target';
import {
  EditorLoad,
  forgetProbe,
  HELLO_TIMEOUT_MS,
  initialLoad,
  nextLoad,
  probeEditor,
  rememberProbe,
} from './availability';

const styles = {
  content: css`
    && {
      flex: 1;
      min-height: 0;
      display: flex;
      padding: 0;
      margin-bottom: 0;
    }
  `,
  titleRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  help: css`
    display: inline-flex;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    cursor: help;
  `,
  body: css`
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  `,
  status: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  frame: css`
    flex: 1;
    border: 0;
    width: 100%;
    height: 100%;
    background: #fff;
  `,
};

const FAILURES: Partial<Record<EditorLoad, { title: string; hint: string }>> = {
  missing: {
    title: 'The draw.io editor is not installed with this plugin build (dist/drawio is missing).',
    hint: 'Rebuild the plugin with npm run build. The build puts draw.io in dist/drawio.',
  },
  unreachable: {
    title: 'The draw.io editor files could not be loaded.',
    hint: 'Make sure that Grafana is available, then open the editor again.',
  },
  timeout: {
    title: `The draw.io editor did not start in ${HELLO_TIMEOUT_MS / 1000} s.`,
    hint: 'Look for blocked files in the browser console, then open the editor again.',
  },
};

const HELP =
  'Move or resize chart rectangles here. Keep cell IDs unchanged to retain bindings. Assign queries and chart settings in the panel inspector.';

/** How long the host waits for the reply of an export. The editor embeds the images of the diagram in that time. */
export const EXPORT_TIMEOUT_MS = 60_000;
const EXPORT_TIMEOUT = `The export did not finish in ${EXPORT_TIMEOUT_MS / 1000} s. The diagram was not saved.`;
const EDITOR_BUSY =
  'The editor is still running the previous export. This save follows it. If it does not finish, close the editor and open it again.';

/** Shows the bundled draw.io editor in embed mode inside a sandboxed iframe. Only this component loads draw.io code. */
export function DrawioModal({ xml, title, mode, isDark, onSave, onClose }: DrawioModalProps) {
  // The modal is on top of the overlay stack, so the bindings popup under it ignores Esc.
  useOverlay(`drawio-${useId()}`);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef<ProtocolState>(initialState(xml));
  const [phase, setPhase] = useState<ProtocolState['phase']>('init');
  /** Why the last export stored nothing. */
  const [exportFailure, setExportFailure] = useState<string>();
  /** A save waits for the editor, which may still run the export that the deadline gave up on. */
  const [queued, setQueued] = useState(false);
  /** The id of the export that the host waits for, while the phase is exporting. */
  const [waiting, setWaiting] = useState<number>();
  /** True while the editor is mounted (the effect below sets it): an inflate that ends after the unmount stores nothing. */
  const live = useRef(false);
  // A new token for each modal. The bundled editor sends it back in its channel hello.
  const [token] = useState(newChannelToken);
  const base = useMemo(() => bundledEditorBase(), []);
  const [load, dispatchLoad] = useReducer(nextLoad, base, initialLoad);
  // The frame and its srcdoc document come only after a good probe of the editor files.
  const started = load === 'starting' || load === 'ready' || load === 'running';
  const target = useMemo(() => (started ? editorTarget(isDark, token) : undefined), [started, isDark, token]);
  const failure = FAILURES[load];
  // The port of the accepted channel hello. It stays open while the modal is open.
  const portRef = useRef<MessagePort | undefined>(undefined);
  // The newest props for the channel. A dashboard refresh renders the parent again and gives new callbacks: the
  // channel, the frame and its srcdoc must not change for them.
  const propsRef = useRef({ mode, title, isDark, onSave, onClose });
  useLayoutEffect(() => {
    propsRef.current = { mode, title, isDark, onSave, onClose };
  });

  const options = () => {
    const { onSave: _save, onClose: _close, ...opts } = propsRef.current;
    return opts;
  };
  /** Applies one step of the protocol: the state, the replies to the editor, the stored diagram and the close. */
  const apply = useCallback((step: Step) => {
    stateRef.current = step.state;
    setPhase(step.state.phase);
    setExportFailure(step.state.failure);
    setQueued(step.state.phase === 'loaded' && step.state.busy !== undefined && step.state.pending !== undefined);
    setWaiting(step.state.phase === 'exporting' ? step.state.seq : undefined);
    for (const action of step.send) {
      portRef.current?.postMessage(JSON.stringify(action));
    }
    if (step.result) {
      propsRef.current.onSave(step.result);
    }
    if (step.close) {
      propsRef.current.onClose();
    }
  }, []);

  // The reply of an export has the SVG and the xml of one snapshot, with compressed pages: inflate them, then
  // store both. A save in the meantime, or the unmount, makes the result stale (exportDone drops it).
  const inflate = useCallback(
    (raw: { xml: string; svg: string }, seq: number) => {
      inflatePages(raw.xml).then(
        (xml) => {
          if (live.current) {
            apply(exportDone(stateRef.current, seq, { xml, svg: raw.svg }, options()));
          }
        },
        (error: unknown) => {
          if (live.current) {
            apply(exportFailed(stateRef.current, seq, error instanceof Error ? error.message : String(error)));
          }
        }
      );
    },
    [apply]
  );

  useEffect(() => {
    const run = (msg: EditorMessage) => {
      const step = handleMessage(stateRef.current, msg, options());
      if (msg.event === 'init') {
        // draw.io runs in the frame of the accepted hello: the probe of this modal cannot remove it any more.
        dispatchLoad('init');
      }
      apply(step);
      if (step.export) {
        inflate(step.export, step.state.seq);
      }
    };
    const bindPort = (port: MessagePort, base: string) => {
      port.onmessage = (m: MessageEvent) => {
        const file = parseFileRequest(m.data);
        if (file) {
          readEditorFile(file, base).then((reply) => port.postMessage(reply));
          return;
        }
        const msg = parseMessage(m.data);
        if (msg) {
          run(msg);
        }
      };
    };
    if (!target) {
      return;
    }
    if (portRef.current) {
      bindPort(portRef.current, target.base);
    }
    const onMessage = (e: MessageEvent) => {
      const frame = frameWindow(frameRef.current);
      const port = acceptChannelHello<MessagePort>(e, target.origin, token, frame);
      if (port) {
        // A reload of the frame sends a new hello with the same token.
        portRef.current?.close();
        portRef.current = port;
        bindPort(port, target.base);
        dispatchLoad('hello');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [target, token, apply, inflate]);

  // An export with no reply in time stores nothing. Its late reply is stale: exportFailed moved the phase on.
  useEffect(() => {
    if (waiting === undefined) {
      return;
    }
    const timer = setTimeout(() => apply(exportFailed(stateRef.current, waiting, EXPORT_TIMEOUT)), EXPORT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [waiting, apply]);

  // A new srcdoc document (theme change) must send a new hello in time.
  useEffect(() => {
    if (target) {
      dispatchLoad('reload');
    }
  }, [target]);

  // One probe for each modal. After a good probe of the base in this session the frame is there from the start
  // (initialLoad), and the probe confirms that the files are still there: the shim sends its hello before draw.io
  // loads, so without the probe a missing main.js would leave the modal in ready without an error. A failure is
  // final: the user closes the modal and opens it again. Once draw.io sent its init (running), a late failure of the
  // probe only drops the base for the next modal.
  useEffect(() => {
    const ctrl = new AbortController();
    probeEditor(base, fetch, ctrl.signal).then((probe) => {
      if (!ctrl.signal.aborted) {
        rememberProbe(base, probe);
        dispatchLoad(`probe-${probe}`);
      }
    });
    return () => ctrl.abort();
  }, [base]);

  // A failed start drops the base: the next modal waits for its probe again.
  useEffect(() => {
    if (load === 'timeout') {
      forgetProbe(base);
    }
  }, [load, base]);

  useEffect(() => {
    if (load !== 'starting') {
      return;
    }
    const timer = setTimeout(() => dispatchLoad('timeout'), HELLO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [load]);

  // Strict Mode replays this effect: the setup makes the editor live again after the replayed cleanup.
  useEffect(() => {
    const ref = portRef;
    live.current = true;
    return () => {
      live.current = false;
      ref.current?.close();
    };
  }, []);

  const heading = mode === 'edit' ? 'draw.io editor' : 'Exporting diagram';
  return (
    <Modal
      isOpen={true}
      title={
        <div className={styles.titleRow}>
          <h2>{heading}</h2>
          {mode === 'edit' && (
            <Toggletip
              content={<span data-testid="dmap-editor-help-text">{HELP}</span>}
              placement="bottom"
              closeButton={false}
            >
              <button
                type="button"
                className={styles.help}
                aria-label="About this editor"
                data-testid="dmap-editor-help"
              >
                <Icon name="info-circle" />
              </button>
            </Toggletip>
          )}
        </div>
      }
      ariaLabel={heading}
      onDismiss={onClose}
      className={dialogModalClass}
      contentClassName={styles.content}
      closeOnBackdropClick={false}
    >
      <div
        className={styles.body}
        data-testid="dmap-editor-modal"
        data-dmap-editor-phase={phase}
        data-dmap-editor-load={load}
      >
        {failure && (
          <Alert title={failure.title} severity="error">
            <p>{failure.hint}</p>
            <Button data-testid="dmap-editor-close" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </Alert>
        )}
        {!failure && exportFailure && (
          <Alert title={exportFailure} severity="error" data-testid="dmap-export-failure">
            {mode === 'edit' ? (
              <p>Save again. The last saved diagram is unchanged.</p>
            ) : (
              <Button data-testid="dmap-editor-close" variant="secondary" onClick={onClose}>
                Close
              </Button>
            )}
          </Alert>
        )}
        {!failure && queued && (
          <div role="status" className={styles.status} data-testid="dmap-export-queued">
            <Spinner inline /> {EDITOR_BUSY}
          </div>
        )}
        {!failure && ((load !== 'ready' && load !== 'running') || phase === 'init') && (
          <div role="status" className={styles.status}>
            <Spinner inline /> Loading the draw.io editor…
          </div>
        )}
        {target && !failure && (
          <iframe
            ref={frameRef}
            data-testid="dmap-editor-frame"
            className={styles.frame}
            srcDoc={target.srcDoc}
            sandbox={target.sandbox}
            title="draw.io"
            allow="clipboard-read; clipboard-write"
          />
        )}
      </div>
    </Modal>
  );
}
