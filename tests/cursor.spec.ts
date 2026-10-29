import type { ConfigV4 } from '../src/model/v4';
import { expect, test, testdataTarget } from './authoring-fixtures';

// A fictional portograph sheet: canvas, a group, two nodes with an icon, a link with a label and a legend.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360">
  <g data-cell-id="0" data-meta-pg-schema="1">
    <g data-cell-id="pg-layer~canvas"><g data-cell-id="pg-canvas"><rect width="600" height="360" fill="#f5f5f5"/></g></g>
    <g data-cell-id="pg-layer~diagram">
      <g data-cell-id="pg-group~core"><rect x="20" y="20" width="420" height="200" fill="#dae8fc" stroke="#6c8ebf"/></g>
      <g data-cell-id="pg-node~rtr-a" data-meta-pg-kind="node" data-meta-pg-id="rtr-a"><rect x="60" y="100" width="100" height="60" fill="#d5e8d4"/><text x="70" y="135">rtr-a</text></g>
      <g data-cell-id="pg-node~rtr-b" data-meta-pg-kind="node" data-meta-pg-id="rtr-b"><rect x="300" y="100" width="100" height="60" fill="#d5e8d4"/><text x="310" y="135">rtr-b</text></g>
      <g data-cell-id="pg-link~a-b" data-meta-pg-kind="link" data-meta-pg-id="a-b" data-meta-pg-from="rtr-a" data-meta-pg-to="rtr-b"><path d="M160 130 L300 130" fill="none" stroke="#888" stroke-width="6" pointer-events="stroke"/></g>
      <g data-cell-id="pg-icon~rtr-a" data-meta-pg-kind="node-icon" data-meta-pg-of="rtr-a"><ellipse cx="80" cy="115" rx="10" ry="10" fill="#666"/></g>
      <g data-cell-id="pg-linkLabel~a-b" data-meta-pg-kind="link-label" data-meta-pg-of="a-b"><rect x="205" y="110" width="50" height="16" fill="#fff"/><text x="208" y="122">uplink</text></g>
      <g data-cell-id="pg-legend"><rect x="460" y="260" width="120" height="80" fill="#fff" stroke="#999"/><text x="470" y="290">Legend</text></g>
    </g>
  </g>
</svg>`.replace(
  /data-cell-id="([^"]+)"/g,
  (tag, id: string) => `${tag} data-meta-bind="${id === 'pg-node~rtr-b' ? 'plain' : 'cards'}" data-meta-key="${id}"`
);

const cards: ConfigV4 = {
  version: 4,
  freshness: '3x',
  classes: {
    cards: { match: { key: 'job' }, rows: [{ kind: 'metadata', label: 'Element', text: '${id}' }] },
    plain: { match: { key: 'job' }, rows: [] },
  },
  overrides: {},
};

test('the hand cursor shows only on cells that open a card', async ({ page, createDiagram, gotoDashboardPage }) => {
  const uid = await createDiagram(cards, { svg });
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  const cursor = (id: string) =>
    panel
      .locator(`[data-cell-id="${id}"] > :is(rect, path, ellipse)`)
      .first()
      .evaluate((el) => getComputedStyle(el).cursor);
  await expect.poll(() => cursor('pg-node~rtr-a')).toBe('pointer');
  for (const id of ['pg-icon~rtr-a', 'pg-link~a-b', 'pg-linkLabel~a-b']) {
    expect(await cursor(id), id).toBe('pointer');
  }
  for (const id of ['pg-canvas', 'pg-group~core', 'pg-legend', 'pg-node~rtr-b']) {
    expect(await cursor(id), id).toBe('auto');
  }
});

test('in panel edit mode only the cells that open a card show the hand cursor; Tab reaches every cell after a refresh', async ({
  page,
  createDiagram,
  gotoPanelEditPage,
  selectors,
}) => {
  const uid = await createDiagram(cards, {
    svg,
    targets: [testdataTarget('A', { scenarioId: 'random_walk' })],
  });
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const panel = page.getByTestId('dmap-panel');
  const shape = (id: string) => panel.locator(`[data-cell-id="${id}"] > :is(rect, path, ellipse)`).first();
  const cursor = (id: string) => shape(id).evaluate((el) => getComputedStyle(el).cursor);
  // Panel edit keeps the view interactions. A cell without a card keeps its default cursor; a click selects nothing.
  await shape('pg-node~rtr-a').click();
  await page.keyboard.press('Escape');
  await expect(panel.locator('[data-dmap-selected="true"]')).toHaveCount(0);
  await expect.poll(() => cursor('pg-node~rtr-a')).toBe('pointer');
  expect(await cursor('pg-link~a-b')).toBe('pointer');
  for (const id of ['pg-canvas', 'pg-group~core', 'pg-legend', 'pg-node~rtr-b']) {
    expect(await cursor(id), id).toBe('auto');
  }
  // A data refresh redraws the patches. The cells without a card stay plain, and the cells with a card keep
  // their tab stop.
  const dmapCell = (id: string) => panel.locator(`[data-cell-id="${id}"]`);
  const refreshed = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/ds/query');
  await panelEditPage.getByGrafanaSelector(selectors.components.RefreshPicker.runButtonV2).click();
  await (await refreshed).finished();
  // the new data goes through a React render and the patch frame
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  for (const id of ['pg-canvas', 'pg-group~core', 'pg-legend', 'pg-node~rtr-b']) {
    await expect(dmapCell(id), id).not.toHaveAttribute('role', 'button');
    expect(await cursor(id), id).toBe('auto');
  }
  for (const id of ['pg-node~rtr-a', 'pg-link~a-b']) {
    await expect(dmapCell(id), id).toHaveAttribute('role', 'button');
    await expect(dmapCell(id), id).toHaveAttribute('tabindex', '0');
    expect(await cursor(id), id).toBe('pointer');
  }
  await dmapCell('pg-node~rtr-a').focus();
  await page.keyboard.press('Tab');
  await expect(dmapCell('pg-node~rtr-b')).not.toBeFocused();
  await expect(panel.locator('[data-cell-id]:focus')).toHaveCount(1);
});
