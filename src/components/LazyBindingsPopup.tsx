import React, { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Modal, Spinner } from '@grafana/ui';
import type { BindingsPopupProps } from '../editor/popup';
import { dialogModalClass } from '../editor/dialogSize';
import { LazyChunk } from '../editor/lazyChunk';

const load = () => import(/* webpackChunkName: "bindings-popup" */ '../editor/popup');

/**
 * The dialog of the loading and the error states. The chunk holds the plugin dialog of the popup (PluginDialog), so
 * these states use a Grafana Modal in the place and the size of the popup.
 */
function Shell({ onDismiss, children }: { onDismiss: () => void; children: ReactNode }) {
  return (
    <Modal isOpen={true} title="Edit bindings" onDismiss={onDismiss} className={dialogModalClass}>
      {children}
    </Modal>
  );
}

/**
 * The bindings popup in its own chunk: view mode never loads it. While the chunk loads, a modal shows a spinner. A
 * failed load shows a message with a Retry button. On close, the opener gets the focus back.
 */
export function LazyBindingsPopup(props: BindingsPopupProps) {
  // The element that opened the popup gets the focus back on close. The first render reads it, in the event that
  // opens the popup: the loading modal and the dialog mount later and move the focus. The restore waits a frame, after
  // the unmount cleanup of the dialog, which read the focus after the loading modal and would put it on the body.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(
    () => () => {
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) {
          opener.focus();
        }
      });
    },
    [opener]
  );
  return (
    <LazyChunk
      load={load}
      props={props}
      fallback={
        <Shell onDismiss={props.onClose}>
          <div role="status" aria-label="Loading the bindings editor">
            <Spinner inline /> Loading the bindings editor…
          </div>
        </Shell>
      }
      failed={(retry) => (
        <Shell onDismiss={props.onClose}>
          <Alert title="The editor could not load" severity="error">
            <p>The bindings editor files did not load. Check the network, then try again.</p>
          </Alert>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={props.onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={retry}>
              Retry
            </Button>
          </div>
        </Shell>
      )}
    />
  );
}
