import React, { createContext, useEffect, useMemo, useState } from 'react';
import type { PanelProps, ScopedVars } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import type { DataSourceRef } from '@grafana/schema';
import { createQueryController } from './controller';
import { createGrafanaExecutor } from './grafana';
import type { QueryContext, QueryController } from './types';

export interface PanelQueryService {
  controller?: QueryController;
  context: QueryContext;
}
export const PanelQueryContext = createContext<PanelQueryService | undefined>(undefined);
type Props = Pick<PanelProps, 'data' | 'timeRange' | 'timeZone' | 'replaceVariables'> & {
  defaultDatasource?: DataSourceRef;
  refreshMs?: number;
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
  children,
}: Props) {
  const [controller, setController] = useState<QueryController>();
  useEffect(() => {
    const current = createQueryController(createGrafanaExecutor());
    let attached = true;
    queueMicrotask(() => {
      if (attached) {
        setController(current);
      }
    });
    return () => {
      attached = false;
      current.dispose();
    };
  }, []);
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
  // Guarded state adjustment freezes one resolved context for the whole generation.
  const [resolved, setResolved] = useState<{ signature: string; context: QueryContext }>(() => ({
    signature,
    context: { ...nextContext, generation: 1 },
  }));
  if (resolved.signature !== signature) {
    setResolved({ signature, context: { ...nextContext, generation: resolved.context.generation + 1 } });
  }
  const context = resolved.context;
  const service = useMemo(() => ({ controller, context }), [controller, context]);
  return <PanelQueryContext.Provider value={service}>{children}</PanelQueryContext.Provider>;
}
