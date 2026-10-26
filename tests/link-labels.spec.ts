import fs from 'node:fs';
import type { DashboardPage } from '@grafana/plugin-e2e';
import { devices, type Locator } from '@playwright/test';
import type { DiagramConfig, LinkLabelMode } from '../src/model/config';
import { demoL3Config, handDrawnConfig } from '../src/fixtures/demo-config';
import { pointOnHalf, touch } from './authoring-controls';
import { expect, test } from './authoring-fixtures';

/*
 * The link value labels (docs/superpowers/specs/2026-10-25-link-value-labels-design.md, section 8). The demo L3
 * sheet and the hand-drawn sheet with the demo panel queries, the WAN pattern labelled; the provisioned demo
 * dashboard keeps the default (no labels).
 */

const ISP_A = 'pg-link~isp-a:pppoe->rtr-a:wan1';
// A desktop viewport in which the fitted L3 sheet (1113 × 638 units) renders at about 1 px per unit: at 1280 × 720 the
// panel height gives 0.78 px per unit, under the 7 px rule, and the layer hides (as it should).
test.use({ viewport: { width: 1600, height: 1000 } });
const SHOTS = process.env.DMAP_SCREENSHOTS; // a directory: write the screenshots there
const demoSvg = fs.readFileSync('fixtures/demo/svg/demo-l3.svg', 'utf8');
const handSvg = fs.readFileSync('fixtures/demo/svg/hand-drawn.svg', 'utf8');

/** The panel queries of the demo dashboard (demo/dashboard.template.json) against the provisioned datasource. */
const demoTargets = (datasource: { uid: string; type: string }) =>
  [
    ['A', 'rate(node_network_transmit_bytes_total{device!~"pppoe|dhcp|wan1|wan2|wan3"}[1m]) * 8'],
    ['W', 'rate(node_network_transmit_bytes_total{device=~"pppoe|dhcp|wan1|wan2|wan3"}[1m]) * 8'],
    ['S', 'node_network_speed_bytes'],
    ['C', 'up'],
    ['D', 'node_load1'],
    ['E', 'node_cpu_usage_percent'],
  ].map(([refId, expr]) => ({ refId, expr, datasource, legendFormat: `{{job}} {{device}}` }));
/** The WAN query has Max 100 Mb/s, as the demo dashboard; the LAN values are in bit/s with one decimal. */
const fieldConfig = {
  defaults: { unit: 'bps', decimals: 1 },
  overrides: [
    { matcher: { id: 'byFrameRefID', options: 'W' }, properties: [{ id: 'max', value: 100000000 }] },
    { matcher: { id: 'byFrameRefID', options: 'S' }, properties: [{ id: 'unit', value: 'Bps' }] },
  ],
};

const labelsOf = (panel: Locator) => panel.locator('text.dmap-link-label');
const label = (panel: Locator, cell: string, half: 'a2b' | 'b2a') =>
  panel.locator(`text.dmap-link-label[data-dmap-cell="${cell}"][data-dmap-half="${half}"]`);
const layerOf = (panel: Locator) => panel.locator('g.dmap-link-labels');

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box, tolerance = 1) =>
  a.x + tolerance < b.x + b.width &&
  b.x + tolerance < a.x + a.width &&
  a.y + tolerance < b.y + b.height &&
  b.y + tolerance < a.y + a.height;
/** The client boxes of the visible elements of a locator. */
async function boxes(locator: Locator): Promise<Box[]> {
  return locator.evaluateAll((els) =>
    els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
  );
}

