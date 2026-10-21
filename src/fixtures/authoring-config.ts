import type { DiagramConfigV2, NamedQuery, QueryBinding } from '../model/config';

/** Fictional routers and constant values: no live infrastructure or credentials. */
export const binding = (queryId: string): QueryBinding => ({ queryId, match: {}, reducer: 'last' });
export const nativeQuery = (id: string, expr: string, parameters: Record<string, string> = {}): NamedQuery => {
  const target = { refId: id.toUpperCase(), expr, range: true };
  return { id, name: id, source: { kind: 'datasource', target, parameters } };
};
export function authoringConfig(prometheus: string, testdata: string): DiagramConfigV2 {
  const trendTarget = { refId: 'TREND', scenarioId: 'random_walk', alias: 'Sanitized trend' };
  return {
    version: 2,
    defaultDatasource: { uid: prometheus, type: 'prometheus' },
    queries: [
      nativeQuery('health', 'label_replace(vector(1), "device", "$dm_key", "", "")', { dm_key: 'cell.key' }),
      nativeQuery('detail', 'label_replace(vector($site), "device", "$dm_key", "", "")', { dm_key: 'cell.key' }),
      {
        id: 'trend',
        name: 'Standalone trend',
        source: {
          kind: 'datasource',
          datasource: { uid: testdata, type: 'grafana-testdata-datasource' },
          target: trendTarget,
          parameters: {},
        },
      },
      // synthetic traffic from stack/metrics-gen: the transmit and receive rate of one port, in bit/s
      nativeQuery('tx', 'rate(node_network_transmit_bytes_total{job="node-rtr-a",device="wan1"}[1m]) * 8'),
      nativeQuery('rx', 'rate(node_network_receive_bytes_total{job="node-rtr-a",device="wan1"}[1m]) * 8'),
    ],
    patterns: [
      {
        id: 'routers',
        name: 'Repeated routers',
        select: { ids: ['device-1', 'device-2'] },
        display: {
          label: 'Router ${cell.key}',
          status: {
            kind: 'mapping',
            binding: binding('health'),
            default: { state: 'normal', reason: 'Healthy' },
            mappings: [{ value: 0, state: 'down', reason: 'Health check failed' }],
          },
          hover: {
            rows: [
              { kind: 'value', label: 'Detail value', binding: binding('detail') },
              { kind: 'history', label: 'Detail history', binding: binding('detail') },
            ],
          },
        },
      },
      {
        id: 'directional-link',
        name: 'Directional traffic',
        select: { ids: ['link-1'] },
        display: {
          link: { a2bBinding: binding('health'), b2aBinding: binding('health'), capacity: 100 },
          hover: {
            rows: [
              {
                kind: 'history',
                label: 'Traffic',
                unit: 'bps',
                capacity: 100000000,
                series: [
                  { binding: binding('tx'), direction: 'up', label: '↑' },
                  { binding: binding('rx'), direction: 'down', label: '↓' },
                ],
              },
            ],
          },
        },
      },
    ],
    overrides: [],
    widgets: [
      {
        id: 'trend-region',
        anchorCellId: 'chart-1',
        kind: 'sparkline',
        label: 'Standalone trend',
        binding: binding('trend'),
      },
    ],
  };
}
