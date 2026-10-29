/**
 * Builds provisioning/dashboards/demo.json from the template, the v4 demo configs (src/fixtures/demo-config.ts,
 * src/fixtures/authoring-config.ts) and the demo diagrams. The template holds the panel targets of the demo panels;
 * this script adds the targets of the authoring panel. Run: npm run build:dashboard
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { authoringConfigV4 } from '../src/fixtures/authoring-config';
import { demoConfigV4, handDrawnConfigV4 } from '../src/fixtures/demo-config';

const root = process.cwd(); // npm scripts run from the repo root
const dom = new JSDOM('');
// DOMPurify picks up `window` when its module loads, so set the globals before the dynamic imports.
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

const PANELS = [
  { id: 1, svg: 'fixtures/demo/svg/demo-l3.svg', xml: 'fixtures/demo/demo-l3.drawio', config: demoConfigV4 },
  { id: 2, svg: 'fixtures/demo/svg/hand-drawn.svg', xml: 'fixtures/hand/hand-drawn.drawio', config: handDrawnConfigV4 },
];

const PROMETHEUS = { type: 'prometheus', uid: 'victoriametrics' };
const TESTDATA = { type: 'grafana-testdata-datasource', uid: 'authoring-testdata' };
/** One constant series with a device label for each router of the authoring diagram. */
const perRouter = (value: string) =>
  ['router-1', 'router-2']
    .map((device) => `label_replace(vector(${value}), "device", "${device}", "", "")`)
    .join(' or ');
/** The panel targets of the authoring panel: the refIds of src/fixtures/authoring-config.ts. */
const AUTHORING_TARGETS = [
  { refId: 'health', datasource: PROMETHEUS, expr: perRouter('1'), legendFormat: '{{device}}' },
  { refId: 'detail', datasource: PROMETHEUS, expr: perRouter('$site'), legendFormat: '{{device}}' },
  {
    refId: 'trend',
    datasource: TESTDATA,
    scenarioId: 'random_walk',
    seriesCount: 1,
    labels: 'device=trend',
    alias: 'Sanitized trend',
  },
  // synthetic traffic from stack/metrics-gen: the transmit and receive rate of one port, in bit/s
  {
    refId: 'tx',
    datasource: PROMETHEUS,
    expr: 'rate(node_network_transmit_bytes_total{job="node-rtr-a",device="wan1"}[1m]) * 8',
  },
  {
    refId: 'rx',
    datasource: PROMETHEUS,
    expr: 'rate(node_network_receive_bytes_total{job="node-rtr-a",device="wan1"}[1m]) * 8',
  },
];
/** The health of a router: 1 is up (green), 0 is down (red). */
const HEALTH_OVERRIDE = {
  matcher: { id: 'byFrameRefID', options: 'health' },
  properties: [
    { id: 'unit', value: 'none' },
    {
      id: 'thresholds',
      value: {
        mode: 'absolute',
        steps: [
          { color: 'red', value: null },
          { color: 'green', value: 1 },
        ],
      },
    },
    {
      id: 'mappings',
      value: [{ type: 'value', options: { '0': { text: 'Health check failed' }, '1': { text: 'Healthy' } } }],
    },
  ],
};

async function main() {
  const { sanitizeSvg } = await import('../src/render/sanitize');
  const { validateConfig } = await import('../src/model/validate');
  const { fnv1a } = await import('../src/util/hash');

  const dashboard = JSON.parse(readFileSync(resolve(root, 'demo/dashboard.template.json'), 'utf8'));
  for (const spec of PANELS) {
    const svgRaw = readFileSync(resolve(root, spec.svg), 'utf8');
    const xml = readFileSync(resolve(root, spec.xml), 'utf8');
    const config = spec.config;
    const { report } = validateConfig(config);
    if (report.length) {
      throw new Error(`panel ${spec.id}: ${JSON.stringify(report)}`);
    }
    const clean = sanitizeSvg(svgRaw);
    const panel = dashboard.panels.find((p: { id: number }) => p.id === spec.id);
    panel.options.config = config;
    panel.options.diagram = {
      xml,
      svg: clean.svg,
      hash: fnv1a(clean.svg + xml),
      updatedAt: '2026-10-17T00:00:00.000Z',
    };
    console.log(
      `panel ${spec.id}: svg ${Math.round(clean.svg.length / 1024)} KB (from ${Math.round(svgRaw.length / 1024)} KB), ${Object.keys(config.classes).length} classes`
    );
  }
  const authoringSvg = sanitizeSvg(readFileSync(resolve(root, 'src/fixtures/authoring.svg'), 'utf8')).svg;
  const authoringXml = readFileSync(resolve(root, 'src/fixtures/authoring.drawio'), 'utf8');
  dashboard.templating.list.push({
    name: 'site',
    type: 'custom',
    query: '23,47',
    current: { text: '23', value: '23' },
    options: [
      { text: '23', value: '23', selected: true },
      { text: '47', value: '47' },
    ],
  });
  dashboard.panels.push({
    id: 3,
    title: 'Sanitized authoring topology',
    type: 'simnv-drawiomap-panel',
    gridPos: { x: 0, y: 40, w: 24, h: 16 },
    datasource: { type: 'datasource', uid: '-- Mixed --' },
    targets: AUTHORING_TARGETS,
    fieldConfig: { defaults: {}, overrides: [HEALTH_OVERRIDE] },
    options: {
      config: authoringConfigV4,
      diagram: {
        svg: authoringSvg,
        xml: authoringXml,
        hash: fnv1a(authoringSvg + authoringXml),
        updatedAt: '2026-10-18',
      },
      zoom: { mode: 'fit', wheel: true, pan: true },
    },
  });
  const out = resolve(root, 'provisioning/dashboards/demo.json');
  writeFileSync(out, JSON.stringify(dashboard, null, 2) + '\n');
  console.log(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
