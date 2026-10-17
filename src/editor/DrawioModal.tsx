import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Alert, Modal } from '@grafana/ui';
import type { DrawioModalProps } from '../types';
import {
  acceptChannelHello,
  classifyEditorMessage,
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

/** Shows the draw.io editor in embed mode inside an iframe. Only this component loads draw.io code. */
export function DrawioModal({ editorUrl, xml, title, mode, isDark, onSave, onClose }: DrawioModalProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef<ProtocolState>(initialState(xml));
  const [phase, setPhase] = useState<ProtocolState['phase']>('init');
  // A new token for each modal. The bundled editor sends it back in its channel hello.
  const [token] = useState(newChannelToken);
  const target = useMemo(() => editorTarget(editorUrl, isDark, token), [editorUrl, isDark, token]);
  // External editor only: the Grafana frontend sandbox forbids iframe.contentWindow and event.source
  // (cross-origin window). Then the host cannot verify the sender or reply: the filter fails closed and the modal
  // shows an alert.
  const [blocked, setBlocked] = useState(false);
  // Bundled editor: the port of the accepted channel hello. It stays open while the modal is open.
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
    if (portRef.current && target.kind === 'bundled') {
      bindPort(portRef.current, target.base);
    }
    const onMessage = (e: MessageEvent) => {
      const frame = frameWindow(frameRef.current);
      if (target.kind === 'bundled') {
        const port = acceptChannelHello<MessagePort>(e, target.origin, token, frame);
        if (port) {
          // A reload of the frame sends a new hello with the same token.
          portRef.current?.close();
          portRef.current = port;
          bindPort(port, target.base);
        }
        return;
      }
      const verdict = classifyEditorMessage(e, target.origin, frame);
      if (verdict.kind === 'blocked') {
        setBlocked(true);
      } else if (verdict.kind === 'accept') {
        // Replies go only to the window of the editor frame and only to the editor origin.
        run(verdict.msg, (action) => frame?.postMessage(JSON.stringify(action), target.origin));
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
      <div
        className={styles.body}
        data-testid="dmap-editor-modal"
        data-dmap-editor-phase={phase}
        data-dmap-editor-blocked={blocked || undefined}
      >
        {blocked ? (
          <Alert severity="error" title="The draw.io editor cannot start" data-testid="dmap-editor-blocked">
            The Grafana frontend sandbox is on for this plugin. The sandbox does not let the panel verify or answer the
            messages of the draw.io frame on another origin. Clear the Editor URL to use the draw.io editor that the
            plugin includes, or remove simnv-drawiomap-panel from enable_frontend_sandbox_for_plugins.
          </Alert>
        ) : null}
        <iframe
          key={target.kind}
          ref={frameRef}
          data-testid="dmap-editor-frame"
          className={styles.frame}
          src={target.kind === 'url' ? target.src : undefined}
          srcDoc={target.kind === 'bundled' ? target.srcDoc : undefined}
          sandbox={target.kind === 'bundled' ? target.sandbox : undefined}
          data-dmap-editor-kind={target.kind}
          title="draw.io"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </Modal>
  );
}
