#!/usr/bin/env node
/**
 * The hover card bench in the browser (not in CI, not an e2e project).
 *
 * It opens the demo dashboard on GRAFANA_URL, records a Chromium trace (devtools.timeline and the CPU profiler),
 * moves the mouse over up to 20 bound cells in turn with a 300 ms gap, and prints:
 * - the median and p90 task time of the tasks that dispatch a pointermove (the card's first commit lives there),
 * - the top ten self-time functions under those tasks,
 * - the duration of the next task after each pointer task that holds uPlot (the chart commit of the card).
 *
 * Run (the compose stack must run and dist must hold the plugin):
 *   GRAFANA_URL=http://localhost:3013 node scripts/bench/card-hover.mjs
 * Options: CELLS=20 GAP_MS=300 DASHBOARD=drawiomap-demo HEADLESS=1 TRACE=local/bench/card-hover.json
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.env.GRAFANA_URL ?? 'http://localhost:3013';
const dashboard = process.env.DASHBOARD ?? 'drawiomap-demo';
const cells = Number(process.env.CELLS ?? 20);
const gapMs = Number(process.env.GAP_MS ?? 300);
const tracePath = process.env.TRACE;

const quantile = (values, q) => {
  if (!values.length) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const ms = (us) => (us / 1000).toFixed(2);

/** The centre of a bound element: the first shape of a group, the polyline of a link half. */
async function pointOf(handle) {
  return handle.evaluate((el) => {
    const shape = el instanceof SVGGElement ? (el.querySelector('rect, ellipse, path, polygon, image') ?? el) : el;
    shape.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = shape.getBoundingClientRect();
    return r.width > 0 || r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
}

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.goto(`${url}/d/${dashboard}?kiosk`, { waitUntil: 'networkidle' });
const bound = page.locator('[data-dmap-status]');
await bound.first().waitFor({ state: 'attached', timeout: 60_000 });
// the values and the colours are there: the first request of every binding has settled
await page.waitForTimeout(2000);
const handles = await bound.elementHandles();
const points = [];
for (const handle of handles) {
  const point = await pointOf(handle);
  if (point) {
    points.push(point);
  }
  if (points.length >= cells) {
    break;
  }
}
if (points.length < 2) {
  console.error(`card-hover: ${points.length} bound cells with a layout box on ${url}/d/${dashboard}; need 2`);
  await browser.close();
  process.exit(1);
}

await page.mouse.move(1, 1);
await browser.startTracing(page, {
  categories: [
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-v8.cpu_profiler',
    'v8.execute',
  ],
});
let opened = 0;
for (const point of points) {
  // from beside the cell, so the page sees an enter; the last move opens the card
  await page.mouse.move(point.x + 24, point.y);
  await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.waitForTimeout(gapMs);
  opened += (await page.getByTestId('dmap-card').count()) > 0 ? 1 : 0;
}
const buffer = await browser.stopTracing();
await browser.close();
if (tracePath) {
  mkdirSync(dirname(tracePath), { recursive: true });
  writeFileSync(tracePath, buffer);
}

const { traceEvents } = JSON.parse(buffer.toString());
const inWindow = (e, task) => e.ts >= task.ts && e.ts <= task.ts + task.dur;

// the pointermove tasks of the renderer main thread
const dispatches = traceEvents.filter(
  (e) => e.name === 'EventDispatch' && ['pointermove', 'mousemove'].includes(e.args?.data?.type)
);
const threads = new Set(dispatches.map((e) => `${e.pid}:${e.tid}`));
const tasks = traceEvents
  .filter((e) => e.name === 'RunTask' && e.ph === 'X' && threads.has(`${e.pid}:${e.tid}`))
  .sort((a, b) => a.ts - b.ts);
const pointerTasks = tasks.filter((task) =>
  dispatches.some((d) => d.pid === task.pid && d.tid === task.tid && inWindow(d, task))
);

// the CPU profile samples: time per call frame, from the Profile and ProfileChunk events
const samples = [];
const profiles = new Map();
for (const e of traceEvents) {
  if (e.name === 'Profile' && e.args?.data?.startTime !== undefined) {
    profiles.set(e.id, { time: e.args.data.startTime, nodes: new Map(), pid: e.pid });
  }
}
for (const e of traceEvents.filter((e) => e.name === 'ProfileChunk').sort((a, b) => a.ts - b.ts)) {
  const profile = profiles.get(e.id);
  const data = e.args?.data;
  if (!profile || !data) {
    continue;
  }
  for (const node of data.cpuProfile?.nodes ?? []) {
    profile.nodes.set(node.id, node.callFrame);
  }
  const ids = data.cpuProfile?.samples ?? [];
  const deltas = data.timeDeltas ?? [];
  ids.forEach((id, i) => {
    profile.time += deltas[i] ?? 0;
    const frame = profile.nodes.get(id);
    samples.push({ ts: profile.time, dur: deltas[i + 1] ?? deltas[i] ?? 0, frame, pid: profile.pid });
  });
}
const label = (frame) => {
  if (!frame) {
    return '(unknown)';
  }
  const file = (frame.url ?? '').split('/').pop();
  return `${frame.functionName || '(anonymous)'} ${file ? `${file}:${frame.lineNumber + 1}` : ''}`.trim();
};
const holdsUplot = (task) =>
  samples.some(
    (s) =>
      s.pid === task.pid &&
      inWindow(s, task) &&
      (/uplot/i.test(s.frame?.url ?? '') || /^uPlot/.test(s.frame?.functionName ?? ''))
  );

// One hover is a burst of pointermove tasks; the gap separates the bursts. The longest task of a burst is the one
// that opened the card (the first commit); the next long task after it is the chart commit (the transition).
const bursts = [];
for (const task of pointerTasks) {
  const last = bursts.at(-1);
  if (last && task.ts - last.at(-1).ts < (gapMs * 1000) / 3) {
    last.push(task);
  } else {
    bursts.push([task]);
  }
}
const openTasks = bursts.map((burst) => burst.reduce((a, b) => (b.dur > a.dur ? b : a)));
const isPointer = new Set(pointerTasks);
const chartTasks = openTasks.flatMap((task) => {
  const end = task.ts + task.dur;
  const next = tasks.find((t) => t.ts > end && t.ts < end + (gapMs * 1000) / 3 && t.dur > 1000 && !isPointer.has(t));
  return next ? [next] : [];
});
const selfTime = (list) => {
  const self = new Map();
  for (const task of list) {
    for (const s of samples) {
      if (s.pid === task.pid && inWindow(s, task)) {
        const key = label(s.frame);
        self.set(key, (self.get(key) ?? 0) + s.dur);
      }
    }
  }
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
};
const stats = (list) => {
  const durations = list.map((t) => t.dur);
  return `${list.length}; median ${ms(quantile(durations, 0.5))} ms, p90 ${ms(quantile(durations, 0.9))} ms, max ${ms(Math.max(0, ...durations))} ms`;
};

console.log(`card-hover on ${url}/d/${dashboard}: ${points.length} cells, ${gapMs} ms gap, ${opened} cards opened`);
console.log(`pointermove tasks, all: ${stats(pointerTasks)}`);
console.log(`pointermove task that opened the card (longest of each hover): ${stats(openTasks)}`);
console.log(
  `next long task after it (the chart commit; ${chartTasks.filter(holdsUplot).length} with a uPlot frame): ${stats(chartTasks)}`
);
console.log('top self-time functions under the opening pointermove tasks:');
for (const [name, dur] of selfTime(openTasks)) {
  console.log(`  ${ms(dur).padStart(8)} ms  ${name}`);
}
console.log('top self-time functions under the chart commit tasks:');
for (const [name, dur] of selfTime(chartTasks)) {
  console.log(`  ${ms(dur).padStart(8)} ms  ${name}`);
}
