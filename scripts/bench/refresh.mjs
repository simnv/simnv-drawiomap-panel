#!/usr/bin/env node
/**
 * The data refresh bench in the browser (not in CI, not an e2e project).
 *
 * It opens the demo dashboard on GRAFANA_URL, puts a MutationObserver on the stage of every panel of this plugin,
 * counts the calls of the path API (getTotalLength, getPointAtLength, getCTM) and times every animation frame
 * callback that mutates a stage (the apply pass: the applier, the overlay, the link labels). Then it clicks the
 * refresh button REFRESHES times with a gap and prints, per refresh:
 * - the DOM mutations under the stages, by kind (attributes, added and removed nodes, text),
 * - the duration of the apply passes (one per panel and refresh),
 * - the path API calls.
 *
 * Run (the compose stack must run and dist must hold the plugin):
 *   GRAFANA_URL=http://localhost:3013 node scripts/bench/refresh.mjs
 * Options: REFRESHES=10 GAP_MS=1500 DASHBOARD=drawiomap-demo HEADLESS=1
 */
import { chromium } from '@playwright/test';

const url = process.env.GRAFANA_URL ?? 'http://localhost:3013';
const dashboard = process.env.DASHBOARD ?? 'drawiomap-demo';
const refreshes = Number(process.env.REFRESHES ?? 10);
const gapMs = Number(process.env.GAP_MS ?? 1500);

const quantile = (values, q) => {
  if (!values.length) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const fixed = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();

// Before the plugin loads: the counters, the frame timer and the observer hook.
await page.addInitScript(() => {
  const bench = {
    api: { getTotalLength: 0, getPointAtLength: 0, getCTM: 0 },
    mutations: { attributes: 0, added: 0, removed: 0, text: 0, records: 0 },
    passes: [],
    observers: [],
  };
  window.__dmapBench = bench;
  const count = (proto, name) => {
    const original = proto[name];
    if (typeof original !== 'function') {
      return;
    }
    proto[name] = function (...args) {
      bench.api[name]++;
      return original.apply(this, args);
    };
  };
  count(SVGPathElement.prototype, 'getTotalLength');
  count(SVGPathElement.prototype, 'getPointAtLength');
  count(SVGGraphicsElement.prototype, 'getCTM');
  const tally = (records) => {
    for (const r of records) {
      bench.mutations.records++;
      if (r.type === 'attributes') {
        bench.mutations.attributes++;
      } else if (r.type === 'characterData') {
        bench.mutations.text++;
      } else {
        bench.mutations.added += r.addedNodes.length;
        bench.mutations.removed += r.removedNodes.length;
      }
    }
    return records.length;
  };
  const take = () => bench.observers.reduce((n, o) => n + tally(o.takeRecords()), 0);
  /** Observes the stage of every panel of the plugin that is in the page now. */
  bench.observe = () => {
    for (const stage of document.querySelectorAll('[data-testid="dmap-stage"]')) {
      if (stage.__dmapObserved) {
        continue;
      }
      stage.__dmapObserved = true;
      const o = new MutationObserver(tally);
      o.observe(stage, { attributes: true, childList: true, subtree: true, characterData: true });
      bench.observers.push(o);
    }
    return bench.observers.length;
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      take();
      const api = { ...bench.api };
      const start = performance.now();
      cb(t);
      const ms = performance.now() - start;
      const records = take();
      if (records > 0) {
        bench.passes.push({
          ms,
          records,
          getTotalLength: bench.api.getTotalLength - api.getTotalLength,
          getPointAtLength: bench.api.getPointAtLength - api.getPointAtLength,
          getCTM: bench.api.getCTM - api.getCTM,
        });
      }
    });
  bench.snapshot = () => {
    take();
    return JSON.parse(JSON.stringify({ api: bench.api, mutations: bench.mutations, passes: bench.passes.length }));
  };
});

await page.goto(`${url}/d/${dashboard}`, { waitUntil: 'networkidle' });
const bound = page.locator('[data-dmap-status]');
await bound.first().waitFor({ state: 'attached', timeout: 60_000 });
// the values and the colours are there: the first request of every binding has settled
await page.waitForTimeout(2000);
const stages = await page.evaluate(() => window.__dmapBench.observe());
const halves = await page.locator('polyline.dmap-half').count();
const cells = await page.locator('[data-testid="dmap-stage"] [data-cell-id]').count();
const refreshButton = page.getByTestId('data-testid RefreshPicker run button');
if ((await refreshButton.count()) === 0) {
  console.error('refresh: no refresh button on the page; open the dashboard without kiosk mode');
  await browser.close();
  process.exit(1);
}

const snapshot = () => page.evaluate(() => window.__dmapBench.snapshot());
const passes = (from) => page.evaluate((n) => JSON.parse(JSON.stringify(window.__dmapBench.passes.slice(n))), from);
const rounds = [];
for (let i = 0; i < refreshes; i++) {
  const before = await snapshot();
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/api/ds/query'));
  await refreshButton.dispatchEvent('click');
  await (await answered).finished();
  await page.waitForTimeout(gapMs);
  const after = await snapshot();
  const delta = (pick) => pick(after) - pick(before);
  rounds.push({
    records: delta((s) => s.mutations.records),
    attributes: delta((s) => s.mutations.attributes),
    added: delta((s) => s.mutations.added),
    removed: delta((s) => s.mutations.removed),
    text: delta((s) => s.mutations.text),
    getTotalLength: delta((s) => s.api.getTotalLength),
    getPointAtLength: delta((s) => s.api.getPointAtLength),
    getCTM: delta((s) => s.api.getCTM),
    passes: await passes(before.passes),
  });
}
await browser.close();

const column = (name) => rounds.map((r) => r[name]);
const stat = (values) => `median ${fixed(quantile(values, 0.5))}, max ${fixed(Math.max(...values))}`;
const passMs = rounds.flatMap((r) => r.passes.map((p) => p.ms));
const passesPerRefresh = rounds.map((r) => r.passes.length);
console.log(
  `refresh on ${url}/d/${dashboard}: ${stages} stages, ${cells} cells, ${halves} link halves, ${refreshes} refreshes, ${gapMs} ms gap`
);
console.log(`DOM mutation records under the stages per refresh: ${stat(column('records'))}`);
console.log(
  `  attributes ${stat(column('attributes'))}; nodes added ${stat(column('added'))}; nodes removed ${stat(column('removed'))}; text ${stat(column('text'))}`
);
console.log(
  `apply passes (animation frame callbacks that mutated a stage) per refresh: ${stat(passesPerRefresh)}; duration: median ${fixed(quantile(passMs, 0.5))} ms, p90 ${fixed(quantile(passMs, 0.9))} ms, max ${fixed(Math.max(0, ...passMs))} ms`
);
console.log(
  `path API calls per refresh: getTotalLength ${stat(column('getTotalLength'))}; getPointAtLength ${stat(column('getPointAtLength'))}; getCTM ${stat(column('getCTM'))}`
);
