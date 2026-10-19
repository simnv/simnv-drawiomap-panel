import type { Page } from '@playwright/test';
import type { DiagramConfigV2, NamedQuery } from '../src/model/config';
import { binding, nativeQuery } from '../src/fixtures/authoring-config';
import { expect, test } from './authoring-fixtures';

// Three fictional devices. Each device has its own query and status condition.
const COUNT = 3;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="330" height="80" viewBox="0 0 330 80">
  <g data-cell-id="0" data-meta-pg-schema="1">${Array.from(
    { length: COUNT },
    (_, i) =>
      `<g data-cell-id="device-${i}" data-meta-pg-id="device-${i}" data-meta-pg-kind="node" data-meta-pg-schema="1" transform="translate(${i * 110} 10)"><rect width="80" height="50" fill="#d5e8d4" stroke="#82b366"/><text x="8" y="30">Device ${i}</text></g>`
  ).join('')}</g>
</svg>`;

function statusConfig(config: DiagramConfigV2, queries: NamedQuery[]): DiagramConfigV2 {
  return {
    ...config,
    queries,
    patterns: [],
    widgets: [],
    overrides: queries.map((query, i) => ({
      cellId: `device-${i}`,
      display: {
        status: {
          kind: 'mapping',
          binding: binding(query.id),
          default: { state: 'normal', reason: 'Healthy' },
          mappings: [{ value: 0, state: 'down', reason: 'Health check failed' }],
        },
      },
    })),
  };
}

const kinds = {
  // Eager panel targets: the panel query runner keeps the last series while it loads.
  panel: (prometheus: string) => ({
    queries: Array.from({ length: COUNT }, (_, i): NamedQuery => ({
      id: `health-${i}`,
      name: `health-${i}`,
      source: { kind: 'panel', refId: `H${i}` },
    })),
    targets: Array.from({ length: COUNT }, (_, i) => ({
      refId: `H${i}`,
      datasource: { uid: prometheus, type: 'prometheus' },
      expr: 'vector(1)',
      range: true,
    })),
  }),
  // Lazy datasource queries: the diagram query controller runs them.
  datasource: () => ({
    queries: Array.from({ length: COUNT }, (_, i) => nativeQuery(`health-${i}`, 'vector(1)')),
    targets: [],
  }),
};

/** Delay every /api/ds/query response while the gate is closed. */
async function delayQueries(page: Page, ms: number) {
  const state = { delayed: 0 };
  await page.route('**/api/ds/query*', async (route) => {
    state.delayed++;
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue().catch(() => {}); // The page can cancel the request.
  });
  return state;
}

for (const kind of Object.keys(kinds) as Array<keyof typeof kinds>) {
  test.describe(`${kind} queries`, () => {
    let uid: string;
    test.beforeEach(async ({ request, config, readProvisionedDataSource }, testInfo) => {
      const prometheus = (await readProvisionedDataSource({ fileName: 'victoriametrics.yaml' })).uid;
      const { queries, targets } = kinds[kind](prometheus);
      uid = `refresh-${kind}-${testInfo.workerIndex}-${Date.now()}`;
      const response = await request.post('/api/dashboards/db', {
        data: {
          dashboard: {
            uid,
            title: uid,
            schemaVersion: 39,
            editable: true,
            time: { from: 'now-1h', to: 'now' },
            panels: [
              {
                id: 1,
                title: 'Sanitized refresh',
                type: 'simnv-drawiomap-panel',
                gridPos: { x: 0, y: 0, w: 24, h: 12 },
                targets,
                fieldConfig: { defaults: {}, overrides: [] },
                options: {
                  config: statusConfig(config, queries),
                  rules: [],
                  diagram: { svg, hash: uid },
                  zoom: { mode: 'fit', wheel: true, pan: true },
                },
              },
            ],
          },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
    });
    test.afterEach(async ({ request }) => {
      await request.delete(`/api/dashboards/uid/${uid}`);
    });

    test('first load shows loading, then the data', async ({ page, gotoDashboardPage }) => {
      // Grafana renders a panel with eager targets only after their first result.
      test.skip(kind === 'panel', 'The panel has no first-load state of its own.');
      const delayed = await delayQueries(page, 1500);
      await gotoDashboardPage({ uid });
      const panel = page.getByTestId('dmap-panel');
      await expect(panel.getByTestId('dmap-status-band')).toContainText('Loading data');
      await expect(panel.locator('[data-cell-id^="device-"][data-dmap-status="missing"]')).toHaveCount(COUNT);
      await expect(panel.locator('[data-cell-id^="device-"][data-dmap-status="normal"]')).toHaveCount(COUNT);
      await expect(panel.getByTestId('dmap-status-band').locator('.dmap-status-summary')).toHaveCount(0);
      expect(delayed.delayed).toBeGreaterThan(0);
    });

    test('refresh keeps the last data: no missing marker, no band row, no layout shift', async ({
      page,
      gotoDashboardPage,
      selectors,
    }) => {
      const dashboard = await gotoDashboardPage({ uid });
      const panel = page.getByTestId('dmap-panel');
      const devices = panel.locator('[data-cell-id^="device-"]');
      await expect(panel.locator('[data-cell-id^="device-"][data-dmap-status="normal"]')).toHaveCount(COUNT);
      const rows = panel.getByTestId('dmap-status-band').locator('.dmap-status-summary');
      await expect(rows).toHaveCount(0);
      const stage = panel.getByTestId('dmap-stage').locator('svg').first();
      const before = await stage.boundingBox();

      const delayed = await delayQueries(page, 1500);
      await dashboard.getByGrafanaSelector(selectors.components.RefreshPicker.runButtonV2).click();
      await expect.poll(() => delayed.delayed).toBeGreaterThan(0);
      // Sample the panel while the delayed responses are pending.
      const samples: Array<{ missing: number; rows: number; text: string[]; box: unknown }> = [];
      const until = Date.now() + 1200;
      while (Date.now() < until) {
        samples.push({
          missing: await devices.and(panel.locator('[data-dmap-status="missing"]')).count(),
          rows: await rows.count(),
          text: await panel.getByTestId('dmap-status-band').allTextContents(),
          box: await stage.boundingBox(),
        });
        await page.waitForTimeout(50);
      }
      expect(samples.length).toBeGreaterThan(5);
      expect(samples.filter((s) => s.missing || s.rows)).toEqual([]);
      expect(samples.filter((s) => JSON.stringify(s.box) !== JSON.stringify(before))).toEqual([]);
      await expect(panel.locator('[data-cell-id^="device-"][data-dmap-status="normal"]')).toHaveCount(COUNT);
    });
  });
}
