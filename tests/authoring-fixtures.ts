import fs from 'node:fs';
import { expect, test as base } from '@grafana/plugin-e2e';
import type { Page, TestInfo } from '@playwright/test';
import type { DiagramConfigV2 } from '../src/model/config';
import { authoringConfig } from '../src/fixtures/authoring-config';

export { expect };
export const svg = fs.readFileSync('src/fixtures/authoring.svg', 'utf8');
export const xml = fs.readFileSync('src/fixtures/authoring.drawio', 'utf8');
export const test = base.extend<{
  config: DiagramConfigV2;
  createDiagram: (config: DiagramConfigV2, settings?: { clones?: number; svg?: string }) => Promise<string>;
  sandboxSettings: void;
}>({
  sandboxSettings: [
    async ({ request }, use) => {
      if (process.env.AUTHORING_SANDBOX === '1') {
        const response = await request.get('/api/frontend/settings');
        const settings = await response.json();
        expect(settings.enableFrontendSandboxForPlugins).toContain('simnv-drawiomap-panel');
        expect(settings.featureToggles.pluginsFrontendSandbox).toBe(true);
      }
      await use();
    },
    { auto: true },
  ],
  config: async ({ readProvisionedDataSource }, use) => {
    const prom = await readProvisionedDataSource({ fileName: 'victoriametrics.yaml' });
    const td = await readProvisionedDataSource({ fileName: 'authoring.yaml' });
    await use(authoringConfig(prom.uid, td.uid));
  },
  createDiagram: async ({ request }, use, testInfo) => {
    const dashboards: string[] = [];
    await use(async (config, settings = {}) => {
      const uid = `authoring-${testInfo.workerIndex}-${Date.now()}-${dashboards.length}`;
      const response = await request.post('/api/dashboards/db', {
        data: {
          dashboard: {
            uid,
            title: uid,
            schemaVersion: 39,
            editable: true,
            time: { from: 'now-1h', to: 'now' },
            templating: {
              list: [
                {
                  name: 'site',
                  type: 'custom',
                  query: '23,47',
                  current: { text: '23', value: '23' },
                  options: [
                    { text: '23', value: '23', selected: true },
                    { text: '47', value: '47' },
                  ],
                },
              ],
            },
            panels: Array.from({ length: settings.clones ?? 1 }, (_, i) => ({
              id: i + 1,
              title: `Sanitized topology ${i + 1}`,
              type: 'simnv-drawiomap-panel',
              gridPos: { x: i * 12, y: 0, w: settings.clones ? 12 : 24, h: 20 },
              targets: [],
              fieldConfig: { defaults: {}, overrides: [] },
              options: {
                config,
                rules: [],
                diagram: { svg: settings.svg ?? svg, xml, hash: uid },
                zoom: { mode: 'fit', wheel: true, pan: true },
              },
            })),
          },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      dashboards.push(uid);
      return uid;
    });
    for (const uid of dashboards) await request.delete(`/api/dashboards/uid/${uid}`);
  },
});

export function observeQueries(page: Page, dashboardUid?: string) {
  const requests: Array<{
    queries: Array<{ refId: string; datasource: { uid: string; type: string }; expr?: string }>;
    from: string;
    to: string;
  }> = [];
  page.on('request', (request) => {
    const referer = request.headers().referer;
    const belongsToDashboard = !dashboardUid || (referer && new URL(referer).pathname.includes(`/d/${dashboardUid}`));
    if (new URL(request.url()).pathname === '/api/ds/query' && belongsToDashboard)
      requests.push(request.postDataJSON());
  });
  return requests;
}
export async function attachJson(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`);
  fs.writeFileSync(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}
export async function saveDashboard(page: Page) {
  await page.getByRole('button', { name: /^(Back to dashboard|Back)$/i }).click();
  await page.getByRole('button', { name: /^(Save dashboard|Save)$/i }).click();
  const saved = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.request().method() !== 'GET' &&
      response.ok() &&
      (path === '/api/dashboards/db' || path.startsWith('/apis/dashboard.grafana.app/'))
    );
  });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Save$/ })
    .click();
  await saved;
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
