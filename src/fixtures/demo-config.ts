import type { ClassV4, ConfigV4, RowV4 } from '../model/v4';

/**
 * The bindings of the demo panels (provisioning/dashboards/demo.json). The series come from the synthetic generator
 * in stack/metrics-gen/gen.py, through the panel targets of demo/dashboard.template.json. The refId of a target is
 * its query name: lan_tx, lan_rx, wan_tx, wan_rx, speed, up, load, cpu, v4_samples and v4_nine.
 *
 * A link carries only `bind`. Each node has key=<job>. Each measured port has port=<device> (and cap=100M on the
 * WAN, tunnel and relay ports). The link takes the instrumented end, key and port from its two cells (reason `only`),
 * and the end sets the direction: tx is up and rx is down, so the halves follow the geometric direction of the
 * link (spec 3.8.2). The capacity of a LAN link is the speed series of the router port. The cells get these
 * attributes in fixtures/demo/demo-l3.yaml.
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
 * The L3 demo. LTE stays down (up=0); every cell and link end has a series, so the match report is empty. `links` is
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
        { kind: 'history', label: 'Three lines', query: 'v4_samples', unit: 'none', decimals: 0 },
        { kind: 'history', label: 'Nine lines', query: 'v4_nine', unit: 'none', decimals: 0 },
      ],
      url: '/d/drawiomap-demo?var-job=${key}',
      urlTitle: 'Host ${key}',
    },
  },
  overrides: {},
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
