import { defineConfig } from '@playwright/test';
import config from '../playwright.config';

process.env.AUTHORING_COMPAT = '1';

// The package scripts keep their readiness gate; browser requests use this worker's stack.
export default defineConfig(config, {
  testDir: '.',
  // Only the compat spec: testDir '.' alone would match the whole suite and run it on one worker.
  testMatch: 'authoring-compat.spec.ts',
  workers: 1,
  use: {
    ...config.use,
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    baseURL: process.env.AUTHORING_GRAFANA_URL || 'http://localhost:3412',
  },
});
