import fs from 'node:fs';
import type { Locator, Page, Route } from '@playwright/test';
import type { ConfigV4 } from '../src/model/v4';
import { demoConfigV4 } from '../src/fixtures/demo-config';
import { expect, promTarget, test, type PanelTarget } from './authoring-fixtures';

/*
 * A labelled panel stays open through many refreshes: stale and fresh status, a refresh that loads, a refresh that
 * fails and a return from a hidden page. After each step every link half is drawn, in the DOM and on the screen, and
 * no half wears a mask (the links that Safari stopped painting were the ones whose halves wore one).
 */

test.use({ viewport: { width: 1600, height: 1000 } });
const demoSvg = fs.readFileSync('fixtures/demo/svg/demo-l3.svg', 'utf8');
const demoPanel: { targets: PanelTarget[]; fieldConfig: { defaults: Record<string, unknown>; overrides: unknown[] } } =
  JSON.parse(fs.readFileSync('provisioning/dashboards/demo.json', 'utf8')).panels[0];

for (const scale of [1, 2]) {
  test(`arrow styles keep their geometry and point heads stay inside the stroke band at ${scale}x`, async ({
    page,
    createDiagram,
    gotoDashboardPage,
  }) => {
    const styles = ['point', 'triangle', 'none'] as const;
    const config: ConfigV4 = {
      version: 4,
      classes: Object.fromEntries(
        styles.map((arrow) => [
          arrow,
          {
            match: { key: 'job' },
            up: 'load',
            down: 'load',
            arrow,
          },
        ])
      ),
    };
    config.classes['point-bent'] = { match: { key: 'job' }, up: 'load', arrow: 'point' };
    config.classes['none-bent'] = { match: { key: 'job' }, up: 'load', down: 'load', arrow: 'none' };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300">${styles
      .map(
        (arrow, i) =>
          `<text x="40" y="${30 + i * 70}" fill="#ccc">${arrow}</text><g data-cell-id="${arrow}" data-meta-bind="${arrow}" data-meta-key="arrow-demo"><path d="M 40 ${50 + i * 70} L 560 ${50 + i * 70}" fill="none" stroke="#333" pointer-events="stroke"/></g>`
      )
      .join(
        ''
      )}<text x="400" y="210" fill="#ccc">point to port</text><g data-cell-id="point-bent" data-meta-bind="point-bent" data-meta-key="arrow-demo"><path d="M 400 230 L 480 230 L 480 250 L 486 250" fill="none" stroke="#333" pointer-events="stroke"/></g><text x="40" y="210" fill="#ccc">none at a bend</text><g data-cell-id="none-bent" data-meta-bind="none-bent" data-meta-key="arrow-demo"><path d="M 40 230 L 100 230 L 100 290" fill="none" stroke="#333" pointer-events="stroke"/></g></svg>`;
    const uid = await createDiagram(config, {
      svg,
      height: 18,
      zoom: { mode: 'custom', percent: scale * 100, wheel: false, pan: false },
      targets: [promTarget('load', 'label_replace(vector(40), "job", "arrow-demo", "", "")')],
      fieldConfig: { defaults: { unit: 'bps', color: { mode: 'fixed', fixedColor: '#00ff00' } }, overrides: [] },
      options: { linkWidth: { min: 10, max: 10 }, legend: { show: false } },
    });
    await gotoDashboardPage({ uid });
    const panel = page.getByTestId('dmap-panel');
    await expect(panel.locator('polyline.dmap-half')).toHaveCount(9);
    for (const style of styles) {
      const overlay = panel.locator(`g.dmap-overlay[data-dmap-cell="${style}"]`);
      await expect(overlay.locator('polygon')).toHaveCount(style === 'none' ? 0 : 2);
      const geometry = await overlay.evaluate((el) => {
        const points = (p: Element) => (p.getAttribute('points') ?? '').split(' ').map((v) => v.split(',').map(Number));
        const lines = Array.from(el.querySelectorAll('polyline'), points);
        const heads = Array.from(el.querySelectorAll('polygon'), points);
        return { bases: heads.map(([, a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1])), lines };
      });
      expect(geometry.bases).toEqual(style === 'none' ? [] : style === 'point' ? [10, 10] : [24, 24]);
      if (style === 'none') {
        expect(geometry.lines[0].at(-1)).toEqual(geometry.lines[1][0]);
      }
    }
    const noneBent = panel.locator('g.dmap-overlay[data-dmap-cell="none-bent"]');
    await expect(noneBent.locator('polygon')).toHaveCount(0);
    const noneLines = await noneBent
      .locator('polyline')
      .evaluateAll((lines) => lines.map((line) => line.getAttribute('points')!.split(' ')));
    expect(noneLines[0].at(-1)).toBe('84,230');
    expect(noneLines[1][0]).toBe('84,230');
    const bent = panel.locator('polygon.dmap-arrow[data-dmap-cell="point-bent"]');
    await expect(bent).toHaveCount(1);
    const bentPoints = (await bent.getAttribute('points'))!.split(' ');
    expect(bentPoints[0]).toBe('486,250');
    expect(bentPoints).toContain('485,244');
    expect(bentPoints).toContain('475,244');
    expect(bentPoints.length).toBeGreaterThan(3);
    const bentLine = panel.locator('polyline.dmap-half[data-dmap-cell="point-bent"]');
    expect((await bentLine.getAttribute('points'))!.split(' ').at(-1)).toBe('480,244.1');
    const region = await panel
      .locator('polygon.dmap-arrow[data-dmap-cell="point"]')
      .first()
      .evaluate((head) => {
        const parent = head.closest('[data-testid="dmap-panel"]')!;
        const box = parent.getBoundingClientRect();
        const m = (head as SVGGraphicsElement).getScreenCTM()!;
        const point = new DOMPoint(300, 50).matrixTransform(m);
        const bentBase = new DOMPoint(480, 244).matrixTransform(m);
        return {
          x: point.x - box.x,
          y: point.y - box.y,
          scale: Math.hypot(m.a, m.b),
          width: box.width,
          bentX: bentBase.x - box.x,
          bentY: bentBase.y - box.y,
        };
      });
    expect(region.scale).toBeCloseTo(scale, 2);
    const shot = await panel.screenshot();
    fs.mkdirSync('local', { recursive: true });
    fs.writeFileSync(scale === 1 ? 'local/arrows-point.png' : 'local/arrows-triangle-none.png', shot);
    const pixels = await page.evaluate(
      async ({ png, region }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, img.width, img.height).data;
        const k = img.width / region.width;
        const at = (x: number, y: number) => {
          const i = (Math.round(y * k) * img.width + Math.round(x * k)) * 4;
          return px[i + 1] > 180 && px[i] < 70 && px[i + 2] < 70;
        };
        let outside = 0;
        let seam = 0;
        let samples = 0;
        for (let x = -15 * region.scale; x <= 15 * region.scale; x++) {
          for (const side of [-1, 1]) {
            for (let y = 5 * region.scale + 1.5; y <= 13 * region.scale; y++) {
              outside += Number(at(region.x + x, region.y + side * y));
            }
          }
        }
        // The middle of each base must have solid colour across the stroke/head join.
        for (const side of [-1, 1]) {
          for (let x = -2 * region.scale; x <= 2 * region.scale; x++) {
            samples++;
            seam += Number(at(region.x + side * 12 * region.scale + x, region.y));
          }
        }
        for (let y = -2 * region.scale; y <= 2 * region.scale; y++) {
          samples++;
          seam += Number(at(region.bentX, region.bentY + y));
        }
        return { outside, seam, samples };
      },
      { png: shot.toString('base64'), region }
    );
    expect(pixels.outside, 'point heads add no colour outside the stroke band').toBe(0);
    expect(pixels.seam, 'both stroke/head joins stay solid').toBe(pixels.samples);
  });
}

/** The WAN links carry percent labels and a status from their transmit series that is stale 1 s after its sample. */
function strokeConfig(): ConfigV4 {
  const config = structuredClone(demoConfigV4);
  config.freshness = '1s';
  config.classes.wan = { ...config.classes.wan, linkLabel: 'percent', status: 'wan_tx' };
  config.classes['lan-speed'] = { ...config.classes['lan-speed'], linkLabel: 'percent' };
  return config;
}

interface HalfDraw {
  id: string;
  stroke: string;
  width: number;
  points: number;
  hidden: boolean;
  masked: boolean;
  /**
   * Screen points on the inner part of the half, outside its cuts, relative to the panel: each with a point beside
   * the stroke, whose pixel is the background that a translucent stroke mixes with.
   */
  samples: Array<[number, number, number, number]>;
}

/** The drawn state of every half of the panel, read in the page. */
function readHalves(
  panel: Locator
): Promise<{ halves: HalfDraw[]; width: number; masks: number; urls: number; cut: number }> {
  return panel.evaluate((el) => {
    const svg = el.querySelector<SVGSVGElement>('[data-testid="dmap-stage"] svg')!;
    const box = el.getBoundingClientRect();
    const halves = Array.from(svg.querySelectorAll<SVGPolylineElement>('g.dmap-overlay polyline.dmap-half')).map(
      (h) => {
        const cs = getComputedStyle(h);
        const pts = (h.getAttribute('points') ?? '')
          .trim()
          .split(/\s+/)
          .map((p) => p.split(',').map(Number));
        const dash = (h.getAttribute('stroke-dasharray') ?? '').split(' ').filter(Boolean).map(Number);
        // the arc intervals that the dash pattern cuts out
        const gaps: Array<[number, number]> = [];
        for (let i = 0, at = 0; i + 1 < dash.length; i += 2) {
          at += dash[i];
          gaps.push([at - 2, at + dash[i + 1] + 2]);
          at += dash[i + 1];
        }
        const m = h.getScreenCTM()!;
        const samples: Array<[number, number, number, number]> = [];
        const toScreen = ([x, y]: number[]) => [m.a * x + m.c * y + m.e - box.x, m.b * x + m.d * y + m.f - box.y];
        const aside = (Number(h.getAttribute('stroke-width')) / 2) * Math.hypot(m.a, m.b) + 5;
        let arc = 0;
        pts.forEach(([x, y], i) => {
          if (i > 0) {
            arc += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
          }
          // the inner points only: the ends stand under port pills and arrow heads
          if (i < 2 || i > pts.length - 4 || gaps.some(([a, b]) => arc >= a && arc <= b)) {
            return;
          }
          const [sx, sy] = toScreen([x, y]);
          const [px, py] = toScreen(pts[i - 1]);
          const len = Math.hypot(sx - px, sy - py) || 1;
          samples.push([sx, sy, sx - ((sy - py) / len) * aside, sy + ((sx - px) / len) * aside]);
        });
        return {
          id: `${h.getAttribute('data-dmap-cell')}:${h.getAttribute('data-dmap-half')}`,
          stroke: cs.stroke,
          width: Number(h.getAttribute('stroke-width')),
          points: pts.length,
          hidden: cs.visibility !== 'visible' || cs.display === 'none' || Number(cs.opacity) === 0,
          masked: h.hasAttribute('mask') || (cs.mask !== '' && cs.mask !== 'none'),
          samples,
        };
      }
    );
    return {
      halves,
      width: box.width,
      masks: svg.querySelectorAll('mask').length,
      urls: (svg.outerHTML.match(/url\(#/g) ?? []).length,
      cut: svg.querySelectorAll('polyline.dmap-half[stroke-dasharray]').length,
    };
  });
}

/** The share of the samples of each half that show its stroke colour in a screenshot of the panel. */
async function shownShares(
  page: Page,
  panel: Locator,
  halves: HalfDraw[],
  width: number
): Promise<Record<string, number>> {
  const shot = await panel.screenshot();
  if (process.env.DMAP_SCREENSHOTS) {
    fs.writeFileSync(`${process.env.DMAP_SCREENSHOTS}/link-strokes.png`, shot);
  }
  const png = shot.toString('base64');
  return page.evaluate(
    async ({ png, halves, width }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, img.width, img.height).data;
      const k = img.width / width;
      const out: Record<string, number> = {};
      for (const h of halves) {
        const [r, gr, b, alpha = 1] = (h.stroke.match(/[\d.]+/g) ?? []).map(Number);
        const at = (x: number, y: number) => (Math.round(y * k) * img.width + Math.round(x * k)) * 4;
        let hit = 0;
        for (const [x, y, bx, by] of h.samples) {
          // a translucent stroke shows its colour mixed with the background beside it
          const j = at(bx, by);
          const want = [r, gr, b].map((c, n) => alpha * c + (1 - alpha) * px[j + n]);
          let ok = false;
          for (let dx = -1; dx <= 1 && !ok; dx++) {
            for (let dy = -1; dy <= 1 && !ok; dy++) {
              const i = at(x + dx / k, y + dy / k);
              // the stroke colour, or a colour that the background beside it does not have: a status can change the
              // colour of a half between the read and the paint, a half that is gone shows the background
              ok =
                Math.abs(px[i] - want[0]) + Math.abs(px[i + 1] - want[1]) + Math.abs(px[i + 2] - want[2]) < 60 ||
                Math.abs(px[i] - px[j]) + Math.abs(px[i + 1] - px[j + 1]) + Math.abs(px[i + 2] - px[j + 2]) > 90;
            }
          }
          hit += ok ? 1 : 0;
        }
        out[h.id] = h.samples.length ? hit / h.samples.length : 1;
      }
      return out;
    },
    { png, halves, width }
  );
}

/**
 * Every half is drawn: in the DOM (stroke, width, points, no mask) and on the screen. Other cells can cover a half
 * (an edge label with a background): the screen check compares each half with the first paint (`seen`), where most
 * halves must show.
 */
async function expectAllDrawn(page: Page, panel: Locator, step: string, count: number, seen: Map<string, number>) {
  // the paint runs in an animation frame after the data
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const state = await readHalves(panel);
  expect(state.halves.length, `${step}: halves`).toBe(count);
  expect(state.masks, `${step}: no mask element`).toBe(0);
  expect(state.urls, `${step}: no url() reference`).toBe(0);
  for (const h of state.halves) {
    expect(h.points, `${step}: ${h.id} points`).toBeGreaterThanOrEqual(2);
    expect(h.width, `${step}: ${h.id} width`).toBeGreaterThan(0);
    expect(h.hidden, `${step}: ${h.id} hidden`).toBe(false);
    expect(h.masked, `${step}: ${h.id} masked`).toBe(false);
    expect(h.stroke, `${step}: ${h.id} stroke`).toMatch(/^rgba?\(/);
    expect(h.stroke, `${step}: ${h.id} transparent`).not.toMatch(/rgba\([^)]*,\s*0\)/);
  }
  // a colour can change between the read and the screenshot (a status turns stale): read again until it holds
  let shares: Record<string, number> = {};
  for (let attempt = 0; attempt < 5; attempt++) {
    const read = await readHalves(panel);
    shares = await shownShares(page, panel, read.halves, read.width);
    const again = await readHalves(panel);
    if (JSON.stringify(again.halves) === JSON.stringify(read.halves)) {
      break;
    }
  }
  if (!seen.size) {
    Object.entries(shares).forEach(([id, share]) => seen.set(id, share));
    const shown = [...seen.values()].filter((share) => share >= 0.5).length;
    expect(shown, `${step}: halves on screen ${JSON.stringify(shares)}`).toBeGreaterThanOrEqual(0.75 * count);
  }
  for (const [id, share] of Object.entries(shares)) {
    if ((seen.get(id) ?? 0) >= 0.5) {
      expect(share, `${step}: ${id} on screen`).toBeGreaterThanOrEqual(0.25);
    }
  }
  return state;
}

/** Holds the next query requests until the returned release runs; `fail` aborts them instead. */
async function gateQueries(page: Page, fail: boolean) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let held = 0;
  const handler = async (route: Route) => {
    held++;
    if (fail) {
      await route.abort('failed').catch(() => {});
      return;
    }
    await gate;
    await route.continue().catch(() => {});
  };
  await page.route('**/api/ds/query*', handler);
  return {
    held: () => held,
    release: async () => {
      await page.unroute('**/api/ds/query*', handler);
      open();
    },
  };
}

/** The page goes hidden: no animation frame runs and the document reports `hidden` until `show` runs. */
async function hidePage(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const queue = new Map<number, FrameRequestCallback>();
    let n = 1e6;
    w.__dmapFrames = { real: window.requestAnimationFrame, cancel: window.cancelAnimationFrame, queue };
    window.requestAnimationFrame = (cb) => {
      queue.set(++n, cb);
      return n;
    };
    window.cancelAnimationFrame = (id) => {
      queue.delete(id);
    };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  return () =>
    page.evaluate(() => {
      const w = window as unknown as {
        __dmapFrames: {
          real: typeof requestAnimationFrame;
          cancel: typeof cancelAnimationFrame;
          queue: Map<number, FrameRequestCallback>;
        };
      };
      const { real, cancel, queue } = w.__dmapFrames;
      window.requestAnimationFrame = real;
      window.cancelAnimationFrame = cancel;
      Reflect.deleteProperty(document, 'visibilityState');
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      const pending = [...queue.values()];
      queue.clear();
      real((t) => pending.forEach((cb) => cb(t)));
    });
}

test('every link half stays drawn through refreshes, stale status, a loading and a failed refresh and a hidden page', async ({
  page,
  createDiagram,
  gotoDashboardPage,
  readProvisionedDataSource,
}) => {
  test.setTimeout(240_000);
  const prom = await readProvisionedDataSource({ fileName: 'victoriametrics.yaml' });
  const datasource = { uid: prom.uid, type: prom.type };
  const config = strokeConfig();
  const uid = await createDiagram(config, {
    panels: [{ config, svg: demoSvg, title: 'strokes L3' }],
    targets: demoPanel.targets.map((t) => promTarget(t.refId, String(t.expr), { ...t, datasource })),
    fieldConfig: demoPanel.fieldConfig,
    height: 18,
    zoom: { mode: 'fit', wheel: false, pan: false },
    refresh: '5s',
  });
  const dashboardPage = await gotoDashboardPage({ uid });
  const panel = (await dashboardPage.getPanelByTitle('strokes L3')).locator;
  await expect(panel.locator('text.dmap-link-label').first()).toHaveAttribute('data-dmap-placed-at', /\d+/);
  const count = await panel.locator('g.dmap-overlay polyline.dmap-half').count();
  expect(count).toBeGreaterThan(4);
  const seen = new Map<string, number>();
  const nextQuery = () => page.waitForResponse((r) => r.url().includes('/api/ds/query'), { timeout: 30_000 });

  const first = await expectAllDrawn(page, panel, 'first paint', count, seen);
  // the WAN labels stand on their strokes: the cut is in the test
  expect(first.cut).toBeGreaterThan(0);

  for (let round = 0; round < 2; round++) {
    // a refresh, then the status goes stale 1 s after its sample: the halves take the stale colour
    await nextQuery();
    await expect(panel.locator('[data-dmap-status="stale"]').first()).toBeAttached();
    await expectAllDrawn(page, panel, `round ${round}: stale`, count, seen);
    // a refresh that loads: the requests are held
    const loading = await gateQueries(page, false);
    await expect.poll(loading.held, { timeout: 30_000 }).toBeGreaterThan(0);
    await expectAllDrawn(page, panel, `round ${round}: loading`, count, seen);
    await loading.release();
    await nextQuery();
    await expectAllDrawn(page, panel, `round ${round}: loaded`, count, seen);
    // a refresh that fails
    const failing = await gateQueries(page, true);
    await expect.poll(failing.held, { timeout: 30_000 }).toBeGreaterThan(0);
    await expectAllDrawn(page, panel, `round ${round}: failed`, count, seen);
    await failing.release();
    await nextQuery();
    await expectAllDrawn(page, panel, `round ${round}: back`, count, seen);
    // a hidden page for longer than two refresh periods (Grafana holds the refresh while hidden), then the return
    const show = await hidePage(page);
    await page.waitForTimeout(12_000);
    const refreshed = nextQuery();
    await show();
    await refreshed;
    await expectAllDrawn(page, panel, `round ${round}: shown again`, count, seen);
  }
});
