/**
 * Builds provisioning/dashboards/demo.json from the template, the demo bindings (src/fixtures/demo-config.ts)
 * and the demo diagrams. Run: npm run build:dashboard
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { authoringConfig } from '../src/fixtures/authoring-config';
import { demoL3Config, handDrawnConfig } from '../src/fixtures/demo-config';

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
  { id: 1, svg: 'fixtures/demo/svg/demo-l3.svg', xml: 'fixtures/demo/demo-l3.drawio', config: demoL3Config },
  { id: 2, svg: 'fixtures/demo/svg/hand-drawn.svg', xml: 'fixtures/hand/hand-drawn.drawio', config: handDrawnConfig },
];

async function main() {
  const { sanitizeSvg } = await import('../src/render/sanitize');
  const { validateConfig } = await import('../src/model/config');
  const { fnv1a } = await import('../src/util/hash');

  const dashboard = JSON.parse(readFileSync(resolve(root, 'demo/dashboard.template.json'), 'utf8'));
  for (const spec of PANELS) {
    const svgRaw = readFileSync(resolve(root, spec.svg), 'utf8');
    const xml = readFileSync(resolve(root, spec.xml), 'utf8');
    const config = spec.config();
    const { diagnostics } = validateConfig(config);
    if (diagnostics.length) {
      throw new Error(`panel ${spec.id}: ${diagnostics.map((d) => `${d.path}: ${d.message}`).join('; ')}`);
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
      `panel ${spec.id}: svg ${Math.round(clean.svg.length / 1024)} KB (from ${Math.round(svgRaw.length / 1024)} KB), ${config.patterns.length} patterns`
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
    targets: [],
    fieldConfig: { defaults: {}, overrides: [] },
    options: {
      config: authoringConfig('victoriametrics', 'authoring-testdata'),
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
