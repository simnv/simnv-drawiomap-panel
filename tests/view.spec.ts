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
  await expect(panel.locator.locator('polyline.dmap-spark[data-dmap-cell="pg-node~rtr-a"]')).toBeAttached();
  const label = panel.locator.locator(
    'g.dmap-label[data-dmap-cell="pg-link~wan1:pppoe->rtr-a:wan1"][data-dmap-half="a2b"] text'
  );
  await expect(label).toHaveText(/41(\.\d)? Mb\/s · 41%/);
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
