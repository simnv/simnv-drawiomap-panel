import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Alert, Button, Modal, Spinner } from '@grafana/ui';
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
import { parseFileRequest, readEditorFile } from './files';
import { bundledEditorBase, editorTarget } from './target';
import { EditorLoad, HELLO_TIMEOUT_MS, nextLoad, probeEditor } from './availability';

const styles = {
  modal: css`
    width: 95vw;
    max-width: 95vw;
    height: 90vh;
    display: flex;
    flex-direction: column;
  `,
  content: css`
    flex: 1;
    min-height: 0;
    display: flex;
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

/** Shows the bundled draw.io editor in embed mode inside a sandboxed iframe. Only this component loads draw.io code. */
export function DrawioModal({ xml, title, mode, isDark, onSave, onClose }: DrawioModalProps) {
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

  useEffect(() => {
    const run = (msg: EditorMessage, reply: (action: EditorAction) => void) => {
      const step = handleMessage(stateRef.current, msg, { mode, title, isDark });
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
  }, [target, token, mode, title, isDark, onSave, onClose]);

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

  return (
    <Modal
      isOpen={true}
      title={mode === 'edit' ? 'draw.io editor' : 'Exporting diagram'}
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
        {mode === 'edit' && !failure && (
          <p>
            Move or resize chart rectangles here. Keep cell IDs unchanged to retain bindings. Assign queries and chart
            settings in the panel inspector.
          </p>
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
