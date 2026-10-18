import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Modal } from '@grafana/ui';
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
import { editorTarget } from './target';

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
  frame: css`
    flex: 1;
    border: 0;
    width: 100%;
    height: 100%;
    background: #fff;
  `,
};

/** Shows the bundled draw.io editor in embed mode inside a sandboxed iframe. Only this component loads draw.io code. */
export function DrawioModal({ xml, title, mode, isDark, onSave, onClose }: DrawioModalProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef<ProtocolState>(initialState(xml));
  const [phase, setPhase] = useState<ProtocolState['phase']>('init');
  // A new token for each modal. The bundled editor sends it back in its channel hello.
  const [token] = useState(newChannelToken);
  const target = useMemo(() => editorTarget(isDark, token), [isDark, token]);
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
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [target, token, mode, title, isDark, onSave, onClose]);

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
      <div className={styles.body} data-testid="dmap-editor-modal" data-dmap-editor-phase={phase}>
        {mode === 'edit' && (
          <p>
            Move or resize chart rectangles here. Keep cell IDs unchanged to retain bindings. Assign queries and chart
            settings in the panel inspector.
          </p>
        )}
        <iframe
          ref={frameRef}
          data-testid="dmap-editor-frame"
          className={styles.frame}
          srcDoc={target.srcDoc}
          sandbox={target.sandbox}
          title="draw.io"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </Modal>
  );
}
