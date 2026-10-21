import { expect, test } from '@grafana/plugin-e2e';

const SHOTS = process.env.DMAP_SCREENSHOTS; // a directory: write the screenshots there

test('renders the diagram and colours links from synthetic traffic', async ({ gotoDashboardPage }) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  await expect(panel.locator.getByTestId('dmap-panel')).toHaveAttribute('data-dmap-cells', '108');
  const half = (cell: string, dir: string) =>
    panel.locator.locator(`polyline.dmap-half[data-dmap-half="${dir}"][data-dmap-cell="${cell}"]`);
  await expect(half('pg-link~isp-a:pppoe->rtr-a:wan1', 'a2b')).toHaveAttribute('data-dmap-step', '0');
  await expect(half('pg-link~isp-a:pppoe->rtr-a:wan1', 'b2a')).toHaveAttribute('data-dmap-status', 'ok');
  await expect(half('pg-link~radio:dhcp->rtr-a:wan2', 'a2b')).toHaveAttribute('data-dmap-step', '2');
  await expect(half('pg-link~lte:static->rtr-a:wan3', 'a2b')).toHaveAttribute('data-dmap-status', 'nodata');
  await expect(panel.locator.locator('[data-cell-id="pg-node~lte"]')).toHaveAttribute('data-dmap-step', '0');
  await expect(panel.locator.locator('[data-cell-id="pg-node~rtr-a"]')).toHaveAttribute('data-dmap-step', '1');
  // The values and sparklines show in the hover card only.
  await expect(panel.locator.locator('.dmap-overlay text, .dmap-label, .dmap-spark')).toHaveCount(0);
});

test('link labels stay above the coloured link halves', async ({ gotoDashboardPage }) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  const link = 'pg-link~isp-a:pppoe->rtr-a:wan1';
  await expect(panel.locator.locator(`polyline.dmap-half[data-dmap-cell="${link}"]`)).toHaveCount(2);
  const label = panel.locator.locator(`[data-cell-id="pg-linkLabel~isp-a:pppoe->rtr-a:wan1"] text`);
  const hit = await label.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      inLabel: !!top?.closest('[data-meta-pg-kind="link-label"]'),
      half: !!top?.closest('.dmap-half, .dmap-arrow'),
      tag: top?.localName,
    };
  });
  expect(hit).toEqual({ inLabel: true, half: false, tag: expect.any(String) });
  if (SHOTS) {
    await panel.locator.screenshot({ path: `${SHOTS}/labels-above-links.png` });
  }
});

