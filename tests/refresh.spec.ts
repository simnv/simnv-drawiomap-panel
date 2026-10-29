import type { Page } from '@playwright/test';
import type { ConfigV4 } from '../src/model/v4';
import { expect, observeQueries, promTarget, test, testdataTarget } from './authoring-fixtures';

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

// P3-08: the bindings popup comes back with the split editor (spec 5.0, 6.5). Then this case opens the split editor
// where it says "P3-08" and runs again.
test.describe('popup open', () => {
  test.fixme('the panel behind does no work for a refresh while the popup is open and updates once on close', async ({
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
    const halves = panel.locator('polyline.dmap-half');
    await expect(halves.first()).toBeAttached();
    const snapshot = async () => ({
      halves: await halves.evaluateAll((els) => els.map((el) => el.outerHTML)),
      patched: await panel.getAttribute('data-dmap-patched'),
    });
    // Count every change under the panel: an attribute, a node, a text. The applier writes at least one per refresh.
    await panel.evaluate((el) => {
      const w = window as unknown as { __dmapMutations: number };
      w.__dmapMutations = 0;
      new MutationObserver((records) => {
        w.__dmapMutations += records.length;
      }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
    });
    const mutations = () => page.evaluate(() => (window as unknown as { __dmapMutations: number }).__dmapMutations);

    // Control: without the popup, a refresh changes the panel.
    await page.waitForTimeout(1000);
    const settled = await mutations();
    await refresh();
    await expect.poll(mutations, { timeout: 10_000 }).toBeGreaterThan(settled);

    // P3-08: open the split editor.
    const before = await snapshot();
    const mutationsBefore = await mutations();
    // Three dashboard refreshes reach the data source while the popup is open.
    for (let i = 0; i < 3; i++) {
      await refresh();
    }
    expect(await snapshot()).toEqual(before);
    expect(await mutations()).toBe(mutationsBefore);

    const valuesAtOpen = values.at(-1)!;
    // Record each distinct picture of the link halves from the close on.
    await panel.evaluate((el) => {
      const w = window as unknown as { __dmapPictures: string[] };
      w.__dmapPictures = [];
      const read = () => Array.from(el.querySelectorAll('polyline.dmap-half'), (half) => half.outerHTML).join('\n');
      new MutationObserver(() => {
        const picture = read();
        if (w.__dmapPictures.at(-1) !== picture) {
          w.__dmapPictures.push(picture);
        }
      }).observe(el, { attributes: true, childList: true, subtree: true });
    });
    const pictures = () => page.evaluate(() => (window as unknown as { __dmapPictures: string[] }).__dmapPictures);
    const responsesAtClose = values.length;
    // P3-08: close the split editor.
    // The panel renders the latest data: its link halves change.
    await expect.poll(async () => (await snapshot()).halves, { timeout: 15_000 }).not.toEqual(before.halves);
    expect(await mutations()).toBeGreaterThan(mutationsBefore);
    await page.waitForTimeout(1200);
    // One update with the latest result: one new picture, plus one for each refresh that arrived after the close.
    expect((await pictures()).length).toBeLessThanOrEqual(1 + (values.length - responsesAtClose));
    // The hover card shows the latest value, not the one from before the pause.
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
