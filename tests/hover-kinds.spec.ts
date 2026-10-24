import type { DiagramConfigV2 } from '../src/model/config';
import type { Locator } from '@playwright/test';
import { expect, test } from './authoring-fixtures';

// A fictional portograph sheet: canvas, a group with a title, two nodes, a link and a legend.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360">
  <g data-cell-id="0" data-meta-pg-schema="1">
    <g data-cell-id="pg-layer~canvas"><g data-cell-id="pg-canvas"><rect width="600" height="360" fill="#f5f5f5"/></g></g>
    <g data-cell-id="pg-layer~diagram">
      <g data-cell-id="pg-group~core"><rect x="20" y="20" width="420" height="200" fill="#dae8fc" stroke="#6c8ebf"/></g>
      <g data-cell-id="pg-groupTitle~core"><text x="30" y="40">CORE</text></g>
      <g data-cell-id="pg-node~rtr-a" data-meta-pg-kind="node" data-meta-pg-id="rtr-a" data-meta-role="router"><rect x="60" y="100" width="100" height="60" fill="#d5e8d4" stroke="#82b366"/><text x="70" y="135">rtr-a</text></g>
      <g data-cell-id="pg-node~rtr-b" data-meta-pg-kind="node" data-meta-pg-id="rtr-b" data-meta-role="router"><rect x="300" y="100" width="100" height="60" fill="#d5e8d4" stroke="#82b366"/><text x="310" y="135">rtr-b</text></g>
      <g data-cell-id="pg-link~a-b" data-meta-pg-kind="link" data-meta-pg-id="a-b" data-meta-pg-from="rtr-a" data-meta-pg-to="rtr-b"><path d="M160 130 L300 130" fill="none" stroke="#888" stroke-width="6" pointer-events="stroke"/></g>
      <g data-cell-id="pg-icon~rtr-a" data-meta-pg-kind="node-icon" data-meta-pg-of="rtr-a"><ellipse cx="80" cy="115" rx="10" ry="10" fill="#666"/></g>
      <g data-cell-id="pg-linkLabel~a-b" data-meta-pg-kind="link-label" data-meta-pg-of="a-b"><rect x="205" y="110" width="50" height="16" fill="#fff"/><text x="208" y="122">uplink</text></g>
      <g data-cell-id="pg-legend"><rect x="460" y="260" width="120" height="80" fill="#fff" stroke="#999"/><text x="470" y="290">Legend</text></g>
    </g>
  </g>
