import { expect, observeQueries, svg, test } from './authoring-fixtures';
import { binding, nativeQuery } from '../src/fixtures/authoring-config';
import type { DiagramConfig } from '../src/model/config';

test('visible health becomes stale without another response or network request', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  config.queries[0] = nativeQuery('health', 'vector(1)');
  config.queries[0].source = {
    kind: 'datasource',
    target: { refId: 'HEALTH', ...{ expr: 'vector(1)', instant: true } },
    parameters: {},
  };
  config.patterns[0].display.status!.freshness = { expectedIntervalMs: 1000, staleAfterMs: 5000 };
  config.widgets = [];
  const uid = await createDiagram(config);
  const requests = observeQueries(page);
  await gotoDashboardPage({ uid });
  const device = page.getByTestId('dmap-panel').locator('[data-cell-id="device-1"]');
  await expect(device).toHaveAttribute('data-dmap-status', 'normal');
  const count = requests.length;
  await expect(device).toHaveAttribute('data-dmap-status', 'stale', { timeout: 8000 });
  expect(requests).toHaveLength(count);
});

const STATES = [
  'normal',
  'partial outage',
  'widespread outage',
  'zero',
  'missing',
  'stale',
  'loading',
  'error',
] as const;
type State = (typeof STATES)[number];

/** The loading panel gets its own expression, so the route holds only its query. */
const LOADING_EXPR = 'vector(1) + 0';

function stateConfig(base: DiagramConfig, state: State): DiagramConfig {
  const config = structuredClone(base);
  const expr =
    state === 'error'
      ? 'vector('
      : state === 'missing'
        ? 'absent(vector(1))'
        : state === 'loading'
          ? LOADING_EXPR
          : state.includes('outage')
            ? 'vector(0)'
            : 'vector(1)';
  config.queries[0] = nativeQuery('health', expr);
  if (state === 'partial outage') {
    config.queries.push(nativeQuery('healthy-peer', 'vector(1)'));
    config.overrides.push({
      cellId: 'device-2',
      display: { status: { ...config.patterns[0].display.status!, binding: binding('healthy-peer') } },
    });
  }
  if (state === 'widespread outage') {
    // the link takes the status too: its halves show the status colour over the binding colour
    config.overrides.push({ cellId: 'link-1', display: { status: config.patterns[0].display.status! } });
  }
  if (state === 'stale') config.patterns[0].display.status!.freshness = { expectedIntervalMs: 1, staleAfterMs: 2 };
  if (state === 'zero') config.queries[2] = nativeQuery('trend', 'vector(0)');
  return config;
}