/** Which side of its half a label stands on: the sign of the cross product with the nearest half segment. */
async function sideOf(panel: Locator, cell: string, half: 'a2b' | 'b2a') {
  return panel.locator(`[data-dmap-cell="${cell}"][data-dmap-half="${half}"]`).evaluateAll((els) => {
    const text = els.find((el) => el.localName === 'text') as SVGTextElement;
    const line = els.find((el) => el.localName === 'polyline') as SVGPolylineElement;
    const centre = { x: Number(text.getAttribute('x')), y: Number(text.getAttribute('y')) };
    const pts = (line.getAttribute('points') ?? '')
      .split(' ')
      .map((p) => p.split(',').map(Number))
      .map(([x, y]) => ({ x, y }));
    let best = { distance: Infinity, sign: 0 };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((centre.x - a.x) * dx + (centre.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const distance = Math.hypot(a.x + t * dx - centre.x, a.y + t * dy - centre.y);
      if (distance < best.distance) {
        // the sign against the reading direction (left to right, or bottom to top), not the drawing direction
        const forward = Math.abs(dx) <= 0.01 ? dy < 0 : dx > 0;
        best = { distance, sign: Math.sign((dx * (centre.y - a.y) - dy * (centre.x - a.x)) * (forward ? 1 : -1)) };
      }
    }
    return best.sign;
  });
}

/** The fixtures a labelled dashboard needs, by shape, so that a test passes its own destructured fixtures. */
interface LabelFixtures {
  createDiagram: (
    config: DiagramConfig,
    settings: {
      panels: Array<{ config: DiagramConfig; title?: string; svg?: string }>;
      targets: unknown[];
      fieldConfig: typeof fieldConfig;
      height: number;
      zoom: Record<string, unknown>;
      refresh?: string;
    }
  ) => Promise<string>;
  gotoDashboardPage: (args: { uid: string }) => Promise<DashboardPage>;
  readProvisionedDataSource: (args: { fileName: string }) => Promise<{ uid: string; type: string }>;
}

async function openLabelled(
  mode: LinkLabelMode,
  fixtures: LabelFixtures,
  settings: { zoom?: Record<string, unknown>; height?: number; refresh?: string } = {}
) {
  const { createDiagram, gotoDashboardPage, readProvisionedDataSource } = fixtures;
  const prom = await readProvisionedDataSource({ fileName: 'victoriametrics.yaml' });
  const datasource = { uid: prom.uid, type: prom.type };
  const uid = await createDiagram(demoL3Config(mode), {
    panels: [
      { config: demoL3Config(mode), svg: demoSvg, title: 'labels L3' },
      { config: handDrawnConfig('W', mode), svg: handSvg, title: 'labels hand-drawn' },
    ],
    targets: demoTargets(datasource),
    fieldConfig,
    height: settings.height ?? 18,
    zoom: settings.zoom ?? { mode: 'fit', wheel: true, pan: true },
    refresh: settings.refresh,
  });
  const dashboardPage = await gotoDashboardPage({ uid });
  const panel = (await dashboardPage.getPanelByTitle('labels L3')).locator;
  const hand = (await dashboardPage.getPanelByTitle('labels hand-drawn')).locator;
  await expect(label(panel, ISP_A, 'a2b')).toHaveAttribute('data-dmap-placed-at', /\d+/);
  /** Grafana renders a panel below the fold when it scrolls into view: bring the hand-drawn panel up and wait. */
  const showHand = async () => {
    await hand.scrollIntoViewIfNeeded();
    await expect(label(hand, 'edge-ab', 'a2b')).toHaveAttribute('data-dmap-placed-at', /\d+/);
  };
  return { uid, dashboardPage, panel, hand, showHand };
}

test('percent: each WAN half reads its percent, both labels on one side of the edge', async ({
  createDiagram,
  gotoDashboardPage,
  readProvisionedDataSource,
}) => {
  const { panel } = await openLabelled('percent', { createDiagram, gotoDashboardPage, readProvisionedDataSource });
  await expect(label(panel, ISP_A, 'a2b')).toHaveText('41%');
  await expect(label(panel, ISP_A, 'b2a')).toHaveText(/^\d+%$/);
  await expect(label(panel, ISP_A, 'a2b')).toHaveAttribute('data-dmap-mode', 'percent');
  expect(await sideOf(panel, ISP_A, 'a2b')).toBe(await sideOf(panel, ISP_A, 'b2a'));
  // no LAN label: the pattern of the LAN links has no label key; the four WAN links have two halves each
  await expect(labelsOf(panel)).toHaveCount(8);
  for (const el of await labelsOf(panel).all()) {
    expect(await el.getAttribute('data-dmap-cell')).toMatch(/rtr-(a|b):(wan1|wan2|wan3|pppoe)$/);
  }
  if (SHOTS) {
    await panel.screenshot({ path: `${SHOTS}/link-labels-percent.png` });
  }
});

test('value: the a2b text of the WAN link is the reading in the unit of the field', async ({
  createDiagram,
  gotoDashboardPage,
  readProvisionedDataSource,
}) => {
  const { panel, hand, showHand } = await openLabelled('value', {
    createDiagram,
    gotoDashboardPage,
    readProvisionedDataSource,
  });
  await expect(label(panel, ISP_A, 'a2b')).toHaveText(/^41(\.\d)? Mb\/s$/);
  await expect(label(panel, ISP_A, 'a2b')).toHaveAttribute('data-dmap-mode', 'value');
  if (SHOTS) {
    await panel.screenshot({ path: `${SHOTS}/link-labels-value.png` });
  }
  await showHand();
  await expect(label(hand, 'edge-ab', 'a2b')).toHaveText(/^41(\.\d)? Mb\/s$/);
});

test('no label overlaps a port pill, a label chip, a status marker or a plain node body', async ({
  createDiagram,
  gotoDashboardPage,
  readProvisionedDataSource,
}) => {
  const { panel, hand, showHand } = await openLabelled('percent', {
    createDiagram,
    gotoDashboardPage,
    readProvisionedDataSource,
  });
  const placed = await boxes(labelsOf(panel).locator('visible=true'));
  expect(placed.length).toBeGreaterThan(4);
  const pills = await boxes(panel.locator('g[data-cell-id^="pg-port"] rect'));
  const chips = await boxes(panel.locator('g[data-cell-id^="pg-linkLabel"]'));
  const markers = await boxes(panel.locator('.dmap-status-marker text'));
  for (const box of placed) {
    for (const other of [...pills, ...chips, ...markers]) {
      expect(intersects(box, other), JSON.stringify({ box, other })).toBe(false);
    }
  }
  // the labels do not overlap each other either
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      expect(intersects(placed[i], placed[j]), JSON.stringify([placed[i], placed[j]])).toBe(false);
    }
  }
  // the hand-drawn sheet: no label on a node body
  await showHand();
  const handLabels = await boxes(labelsOf(hand).locator('visible=true'));
  expect(handLabels.length).toBeGreaterThan(0);
  const bodies = await boxes(hand.locator('g[data-cell-id^="node-"] :is(rect, ellipse)'));
  for (const box of handLabels) {
    for (const body of bodies) {
      expect(intersects(box, body), JSON.stringify({ box, body })).toBe(false);
    }
  }
});

