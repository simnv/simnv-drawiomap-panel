import { useEffect, useMemo, useRef, useState } from 'react';
import { collectBindingDemands } from '../binding/engine';
import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfigV2 } from '../model/config';
import type { PanelQueryService } from '../query/panel';
import { preparedSnapshot, type QueryPreview } from '../editor/preview';

const NO_PREPARED: QueryPreview[] = [];

/** Holds only active display snapshots. The shared controller owns execution and the inactive cache. */
export function useBindingSnapshots(
  plan: BindingPlan,
  config: DiagramConfigV2,
  service: PanelQueryService | undefined,
  openCellId: string | undefined,
  maxDataPoints: number,
  prepared: QueryPreview[] = NO_PREPARED
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
        const snapshot = preparedSnapshot(
          query,
          config,
          demand.cellId,
          undefined,
          prepared.filter(
            (result) =>
              result.context === service.context &&
              (result.snapshot.state === 'ready' || result.snapshot.state === 'empty')
          ),
          service.context.generation
        );
        const reuse = snapshot.state === 'ready' || snapshot.state === 'empty' ? snapshot : undefined;
        return [{ request, cellId: demand.cellId, key: JSON.stringify(request), reuse }];
      }),
    [plan, config, service, openCellId, maxDataPoints, prepared]
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
    const desired = new Map(demands.filter((d) => !d.reuse).map((d) => [d.request.consumerId, d]));
    for (const [id, item] of subscriptions) {
      if (desired.get(id)?.key !== item.key) {
        subscriptions.delete(id);
        item.release();
      }
    }
    if (controller) {
      for (const demand of desired.values()) {
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
    if (!Object.entries(snapshots).some(([id, item]) => desired.get(id)?.key !== item.key)) {
      return;
    }
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
  }, [controller, demands, snapshots]);
  return useMemo(
    () =>
      demands.flatMap((demand) => {
        if (demand.reuse) {
          return [
            {
              query: demand.request.query,
              cellId: demand.cellId,
              context: demand.request.context,
              snapshot: demand.reuse,
            },
          ];
        }
        const value = snapshots[demand.request.consumerId];
        return value?.key === demand.key ? [value.preview] : [];
      }),
    [demands, snapshots]
  );
}
