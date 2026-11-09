import type { PluginOptions } from '@grafana/plugin-e2e';
import { defineConfig, devices } from '@playwright/test';
import baseConfig from './.config/playwright.config';

/**
 * Extends the scaffolded config. See
 * https://grafana.com/developers/plugin-tools/how-to-guides/extend-configurations#extend-the-playwright-config
 *
 * GRAFANA_URL selects the Grafana version: http://localhost:3012 (12.4) or http://localhost:3013 (13.2).
 * VictoriaMetrics needs about one minute of counters before rate() is stable, so the timeouts are long.
 * PW_WEBKIT=1 adds a WebKit project (`--project webkit`) for the checks that differ in Safari, for example the
 * paint cost of the pinned-card tooltip. The default run stays Chromium only.
 * PW_DOCS=1 adds the `docs` project, which captures the documentation images (`npm run docs:screenshots` sets it).
 * Without it, no run writes an image.
 *
 * Two Chromium projects split the suite by what a test depends on (docs/research/test-cost-audit.md, section 2.3):
 * - `matrix`: the tests on surfaces that differ between Grafana versions (panel edit page, dashboard save API,
 *   datasource editors, dashboard refresh, field config, plugin loading). They run on 12.4 and on 13.2.
 * - `plugin`: the tests on the plugin's own DOM. They run on 13.2 only; the release run covers 12.4 too.
 * A whole spec file is in `matrix` when its path is in MATRIX_SPECS. A single test is in `matrix` when its title
 * carries the tag `@matrix` (`test(title, { tag: '@matrix' }, fn)`). `webkit` runs everything except `tests/docs/`. `docs` (only with PW_DOCS=1) runs only `tests/docs/`.
 */
const chromium = baseConfig.projects!.find((p) => p.name === 'chromium')!;
const MATRIX_SPECS = [
  'color',
  'editor',
  'editor-refresh',
  'no-drawio',
  'options',
  'panel-edit-requests',
  'refresh',
  'reset-corner',
];
const matrixOnly = new RegExp(`@matrix|(^|[ /])(${MATRIX_SPECS.join('|')})\\.spec\\.ts`);
// tests/docs/ holds the capture of the documentation images (`npm run docs:screenshots`, project `docs`). Only the
// `docs` project runs it, and only with PW_DOCS=1, so a normal e2e run writes no image.
const docsSpecs = '**/docs/**';
const webkit = process.env.PW_WEBKIT
  ? [{ ...chromium, name: 'webkit', testIgnore: docsSpecs, use: { ...chromium.use, ...devices['Desktop Safari'] } }]
  : [];
const docs = process.env.PW_DOCS
  ? [{ ...chromium, name: 'docs', testMatch: /docs\/.*\.spec\.ts/, outputDir: 'test-results/docs' }]
  : [];

// defineConfig(base, override) merges projects by name and would keep `chromium`. Spread the base to replace it.
export default defineConfig<PluginOptions>({
  ...baseConfig,
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  projects: [
    ...baseConfig.projects!.filter((p) => p.name !== 'chromium'),
    { ...chromium, name: 'matrix', grep: matrixOnly, testIgnore: docsSpecs },
    { ...chromium, name: 'plugin', grepInvert: matrixOnly, testIgnore: docsSpecs },
    ...docs,
    ...webkit,
  ],
  // The HTML report costs time on every run. Write it in CI, or locally with PW_HTML=1.
  reporter: process.env.CI || process.env.PW_HTML ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    ...baseConfig.use,
    baseURL: process.env.GRAFANA_URL || 'http://localhost:3012',
    actionTimeout: 10_000,
  },
});