test('a tap on a label opens the card of its link, not of the group under it', async ({
  createDiagram,
  gotoDashboardPage,
  readProvisionedDataSource,
}) => {
  const { panel } = await openLabelled('percent', { createDiagram, gotoDashboardPage, readProvisionedDataSource });
  const target = label(panel, ISP_A, 'a2b');
  await target.click({ force: true });
  const dialog = panel.getByRole('dialog');
  await expect(dialog).toContainText('isp-a ↔ rtr-a');
  await expect(dialog).toContainText(/41(\.\d)? Mb\/s · 41%/);
});

test('a dashboard refresh keeps every label element and its transform', async ({
  createDiagram,
  gotoDashboardPage,
  readProvisionedDataSource,
  page,
  selectors,
}) => {
  const { panel, dashboardPage } = await openLabelled('percent', {
    createDiagram,
    gotoDashboardPage,
    readProvisionedDataSource,
  });
  const read = () =>
    labelsOf(panel).evaluateAll((els) =>
      els.map((el) => [
        el.getAttribute('data-dmap-cell'),
        el.getAttribute('data-dmap-half'),
        el.getAttribute('transform'),
        el.getAttribute('data-dmap-placed-at'),
      ])
    );
  const before = await read();
  expect(before.length).toBeGreaterThan(4);
  const refreshed = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/api/ds/query'));
  await dashboardPage.getByGrafanaSelector(selectors.components.RefreshPicker.runButtonV2).click();
  await (await refreshed).finished();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(label(panel, ISP_A, 'a2b')).toHaveText('41%');
  expect(await read()).toEqual(before);
});

test('the provisioned demo dashboard has no label: the key is absent', async ({ gotoDashboardPage }) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = (await dashboardPage.getPanelByTitle('demo-lab L3')).locator;
  await expect(panel.locator(`polyline.dmap-half[data-dmap-cell="${ISP_A}"]`)).toHaveCount(2);
  await expect(labelsOf(panel)).toHaveCount(0);
  await expect(layerOf(panel)).toHaveCount(0);
});

