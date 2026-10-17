/**
 * Builds provisioning/dashboards/demo.json from the template, the demo rules
 * and the demo-l3 fixture. Run: npm run build:dashboard
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

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
  { id: 1, svg: 'fixtures/demo/svg/demo-l3.svg', xml: 'fixtures/demo/demo-l3.drawio', rules: 'demo/rules.yaml' },
  { id: 2, svg: 'fixtures/demo/svg/hand-drawn.svg', xml: 'fixtures/hand/hand-drawn.drawio', rules: 'demo/rules-hand.yaml' },
];

async function main() {
  const { sanitizeSvg } = await import('../src/render/sanitize');
  const { parseRulesYaml } = await import('../src/rules/schema');
  const { fnv1a } = await import('../src/util/hash');

  const dashboard = JSON.parse(readFileSync(resolve(root, 'demo/dashboard.template.json'), 'utf8'));
  for (const spec of PANELS) {
    const svgRaw = readFileSync(resolve(root, spec.svg), 'utf8');
    const xml = readFileSync(resolve(root, spec.xml), 'utf8');
    const rules = parseRulesYaml(readFileSync(resolve(root, spec.rules), 'utf8'));
    if (!rules.rules) {
      throw new Error(`${spec.rules}: ${rules.errors.join('; ')}`);
    }
    const clean = sanitizeSvg(svgRaw);
    const panel = dashboard.panels.find((p: { id: number }) => p.id === spec.id);
    panel.options.rules = rules.rules;
    panel.options.diagram = { xml, svg: clean.svg, hash: fnv1a(clean.svg + xml), updatedAt: '2026-10-17T00:00:00.000Z' };
    console.log(`panel ${spec.id}: svg ${Math.round(clean.svg.length / 1024)} KB (from ${Math.round(svgRaw.length / 1024)} KB), ${rules.rules.length} rules`);
  }
  const out = resolve(root, 'provisioning/dashboards/demo.json');
  writeFileSync(out, JSON.stringify(dashboard, null, 2) + '\n');
  console.log(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
