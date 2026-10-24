import fs from 'node:fs';
import { expect, test } from '@grafana/plugin-e2e';
import { saveDashboard } from './authoring-fixtures';

test.skip(process.env.AUTHORING_COMPAT !== '1', 'Build the test-only probe and use authoring-compat.config.ts');
test.use({ userPreferences: { theme: process.env.AUTHORING_THEME === 'light' ? 'light' : 'dark' } });

const svg = fs.readFileSync('src/fixtures/authoring.svg', 'utf8');
const xml = fs.readFileSync('src/fixtures/authoring.drawio', 'utf8');

test('panel-owned inspector focuses, saves and isolates cloned panels across remount', async ({
  request,
  gotoPanelEditPage,
  gotoDashboardPage,
  page,
}) => {
  const uid = `compat-${Date.now()}`;
  const options = {
    diagram: { svg, xml, hash: 'compat', updatedAt: '2026-10-18' },
    zoom: { mode: 'fit', wheel: true, pan: true },
    linkWidth: { min: 2, max: 10 },
  };
  const created = await request.post('/api/dashboards/db', {
    data: {
      dashboard: {
        uid,
        title: uid,
        schemaVersion: 39,
        time: { from: '2026-10-17T00:00:00Z', to: '2026-10-17T01:00:00Z' },
        templating: {
          list: [
            {
              name: 'site',
              type: 'custom',
              query: 'east,west',
              current: { text: 'east', value: 'east' },
              options: [
                { text: 'east', value: 'east', selected: true },
                { text: 'west', value: 'west' },
              ],
            },
          ],
        },
        panels: [1, 2].map((id) => ({
          id,
          title: `Clone ${id}`,
          type: 'simnv-drawiomap-panel',
          gridPos: { x: (id - 1) * 12, y: 0, w: 12, h: 14 },
          options,
          targets: [],
          fieldConfig: { defaults: {}, overrides: [] },
        })),
      },
    },
  });
  expect(created.ok()).toBe(true);
  try {
    const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const probe = page.getByTestId('compat-panel-1');
    await expect(probe).toBeVisible({ timeout: 5000 });
    await probe.locator('[data-cell-id="device-1"]').click();
    await expect(probe.getByRole('heading', { name: 'device-1 bindings' })).toBeFocused();
    await expect(probe.getByTestId('compat-context')).toContainText('east');
    await expect(probe.getByTestId('compat-context')).toContainText('1792195200000');
    await probe.getByLabel('Binding label').fill('Saved first clone');
    await probe.getByRole('button', { name: 'Apply binding' }).click();
    // Public callback updates Grafana's options model; persist through Grafana's public save UI.
    await saveDashboard(page, panelEditPage);
    await gotoDashboardPage({ uid });
    await expect(page.getByTestId('compat-panel-1').getByTestId('compat-saved')).toHaveText('Saved first clone');
    await expect(page.getByTestId('compat-panel-2').getByTestId('compat-saved')).toHaveText('');
    await page.getByTestId('compat-panel-1').locator('[data-cell-id="device-1"]').click();
    await expect(
      page.getByTestId('compat-panel-2').getByRole('heading', { name: 'No selection bindings' })
    ).toBeVisible();
    await page.getByTestId('compat-panel-2').locator('[data-cell-id="device-2"]').click();
    await expect(page.getByTestId('compat-panel-2').getByRole('heading', { name: 'device-2 bindings' })).toBeFocused();
    await expect(page.getByTestId('compat-panel-1').getByRole('heading', { name: 'device-1 bindings' })).toBeVisible();
    const reopenedPanel = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    await reopenedPanel.goto({
      queryParams: new URLSearchParams({ from: '1792108800000', to: '1792116000000', 'var-site': 'west' }),
    });
    await expect(page.getByTestId('compat-panel-1').getByTestId('compat-context')).toHaveText(
      '1792108800000:1792116000000:west'
    );
    await expect(page.getByTestId('compat-panel-1').getByTestId('compat-saved')).toHaveText('Saved first clone');
    await page.getByTestId('compat-panel-1').locator('[data-cell-id="device-2"]').click();
    await expect(page.getByRole('heading', { name: 'device-2 bindings' })).toBeFocused();
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test('installed native datasource editors preserve targets and require explicit preview', async ({
  request,
  gotoPanelEditPage,
  page,
}) => {
  const uid = `compat-query-${Date.now()}`;
  const created = await request.post('/api/dashboards/db', {
    data: {
      dashboard: {
        uid,
        title: uid,
        schemaVersion: 39,
        time: { from: 'now-1h', to: 'now' },
        panels: [
          {
            id: 1,
            title: 'Native editor',
            type: 'simnv-drawiomap-panel',
            gridPos: { x: 0, y: 0, w: 24, h: 20 },
            options: { diagram: { svg, xml, hash: 'compat-query' } },
            targets: [],
            fieldConfig: { defaults: {}, overrides: [] },
          },
        ],
      },
    },
  });
  expect(created.ok()).toBe(true);
  const detailRequests: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/ds/query' && r.postData()?.includes('DETAIL'))
      detailRequests.push(r.postData()!);
  });
  try {
    const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const editor = page.getByTestId('compat-native-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect
      .poll(() => editor.getByTestId('compat-installed-editor').getByRole('textbox').count())
      .toBeGreaterThan(0);
    await editor.getByRole('button', { name: /Options Legend/ }).click();
    await editor
      .getByTestId('compat-installed-editor')
      .getByRole('textbox', { name: /Min step text box/ })
      .fill('15s');
    await editor.getByRole('button', { name: 'Run queries', exact: true }).click();
    await expect(editor.getByTestId('compat-native-target')).toContainText('15s');
    await expect(editor.getByTestId('compat-preview-status')).toHaveText('Preview required');
    const prometheusTarget = JSON.parse((await editor.getByTestId('compat-native-target').textContent())!);
    expect(prometheusTarget.compatOpaque).toEqual({ keep: ['native', 7] });
    expect(detailRequests).toHaveLength(0);
    await editor.getByRole('button', { name: 'TestData editor' }).click();
    await editor
      .getByTestId('compat-installed-editor')
      .getByRole('textbox', { name: 'Alias', exact: true })
      .fill('saved-native-alias');
    await editor
      .getByTestId('compat-installed-editor')
      .getByRole('textbox', { name: 'Alias', exact: true })
      .press('Tab');
    await expect(editor.getByTestId('compat-native-target')).toContainText('saved-native-alias');
    const testdataTarget = JSON.parse((await editor.getByTestId('compat-native-target').textContent())!);
    expect(testdataTarget.compatOpaque).toEqual({ keep: ['native', 7] });
    await editor.getByRole('button', { name: 'Save native targets' }).click();
    expect(detailRequests).toHaveLength(0);
    await saveDashboard(page, panelEditPage);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const reopened = page.getByTestId('compat-native-editor');
    await expect
      .poll(async () => JSON.parse((await reopened.getByTestId('compat-native-target').textContent())!))
      .toEqual(prometheusTarget);
    await expect(
      reopened.getByTestId('compat-installed-editor').getByRole('textbox', { name: /Editor content/ })
    ).toHaveValue('vector(23)');
    expect(detailRequests).toHaveLength(0);
    await reopened.getByRole('button', { name: 'Preview native query' }).click();
    await expect(reopened.getByTestId('compat-preview-status')).toHaveText('frames:1');
    expect(detailRequests).toHaveLength(1);
    await reopened.getByRole('button', { name: 'TestData editor' }).click();
    await expect(
      reopened.getByTestId('compat-installed-editor').getByRole('textbox', { name: 'Alias', exact: true })
    ).toHaveValue('saved-native-alias');
    await expect
      .poll(async () => JSON.parse((await reopened.getByTestId('compat-native-target').textContent())!))
      .toEqual(testdataTarget);
    expect(detailRequests).toHaveLength(1);
    await reopened.getByRole('button', { name: 'Preview native query' }).click();
    await expect(reopened.getByTestId('compat-preview-status')).toHaveText('frames:1');
    expect(detailRequests).toHaveLength(2);
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test('Sparkline portal follows a nested affine anchor through fit, resize, pan and zoom', async ({
  request,
  gotoDashboardPage,
  page,
}) => {
  if (process.env.AUTHORING_SANDBOX === '1') {
    const settings = await (await request.get('/api/frontend/settings')).json();
    expect(settings.enableFrontendSandboxForPlugins).toContain('simnv-drawiomap-panel');
    expect(settings.featureToggles.pluginsFrontendSandbox).toBe(true);
  }
  const uid = `compat-geometry-${Date.now()}`;
  const created = await request.post('/api/dashboards/db', {
    data: {
      dashboard: {
        uid,
        title: uid,
        schemaVersion: 39,
        time: { from: 'now-1h', to: 'now' },
        panels: [
          {
            id: 1,
            title: 'Nested chart',
            type: 'simnv-drawiomap-panel',
            gridPos: { x: 0, y: 0, w: 24, h: 20 },
            options: {
              diagram: {
                svg: svg.replace('</svg>', '<style>body { opacity: 0.25 }</style></svg>'),
                xml,
                hash: 'compat-geometry',
              },
              zoom: { mode: 'fit', wheel: true, pan: true },
            },
            targets: [],
            fieldConfig: { defaults: {}, overrides: [] },
          },
        ],
      },
    },
  });
  expect(created.ok()).toBe(true);
  try {
    await gotoDashboardPage({ uid });
    await expect(page.getByTestId('dmap-panel')).toHaveAttribute('data-dmap-cells', '7');
    await expect(page.getByTestId('compat-sparkline')).toBeVisible({ timeout: 5000 });
    const panel = page.getByTestId('compat-panel-1');
    await expect(panel.getByTestId('compat-realm')).toHaveText(
      process.env.AUTHORING_SANDBOX === '1' ? 'blocked' : 'readable'
    );
    const read = () =>
      panel.evaluate((el) => {
        const anchor = el.querySelector<SVGRectElement>('[data-cell-id="chart-1"] rect')!;
        const portal = el.querySelector<SVGForeignObjectElement>('[data-testid="compat-portal"]')!;
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
        const actual = quad(portal);
        const chart = el.querySelector<HTMLElement>('[data-testid="compat-sparkline"]')!;
        const marker = (x: number) => {
          const p = new DOMPoint(x, 30).matrixTransform(portal.getScreenCTM()!);
          return document.elementFromPoint(p.x, p.y)?.closest('[data-testid="compat-sparkline"]') !== null;
        };
        const pixels = [...chart.querySelectorAll('canvas')].some((canvas) => {
          const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
          return data?.some((v, i) => i % 4 === 3 && v > 0);
        });
        return {
          error: Math.max(...actual.flatMap((p, i) => p.map((v, k) => Math.abs(v - expected[i][k])))),
          localWidth: portal.width.baseVal.value,
          localHeight: portal.height.baseVal.value,
          paintOrder: anchor.nextElementSibling === portal,
          pixels,
          inside: marker(177),
          outside: marker(200),
          parentOffset: portal.transform.baseVal.consolidate()!.matrix.e,
          color: getComputedStyle(chart).color,
          fontSize: getComputedStyle(chart).fontSize,
          svgOverflow: getComputedStyle(el.querySelector('svg')!).overflow,
          matrix: [
            anchor.getScreenCTM()!.a,
            anchor.getScreenCTM()!.b,
            anchor.getScreenCTM()!.c,
            anchor.getScreenCTM()!.d,
          ],
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
    expect(Math.abs(fitted.matrix[1])).toBeGreaterThan(0.01);
    expect(Math.abs(fitted.matrix[2])).toBeGreaterThan(0.01);
    expect(fitted.parentOffset).toBeCloseTo(2);
    expect(fitted.fontSize).toBe('12px');
    expect(fitted.color).not.toBe('rgb(1, 2, 3)');
    expect(fitted.svgOverflow).toBe('hidden');
    await expect(page.locator('body')).toHaveCSS('opacity', '1');
    await expect(panel.getByTestId('compat-sparkline')).toHaveAttribute(
      'data-theme',
      process.env.AUTHORING_THEME === 'light' ? 'light' : 'dark'
    );
    expect(fitted.inside).toBe(true);
    expect(fitted.outside).toBe(false);
    await page.setViewportSize({ width: 450, height: 950 });
    await expect.poll(async () => (await read()).box.width).not.toBe(fitted.box.width);
    const narrow = await verify();
    await page.setViewportSize({ width: 1450, height: 950 });
    await expect.poll(async () => (await read()).box.width).not.toBe(narrow.box.width);
    const resized = await verify();
    const stage = panel.getByTestId('dmap-panel');
    const box = (await stage.boundingBox())!;
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
    const evidence = process.env.AUTHORING_EVIDENCE_DIR || 'artifacts/authoring-compat';
    fs.mkdirSync(evidence, { recursive: true });
    const label = `${new URL(page.url()).port}-${process.env.AUTHORING_THEME || 'dark'}`;
    await panel.screenshot({ path: `${evidence}/geometry-${label}.png` });
    fs.writeFileSync(
      `${evidence}/geometry-${label}.json`,
      JSON.stringify({ fitted, narrow, resized, final: await read() }, null, 2)
    );
  } finally {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});