test.describe('phone', () => {
  // Chromium with the Pixel 5 viewport, touch and no hover.
  const { defaultBrowserType: _chromium, ...pixel } = devices['Pixel 5'];
  test.use(pixel);

  test('in Fit the layer is hidden on the first frame; a pinch to 5× shows it', async ({
    page,
    createDiagram,
    gotoDashboardPage,
    readProvisionedDataSource,
  }) => {
    const { panel } = await openLabelled(
      'percent',
      { createDiagram, gotoDashboardPage, readProvisionedDataSource },
      { height: 14 }
    );
    const layer = layerOf(panel);
    await expect(layer).toHaveAttribute('visibility', 'hidden');
    // a pinch on the WAN link, so the zoomed view holds its labels
    const { x: cx, y: cy } = await pointOnHalf(
      panel.locator(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${ISP_A}"]`)
    );
    await touch(
      page,
      [
        { x: cx - 20, y: cy },
        { x: cx + 20, y: cy },
      ],
      [
        { x: cx - 100, y: cy },
        { x: cx + 100, y: cy },
      ]
    );
    await expect(layer).not.toHaveAttribute('visibility', 'hidden');
    await expect(label(panel, ISP_A, 'a2b')).toBeVisible();
    if (SHOTS) {
      await panel.screenshot({ path: `${SHOTS}/link-labels-phone-zoomed.png` });
    }
  });

  test('a minimum scale of 1.3 shows the labels at load', async ({
    createDiagram,
    gotoDashboardPage,
    readProvisionedDataSource,
  }) => {
    const { panel } = await openLabelled(
      'percent',
      { createDiagram, gotoDashboardPage, readProvisionedDataSource },
      {
        height: 14,
        zoom: { mode: 'fit', wheel: true, pan: true, minScale: 1.3 },
      }
    );
    await expect(layerOf(panel)).not.toHaveAttribute('visibility', 'hidden');
    await expect(label(panel, ISP_A, 'a2b')).toBeVisible();
  });
});

test('an HTML edge label (a 100% foreignObject) does not drop the labels and no label stands on its text', async ({
  createDiagram,
  gotoDashboardPage,
  readProvisionedDataSource,
}) => {
  const prom = await readProvisionedDataSource({ fileName: 'victoriametrics.yaml' });
  const datasource = { uid: prom.uid, type: prom.type };
  const legacySvg = fs.readFileSync('fixtures/demo/svg/legacy-html-labels.svg', 'utf8');
  const uid = await createDiagram(demoL3Config('percent'), {
    panels: [{ config: demoL3Config('percent'), svg: legacySvg, title: 'labels html' }],
    targets: demoTargets(datasource),
    fieldConfig,
    height: 18,
    zoom: { mode: 'fit', wheel: true, pan: true },
  });
  const dashboardPage = await gotoDashboardPage({ uid });
  const panel = (await dashboardPage.getPanelByTitle('labels html')).locator;
  await expect(label(panel, ISP_A, 'a2b')).toHaveAttribute('data-dmap-placed-at', /\d+/);
  // the sheet has HTML labels in 100% x 100% foreignObjects, and the labels are not all dropped
  expect(await panel.locator('foreignObject[width="100%"]').count()).toBeGreaterThan(0);
  const placed = await boxes(labelsOf(panel).locator('visible=true'));
  const total = await labelsOf(panel).count();
  const dropped = Number(await layerOf(panel).getAttribute('data-dmap-labels-dropped'));
  expect(total, `dropped ${dropped}`).toBeGreaterThan(0);
  // the same sheet with plain labels places all eight halves (two of them have no data and stay hidden)
  expect(total).toBe(8);
  expect(dropped).toBe(0);
  expect(placed.length).toBeGreaterThan(4);
  // none sits on the text of an HTML label (the innermost text blocks of the foreignObjects)
  const texts = await boxes(panel.locator('foreignObject div:not(:has(div))'));
  expect(texts.length).toBeGreaterThan(0);
  for (const box of placed) {
    for (const text of texts) {
      expect(intersects(box, text), JSON.stringify({ box, text })).toBe(false);
    }
  }
});
