import type { ClassV4, ConfigV4, RowV4 } from '../model/v4';

/**
 * Panel targets use these refIds: lan_tx, lan_rx, wan_tx, wan_rx, speed, up, load and cpu.
 * A link carries key=<job>, port=<device>, and at=source or at=target for the end that owns the counters.
 * LAN links use the speed target. WAN and tunnel links carry cap=100M.
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

/** The L3 demo. The up target includes a down node; a node with no series keeps the grey no-data state. */
export const demoConfigV4: ConfigV4 = {
  version: 4,
  freshness: '3x',
  classes: {
    links: traffic('lan_tx', 'lan_rx'),
    'lan-speed': { extends: 'links', capacity: 'speed' },
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
      rows: [{ kind: 'history', label: 'CPU', unit: 'percent', query: 'cpu' }, ...nodeRows()],
      url: '/d/drawiomap-demo?var-job=${key}',
      urlTitle: 'Host ${key}',
    },
  },
  overrides: {},
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
