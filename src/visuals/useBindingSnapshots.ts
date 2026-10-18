import { useEffect, useMemo, useRef, useState } from 'react';
import { collectBindingDemands } from '../binding/engine';
import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfigV2 } from '../model/config';
import type { PanelQueryService } from '../query/panel';
import type { QueryPreview } from '../editor/preview';

/** Holds only active display snapshots. The shared controller owns execution and the inactive cache. */
export function useBindingSnapshots(
  plan: BindingPlan,
  config: DiagramConfigV2,
  service: PanelQueryService | undefined,
  openCellId: string | undefined,
  maxDataPoints: number
): QueryPreview[] {
  const demands = useMemo(
    () =>
      collectBindingDemands(plan, openCellId).flatMap((demand) => {
        const query = config.queries.find((q) => q.id === demand.binding.queryId);
        const scope = plan.cells[demand.cellId]?.scope;
        if (!query || query.source.kind === 'panel' || !scope || !service) {
          return [];
        }
        const consumerId = `binding:${demand.role}:${demand.cellId}:${demand.rowIndex ?? JSON.stringify(demand.binding)}`;
        const request = { consumerId, query, scope, context: service.context, maxDataPoints };
        return [{ request, cellId: demand.cellId, key: JSON.stringify(request) }];
      }),
    [plan, config, service, openCellId, maxDataPoints]
  );
  const active = useRef(new Map<string, { key: string; release: () => void }>());
  const [snapshots, setSnapshots] = useState<Record<string, { key: string; preview: QueryPreview }>>({});
  const controller = service?.controller;
  useEffect(() => {
    const subscriptions = active.current;
    return () => {
      for (const item of subscriptions.values()) {
        item.release();
      }
      subscriptions.clear();
    };
  }, [controller]);
  useEffect(() => {
    const subscriptions = active.current;
    const desired = new Map(demands.map((d) => [d.request.consumerId, d]));
    for (const [id, item] of subscriptions) {
      if (desired.get(id)?.key !== item.key) {
        subscriptions.delete(id);
        item.release();
      }
    }
    if (controller) {
      for (const demand of demands) {
        const id = demand.request.consumerId;
        if (subscriptions.has(id)) {
          continue;
        }
        const item = { key: demand.key, release: () => {} };
        subscriptions.set(id, item);
        item.release = controller.watch(demand.request, (snapshot) => {
          if (subscriptions.get(id) !== item) {
            return;
          }
          setSnapshots((previous) => ({
            ...previous,
            [id]: {
              key: demand.key,
              preview: {
                query: demand.request.query,
                cellId: demand.cellId,
                context: demand.request.context,
                snapshot,
              },
            },
          }));
        });
      }
    }
    // Discard inactive display snapshots; keep reusable history only in the bounded controller cache.
    let attached = true;
    queueMicrotask(() => {
      if (attached) {
        setSnapshots((previous) => {
          const entries = Object.entries(previous).filter(([id, item]) => desired.get(id)?.key === item.key);
          return entries.length === Object.keys(previous).length ? previous : Object.fromEntries(entries);
        });
      }
    });
    return () => {
      attached = false;
    };
  }, [controller, demands]);
  return useMemo(
    () =>
      demands.flatMap((demand) => {
        const value = snapshots[demand.request.consumerId];
        return value?.key === demand.key ? [value.preview] : [];
      }),
    [demands, snapshots]
  );
}
