#!/usr/bin/env node
/**
 * The legend hover bench in the browser (not in CI, not an e2e project).
 *
 * It opens the demo dashboard on GRAFANA_URL, opens the colour legend of the first panel of this plugin, and moves
 * the mouse over every legend entry in turn (ROUNDS times, GAP_MS apart), then over every linked legend row of the
 * diagram. A stub of the React DevTools hook counts the React commits and the renders of these components of the
 * first panel: the panel view, the colour legend, the status band and the card. A render is a new hook list (or a
 * new props object) on the fiber of the component. It prints per hover:
 * - the React commits and the component renders,
 * - the time from the pointer event to the class change of the stage root (the highlight is on the screen next frame),
 * - the main-thread task time in the window of the hover (a Chromium trace).
 *
 * Run (the compose stack must run and dist must hold the plugin):
 *   GRAFANA_URL=http://localhost:3013 node scripts/bench/legend-hover.mjs
 * Options: ROUNDS=3 GAP_MS=300 DASHBOARD=drawiomap-demo HEADLESS=1
 */
import { chromium } from '@playwright/test';

const url = process.env.GRAFANA_URL ?? 'http://localhost:3013';
const dashboard = process.env.DASHBOARD ?? 'drawiomap-demo';
const rounds = Number(process.env.ROUNDS ?? 3);
const gapMs = Number(process.env.GAP_MS ?? 300);

const quantile = (values, q) => {
  if (!values.length) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const fixed = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');
const stat = (values) =>
  `median ${fixed(quantile(values, 0.5))}, p90 ${fixed(quantile(values, 0.9))}, max ${fixed(Math.max(...values))}`;

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.addInitScript(() => {
  const bench = { commits: 0, renders: {}, tracked: [], hovers: [], current: null };
  window.__dmapLegendBench = bench;
  // The stub of the DevTools hook: React calls onCommitFiberRoot after each commit, also in a production build.
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    isDisabled: false,
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot() {
      bench.commits++;
      bench.scan?.();
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    checkDCE() {},
  };
  /** The fiber of the nearest function component (plain, forwardRef or simple memo) that renders the element. */
  const ownerFiber = (el) => {
    const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let fiber = key ? el[key] : null;
    while (fiber && ![0, 11, 15].includes(fiber.tag)) {
      fiber = fiber.return;
    }
    return fiber;
  };
  // The hook list of a function component is a new object on each render; a bail-out keeps it.
  const marks = (fiber) => [fiber, fiber?.alternate].filter(Boolean).map((f) => f.memoizedState ?? f.memoizedProps);
  bench.arm = (panelIndex) => {
    const panel = document.querySelectorAll('[data-testid="dmap-panel"]')[panelIndex];
    bench.tracked = [
      ['view', () => panel],
      ['legend', () => panel.querySelector('[data-testid="dmap-legend"]')],
      ['band', () => panel.querySelector('[data-testid="dmap-status-band"]')],
      ['card', () => document.querySelector('[data-testid="dmap-card"]')],
    ].map(([name, find]) => ({ name, find, seen: new WeakSet() }));
    for (const t of bench.tracked) {
      bench.renders[t.name] = 0;
      for (const m of marks(ownerFiber(t.find()))) {
        if (m && typeof m === 'object') {
          t.seen.add(m);
        }
      }
    }
    bench.scan = () => {
      for (const t of bench.tracked) {
        for (const m of marks(ownerFiber(t.find()))) {
          if (m && typeof m === 'object' && !t.seen.has(m)) {
            t.seen.add(m);
            bench.renders[t.name]++;
          }
        }
      }
    };
    // the class change of the stage root: the highlight effect ran
    const root = panel.querySelector('[data-testid="dmap-stage"] > svg');
    new MutationObserver(() => {
      if (bench.current && bench.current.painted === null) {
        bench.current.painted = performance.now();
      }
    }).observe(root, { attributes: true, attributeFilter: ['class'] });
    // the pointer event that starts a hover: an entry of the panel legend or a linked row of the diagram
    document.addEventListener(
      'pointerover',
      (e) => {
        const hit =
          e.target instanceof Element &&
          panel.contains(e.target) &&
          e.target.closest('[data-testid="dmap-legend-entry"], [data-dmap-legend-row]');
        if (hit && bench.current && bench.current.at === null) {
          bench.current.at = e.timeStamp;
        }
      },
      true
    );
  };
  bench.start = (kind) => {
    bench.current = { kind, at: null, painted: null, commits: bench.commits, renders: { ...bench.renders } };
    performance.mark(`dmap-legend-hover`);
  };
  bench.end = () => {
    const c = bench.current;
    bench.current = null;
    const renders = Object.fromEntries(Object.entries(bench.renders).map(([k, v]) => [k, v - c.renders[k]]));
    bench.hovers.push({
      kind: c.kind,
      commits: bench.commits - c.commits,
      renders,
      latency: c.at !== null && c.painted !== null ? c.painted - c.at : null,
    });
  };
});

await page.goto(`${url}/d/${dashboard}?kiosk`, { waitUntil: 'networkidle' });
const panel = page.getByTestId('dmap-panel').first();
await page.locator('[data-dmap-status]').first().waitFor({ state: 'attached', timeout: 60_000 });
// the values and the colours are there: the first request of every binding has settled
await page.waitForTimeout(2000);
const handle = panel.getByTestId('dmap-legend').getByRole('button', { name: 'Legend' });
await handle.click();
await page.mouse.move(1, 1);
await page.waitForTimeout(300);
const center = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  return b && b.width > 0 && b.height > 0 ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
};
const entryPoints = [];
for (const entry of await panel.getByTestId('dmap-legend-entry').all()) {
  const p = await center(entry);
  if (p) {
    entryPoints.push(p);
  }
}
const rowPoints = [];
for (const row of await panel.locator('g[data-cell-id^="pg-legendRow~symbol:"][data-dmap-legend-row]').all()) {
  const p = await center(row);
  if (p) {
    rowPoints.push(p);
  }
}
if (!entryPoints.length) {
  console.error(`legend-hover: no legend entry on ${url}/d/${dashboard}`);
  await browser.close();
  process.exit(1);
}
await page.evaluate(() => window.__dmapLegendBench.arm(0));

