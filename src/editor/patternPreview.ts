import type { BindingPlan } from '../binding/patterns';
import type { DiagramConfig } from '../model/config';
import { measureFrames } from '../query/controller';
import {
  DEFAULT_QUERY_POLICY,
  type QueryContext,
  type QueryController,
  type QueryPolicy,
  type QuerySnapshot,
} from '../query/types';
import type { QueryPreview } from './preview';

export interface PatternPreview {
  config: DiagramConfig;
  context: QueryContext;
  previews: QueryPreview[];
}

export interface PatternPreviewOptions {
  /** Namespace of the consumer ids, for example `popup:3`. */
  owner: string;
  /** The resolution of the demands: the one of the store entries of the popup, so equal requests merge in the controller. */
  maxDataPoints: number;
  policy?: QueryPolicy;
}

/**
 * One explicit run holds bounded prepared results, never a second query cache or refresh schedule. Its demands have
 * the identity of the popup's own entries: the controller merges them with a running or retained request.
 */
export function previewPattern(
  controller: QueryController,
  plan: BindingPlan,
  config: DiagramConfig,
  affected: string[],
  context: QueryContext,
  publish: (value: PatternPreview) => void,
  { owner, maxDataPoints, policy = DEFAULT_QUERY_POLICY }: PatternPreviewOptions
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
    releases[index] = controller.watch(
      {
        ...demand,
        consumerId: `${owner}:pattern-preview:${index}`,
        context: { ...context, defaultDatasource: config.defaultDatasource, refreshMs: 0 },
        maxDataPoints,
      },
      receive
    );
  });
  return () => {
    active = false;
    // Drop queued demands before releasing running slots, which would otherwise start abandoned work.
    for (let index = releases.length - 1; index >= 0; index--) {
      close(index);
    }
  };
}
