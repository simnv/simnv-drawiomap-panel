import { devices, type Locator } from '@playwright/test';
import { expect, test } from './authoring-fixtures';

/**
 * A point `offset` screen px beside a thin link half of the panel: on the stage, not on a cell that opens a card,
 * and nearer to that link than to any other link. Undefined when no link has such a point.
 */
async function spotBesideThinLink(panel: Locator, offset: number) {
  return panel.evaluate((host, off) => {
    const stage = host.querySelector('[data-testid="dmap-stage"]')!.getBoundingClientRect();
    const halves = Array.from(host.querySelectorAll<SVGPolylineElement>('polyline.dmap-half'));
    type P = { x: number; y: number };
    const screenPoints = (el: SVGPolylineElement): P[] => {
      const m = el.getScreenCTM()!;
      return Array.from(el.points).map((p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }));
    };
    const dist = (p: P, a: P, b: P) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
    };
    const all = halves.map((el) => ({ cell: el.getAttribute('data-dmap-cell')!, pts: screenPoints(el) }));
    for (const el of halves) {
      const m = el.getScreenCTM()!;
      // a thin link: at most 3 px on the screen
      if (Number(el.getAttribute('stroke-width')) * Math.hypot(m.a, m.b) > 3) {
        continue;
      }
      const cell = el.getAttribute('data-dmap-cell')!;
      const pts = screenPoints(el);
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 20) {
          continue;
        }
        const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
        for (const side of [1, -1]) {
          const p = { x: (a.x + b.x) / 2 + side * off * n.x, y: (a.y + b.y) / 2 + side * off * n.y };
          if (p.x < stage.left + 4 || p.x > stage.right - 4 || p.y < stage.top + 4 || p.y > stage.bottom - 4) {
            continue;
          }
          const under = document.elementFromPoint(p.x, p.y);
          if (!under || !host.contains(under) || under.closest('[data-dmap-interactive], .dmap-half')) {
            continue;
          }
          // no other link as near as this one (with a 2 px margin)
          const clear = all.every(
            (o) => o.cell === cell || o.pts.every((q, j) => j === 0 || dist(p, o.pts[j - 1], q) > off + 2)
          );
          if (clear) {
            const group = host.querySelector(`[data-cell-id="${CSS.escape(cell)}"]`);
            return { cell, x: p.x, y: p.y, label: group?.getAttribute('aria-label') ?? '' };
          }
        }
      }
    }
    return undefined;
  }, offset);
}

test.describe('a thin link near the pointer', () => {
  test('a hover 6 px off a thin link opens its card and shows the hover mark', async ({ gotoDashboardPage, page }) => {
    const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
    const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
    await expect(panel.locator.locator('polyline.dmap-half').first()).toHaveAttribute('data-dmap-status', 'ok');
    const spot = await spotBesideThinLink(panel.locator, 6);
    expect(spot, 'a thin link with a free point 6 px beside it').toBeTruthy();
    await page.mouse.move(spot!.x + 30, spot!.y + 30);
    await page.mouse.move(spot!.x, spot!.y, { steps: 3 });
    const card = panel.locator.getByRole('tooltip');
    await expect(card).toBeVisible();
    expect(spot!.label.startsWith((await card.getAttribute('aria-label')) ?? '-')).toBe(true);
    // the mark: the near class on the overlay layer of that link, and the focus layer over the diagram
    const marked = panel.locator.locator('[data-cell-id] g.dmap-overlay.dmap-near');
    await expect(marked).toHaveCount(1);
    await expect(panel.locator.locator(`[data-cell-id="${spot!.cell}"] g.dmap-overlay.dmap-near`)).toHaveCount(1);
    await expect(panel.locator.locator('g.dmap-link-focus-layer')).toHaveCSS('display', 'inline');
    await expect(panel.locator.getByTestId('dmap-stage')).toHaveCSS('cursor', 'pointer');
    // away from every link: the card closes and the mark goes
    await page.mouse.move(1, 1);
    await expect(panel.locator.getByTestId('dmap-card')).toHaveCount(0);
    await expect(marked).toHaveCount(0);
    // and the rest of the diagram is bright again
    await expect(panel.locator.locator('svg.dmap-link-focus')).toHaveCount(0);
  });
});

// Chromium with the iPhone 13 viewport, touch and no hover. The webkit browser of the preset needs a separate worker.
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];

test.describe('a thin link near a finger', () => {
  test.use(iPhone);

  test('a tap 14 px off a thin link pins its card', async ({ gotoDashboardPage, page }) => {
    const dashboardPage = await gotoDashboardPage({ uid: 'drawiomap-demo' });
    const panel = await dashboardPage.getPanelByTitle('demo-lab L3');
    await panel.locator.scrollIntoViewIfNeeded();
    await expect(panel.locator.locator('polyline.dmap-half').first()).toHaveAttribute('data-dmap-status', 'ok');
    const spot = await spotBesideThinLink(panel.locator, 14);
    expect(spot, 'a thin link with a free point 14 px beside it').toBeTruthy();
    await page.touchscreen.tap(spot!.x, spot!.y);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(spot!.label.startsWith((await dialog.getAttribute('aria-label')) ?? '-')).toBe(true);
  });
});
