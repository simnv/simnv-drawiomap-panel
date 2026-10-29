import type { ConfigV4 } from '../src/model/v4';
import {
  authoringTargets,
  expect,
  observeQueries,
  promTarget,
  svg,
  test,
  type DiagramPanel,
  type PanelTarget,
} from './authoring-fixtures';

/** The authoring targets with some targets replaced (by refId). */
function targetsWith(...replace: PanelTarget[]): PanelTarget[] {
  return authoringTargets().map((t) => replace.find((r) => r.refId === t.refId) ?? t);
}

/** A health series of router-1 and router-2, with the given values. */
const health = (router1: string, router2: string) =>
  `label_replace(${router1}, "device", "router-1", "", "") or label_replace(${router2}, "device", "router-2", "", "")`;

test('visible health becomes stale without another response or network request', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  // An instant query is never stale (spec 3.5). The range query has a step of at most 15 s, so its last sample is
  // fresh at the first load and stale 20 s after it.
  config.classes.routers.freshness = '20s';
  const uid = await createDiagram(config);
  const requests = observeQueries(page);
  await gotoDashboardPage({ uid });
  const device = page.getByTestId('dmap-panel').locator('[data-cell-id="device-1"]');
  await expect(device).toHaveAttribute('data-dmap-status', 'normal');
  const count = requests.length;
  await expect(device).toHaveAttribute('data-dmap-status', 'stale', { timeout: 40_000 });
  expect(requests).toHaveLength(count);
});

test('a chart region follows a nested affine anchor through fit, resize, pan and zoom', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}, testInfo) => {
  // The sanitiser drops the style element of the diagram: the page keeps its opacity.
  const uid = await createDiagram(config, {
    svg: svg.replace('</svg>', '<style>body { opacity: 0.25 }</style></svg>'),
  });
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  await expect(panel).toHaveAttribute('data-dmap-cells', '7');
  await expect(panel.getByTestId('dmap-chart')).toBeVisible();
  const read = () =>
    panel.evaluate((el) => {
      const anchor = el.querySelector<SVGRectElement>('[data-cell-id="chart-1"] rect')!;
      const region = el.querySelector<SVGForeignObjectElement>('foreignObject[data-dmap-chart="chart-1"]')!;
      const quad = (node: SVGGraphicsElement) => {
        const b = node.getBBox();
        const m = node.getScreenCTM()!;
        return [
          [b.x, b.y],
          [b.x + b.width, b.y],
          [b.x, b.y + b.height],
          [b.x + b.width, b.y + b.height],
        ].map(([x, y]) => {
          const p = new DOMPoint(x, y).matrixTransform(m);
          return [p.x, p.y];
        });
      };
      const expected = quad(anchor);
      const actual = quad(region);
      const chart = el.querySelector<HTMLElement>('[data-testid="dmap-chart"]')!;
      // a point of the region in its own coordinates: is the chart the top element there?
      const hit = (x: number) => {
        const p = new DOMPoint(x, 30).matrixTransform(region.getScreenCTM()!);
        return document.elementFromPoint(p.x, p.y)?.closest('[data-testid="dmap-chart"]') != null;
      };
      const pixels = [...chart.querySelectorAll('canvas')].some((canvas) => {
        const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
        return data?.some((v, i) => i % 4 === 3 && v > 0);
      });
      const ctm = anchor.getScreenCTM()!;
      return {
        error: Math.max(...actual.flatMap((p, i) => p.map((v, k) => Math.abs(v - expected[i][k])))),
        localWidth: region.width.baseVal.value,
        localHeight: region.height.baseVal.value,
        paintOrder: anchor.nextElementSibling === region,
        pixels,
        inside: hit(177),
        outside: hit(200),
        parentOffset: region.transform.baseVal.consolidate()!.matrix.e,
        color: getComputedStyle(chart).color,
        fontSize: getComputedStyle(chart).fontSize,
        svgOverflow: getComputedStyle(el.querySelector('svg')!).overflow,
        matrix: [ctm.a, ctm.b, ctm.c, ctm.d],
        box: anchor.getBoundingClientRect().toJSON(),
        viewBox: el.querySelector('svg')!.getAttribute('viewBox'),
      };
    });
  const verify = async () => {
    const g = await read();
    expect(g.error).toBeLessThan(0.5);
    expect(g.localWidth).toBe(180);
    expect(g.localHeight).toBe(70);
    expect(g.paintOrder).toBe(true);
    expect(g.pixels).toBe(true);
    return g;
  };
  await expect.poll(async () => (await read()).pixels).toBe(true);
  const fitted = await verify();
  // the anchor is rotated and skewed
  expect(Math.abs(fitted.matrix[1])).toBeGreaterThan(0.01);
  expect(Math.abs(fitted.matrix[2])).toBeGreaterThan(0.01);
  // the transform of the rect (translate(2 0)) is part of the region transform
  expect(fitted.parentOffset).toBeCloseTo(2);
  // the region uses the theme font and colour, not the font and colour of the cell
  expect(fitted.fontSize).toBe('12px');
  expect(fitted.color).not.toBe('rgb(1, 2, 3)');
  expect(fitted.svgOverflow).toBe('hidden');
  await expect(page.locator('body')).toHaveCSS('opacity', '1');
  // the clip path of the cell clips the region
  expect(fitted.inside).toBe(true);
  expect(fitted.outside).toBe(false);
  await page.setViewportSize({ width: 450, height: 950 });
  await expect.poll(async () => (await read()).box.width).not.toBe(fitted.box.width);
  const narrow = await verify();
  await page.setViewportSize({ width: 1450, height: 950 });
  await expect.poll(async () => (await read()).box.width).not.toBe(narrow.box.width);
  const resized = await verify();
  const box = (await panel.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await read()).viewBox).not.toBe(resized.viewBox);
  const zoomed = await verify();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + 110, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).viewBox).not.toBe(zoomed.viewBox);
  await verify();
  await panel.getByRole('button', { name: 'Reset zoom' }).click();
  await expect.poll(async () => (await read()).viewBox).toBe(resized.viewBox);
  await verify();
  const screenshot = testInfo.outputPath('chart-region-geometry.png');
  await panel.screenshot({ path: screenshot });
  await testInfo.attach('chart-region-geometry', { path: screenshot, contentType: 'image/png' });
});

