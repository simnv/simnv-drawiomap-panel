import React, { createContext, useEffect, useMemo, useState } from 'react';
import type { PanelProps, ScopedVars } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import type { DataSourceRef } from '@grafana/schema';
import { createQueryController } from './controller';
import { createGrafanaExecutor } from './grafana';
import { generationOf, newQuerySession, querySession, retainQuerySession } from './session';
import type { QueryContext, QueryController } from './types';

export interface PanelQueryService {
  controller?: QueryController;
  context: QueryContext;
}
export const PanelQueryContext = createContext<PanelQueryService | undefined>(undefined);
type Props = Pick<PanelProps, 'data' | 'timeRange' | 'timeZone' | 'replaceVariables'> & {
  defaultDatasource?: DataSourceRef;
  refreshMs?: number;
  /**
   * The session key of the panel (dashboard and panel id). A new component instance of the same session (the panel
   * editor remounts the panel) continues the result cache and the generation. Without a key the provider has a
   * private session.
   */
  session?: string;
  children: React.ReactNode;
};

/** Consumers watch only after the controller is attached by the mount effect. */
export function PanelQueryProvider({
  data,
  timeRange,
  timeZone,
  replaceVariables,
  defaultDatasource,
  refreshMs = 0,
  session: sessionKey,
  children,
}: Props) {
  const [privateSession] = useState(newQuerySession);
  const session = sessionKey === undefined ? privateSession : querySession(sessionKey);
  const [controller, setController] = useState<QueryController>();
  useEffect(() => {
    const release = sessionKey === undefined ? undefined : retainQuerySession(sessionKey);
    const current = createQueryController(createGrafanaExecutor(), undefined, undefined, session.cache);
    let attached = true;
    queueMicrotask(() => {
      if (attached) {
        setController(current);
      }
    });
    return () => {
      attached = false;
      current.dispose();
      release?.();
    };
  }, [sessionKey, session]);
  useEffect(() => {
    controller?.setPanelData(data);
  }, [controller, data]);
  const scopedVars: ScopedVars = { ...data.request?.scopedVars };
  // Capture raw scalar/array values with a formatter. The datasource still owns query escaping.
  for (const variable of getTemplateSrv()?.getVariables() ?? []) {
    replaceVariables(`\${${variable.name}}`, undefined, (value: unknown) => {
      scopedVars[variable.name] = { text: value, value };
      return '';
    });
  }
  const signature = JSON.stringify([
    timeRange.from.valueOf(),
    timeRange.to.valueOf(),
    timeRange.raw,
    timeZone,
    scopedVars,
    defaultDatasource,
    data.request?.requestId,
    data.request?.intervalMs,
    refreshMs,
  ]);
  const nextContext = {
    timeRange,
    timeZone,
    scopedVars,
    defaultDatasource,
    intervalMs: data.request?.intervalMs ?? 1000,
    refreshMs,
  };
  // Guarded state adjustment freezes one resolved context for the whole generation. The session gives the
  // generation: the same signature keeps it across a remount, a new signature starts the next one.
  const [resolved, setResolved] = useState<{ signature: string; context: QueryContext }>(() => ({
    signature,
    context: { ...nextContext, generation: generationOf(session, signature) },
  }));
  if (resolved.signature !== signature) {
    setResolved({ signature, context: { ...nextContext, generation: generationOf(session, signature) } });
  }
  const context = resolved.context;
  const service = useMemo(() => ({ controller, context }), [controller, context]);
  return <PanelQueryContext.Provider value={service}>{children}</PanelQueryContext.Provider>;
}
