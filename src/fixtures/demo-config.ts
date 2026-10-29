import type { ClassV4, ConfigV4, RowV4 } from '../model/v4';

/**
 * The bindings of the demo panels (provisioning/dashboards/demo.json). The series come from the synthetic generator
 * in stack/metrics-gen/gen.py, through the panel targets of demo/dashboard.template.json. The refId of a target is
 * its query name: lan_tx, lan_rx, wan_tx, wan_rx, speed, up, load and cpu.
 *
 * A link carries key=<job>, port=<device> and at=source or at=target: the end that owns the transmit and receive
 * counters. tx is up and rx is down, so the halves follow the geometric direction of the link (spec 3.8.2).
 * LAN links use key=node-rtr-a or node-rtr-b, port=br-lan and at=target; their capacity is the speed series of the
 * same port. WAN and tunnel links carry cap=100M. The cells get these attributes in fixtures/demo/demo-l3.yaml.
 */

/** A link class: the transmit and receive targets, one updown row, the URL of the interface. */
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

/**
 * The L3 demo. LTE stays down; the proxy-b override selects no series from the up target and stays grey. `links` is
 * the base of the tunnels: it has no match, so it is abstract and needs no cell (spec 2.3).
 */
const { match: linkMatch, ...links } = traffic('lan_tx', 'lan_rx');

export const demoConfigV4: ConfigV4 = {
  version: 4,
  freshness: '3x',
  classes: {
    links,
    'lan-speed': { ...traffic('lan_tx', 'lan_rx'), capacity: 'speed' },
    wan: traffic('wan_tx', 'wan_rx'),
    tunnels: { extends: 'links', match: linkMatch },
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

/** The two hand-drawn edges carry bind=hand-links, key=<job>, port=<device> and their capacity in `cap`. */
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
