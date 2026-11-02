import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Alert, Button, Spinner, useTheme2 } from '@grafana/ui';
import type { Options } from '../types';
import { LazyChunk } from '../editor/lazyChunk';
import { EditBindingsButton } from './EditBindingsButton';

type Props = StandardEditorProps<unknown, Record<string, never>, Options>;

const load = () => import(/* webpackChunkName: "config-yaml-editor" */ './ConfigYamlEditor');

/**
 * The `config` option editor in its own chunk (spec 5.0, A13). The chunk holds the YAML parser, so view mode does
 * not load it. While the chunk loads, a spinner shows. A failed load shows a message with a Retry button. The "Edit
 * bindings" button stands above the YAML, outside the chunk, so it shows also while the chunk loads.
 */
export function LazyConfigYamlEditor(props: Props) {
  const theme = useTheme2();
  return (
    <>
      <div style={{ marginBottom: theme.spacing(1) }}>
        <EditBindingsButton disabled={!props.context.options?.diagram?.svg} />
      </div>
      <LazyChunk
        load={load}
        props={props}
        fallback={
          <div role="status" aria-label="Loading the YAML editor">
            <Spinner inline /> Loading the YAML editor…
          </div>
        }
        failed={(retry) => (
          <Alert title="The YAML editor could not load" severity="error">
            <p>The editor files did not load. Check the network, then try again.</p>
            <Button variant="secondary" onClick={retry}>
              Retry
            </Button>
          </Alert>
        )}
      />
    </>
  );
}
