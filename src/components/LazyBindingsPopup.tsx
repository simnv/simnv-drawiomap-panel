import React, { Component, Suspense, useState, type ReactNode } from 'react';
import { Alert, Button, Spinner } from '@grafana/ui';
import { PluginDialog } from '../editor/popup/PluginDialog';
import type { BindingsPopupProps } from '../editor/popup/BindingsPopup';

/** A new lazy component. React keeps a rejected load, so a retry needs a new factory. */
const makeLazy = () => React.lazy(() => import(/* webpackChunkName: "bindings-popup" */ '../editor/popup'));

class LoadBoundary extends Component<
  { children: ReactNode; onRetry: () => void; onClose: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <PluginDialog title="Edit bindings" onDismiss={this.props.onClose} onEscape={this.props.onClose}>
        <div>
          <Alert title="The editor could not load" severity="error">
            <p>The bindings editor files did not load. Check the network, then try again.</p>
          </Alert>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={this.props.onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                this.setState({ failed: false });
                this.props.onRetry();
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      </PluginDialog>
    );
  }
}

/**
 * The bindings popup in its own chunk: view mode never loads it. While the chunk loads, a small modal shows a
 * spinner. A failed load shows a message with a Retry button.
 */
export function LazyBindingsPopup(props: BindingsPopupProps) {
  const [Popup, setPopup] = useState(makeLazy);
  return (
    <LoadBoundary onRetry={() => setPopup(makeLazy)} onClose={props.onClose}>
      <Suspense
        fallback={
          <PluginDialog title="Edit bindings" onDismiss={props.onClose} onEscape={props.onClose}>
            <div role="status" aria-label="Loading the bindings editor">
              <Spinner inline /> Loading the bindings editor…
            </div>
          </PluginDialog>
        }
      >
        <Popup {...props} />
      </Suspense>
    </LoadBoundary>
  );
}
