import type { Page } from '@playwright/test';
import type { ConfigV4 } from '../src/model/v4';
import { expect, observeQueries, promTarget, quietNetwork, test, testdataTarget } from './authoring-fixtures';

// Three fictional devices. Each device has its own health series; the class `devices` reads them by the key.
const COUNT = 3;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="330" height="80" viewBox="0 0 330 80">
  <g data-cell-id="0" data-meta-pg-schema="1">${Array.from(
    { length: COUNT },
    (_, i) =>
      `<g data-cell-id="device-${i}" data-meta-pg-id="device-${i}" data-meta-pg-kind="node" data-meta-pg-schema="1" data-meta-bind="devices" data-meta-key="device-${i}" transform="translate(${i * 110} 10)"><rect width="80" height="50" fill="#d5e8d4" stroke="#82b366"/><text x="8" y="30">Device ${i}</text></g>`
  ).join('')}</g>
</svg>`;

const statusConfig: ConfigV4 = {
  version: 4,
  freshness: '3x',
  classes: { devices: { match: { key: 'device' }, status: 'health' } },
  overrides: {},
};
/** Eager panel targets: the panel query runner keeps the last series while it loads. */
const targets = [
  promTarget(
    'health',
    Array.from({ length: COUNT }, (_, i) => `label_replace(vector(1), "device", "device-${i}", "", "")`).join(' or '),
    { range: true }
  ),
];

/** Hold every /api/ds/query request until release() runs. A fixed delay is slower and can end before the assertions. */
async function holdQueries(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { held: 0, release };
  await page.route('**/api/ds/query*', async (route) => {
    state.held++;
    await gate;
    await route.continue().catch(() => {}); // The page can cancel the request.
  });
  return state;
}

// The panel queries only: P1 has no queries of its own (spec 6.5). Grafana renders a panel with eager targets only
// after their first result, so the panel has no first-load state of its own.
test.describe('panel queries', () => {
  let uid: string;
  test.beforeEach(async ({ request }, testInfo) => {
    uid = `refresh-panel-${testInfo.workerIndex}-${Date.now()}`;
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
                config: statusConfig,
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

    const held = await holdQueries(page);
    try {
      await dashboard.getByGrafanaSelector(selectors.components.RefreshPicker.runButtonV2).click();
      await expect.poll(() => held.held).toBeGreaterThan(0);
      // Sample the panel while the responses are pending.
      const samples: Array<{ missing: number; rows: number; text: string[]; box: unknown }> = [];
      // A fixed number of samples: a time window gives too few of them on a loaded machine.
      while (samples.length < 10) {
        samples.push({
          missing: await devices.and(panel.locator('[data-dmap-status="missing"]')).count(),
          rows: await rows.count(),
          text: await panel.getByTestId('dmap-status-band').allTextContents(),
          box: await stage.boundingBox(),
        });
        await page.waitForTimeout(50);
      }
      expect(samples.filter((s) => s.missing || s.rows)).toEqual([]);
      expect(samples.filter((s) => JSON.stringify(s.box) !== JSON.stringify(before))).toEqual([]);
    } finally {
      held.release();
    }
    await expect(panel.locator('[data-cell-id^="device-"][data-dmap-status="normal"]')).toHaveCount(COUNT);
  });
});

// The split editor reads the data of the panel and runs no query (spec 5.1). v4 has no hold of the panel behind the
// popup: a refresh updates the panel and the popup stage, and the draft stays.
test.describe('popup open', () => {
  test('a refresh while the split editor is open runs only the panel query, updates both stages and keeps the draft', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
    selectors,
  }) => {
    // The authoring link reads one random walk in both directions; its card shows the value.
    const live: ConfigV4 = {
      ...config,
      classes: {
        'directional-link': {
          match: { key: 'job', port: 'device' },
          up: 'A',
          down: 'A',
          rows: [{ kind: 'value', label: 'Walk', query: 'A' }],
        },
      },
    };
    const uid = await createDiagram(live, {
      targets: [
        testdataTarget('A', { scenarioId: 'random_walk', seriesCount: 1, labels: 'job=node-rtr-a,device=wan1' }),
      ],
    });
    const requests = observeQueries(page, uid);
    // The last value of the walk in each response, in order: the latest result is the last one.
    const values: number[] = [];
    page.on('response', async (response) => {
      if (!new URL(response.url()).pathname.endsWith('/api/ds/query')) {
        return;
      }
      try {
        const body = await response.json();
        const column = body.results?.A?.frames?.[0]?.data?.values?.[1] as number[] | undefined;
        if (column?.length) {
          values.push(column[column.length - 1]);
        }
      } catch {
        // a request that the page cancelled has no body
      }
    });
    const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    // Grafana limits the dashboard timer to 5 s (min_refresh_interval), so three timer ticks cost 15 s. The Refresh
    // button runs the same refresh at once. The popup covers it, so dispatch the click on the button directly.
    const refreshButton = panelEditPage.getByGrafanaSelector(selectors.components.RefreshPicker.runButtonV2);
    const refresh = async () => {
      const answered = values.length;
      await refreshButton.dispatchEvent('click');
      await expect.poll(() => values.length).toBeGreaterThan(answered);
    };
    const panel = page.getByTestId('dmap-panel');
    await expect(panel.locator('polyline.dmap-half').first()).toBeAttached();

    await page.getByTestId('dmap-edit-bindings').click();
    const popup = page.getByTestId('dmap-bindings-popup');
    const lines = popup.getByTestId('data-testid Code editor container').locator('.view-lines');
    await expect(lines).toContainText('version: 4', { timeout: 30_000 });
    const popupStage = popup.getByTestId('dmap-popup-stage');
    await expect(popupStage.locator('polyline.dmap-half').first()).toBeAttached();
    // A draft: a comment on the first line. The stored form has no comments, so the text differs from the saved one.
    await lines.locator('.view-line').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.type('# draft');
    await page.keyboard.press('Enter');
    await expect(lines.locator('.view-line').first()).toHaveText('# draft');
    // A mark on the dialog: a new dialog would not have it.
    await popup.evaluate((el) => el.setAttribute('data-dmap-test-mark', 'before-refresh'));

    // Count every change under the panel and under the popup stage: an attribute, a node, a text.
    for (const [name, stage] of [
      ['panel', panel],
      ['popup', popupStage],
    ] as const) {
      await stage.evaluate((el, key) => {
        const w = window as unknown as Record<string, number>;
        w[key] = 0;
        new MutationObserver((records) => {
          w[key] += records.length;
        }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
      }, `__dmapMutations_${name}`);
    }
    const mutations = (name: 'panel' | 'popup') =>
      page.evaluate((key) => (window as unknown as Record<string, number>)[key], `__dmapMutations_${name}`);
    // Late calls of the query editors and the popup mount end here: the network is quiet for 500 ms.
    await quietNetwork(page);
    const requestsAtOpen = requests.length;
    const valuesAtOpen = values.at(-1)!;
    const panelBefore = await mutations('panel');
    const popupBefore = await mutations('popup');

    // Three dashboard refreshes reach the data source while the popup is open.
    for (let i = 0; i < 3; i++) {
      await refresh();
    }
    // Each refresh sends the panel query and nothing else: the popup sends none.
    expect(requests.slice(requestsAtOpen).map((r) => r.queries.map((q) => q.refId))).toEqual([['A'], ['A'], ['A']]);
    // The panel behind and the popup stage both render the new data.
    await expect.poll(() => mutations('panel'), { timeout: 10_000 }).toBeGreaterThan(panelBefore);
    await expect.poll(() => mutations('popup'), { timeout: 10_000 }).toBeGreaterThan(popupBefore);
    // The draft stays: the same dialog with the same text.
    await expect(popup).toHaveAttribute('data-dmap-test-mark', 'before-refresh');
    await expect(lines.locator('.view-line').first()).toHaveText('# draft');

    // The draft is dirty: Close asks first, Discard closes.
    await page
      .getByRole('dialog', { name: 'Edit bindings' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Discard changes?' })
      .getByRole('button', { name: 'Discard', exact: true })
      .click();
    await expect(popup).toHaveCount(0);
    // The hover card of the panel shows the latest value, not the one from before the refreshes.
    const halves = panel.locator('polyline.dmap-half');
    const at = await halves.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(at.x, at.y - 40);
    await page.mouse.move(at.x, at.y, { steps: 5 });
    const row = panel.getByRole('tooltip').getByTestId('dmap-card-row').first();
    await expect(row).toContainText('Walk');
    const shown = parseFloat(((await row.innerText()).match(/-?\d+(?:\.\d+)?/g) ?? []).at(-1) ?? 'NaN');
    const latest = values.slice(-2);
    const nearest = (candidates: number[]) => Math.min(...candidates.map((value) => Math.abs(value - shown)));
    expect(nearest(latest)).toBeLessThan(Math.abs(valuesAtOpen - shown) + 1e-9);
  });
});
