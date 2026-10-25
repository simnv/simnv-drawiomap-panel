import type { PanelQueryService } from './panel';
import { createSnapshotStore, type SnapshotStore } from './store';
import type { QueryContext, QueryController } from './types';

const stores = new WeakMap<QueryController, SnapshotStore>();
const services = new WeakMap<QueryController, Map<QueryContext, PanelQueryService>>();

/**
 * The query service of a controller for the tests: one store per controller and one service object per
 * (controller, context), as `PanelQueryProvider` gives them, so a rerender with a new context keeps the store.
 */
export function testQueryService(controller: QueryController, context: QueryContext): PanelQueryService {
  let store = stores.get(controller);
  if (!store) {
    store = createSnapshotStore(controller);
    stores.set(controller, store);
  }
  let byContext = services.get(controller);
  if (!byContext) {
    byContext = new Map();
    services.set(controller, byContext);
  }
  let service = byContext.get(context);
  if (!service) {
    service = { controller, store, context };
    byContext.set(context, service);
  }
  return service;
}
