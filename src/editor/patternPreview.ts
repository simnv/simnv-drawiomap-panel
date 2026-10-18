import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfigV2 } from '../model/config';
import { measureFrames } from '../query/controller';
import {
  DEFAULT_QUERY_POLICY,
  type QueryContext,
  type QueryController,
  type QueryPolicy,
  type QuerySnapshot,
} from '../query/types';
import { preparedSnapshot, type QueryPreview } from './preview';

export interface PatternPreview {
  config: DiagramConfigV2;
  context: QueryContext;
  previews: QueryPreview[];
}

/** One explicit run holds bounded prepared results, never a second query cache or refresh schedule. */
export function previewPattern(
  controller: QueryController,
  plan: BindingPlan,
  config: DiagramConfigV2,
  affected: string[],
  context: QueryContext,
  publish: (value: PatternPreview) => void,
  policy: QueryPolicy = DEFAULT_QUERY_POLICY,
  compatible: QueryPreview[] = []
): () => void {
  const demands = affected.flatMap((cellId) => {
    const cell = plan.cells[cellId];
    const ids = new Set([
      ...(cell?.bindings.map((binding) => binding.queryId) ?? []),
      ...plan.widgets.filter((entry) => entry.anchorCellId === cellId).map((entry) => entry.widget.binding.queryId),
    ]);
    return [...ids].flatMap((id) => {
      const query = config.queries.find((query) => query.id === id);
      return query && cell ? [{ query, cellId, scope: cell.scope }] : [];
    });
  });
  let active = true;
  const releases: Array<() => void> = [];
  const close = (index: number) => {
    const release = releases[index];
    // A released controller subscription closes over its last result. Drop that reference too.
    delete releases[index];
    release?.();
  };
  const finished = new Set<number>();
  const prepared = new Set<unknown>();
  let values = 0;
  let bytes = 0;
  const previews: QueryPreview[] = demands.map(({ query, cellId }) => ({
    query,
    cellId,
    context,
    snapshot: { state: 'loading' },
  }));
  const update = () => publish({ config, context, previews: [...previews] });
  update();
  demands.forEach((demand, index) => {
    const receive = (response: QuerySnapshot) => {
      if (!active || finished.has(index)) {
        return;
      }
      let snapshot: QuerySnapshot = response;
      if (snapshot.state === 'ready' && !prepared.has(snapshot.frames)) {
        try {
          const size = measureFrames(snapshot.frames);
          if (
            prepared.size >= policy.maxEntries ||
            values + size.values > policy.maxCachedValues ||
            bytes + size.bytes > policy.maxCachedBytes
          ) {
            throw new Error(
              'Pattern preview result limit reached. Reduce the pattern scope, range or resolution and preview again.'
            );
          }
          prepared.add(snapshot.frames);
          values += size.values;
          bytes += size.bytes;
        } catch (error) {
          snapshot = {
            state: 'error',
            message: error instanceof Error ? error.message : 'Pattern preview result cannot be measured.',
          };
        }
      }
      previews[index] = {
        ...previews[index],
        context: { ...context, defaultDatasource: config.defaultDatasource },
        snapshot,
      };
      if (snapshot.state !== 'idle' && snapshot.state !== 'loading') {
        finished.add(index);
        // watch may emit synchronously. Release after registration and equal-demand coalescing finish.
        queueMicrotask(() => close(index));
      }
      update();
    };
    const existing = preparedSnapshot(demand.query, config, demand.cellId, undefined, compatible, context.generation);
    if (existing.state === 'ready' || existing.state === 'empty') {
      receive(existing);
    } else {
      releases[index] = controller.watch(
        {
          ...demand,
          consumerId: `pattern-preview:${index}`,
          context: { ...context, defaultDatasource: config.defaultDatasource, refreshMs: 0 },
          maxDataPoints: 160,
        },
        receive
      );
    }
  });
  return () => {
    active = false;
    // Drop queued demands before releasing running slots, which would otherwise start abandoned work.
    for (let index = releases.length - 1; index >= 0; index--) {
      close(index);
    }
  };
}