// One dashboard per theme holds a panel for each state. The theme is on the first load, and one page load serves all
// states. Each check and each screenshot stays inside its own panel.
for (const theme of ['light', 'dark'] as const) {
  test.describe(`desktop ${theme}`, () => {
    // Tall enough for all nine panels (752 px each): Grafana mounts a panel below the fold only when it scrolls in.
    test.use({ viewport: { width: 1450, height: 7800 } });
    test(`reasons stay visible and charts remain explicit in every state, and a crowded topology keeps a widespread reason readable`, async ({
      page,
      config,
      createDiagram,
      gotoDashboardPage,
    }, testInfo) => {
      test.setTimeout(150_000);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/ds/query*', async (route) => {
        if (route.request().postData()?.includes(LOADING_EXPR)) await gate;
        await route.continue().catch(() => {});
      });
      const crowdedConfig = structuredClone(config);
      crowdedConfig.queries[0] = nativeQuery('health', 'vector(0)');
      const uid = await createDiagram(config, {
        panels: [
          ...STATES.map((state) => ({ config: stateConfig(config, state), title: state })),
          { config: crowdedConfig, title: 'crowded', svg: svg.replace('translate(35 35)', 'translate(0 0)') },
        ],
      });
      try {
        const dashboard = await gotoDashboardPage({ uid, queryParams: new URLSearchParams({ theme }) });
        const open = async (title: string) => {
          const frame = dashboard.getPanelByTitle(title).locator;
          const panel = frame.getByTestId('dmap-panel');
          await expect(panel).toHaveCSS('color-scheme', theme);
          return panel;
        };
        const shoot = async (panel: Awaited<ReturnType<typeof open>>, name: string) => {
          const screenshot = testInfo.outputPath(`${name}-${theme}.png`);
          await panel.screenshot({ path: screenshot });
          await testInfo.attach(`${name}-${theme}`, { path: screenshot, contentType: 'image/png' });
        };

        for (const state of STATES) {
          await test.step(`${state}: reasons stay visible and charts remain explicit`, async () => {
            const panel = await open(state);
            const device = panel.locator('[data-cell-id="device-1"]');
            const expected = state.includes('outage')
              ? 'down'
              : state === 'stale'
                ? 'stale'
                : ['missing', 'loading', 'error'].includes(state)
                  ? 'missing'
                  : 'normal';
            await expect(device).toHaveAttribute('data-dmap-status', expected);
            if (state === 'partial outage')
              await expect(panel.locator('[data-cell-id="device-2"]')).toHaveAttribute('data-dmap-status', 'normal');
            const rect = device.locator('rect').first();
            if (state === 'widespread outage') {
              await expect(panel.locator('.dmap-status-marker')).toHaveCount(0);
              await expect(panel.locator('.dmap-status-summary')).toHaveCount(1);
              await expect(panel.locator('.dmap-status-summary')).toHaveAttribute(
                'title',
                'down: Health check failed (3 elements)'
              );
              // the status paints the device: a border twice the default width in the status colour, a tinted fill
              await expect(rect).toHaveCSS('stroke-width', '2px');
              const paint = await rect.evaluate((el) => ({
                stroke: el.style.stroke,
                fill: getComputedStyle(el).fill,
                drawn: el.getAttribute('fill'),
              }));
              expect(paint.stroke).not.toBe('');
              expect(paint.fill).toMatch(/^rgb\(/);
              expect(paint.fill).not.toBe('rgb(213, 232, 212)');
              expect(paint.drawn).toBe('#d5e8d4');
              // and the link: both halves and arrow heads in the same status colour, over the binding colour
              const halves = panel.locator('.dmap-half[data-dmap-cell="link-1"]');
              await expect(halves).toHaveCount(2);
              const strokes = await halves.evaluateAll((els) => els.map((el) => getComputedStyle(el).stroke));
              const deviceStroke = await rect.evaluate((el) => getComputedStyle(el).stroke);
              expect(strokes).toEqual([deviceStroke, deviceStroke]);
              await expect(halves.first()).toHaveAttribute('data-dmap-status', 'ok');
            }
            if (state === 'normal') {
              // a normal status paints nothing: the drawn colours stay
              expect(await rect.evaluate((el) => [el.style.stroke, el.style.fill])).toEqual(['', '']);
            }
            if (expected !== 'normal') {
              const reason = state.includes('outage')
                ? 'Health check failed'
                : state === 'missing'
                  ? 'No data'
                  : state === 'error'
                    ? 'Query failed'
                    : state === 'loading'
                      ? 'Loading data'
                      : 'Sample is stale';
              await expect(panel.locator('.dmap-status-summary').filter({ hasText: reason })).toBeVisible();
            }
            await expect(panel.locator('[data-dmap-widget]')).toHaveCount(1);
            await expect(panel.locator('[data-cell-id^="device-"] [data-dmap-widget]')).toHaveCount(0);
            await expect(panel.getByTestId('dmap-card')).toHaveCount(0);
            if (state === 'zero') {
              await expect(panel.locator('[data-dmap-widget]')).toContainText('0');
              await expect(panel.locator('[data-dmap-widget] [data-state="ready"]')).toBeVisible();
            } else await expect(panel.locator('[data-dmap-widget] canvas')).toBeVisible();
            await shoot(panel, state);
          });
        }

        await test.step('crowded topology keeps a widespread reason readable', async () => {
          const panel = await open('crowded');
          await expect(
            panel.locator('.dmap-status-summary[title="down: Health check failed (2 elements)"]')
          ).toBeVisible();
          // the two down devices are painted, nothing is drawn on top of the diagram
          await expect(panel.locator('[data-cell-id^="device-"][data-dmap-status="down"]')).toHaveCount(2);
          await expect(panel.locator('.dmap-status-marker')).toHaveCount(0);
          await shoot(panel, 'crowded');
        });
      } finally {
        release();
      }
    });
  });
}
