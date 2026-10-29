import React, { Component, Suspense, useState, type ReactNode } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Alert, Button, Spinner, useTheme2 } from '@grafana/ui';
import type { Options } from '../types';
import { EditBindingsButton } from './EditBindingsButton';

type Props = StandardEditorProps<unknown, Record<string, never>, Options>;

/** A new lazy component. React keeps a rejected load, so a retry needs a new factory. */
const makeLazy = () => React.lazy(() => import(/* webpackChunkName: "config-yaml-editor" */ './ConfigYamlEditor'));

class LoadBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <Alert title="The YAML editor could not load" severity="error">
        <p>The editor files did not load. Check the network, then try again.</p>
        <Button
          variant="secondary"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onRetry();
          }}
        >
          Retry
        </Button>
      </Alert>
    );
  }
}

/**
 * The `config` option editor in its own chunk (spec 5.0, A13). The chunk holds the YAML parser, so view mode does
 * not load it. While the chunk loads, a spinner shows. A failed load shows a message with a Retry button. The "Edit
 * bindings" button stands above the YAML, outside the chunk, so it shows also while the chunk loads.
 */
export function LazyConfigYamlEditor(props: Props) {
  const theme = useTheme2();
  const [Editor, setEditor] = useState(makeLazy);
  return (
    <>
      <div style={{ marginBottom: theme.spacing(1) }}>
        <EditBindingsButton disabled={!props.context.options?.diagram?.svg} />
      </div>
      <LoadBoundary onRetry={() => setEditor(makeLazy)}>
        <Suspense
          fallback={
            <div role="status" aria-label="Loading the YAML editor">
              <Spinner inline /> Loading the YAML editor…
            </div>
          }
        >
          <Editor {...props} />
        </Suspense>
      </LoadBoundary>
    </>
  );
}
