import { useEffect, useMemo, useRef, useState } from 'react';
import { collectBindingDemands } from '../binding/engine';
import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfigV2 } from '../model/config';
import type { PanelQueryService } from '../query/panel';
import { preparedSnapshot, type QueryPreview } from '../editor/preview';
import type { QuerySnapshot } from '../query/types';
import { useHeld } from '../components/useHeld';

const NO_PREPARED: QueryPreview[] = [];
const settled = (snapshot: QuerySnapshot) => snapshot.state !== 'loading' && snapshot.state !== 'idle';

interface Held {
  key: string;
  preview: QueryPreview;
  /** The last result that is not loading, for the same query, scope, element and default datasource. */
  last?: { match: string; preview: QueryPreview };
}

/** Holds only active display snapshots. The shared controller owns execution and the inactive cache. */
export function useBindingSnapshots(
  plan: BindingPlan,
  config: DiagramConfigV2,
  service: PanelQueryService | undefined,
  openCellId: string | undefined,
  maxDataPoints: number,
  preparedResults: QueryPreview[] | undefined,
  /** Namespace of the consumer ids. Two owners on one controller never release each other's watches. */
  owner: string,
  /**
   * The popup is open over the panel: keep returning the last live result. The subscriptions stay open; an emission
   * is stored and shows on the first render after the pause.
   */
  paused = false
): QueryPreview[] {
  const prepared = preparedResults ?? NO_PREPARED;
  const demands = useMemo(
    () =>
      collectBindingDemands(plan, openCellId).flatMap((demand) => {
        const query = config.queries.find((q) => q.id === demand.binding.queryId);
        const scope = plan.cells[demand.cellId]?.scope;
        if (!query || query.source.kind === 'panel' || !scope || !service) {
          return [];
        }
        const row =
          demand.rowIndex === undefined
            ? undefined
            : `${demand.rowIndex}${demand.seriesIndex === undefined ? '' : `.${demand.seriesIndex}`}`;
        const consumerId = `${owner}:binding:${demand.role}:${demand.cellId}:${row ?? JSON.stringify(demand.binding)}`;
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
        const match = JSON.stringify([query, scope, demand.cellId, service.context.defaultDatasource]);
        return [{ request, cellId: demand.cellId, key: JSON.stringify(request), match, reuse }];
      }),
    [plan, config, service, openCellId, maxDataPoints, prepared, owner]
  );
  const active = useRef(new Map<string, { key: string; release: () => void }>());
  const [snapshots, setSnapshots] = useState<Record<string, Held>>({});
  // While paused an emission goes to this ref, not to state: the hook renders nothing. The resume applies the latest
  // emission of each consumer once.
  const pausedRef = useRef(paused);
  const pending = useRef(new Map<string, Array<(state: Record<string, Held>) => Record<string, Held>>>());
  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && pending.current.size) {
      const apply = Array.from(pending.current.values()).flat();
      pending.current.clear();
      // One update for all consumers.
      setSnapshots((previous) => apply.reduce((state, fn) => fn(state), previous));
    }
  }, [paused]);
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
          const update = (previous: Record<string, Held>) => {
            const preview = {
              query: demand.request.query,
              cellId: demand.cellId,
              context: demand.request.context,
              snapshot,
            };
            const last = settled(snapshot) ? { match: demand.match, preview } : previous[id]?.last;
            return { ...previous, [id]: { key: demand.key, preview, last } };
          };
          if (pausedRef.current) {
            // Keep every emission in order, so that `last` (the last settled result) stays right. A consumer that is
            // released before the resume is dropped.
            const guarded = (state: Record<string, Held>) => (subscriptions.get(id) === item ? update(state) : state);
            pending.current.set(id, [...(pending.current.get(id) ?? []), guarded]);
          } else {
            setSnapshots(update);
          }
        });
      }
    }
    // Discard snapshots of released consumers; keep reusable history only in the bounded controller cache.
    // A consumer with a new key keeps its entry: the entry holds the last result until the new result.
    if (Object.keys(snapshots).every((id) => desired.has(id))) {
      return;
    }
    let attached = true;
    queueMicrotask(() => {
      if (attached) {
        setSnapshots((previous) => {
          const entries = Object.entries(previous).filter(([id]) => desired.has(id));
          return entries.length === Object.keys(previous).length ? previous : Object.fromEntries(entries);
        });
      }
    });
    return () => {
      attached = false;
    };
  }, [controller, demands, snapshots]);
  const shown = useMemo(
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
        const current = value?.key === demand.key ? value.preview : undefined;
        // A refresh starts a new request. Until it has a result, show the last result of the same demand,
        // or the last chart result of an earlier context that the demand reused.
        const last =
          (value?.last?.match === demand.match ? value.last.preview : undefined) ??
          prepared.find(
            (result) =>
              result.context !== demand.request.context &&
              settled(result.snapshot) &&
              preparedSnapshot(
                demand.request.query,
                config,
                demand.cellId,
                undefined,
                [result],
                undefined,
                'display'
              ) === result.snapshot
          );
        if (last && !(current && settled(current.snapshot))) {
          const snapshot = last.snapshot;
          return [
            {
              ...last,
              kept: true,
              context: demand.request.context,
              snapshot:
                snapshot.state === 'ready' || snapshot.state === 'empty' ? { ...snapshot, fromCache: true } : snapshot,
            },
          ];
        }
        return current ? [current] : [];
      }),
    [demands, snapshots, prepared, config]
  );
  return useHeld(shown, paused);
}
