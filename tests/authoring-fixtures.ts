import fs from 'node:fs';
import { expect, PanelEditPage, test as base, type DashboardPage } from '@grafana/plugin-e2e';
import type { Page, TestInfo } from '@playwright/test';
import type { DiagramConfig } from '../src/model/config';
import { authoringConfig } from '../src/fixtures/authoring-config';

export { expect };

const DEMO_UID = 'drawiomap-demo';
/**
 * The provisioned demo dashboard refreshes every 10 s, which only re-queries and redraws the panels during a test.
 * A day never fires within a test. A test that needs a refresh passes its own `refresh` parameter.
 */
const QUIET_REFRESH = '1d';
function quietDemo(uid: string | undefined, queryParams?: URLSearchParams) {
  const params = new URLSearchParams(queryParams);
  if (uid === DEMO_UID && !params.has('refresh')) {
    params.set('refresh', QUIET_REFRESH);
  }
  return params;
}

export const svg = fs.readFileSync('src/fixtures/authoring.svg', 'utf8');
export const xml = fs.readFileSync('src/fixtures/authoring.drawio', 'utf8');
export const test = base.extend<{
  config: DiagramConfig;
  createDiagram: (
    config: DiagramConfig,
    settings?: {
      clones?: number;
      svg?: string;
      height?: number;
      /** grid columns of the panel; default: the full row */
      width?: number;
      zoom?: Record<string, unknown>;
      /** Grafana panel queries; default: none */
      targets?: unknown[];
      /** Several panels with their own config, one below the other. Replaces `clones`. */
      panels?: Array<{ config: DiagramConfig; title?: string; svg?: string }>;
      /** Dashboard auto refresh, for example `5s`; default: off */
      refresh?: string;
    }
  ) => Promise<string>;
  sandboxSettings: void;
  gotoDashboardPage: (args: { uid: string; queryParams?: URLSearchParams }) => Promise<DashboardPage>;
  /** Like the plugin-e2e fixture, plus `queryParams` for the first load (for example `theme`). */
  gotoPanelEditPage: (args: {
    dashboard?: { uid?: string };
    id: string;
    queryParams?: URLSearchParams;
  }) => Promise<PanelEditPage>;
}>({
  gotoDashboardPage: async ({ gotoDashboardPage }, use) => {
    await use((args) => gotoDashboardPage({ ...args, queryParams: quietDemo(args.uid, args.queryParams) }));
  },
  gotoPanelEditPage: async ({ page, request, selectors, grafanaVersion }, use, testInfo) => {
    await use(async ({ queryParams, ...args }) => {
      const panelEditPage = new PanelEditPage({ page, request, selectors, grafanaVersion, testInfo }, args);
      await panelEditPage.goto({ queryParams: quietDemo(args.dashboard?.uid, queryParams) });
      return panelEditPage;
    });
  },
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
            ...(settings.refresh ? { refresh: settings.refresh } : {}),
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
            panels: (settings.panels ?? Array.from({ length: settings.clones ?? 1 }, () => ({ config }))).map(
              (panel, i) => {
                // `panels` lay out one below the other, as wide as the row; `clones` in one row.
                const grid = settings.panels
                  ? { x: 0, y: i * (settings.height ?? 20), w: 24 }
                  : { x: i * 12, y: 0, w: settings.width ?? (settings.clones ? 12 : 24) };
                return {
                  id: i + 1,
                  title: panel.title ?? `Sanitized topology ${i + 1}`,
                  type: 'simnv-drawiomap-panel',
                  gridPos: { ...grid, h: settings.height ?? 20 },
                  targets: settings.targets ?? [],
                  fieldConfig: { defaults: {}, overrides: [] },
                  options: {
                    config: panel.config,
                    diagram: {
                      svg: ('svg' in panel && panel.svg) || (settings.svg ?? svg),
                      xml,
                      hash: settings.panels ? `${uid}-${i}` : uid,
                    },
                    zoom: settings.zoom ?? { mode: 'fit', wheel: true, pan: true },
                  },
                };
              }
            ),
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
    // under app_sub_url the path has a prefix
    if (new URL(request.url()).pathname.endsWith('/api/ds/query') && belongsToDashboard)
      requests.push(request.postDataJSON());
  });
  return requests;
}
export async function attachJson(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`);
  fs.writeFileSync(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}
export async function saveDashboard(page: Page, panelEditPage: PanelEditPage) {
  await panelEditPage.backToDashboard();
  await page.getByRole('button', { name: /^(Save dashboard|Save)$/i }).click();
  const saved = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.request().method() !== 'GET' &&
      response.ok() &&
      (path.endsWith('/api/dashboards/db') || path.includes('/apis/dashboard.grafana.app/'))
    );
  });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Save$/ })
    .click();
  await saved;
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
