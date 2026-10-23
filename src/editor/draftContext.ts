import type { DataSourceRef } from '@grafana/schema';
import type { PanelQueryService } from '../query/panel';

const cache = new WeakMap<PanelQueryService, { key: string; value: PanelQueryService }>();

/**
 * The query service of the popup: the controller of the panel and the context of the panel with the default
 * datasource of the draft. The provider keeps the saved default datasource for the panel itself.
 *
 * It returns the same object while the saved service and the draft default datasource stay equal, so it is safe
 * as a dependency of `useMemo` and `useEffect`. When the draft value equals the saved one, it returns the saved
 * service itself.
 */
export function draftQueryService(
  service: PanelQueryService | undefined,
  defaultDatasource: DataSourceRef | undefined
): PanelQueryService | undefined {
  if (!service) {
    return undefined;
  }
  const key = JSON.stringify(defaultDatasource ?? null);
  if (key === JSON.stringify(service.context.defaultDatasource ?? null)) {
    return service;
  }
  const cached = cache.get(service);
  if (cached?.key === key) {
    return cached.value;
  }
  const value = { controller: service.controller, context: { ...service.context, defaultDatasource } };
  cache.set(service, { key, value });
  return value;
}