</svg>`;

function cardsForAll(config: DiagramConfigV2): DiagramConfigV2 {
  return {
    ...config,
    queries: [],
    widgets: [],
    overrides: [],
    // every cell has a card row, so only Hover kinds decides
    patterns: [
      {
        id: 'all',
        name: 'All cells',
        select: {},
        display: { hover: { rows: [{ kind: 'metadata', label: 'Element', path: 'cell.id' }] } },
      },
    ],
  };
}

/** Moves the mouse to a point of the element box, as fractions of its width and height. */
async function hoverAt(locator: Locator, fx = 0.5, fy = 0.5) {
  const box = (await locator.boundingBox())!;
  await locator.page().mouse.move(box.x + box.width * fx, box.y + box.height * fy);
}

test('the canvas, a group and the legend open no card; nodes and links do', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  const uid = await createDiagram(cardsForAll(config), { svg });
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  const card = panel.getByTestId('dmap-card');
  const shape = (id: string) => panel.locator(`[data-cell-id="${id}"] > rect, [data-cell-id="${id}"] > path`).first();
  await hoverAt(shape('pg-node~rtr-a'));
  await expect(panel.getByRole('tooltip')).toHaveAttribute('aria-label', 'rtr-a');
  await hoverAt(shape('pg-link~a-b'), 0.2, 0.5);
  await expect(panel.getByRole('tooltip')).toHaveAttribute('aria-label', 'rtr-a ↔ rtr-b');
  // the empty background (bottom-left corner), the free area of the group, the legend
  await hoverAt(shape('pg-canvas'), 0.02, 0.97);
  await expect(card).toHaveCount(0);
  await hoverAt(shape('pg-group~core'), 0.4, 0.9);
  await expect(card).toHaveCount(0);
  await hoverAt(shape('pg-legend'));
  await expect(card).toHaveCount(0);
  // a click does not pin a card either
  await hoverAt(shape('pg-canvas'), 0.02, 0.97);
  await page.mouse.down();
  await page.mouse.up();
  await expect(card).toHaveCount(0);
});

test('Hover kinds: group added, link removed', async ({ page, request, config, createDiagram, gotoDashboardPage }) => {
  const uid = await createDiagram(cardsForAll(config), { svg });
  const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
  saved.dashboard.panels[0].options.hover = { kinds: ['node', 'group'] };
  const response = await request.post('/api/dashboards/db', { data: { dashboard: saved.dashboard, overwrite: true } });
  expect(response.ok(), await response.text()).toBe(true);
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  const shape = (id: string) => panel.locator(`[data-cell-id="${id}"] > rect, [data-cell-id="${id}"] > path`).first();
  await hoverAt(shape('pg-node~rtr-a'));
  await expect(panel.getByRole('tooltip')).toHaveAttribute('aria-label', 'rtr-a');
  await hoverAt(shape('pg-link~a-b'), 0.2, 0.5);
  await expect(panel.getByTestId('dmap-card')).toHaveCount(0);
  await hoverAt(shape('pg-group~core'), 0.4, 0.9);
  await expect(panel.getByRole('tooltip')).toHaveAttribute('aria-label', 'core');
});

test('the icon of a node and the label of a link open the card of the node and of the link', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  const uid = await createDiagram(cardsForAll(config), { svg });
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  const tooltip = panel.getByRole('tooltip');
  await hoverAt(panel.locator('[data-cell-id="pg-node~rtr-a"] > rect'), 0.8, 0.8);
  await expect(tooltip).toHaveAttribute('aria-label', 'rtr-a');
  const node = await tooltip.textContent();
  expect(node).toContain('pg-node~rtr-a');
  await hoverAt(panel.locator('[data-cell-id="pg-icon~rtr-a"] > ellipse'));
  await expect(tooltip).toHaveAttribute('aria-label', 'rtr-a');
  await expect(tooltip).toHaveText(node!);
  await hoverAt(panel.locator('[data-cell-id="pg-linkLabel~a-b"] > rect'));
  await expect(tooltip).toContainText('pg-link~a-b');
  await expect(tooltip).not.toContainText('pg-linkLabel');
});

// Two labelled nodes, a port on each and a link between the ports. The link label is empty.
const titleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" viewBox="0 0 600 240">
  <g data-cell-id="0" data-meta-pg-schema="1">
    <g data-cell-id="pg-node~sw" data-meta-pg-kind="node" data-meta-pg-id="sw"><rect x="40" y="80" width="140" height="80" fill="#d5e8d4" stroke="#82b366"/><text x="50" y="100">Switch-A</text></g>
    <g data-cell-id="pg-node~ap" data-meta-pg-kind="node" data-meta-pg-id="ap"><rect x="400" y="80" width="140" height="80" fill="#d5e8d4" stroke="#82b366"/><text x="410" y="100">AP-1</text></g>
    <g data-cell-id="pg-port~sw~p9~1" data-meta-pg-kind="port" data-meta-pg-id="sw:p9" data-meta-pg-node="sw" data-meta-pg-port="p9"><rect x="160" y="110" width="30" height="20" fill="#fff" stroke="#333"/><text x="164" y="124">p9</text></g>
    <g data-cell-id="pg-link~sw-p9-ap" data-meta-pg-kind="link" data-meta-pg-id="sw:p9->ap" data-meta-pg-from="sw:p9" data-meta-pg-to="ap"><path d="M190 120 L400 120" fill="none" stroke="#888" stroke-width="6" pointer-events="stroke"/></g>
  </g>
</svg>`;

test('a port card and a link card have a readable title', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  const uid = await createDiagram(cardsForAll(config), { svg: titleSvg });
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  await hoverAt(panel.locator('[data-cell-id="pg-port~sw~p9~1"] > rect'));
  await expect(panel.getByRole('tooltip')).toHaveAttribute('aria-label', 'Switch-A p9');
  await hoverAt(panel.locator('[data-cell-id="pg-link~sw-p9-ap"] > path').first(), 0.5, 0.5);
  await expect(panel.getByRole('tooltip')).toHaveAttribute('aria-label', 'Switch-A p9 ↔ AP-1');
});