await browser.startTracing(page, {
  categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing'],
});
const hover = async (kind, point) => {
  await page.evaluate((k) => window.__dmapLegendBench.start(k), kind);
  // one jump: the pointer crosses no cell of the diagram on its way
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(gapMs);
  await page.evaluate(() => window.__dmapLegendBench.end());
};
for (let r = 0; r < rounds; r++) {
  for (const p of entryPoints) {
    await hover('entry', p);
  }
}
await page.mouse.move(1, 1);
await page.waitForTimeout(gapMs);
for (let r = 0; r < rounds; r++) {
  for (const p of rowPoints) {
    await hover('row', p);
    // off the row to an empty corner, so the next row is a new hover
    await page.mouse.move(1, 1);
    await page.waitForTimeout(gapMs / 2);
  }
}
const buffer = await browser.stopTracing();
const hovers = await page.evaluate(() => window.__dmapLegendBench.hovers);
await browser.close();

// The task time in each hover window: the RunTask events of the main thread between two marks.
const { traceEvents } = JSON.parse(buffer.toString());
const marks = traceEvents
  .filter((e) => e.name === 'dmap-legend-hover' && (e.ph === 'R' || e.ph === 'I' || e.ph === 'n' || e.ph === 'b'))
  .sort((a, b) => a.ts - b.ts);
const main = marks.length ? `${marks[0].pid}:${marks[0].tid}` : null;
const tasks = traceEvents.filter((e) => e.name === 'RunTask' && e.ph === 'X' && `${e.pid}:${e.tid}` === main);
const windowMs = marks.map((m) => {
  const end = m.ts + gapMs * 1000;
  return tasks.filter((t) => t.ts >= m.ts && t.ts < end).reduce((sum, t) => sum + t.dur, 0) / 1000;
});
hovers.forEach((h, i) => {
  h.taskMs = windowMs[i] ?? NaN;
});

console.log(
  `legend-hover on ${url}/d/${dashboard}: ${entryPoints.length} entries and ${rowPoints.length} diagram rows, ${rounds} rounds, ${gapMs} ms gap`
);
for (const kind of ['entry', 'row']) {
  const list = hovers.filter((h) => h.kind === kind);
  if (!list.length) {
    continue;
  }
  const sum = (pick) => list.reduce((n, h) => n + pick(h), 0);
  const latencies = list.map((h) => h.latency).filter((v) => v !== null);
  console.log(`${kind} hovers: ${list.length}`);
  console.log(`  React commits per hover: ${stat(list.map((h) => h.commits))}`);
  console.log(
    `  renders over all hovers: ${Object.keys(list[0].renders)
      .map((name) => `${name} ${sum((h) => h.renders[name])}`)
      .join(', ')}`
  );
  console.log(`  pointer event to the class change of the root, ms: ${stat(latencies)} (${latencies.length} measured)`);
  console.log(`  main-thread task time in the hover window, ms: ${stat(list.map((h) => h.taskMs))}`);
}
