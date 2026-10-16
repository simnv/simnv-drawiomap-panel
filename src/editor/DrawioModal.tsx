import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Alert, Modal } from '@grafana/ui';
import type { DrawioModalProps } from '../types';
import {
  acceptEditorMessage,
  buildEditorUrl,
  editorOrigin,
  eventSource,
  frameWindow,
  handleMessage,
  initialState,
  ProtocolState,
} from './protocol';

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
  const src = useMemo(() => buildEditorUrl(editorUrl, isDark), [editorUrl, isDark]);
  const origin = useMemo(() => editorOrigin(editorUrl), [editorUrl]);

  // The editor sends the first message. Replies go to the sender of the first accepted message.
  const sourceRef = useRef<Window | undefined>(undefined);
  // The Grafana frontend sandbox blocks iframe.contentWindow and event.source (cross-origin window),
  // so the host cannot reply to the editor.
  const [blocked, setBlocked] = useState(false);
  const post = useCallback(
    (action: unknown) => {
      sourceRef.current?.postMessage(JSON.stringify(action), origin);
    },
    [origin]
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = acceptEditorMessage(e, origin, frameWindow(frameRef.current), sourceRef.current);
      if (!msg) {
        return;
      }
      const source = eventSource(e);
      if (!source) {
        setBlocked(true);
        return;
      }
      sourceRef.current = source as Window;
      const step = handleMessage(stateRef.current, msg, { mode, title, isDark });
      stateRef.current = step.state;
      setPhase(step.state.phase);
      step.send.forEach(post);
      if (step.result) {
        onSave(step.result);
      }
      if (step.close) {
        onClose();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, mode, title, isDark, post, onSave, onClose]);

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
            The Grafana frontend sandbox is on for this plugin. The sandbox does not let the panel send messages to the
            draw.io frame on another origin. Remove simnv-drawiomap-panel from enable_frontend_sandbox_for_plugins to
            edit the diagram.
          </Alert>
        ) : null}
        <iframe
          ref={frameRef}
          data-testid="dmap-editor-frame"
          className={styles.frame}
          src={src}
          title="draw.io"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </Modal>
  );
}
