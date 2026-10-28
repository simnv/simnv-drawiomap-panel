import type { ClassV4, ConfigV4, RowV4 } from '../model/v4';

/**
 * Panel targets use these refIds: lan_tx, lan_rx, wan_tx, wan_rx, speed, up, load and cpu.
 * A link carries key=<job>, port=<device>, and at=source or at=target for the end that owns the counters.
 * LAN links use key=node-rtr-a or node-rtr-b, port=br-lan and at=target to match the speed target.
 * lan_tx is the transmit rate in bit/s; lan_rx is the receive rate in bit/s. The LAN-speed class uses lan_tx
 * for both halves: the generator has equal transmit rates at both LAN ends, as the v3 demo requires.
 * WAN and tunnel links carry cap=100M.
 * The cut-over assigns these attributes and the bind class to the existing demo cells.
 */
const traffic = (up: string, down: string): ClassV4 => ({
  match: { key: 'job', port: 'device' },
  up,
  down,
  linkLabel: 'none',
  rows: [{ kind: 'updown', label: 'Traffic', up, down }],
  url: '/d/drawiomap-demo?var-job=${key}&var-device=${port}',
  urlTitle: 'Traffic of ${key}:${port}',
});

const nodeRows = (): RowV4[] => [
  { kind: 'history', label: 'state', query: 'up' },
  { kind: 'history', label: 'load 1m', query: 'load' },
];

/** The L3 demo. LTE stays down; the proxy-b override selects no series from the up target and stays grey. */
export const demoConfigV4: ConfigV4 = {
  version: 4,
  freshness: '3x',
  classes: {
    links: traffic('lan_tx', 'lan_rx'),
    'lan-speed': { ...traffic('lan_tx', 'lan_tx'), capacity: 'speed' },
    wan: traffic('wan_tx', 'wan_rx'),
    tunnels: { extends: 'links' },
    'node-up': {
      match: { key: 'job' },
      status: 'up',
      missing: 'nodata',
      rows: nodeRows(),
      url: '/d/drawiomap-demo?var-job=${key}',
      urlTitle: 'Host ${key}',
    },
    'router-cpu': {
      match: { key: 'job' },
      status: 'up',
      missing: 'nodata',
      rows: [
        { kind: 'history', label: 'CPU', unit: 'percent', query: 'cpu' },
        { kind: 'drilldown', label: 'CPU details', url: '/d/drawiomap-demo?var-job=${key}&var-metric=cpu' },
        ...nodeRows(),
      ],
      url: '/d/drawiomap-demo?var-job=${key}',
      urlTitle: 'Host ${key}',
    },
  },
  overrides: {
    // key=node-proxy-b selects node-proxy-b-no-data, which the generator never emits. Keep up and load unchanged.
    'pg-node~proxy-b': { match: { key: 'job="${key}-no-data"' } },
  },
};

/** The two hand-drawn edges use bind=hand-links, key=<job>, port=<device> and cap=100M. */
export const handDrawnConfigV4: ConfigV4 = {
  version: 4,
  freshness: '3x',
  classes: {
    'hand-links': {
      ...traffic('wan_tx', 'wan_rx'),
      url: '/d/drawiomap-demo?cell=${id}',
      urlTitle: 'Link ${id}',
    },
  },
  overrides: {},
};