test('node state colours the node icon, not the whole node', async ({ gotoDashboardPage }) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  const node = panel.locator.locator('[data-cell-id="pg-node~rtr-a"]');
  await expect(node).toHaveAttribute('data-dmap-target', 'icon');
  const colours = await node.evaluate((el) => {
    const svg = el.ownerSVGElement!;
    const icon = svg.querySelector('[data-cell-id="pg-icon~rtr-a"] ellipse') as SVGElement;
    const rect = el.querySelector('rect') as SVGElement;
    return { icon: icon.style.fill, node: rect.style.fill };
  });
  // green from the thresholds of the up query (an override); the node keeps its draw.io fill
  expect(colours.icon).toMatch(/^(rgb\(115, 191, 105\)|#73bf69)$/i);
  expect(colours.node).toContain('light-dark');
  await expect(panel.locator.locator('[data-cell-id="pg-node~lte"]')).toHaveAttribute('data-dmap-target', 'icon');
});

test('curved edge halves follow the real path geometry (getPointAtLength + CTM)', async ({ gotoDashboardPage }) => {
  // Grafana loads panels below the fold only when they scroll into view. viewPanel shows this panel alone.
  const dashboardPage = await gotoDashboardPage({
    uid: 'drawiomap-demo',
    queryParams: new URLSearchParams({ viewPanel: 'panel-2' }),
  });
  const panel = await dashboardPage.getPanelByTitle('hand-drawn');
  const half = panel.locator.locator('polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="edge-cd"]');
  await expect(half).toHaveAttribute('data-dmap-status', 'ok');
  const result = await half.evaluate((el) => {
    const poly = el as SVGPolylineElement;
    const svg = poly.ownerSVGElement!;
    const path = svg.querySelector('[data-cell-id="edge-cd"] path[pointer-events="stroke"]') as SVGPathElement;
    const start = path.getPointAtLength(0).matrixTransform(path.getCTM()!);
    const [x, y] = (poly.getAttribute('points') || '').split(' ')[0].split(',').map(Number);
    const first = new DOMPoint(x, y).matrixTransform((poly.parentNode as SVGGElement).getCTM()!);
    return {
      delta: Math.hypot(start.x - first.x, start.y - first.y),
      samples: (poly.getAttribute('points') || '').split(' ').length,
      curved: /[QC]/.test(path.getAttribute('d') || ''),
    };
  });
  expect(result.curved).toBe(true);
  expect(result.delta).toBeLessThan(1);
  expect(result.samples).toBeGreaterThan(4);
});

// draw.io writes color-scheme: light dark on the SVG root. Without an override, light-dark() colours follow
// the OS preference. The panel must follow the Grafana theme. Emulate the opposite OS preference each time.
for (const [theme, osScheme, dark] of [
  ['dark', 'light', true],
  ['light', 'dark', false],
] as const) {
  test(`diagram background follows the Grafana ${theme} theme, not the OS preference`, async ({
    gotoDashboardPage,
    page,
  }) => {
    await page.emulateMedia({ colorScheme: osScheme });
    const dashboardPage = await gotoDashboardPage({
      uid: 'drawiomap-demo',
      queryParams: new URLSearchParams({ theme }),
    });
    const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
    const root = panel.locator.locator('[data-testid="dmap-panel"] svg').first();
    await expect(root).toHaveCSS('color-scheme', theme);
    const luminance = await root.evaluate((el) => {
      const [r, g, b] = getComputedStyle(el)
        .backgroundColor.match(/\d+(\.\d+)?/g)!
        .map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    });
    expect(luminance < 0.5).toBe(dark);
  });
}

test('link arrows stand away from the bends of the link path', async ({ gotoDashboardPage }) => {
  // edge-ab of the hand-drawn panel has a 30 px jog exactly at the arc-length middle of the path.
  const dashboardPage = await gotoDashboardPage({
    uid: 'drawiomap-demo',
    queryParams: new URLSearchParams({ viewPanel: 'panel-2' }),
  });
  const panel = await dashboardPage.getPanelByTitle('hand-drawn');
  const arrows = panel.locator.locator('polygon.dmap-arrow[data-dmap-cell="edge-ab"]');
  await expect(arrows).toHaveCount(2);
  const result = await arrows.first().evaluate((el) => {
    const svg = (el as SVGElement).ownerSVGElement!;
    const path = svg.querySelector('[data-cell-id="edge-ab"] path[pointer-events="stroke"]') as SVGPathElement;
    const nums = (path.getAttribute('d') || '').match(/-?\d*\.?\d+/g)!.map(Number);
    const vertices: Array<[number, number]> = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      vertices.push([nums[i], nums[i + 1]]);
    }
    const tri = (el.getAttribute('points') || '').split(' ').map((p) => p.split(',').map(Number));
    const [tip, b1, b2] = tri;
    const arrowSize = Math.hypot(tip[0] - (b1[0] + b2[0]) / 2, tip[1] - (b1[1] + b2[1]) / 2);
    // only the vertices that are bends: both neighbours leave the straight line
    const bends = vertices.filter((v, i) => {
      if (i === 0 || i === vertices.length - 1) {
        return false;
      }
      const [p, n] = [vertices[i - 1], vertices[i + 1]];
      return (v[0] - p[0]) * (n[1] - v[1]) - (v[1] - p[1]) * (n[0] - v[0]) !== 0;
    });
    return {
      arrowSize,
      bends: bends.length,
      nearest: Math.min(...bends.map((v) => Math.hypot(v[0] - tip[0], v[1] - tip[1]))),
    };
  });
  expect(result.bends).toBe(2);
  expect(result.arrowSize).toBeGreaterThan(0);
  expect(result.nearest).toBeGreaterThanOrEqual(2 * result.arrowSize - 0.01);
});
