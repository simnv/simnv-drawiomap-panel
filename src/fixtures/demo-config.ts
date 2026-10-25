import type { DiagramConfig, HoverRow, NamedQuery, Pattern, QueryBinding } from '../model/config';

/**
 * The bindings of the two demo panels (provisioning/dashboards/demo.json). The series come from the synthetic
 * generator in stack/metrics-gen/gen.py, through the panel queries of demo/dashboard.template.json.
 * The canvas shows colours only; the values and the histories show in the hover card. The colours come from the
 * field config of the panel (Color scheme and Thresholds, also by override).
 */

const panelQuery = (refId: string): NamedQuery => ({ id: refId, name: refId, source: { kind: 'panel', refId } });
const bind = (queryId: string, match: Record<string, string>): QueryBinding => ({ queryId, match, reducer: 'last' });
/** The series of the two ends of a link, by the node and the port of each end. */
const FROM = { job: 'node-${from.node}', device: '${from.port}' };
const TO = { job: 'node-${to.node}', device: '${to.port}' };
/** The series of a node, by its id. */
const HOST = { job: 'node-${cell.pg-id}' };

/** One combined up/down row: up leaves the first end (a2b), down enters it (b2a). */
const trafficRow = (queryId: string, capacity?: number): HoverRow => ({
  kind: 'combined',
  label: 'Traffic',
  series: [
    { binding: bind(queryId, FROM), direction: 'up' },
    { binding: bind(queryId, TO), direction: 'down' },
  ],
  ...(capacity === undefined ? {} : { capacity }),
});
/** The rows of a node card: its state and its load, each with a history. */
const nodeRows = (): HoverRow[] => [
  { kind: 'history', label: 'state', binding: bind('C', HOST) },
  { kind: 'history', label: 'load 1m', binding: bind('D', HOST) },
];

/**
 * demo-l3: LAN links take their capacity from the port speed series S, WAN links from the field Max (an override
 * of query W), tunnels from a number. Later patterns override earlier ones for the same property of the same cell.
 */
export function demoL3Config(): DiagramConfig {
  const patterns: Pattern[] = [
    {
      id: 'links',
      name: 'Links',
      select: { kind: 'link' },
      display: {
        link: { a2b: { binding: bind('A', FROM) }, b2a: { binding: bind('A', TO) } },
        hover: { title: '${from.node} ↔ ${to.node}', rows: [trafficRow('A')] },
        url: '/d/drawiomap-demo?var-job=node-${from.node}&var-device=${from.port}',
        urlTitle: 'Traffic of ${from.node}:${from.port}',
      },
    },
    {
      id: 'lan-speed',
      name: 'LAN by port speed',
      select: { kind: 'link', attrs: { 'pg-to': '/:br-lan$/' } },
      display: { link: { capacityBinding: bind('S', TO) } },
    },
    {
      id: 'wan',
      name: 'WAN uplinks',
      select: { kind: 'link', attrs: { 'pg-to': '/^rtr-(a|b):(wan1|wan2|wan3|pppoe)$/' } },
      display: {
        link: { a2b: { binding: bind('W', FROM) }, b2a: { binding: bind('W', TO) } },
        hover: { rows: [trafficRow('W')] },
      },
    },
    {
      id: 'tunnels',
      name: 'Tunnels 100M',
      select: { kind: 'link', attrs: { 'pg-to': '/:(ts0|tun-in|relay-in)$/' } },
      display: { link: { capacity: 100000000 }, hover: { rows: [trafficRow('A', 100000000)] } },
    },
    {
      id: 'node-up',
      name: 'Node up',
      select: { kind: 'node' },
      display: {
        shape: { binding: bind('C', HOST), target: 'icon' },
        hover: { rows: nodeRows() },
        url: '/d/drawiomap-demo?var-job=node-${cell.pg-id}',
        urlTitle: 'Host ${cell.pg-id}',
      },
    },
    {
      id: 'router-cpu',
      name: 'Router CPU',
      select: { ids: ['rtr-a', 'rtr-b'] },
      display: {
        hover: {
          rows: [
            {
              kind: 'history',
              label: 'CPU',
              unit: 'percent',
              binding: bind('E', HOST),
              url: '/d/drawiomap-demo?var-job=node-${cell.pg-id}&var-metric=cpu',
            },
            ...nodeRows(),
          ],
        },
      },
    },
  ];
  return {
    version: 3,
    queries: ['A', 'W', 'S', 'C', 'D', 'E'].map(panelQuery),
    patterns,
    overrides: [],
    widgets: [],
  };
}

/** hand-drawn: a plain draw.io diagram. The capacity comes from the `capacity` attribute of each edge. */
export function handDrawnConfig(): DiagramConfig {
  const a2b = bind('A', { job: 'node-isp-a', device: 'pppoe' });
  const b2a = bind('A', { job: 'node-rtr-a', device: 'wan1' });
  return {
    version: 3,
    queries: [panelQuery('A')],
    patterns: [
      {
        id: 'hand-links',
        name: 'Hand links',
        select: { ids: ['edge-ab', 'edge-cd'] },
        display: {
          link: { a2b: { binding: a2b }, b2a: { binding: b2a }, capacity: '${cell.capacity}' },
          hover: {
            rows: [
              {
                kind: 'combined',
                label: 'Traffic',
                capacity: '${cell.capacity}',
                series: [
                  { binding: a2b, direction: 'up' },
                  { binding: b2a, direction: 'down' },
                ],
              },
            ],
          },
          url: '/d/drawiomap-demo?cell=${cell.id}',
          urlTitle: 'Link ${cell.id}',
        },
      },
    ],
    overrides: [],
    widgets: [],
  };
}
