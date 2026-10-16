import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Modal } from '@grafana/ui';
import type { DrawioModalProps } from '../types';
import { buildEditorUrl, editorOrigin, handleMessage, initialState, parseMessage, ProtocolState } from './protocol';

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

  const post = useCallback(
    (action: unknown) => {
      frameRef.current?.contentWindow?.postMessage(JSON.stringify(action), origin);
    },
    [origin]
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow) {
        return;
      }
      const msg = parseMessage(e.data);
      if (!msg) {
        return;
      }
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
      <div className={styles.body} data-testid="dmap-editor-modal" data-dmap-editor-phase={phase}>
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