test('a drag that starts on a chart region pans the diagram, and a hover still reads the chart', async ({
  page,
  config,
  createDiagram,
  gotoDashboardPage,
}) => {
  const uid = await createDiagram(config);
  await gotoDashboardPage({ uid });
  const panel = page.getByTestId('dmap-panel');
  const chart = panel.getByTestId('dmap-chart');
  await expect(chart.locator('canvas').first()).toBeVisible();
  const viewBox = () => panel.locator('svg').first().getAttribute('viewBox');
  // zoom in first: a fitted diagram has no room to pan
  const fitted = await viewBox();
  const box = (await chart.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(viewBox).not.toBe(fitted);
  await expect.poll(async () => (await chart.boundingBox())!.width).toBeGreaterThan(box.width);
  const before = await viewBox();
  // a hover with no drag reads the chart and does not move the view
  await page.mouse.move(start.x, start.y);
  await page.mouse.move(start.x + 5, start.y);
  await expect(page.getByTestId('dmap-chart-tooltip')).toBeVisible();
  expect(await viewBox()).toBe(before);
  // a drag from the chart pans the diagram
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y + 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(viewBox).not.toBe(before);
  await expect(panel.getByRole('button', { name: 'Reset zoom' })).toBeVisible();
  // a click with no drag on the chart does not move the view, and the chart still reads the pointer
  const panned = await viewBox();
  const moved = (await chart.boundingBox())!;
  await page.mouse.click(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.mouse.move(moved.x + moved.width / 2 + 5, moved.y + moved.height / 2);
  await expect(page.getByTestId('dmap-chart-tooltip')).toBeVisible();
  expect(await viewBox()).toBe(panned);
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
/** A health series of the link: link-1 has key=node-rtr-a and port=wan1, and the link class matches job and device. */
const LINK_HEALTH = 'label_replace(label_replace(vector(0), "job", "node-rtr-a", "", ""), "device", "wan1", "", "")';

/** The panel of one state: the authoring config and targets, with the change that gives the state. */
function statePanel(base: ConfigV4, state: State): DiagramPanel {
  const config = structuredClone(base);
  // The dashboard does not refresh: with the default freshness (3x) each cell turns stale during the test.
  config.freshness = '1h';
  const expr =
    state === 'error'
      ? 'vector('
      : state === 'missing'
        ? 'absent(vector(1))'
        : state === 'partial outage'
          ? health('vector(0)', 'vector(1)')
          : state === 'widespread outage'
            ? `${health('vector(0)', 'vector(0)')} or ${LINK_HEALTH}`
            : health(state === 'loading' ? LOADING_EXPR : 'vector(1)', 'vector(1)');
  const replace = [promTarget('health', expr)];
  if (state === 'widespread outage') {
    // the link takes the status too: its halves show the status colour over the colour of the traffic
    config.overrides['link-1'] = { status: 'health' };
  }
  if (state === 'stale') {
    config.classes.routers.freshness = '1ms';
  }
  if (state === 'zero') {
    replace.push(promTarget('trend', 'label_replace(vector(0), "device", "trend", "", "")'));
  }
  return { config, title: state, targets: targetsWith(...replace) };
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
        if (route.request().postData()?.includes(LOADING_EXPR)) {
          await gate;
        }
        await route.continue().catch(() => {});
      });
      const uid = await createDiagram(config, {
        panels: [
          ...STATES.map((state) => statePanel(config, state)),
          {
            config: { ...config, freshness: '1h' },
            title: 'crowded',
            svg: svg.replace('translate(35 35)', 'translate(0 0)'),
            targets: targetsWith(promTarget('health', health('vector(0)', 'vector(0)'))),
          },
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
            if (state === 'loading') {
              // Grafana mounts the panel only with its first data: while the query waits, the plugin draws nothing.
              // After the response the panel shows the data.
              const frame = dashboard.getPanelByTitle(state).locator;
              await expect(frame).toBeVisible();
              await expect(frame.getByTestId('dmap-panel')).toHaveCount(0);
              release();
            }
            const panel = await open(state);
            const device = panel.locator('[data-cell-id="device-1"]');
            const expected = state.includes('outage')
              ? 'critical'
              : state === 'stale'
                ? 'stale'
                : ['missing', 'error'].includes(state)
                  ? 'missing'
                  : 'normal';
            await expect(device).toHaveAttribute('data-dmap-status', expected);
            if (state === 'partial outage') {
              await expect(panel.locator('[data-cell-id="device-2"]')).toHaveAttribute('data-dmap-status', 'normal');
            }
            const rect = device.locator('rect').first();
            if (state === 'widespread outage') {
              await expect(panel.locator('.dmap-status-marker')).toHaveCount(0);
              await expect(panel.locator('.dmap-status-summary')).toHaveCount(1);
              await expect(panel.locator('.dmap-status-summary')).toHaveAttribute(
                'title',
                'Health check failed · health: 3 cells'
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
              // and the link: both halves in the same status colour, over the colour of the traffic
              const halves = panel.locator('.dmap-half[data-dmap-cell="link-1"]');
              await expect(halves).toHaveCount(2);
              const deviceStroke = await rect.evaluate((el) => getComputedStyle(el).stroke);
              await expect
                .poll(() => halves.evaluateAll((els) => els.map((el) => getComputedStyle(el).stroke)))
                .toEqual([deviceStroke, deviceStroke]);
              await expect(halves.first()).toHaveAttribute('data-dmap-status', 'ok');
            }
            if (state === 'normal') {
              // v4 paints a normal status too, in the exact colour of its threshold step (spec 3.4)
              await expect(rect).toHaveCSS('stroke', theme === 'dark' ? 'rgb(115, 191, 105)' : 'rgb(86, 166, 75)');
            }
            if (expected !== 'normal') {
              // the band row is `<text> · <refId>: <n> cells`; a cell with no value gives its reason as the text
              const text = state.includes('outage')
                ? 'Health check failed'
                : state === 'missing'
                  ? 'No data'
                  : state === 'error'
                    ? 'Query failed'
                    : state === 'stale'
                      ? 'Stale'
                      : 'Healthy';
              await expect(
                panel.locator('.dmap-status-summary').filter({ hasText: `${text} · health:` })
              ).toBeVisible();
            }
            if (state === 'stale') {
              await expect(device).toHaveAttribute('aria-label', /Sample is stale/);
            }
            // one chart region, on the chart cell only, and no card
            const region = panel.getByTestId('dmap-chart');
            await expect(region).toHaveCount(1);
            await expect(panel.locator('[data-dmap-chart]')).toHaveAttribute('data-dmap-chart', 'chart-1');
            await expect(panel.getByTestId('dmap-card')).toHaveCount(0);
            if (state === 'zero') {
              // a series of zeros is data, not "no data"
              await expect(region).toContainText('0');
              await expect(region.locator('[data-state="ready"]')).toBeVisible();
            }
            await expect(region.locator('canvas')).toBeVisible();
            await shoot(panel, state);
          });
        }

        await test.step('crowded topology keeps a widespread reason readable', async () => {
          const panel = await open('crowded');
          await expect(
            panel.locator('.dmap-status-summary[title="Health check failed · health: 2 cells"]')
          ).toBeVisible();
          // the two down devices are painted, nothing is drawn on top of the diagram
          await expect(panel.locator('[data-cell-id^="device-"][data-dmap-status="critical"]')).toHaveCount(2);
          await expect(panel.locator('.dmap-status-marker')).toHaveCount(0);
          await shoot(panel, 'crowded');
        });
      } finally {
        release();
      }
    });
  });
}
