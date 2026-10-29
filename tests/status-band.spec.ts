import type { ConfigV4 } from '../src/model/v4';
import { expect, test, promTarget } from './authoring-fixtures';

// One empty health query matches 26 fictional devices.
const COUNT = 26;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="330" viewBox="0 0 660 330">
  <g data-cell-id="0" data-meta-pg-schema="1">${Array.from(
    { length: COUNT },
    (_, i) =>
      `<g data-cell-id="device-${i}" data-meta-pg-id="device-${i}" data-meta-bind="health" data-meta-key="device-${i}" data-meta-pg-kind="node" data-meta-pg-schema="1" transform="translate(${(i % 7) * 95} ${Math.floor(i / 7) * 80})"><rect width="80" height="50" fill="#d5e8d4" stroke="#82b366"/><text x="8" y="30">Device ${i}</text></g>`
  ).join('')}</g>
</svg>`;

const emptyConfig: ConfigV4 = {
  version: 4,
  freshness: '3x',
  classes: { health: { match: { key: 'device' }, status: 'health' } },
  overrides: {},
};

test('stale cells get a Stale band row and the Stale legend entry, never their last fresh text', async ({
  page,
  createDiagram,
  gotoDashboardPage,
}, testInfo) => {
  // Each device has a value, and a freshness of 1 ms makes each sample stale at once (spec 3.5, A10).
  const config: ConfigV4 = {
    ...emptyConfig,
    classes: { health: { match: { key: 'device' }, status: 'health', freshness: '1ms' } },
  };
  const expr = Array.from(
    { length: COUNT },
    (_, i) => `label_replace(vector(1), "device", "device-${i}", "", "")`
  ).join(' or ');
  const uid = await createDiagram(config, { svg, targets: [promTarget('health', expr)] });
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  await expect(panel.locator('[data-cell-id^="device-"][data-dmap-status="stale"]')).toHaveCount(COUNT);
  const rows = panel.getByTestId('dmap-status-band').locator('.dmap-status-summary');
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute('title', `Stale · health: ${COUNT} cells`);
  await expect(rows).toHaveAttribute('data-dmap-state', 'stale');
  const legend = panel.getByTestId('dmap-legend');
  const handle = legend.getByRole('button', { name: 'Legend' });
  await handle.click();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  const state = legend.getByRole('group', { name: 'State', exact: true });
  await expect(state.getByTestId('dmap-legend-entry')).toHaveText(['Stale']);
  // no value block counts a stale cell
  await expect(legend.getByRole('group')).toHaveCount(1);
  const screenshot = testInfo.outputPath('band-stale.png');
  await panel.screenshot({ path: screenshot });
  await testInfo.attach('band-stale', { path: screenshot, contentType: 'image/png' });
});

// The narrow panel is the case that can go wrong: the text of the band wraps. The row logic is in unit tests.
for (const viewport of [{ name: 'narrow', width: 400, height: 800 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test('all queries empty: one band row for 26 cells, above the diagram and not on it', async ({
      page,
      createDiagram,
      gotoDashboardPage,
    }, testInfo) => {
      const uid = await createDiagram(emptyConfig, { svg, targets: [promTarget('health', 'absent(vector(1))')] });
      await gotoDashboardPage({ uid });
      const panel = page.getByTestId('dmap-panel');
      await expect(panel.locator('[data-cell-id^="device-"][data-dmap-status="missing"]')).toHaveCount(COUNT);
      const rows = panel.getByTestId('dmap-status-band').locator('.dmap-status-summary');
      // wait for the end of loading: then one row has all elements
      await expect(rows.and(panel.locator(`[title="No data · health: ${COUNT} cells"]`))).toBeVisible();
      await expect(rows).toHaveCount(1);
      await expect(rows).toHaveText(`?No data · health: ${COUNT} cells`);
      const band = (await panel.getByTestId('dmap-status-band').boundingBox())!;
      const stage = (await panel.getByTestId('dmap-stage').boundingBox())!;
      expect(band.y + band.height).toBeLessThanOrEqual(stage.y + 0.5);
      // no element of the diagram is under the band
      for (const cell of await panel.locator('[data-cell-id^="device-"] rect').all()) {
        const box = await cell.boundingBox();
        if (box) {
          expect(box.y).toBeGreaterThanOrEqual(band.y + band.height - 1);
        }
      }
      const screenshot = testInfo.outputPath(`band-${viewport.name}.png`);
      await panel.screenshot({ path: screenshot });
      await testInfo.attach(`band-${viewport.name}`, { path: screenshot, contentType: 'image/png' });
    });
  });
}
