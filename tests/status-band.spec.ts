import type { DiagramConfigV2 } from '../src/model/config';
import { binding, nativeQuery } from '../src/fixtures/authoring-config';
import { expect, test } from './authoring-fixtures';

// 26 fictional devices; each has its own query, so each has its own status condition.
const COUNT = 26;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="330" viewBox="0 0 660 330">
  <g data-cell-id="0" data-meta-pg-schema="1">${Array.from(
    { length: COUNT },
    (_, i) =>
      `<g data-cell-id="device-${i}" data-meta-pg-id="device-${i}" data-meta-pg-kind="node" data-meta-pg-schema="1" transform="translate(${(i % 7) * 95} ${Math.floor(i / 7) * 80})"><rect width="80" height="50" fill="#d5e8d4" stroke="#82b366"/><text x="8" y="30">Device ${i}</text></g>`
  ).join('')}</g>
</svg>`;

function emptyConfig(config: DiagramConfigV2): DiagramConfigV2 {
  return {
    ...config,
    queries: Array.from({ length: COUNT }, (_, i) => nativeQuery(`health-${i}`, 'absent(vector(1))')),
    patterns: [],
    widgets: [],
    overrides: Array.from({ length: COUNT }, (_, i) => ({
      cellId: `device-${i}`,
      display: {
        status: {
          kind: 'mapping',
          binding: binding(`health-${i}`),
          default: { state: 'normal', reason: 'Healthy' },
          mappings: [{ value: 0, state: 'down', reason: 'Health check failed' }],
        },
      },
    })),
  };
}

// The narrow panel is the case that can go wrong: the text of the band wraps. The row logic is in unit tests.
for (const viewport of [{ name: 'narrow', width: 400, height: 800 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test('all queries empty: one band row for 26 elements, above the diagram and not on it', async ({
      page,
      config,
      createDiagram,
      gotoDashboardPage,
    }, testInfo) => {
      const uid = await createDiagram(emptyConfig(config), { svg });
      await gotoDashboardPage({ uid });
      const panel = page.getByTestId('dmap-panel');
      await expect(panel.locator('[data-cell-id^="device-"][data-dmap-status="missing"]')).toHaveCount(COUNT);
      const rows = panel.getByTestId('dmap-status-band').locator('.dmap-status-summary');
      // wait for the end of loading: then one row has all elements
      await expect(rows.and(panel.locator(`[title="missing: No data (${COUNT} elements)"]`))).toBeVisible();
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText('No data');
      await expect(rows).toContainText(`${COUNT} elements`);
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
