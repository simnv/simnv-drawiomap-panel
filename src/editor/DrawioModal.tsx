import React, { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Alert, Button, Icon, Modal, Spinner, Toggletip } from '@grafana/ui';
import type { DrawioModalProps } from '../types';
import {
  acceptChannelHello,
  EditorAction,
  EditorMessage,
  frameWindow,
  handleMessage,
  initialState,
  newChannelToken,
  parseMessage,
  ProtocolState,
} from './protocol';
import { useOverlay } from './popup/overlayStack';
import { DIALOG_VH, DIALOG_VW } from './dialogSize';
import { parseFileRequest, readEditorFile } from './files';
import { bundledEditorBase, editorTarget } from './target';
import { EditorLoad, HELLO_TIMEOUT_MS, nextLoad, probeEditor } from './availability';

const styles = {
  // The doubled selector wins over the Grafana Modal rules (top 10%, max-height 80%, margins and padding).
  modal: css`
    && {
      top: 50%;
      transform: translateY(-50%);
      width: ${DIALOG_VW}vw;
      max-width: ${DIALOG_VW}vw;
      height: ${DIALOG_VH}vh;
      height: ${DIALOG_VH}dvh;
      max-height: ${DIALOG_VH}vh;
      max-height: ${DIALOG_VH}dvh;
      display: flex;
      flex-direction: column;
    }
    @media (max-width: 600px) {
      && {
        top: 0;
        transform: none;
        width: 100vw;
        max-width: 100vw;
        height: 100vh;
        height: 100dvh;
        max-height: 100vh;
        max-height: 100dvh;
        border-radius: 0;
      }
    }
  `,
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

/** Shows the bundled draw.io editor in embed mode inside a sandboxed iframe. Only this component loads draw.io code. */
export function DrawioModal({ xml, title, mode, isDark, onSave, onClose }: DrawioModalProps) {
  // The modal is on top of the overlay stack, so the bindings popup under it ignores Esc.
  useOverlay(`drawio-${useId()}`);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef<ProtocolState>(initialState(xml));
  const [phase, setPhase] = useState<ProtocolState['phase']>('init');
  const [load, dispatchLoad] = useReducer(nextLoad, 'probing');
  // A new token for each modal. The bundled editor sends it back in its channel hello.
  const [token] = useState(newChannelToken);
  const base = useMemo(() => bundledEditorBase(), []);
  // The frame and its srcdoc document come only after a good probe of the editor files.
  const started = load === 'starting' || load === 'ready';
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

  useEffect(() => {
    const run = (msg: EditorMessage, reply: (action: EditorAction) => void) => {
      const { onSave, onClose, ...opts } = propsRef.current;
      const step = handleMessage(stateRef.current, msg, opts);
      stateRef.current = step.state;
      setPhase(step.state.phase);
      step.send.forEach(reply);
      if (step.result) {
        onSave(step.result);
      }
      if (step.close) {
        onClose();
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
          run(msg, (action) => port.postMessage(JSON.stringify(action)));
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
  }, [target, token]);

  // A new srcdoc document (theme change) must send a new hello in time.
  useEffect(() => {
    if (target) {
      dispatchLoad('reload');
    }
  }, [target]);

  // One probe for each modal. A failure is final: the user closes the modal and opens it again.
  useEffect(() => {
    const ctrl = new AbortController();
    probeEditor(base, fetch, ctrl.signal).then((probe) => !ctrl.signal.aborted && dispatchLoad(`probe-${probe}`));
    return () => ctrl.abort();
  }, [base]);

  useEffect(() => {
    if (load !== 'starting') {
      return;
    }
    const timer = setTimeout(() => dispatchLoad('timeout'), HELLO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const ref = portRef;
    return () => ref.current?.close();
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
      className={styles.modal}
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
        {!failure && (load !== 'ready' || phase === 'init') && (
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
