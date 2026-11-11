import React from 'react';
import { Button } from '@grafana/ui';
import { buildStarter, STARTER_NOTICE, starterFacts } from '../model/starter';
import type { Diagram } from '../types';
import { writeYaml } from './yamlConfig';

/** The YAML text of the starter config for a diagram and the refIds of the panel targets. */
export function starterText(diagram: Diagram, refIds: readonly string[], guessStatus = true): string {
  return writeYaml(buildStarter({ ...starterFacts(diagram), refIds, guessStatus }));
}

/**
 * The notice above an empty config. The button gives the text of the starter to `onInsert`. The notice never writes
 * on its own.
 */
export function StarterNotice({ onInsert, framesOnly = false }: { onInsert: () => void; framesOnly?: boolean }) {
  return (
    <div role="status" data-testid="dmap-starter-notice" style={{ marginBottom: 8 }}>
      <p>The config is empty. Select Insert a starter config. {STARTER_NOTICE}</p>
      {framesOnly ? (
        <p>The starter uses the queries that returned data. For all panel queries, use Edit bindings.</p>
      ) : null}
      <Button variant="secondary" icon="plus" data-testid="dmap-starter-insert" onClick={onInsert}>
        Insert a starter config
      </Button>
    </div>
  );
}
