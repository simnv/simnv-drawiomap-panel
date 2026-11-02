import React, { type ComponentProps, type ComponentType } from 'react';
import { Alert, Button, Spinner } from '@grafana/ui';
import { LazyChunk } from '../editor/lazyChunk';

type Editors = typeof import('./editors');

const chunk = () => import(/* webpackChunkName: "option-editors" */ './editors');

/**
 * A custom option editor from the option-editors chunk. The options pane renders only in panel edit, so view mode
 * does not load the editors, the draw.io modal or the YAML editor shell. While the chunk loads, the option shows a
 * spinner. A failed load shows a message with a Retry button.
 */
function lazyEditor<K extends keyof Editors>(name: K): Editors[K] {
  type Props = ComponentProps<Editors[K]>;
  const load = () => chunk().then((m) => ({ default: m[name] as ComponentType<Props> }));
  function LazyEditor(props: Props) {
    return (
      <LazyChunk
        load={load}
        props={props}
        fallback={
          <div role="status" aria-label="Loading the option editor">
            <Spinner inline />
          </div>
        }
        failed={(retry) => (
          <Alert title="The option editor could not load" severity="error">
            <p>The editor files did not load. Check the network, then try again.</p>
            <Button variant="secondary" onClick={retry}>
              Retry
            </Button>
          </Alert>
        )}
      />
    );
  }
  LazyEditor.displayName = `Lazy(${name})`;
  return LazyEditor as unknown as Editors[K];
}

export const DiagramEditor = lazyEditor('DiagramEditor');
export const IconRadioEditor = lazyEditor('IconRadioEditor');
export const ConfigYamlEditor = lazyEditor('LazyConfigYamlEditor');
