import { expect, test } from '@grafana/plugin-e2e';

test('renders the diagram and colours links from synthetic traffic', async ({ gotoDashboardPage }) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
  const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
  await expect(panel.locator.getByTestId('dmap-panel')).toHaveAttribute('data-dmap-cells', '100');
  const half = (cell: string, dir: string) =>
    panel.locator.locator(`polyline.dmap-half[data-dmap-half="${dir}"][data-dmap-cell="${cell}"]`);
  await expect(half('pg-link~wan1:pppoe->rtr-a:wan1', 'a2b')).toHaveAttribute('data-dmap-step', '0');
  await expect(half('pg-link~wan1:pppoe->rtr-a:wan1', 'b2a')).toHaveAttribute('data-dmap-status', 'ok');
  await expect(half('pg-link~wan2:dhcp->rtr-a:wan2', 'a2b')).toHaveAttribute('data-dmap-step', '2');
  await expect(half('pg-link~lte:static->rtr-a:lte', 'a2b')).toHaveAttribute('data-dmap-status', 'nodata');
  await expect(panel.locator.locator('[data-cell-id="pg-node~lte"]')).toHaveAttribute('data-dmap-step', '0');
  await expect(panel.locator.locator('[data-cell-id="pg-node~rtr-a"]')).toHaveAttribute('data-dmap-step', '1');
  // The values and sparklines show in the hover card only.
  await expect(panel.locator.locator('.dmap-overlay text, .dmap-label, .dmap-spark')).toHaveCount(0);
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
  // green from the rule thresholds; the node keeps its draw.io fill
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
