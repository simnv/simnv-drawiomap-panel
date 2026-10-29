import type { ConfigV4 } from '../src/model/v4';
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
</svg>`.replace(/data-cell-id="([^"]+)"/g, '$& data-meta-bind="cards" data-meta-key="$1"');

const cards: ConfigV4 = {
  version: 4,
  freshness: '3x',
  classes: {
    cards: { match: { key: 'job' }, rows: [{ kind: 'metadata', label: 'Element', text: '${id}' }] },
  },
  overrides: {},
};

/** Moves the mouse to a point of the element box, as fractions of its width and height. */
async function hoverAt(locator: Locator, fx = 0.5, fy = 0.5) {
  const box = (await locator.boundingBox())!;
  await locator.page().mouse.move(box.x + box.width * fx, box.y + box.height * fy);
}

test('the canvas, a group and the legend open no card; nodes and links do', async ({
  page,
  createDiagram,
  gotoDashboardPage,
}) => {
  const uid = await createDiagram(cards, { svg, targets: [] });
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
