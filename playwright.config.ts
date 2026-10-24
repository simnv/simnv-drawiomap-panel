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
 */
const chromium = baseConfig.projects!.find((p) => p.name === 'chromium')!;
const webkit = process.env.PW_WEBKIT
  ? [{ ...chromium, name: 'webkit', use: { ...chromium.use, ...devices['Desktop Safari'] } }]
  : [];

export default defineConfig<PluginOptions>(baseConfig, {
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  projects: [...baseConfig.projects!, ...webkit],
  // The HTML report costs time on every run. Write it in CI, or locally with PW_HTML=1.
  reporter: process.env.CI || process.env.PW_HTML ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.GRAFANA_URL || 'http://localhost:3012',
    actionTimeout: 10_000,
  },
});
