import fs from 'node:fs';
import { expect, PanelEditPage, test as base, type DashboardPage } from '@grafana/plugin-e2e';
import type { Page, TestInfo } from '@playwright/test';
import type { ConfigV4 } from '../src/model/v4';
import { authoringConfigV4 } from '../src/fixtures/authoring-config';

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

/** A Grafana panel target. A target with no `datasource` uses the default datasource. */
export type PanelTarget = { refId: string; datasource?: { type: string; uid: string } } & Record<string, unknown>;
export type FieldConfig = { defaults: Record<string, unknown>; overrides: unknown[] };
/** The provisioned datasources (provisioning/datasources/). */
export const PROMETHEUS = { type: 'prometheus', uid: 'victoriametrics' };
export const TESTDATA = { type: 'grafana-testdata-datasource', uid: 'authoring-testdata' };
/** A panel target of the VictoriaMetrics datasource. */
export const promTarget = (refId: string, expr: string, extra: Record<string, unknown> = {}): PanelTarget => ({
  refId,
  datasource: PROMETHEUS,
  expr,
  ...extra,
});
/** A panel target of the TestData datasource, for example `{ scenarioId: 'random_walk' }`. */
export const testdataTarget = (refId: string, fields: Record<string, unknown>): PanelTarget => ({
  refId,
  datasource: TESTDATA,
  ...fields,
});

/**
 * The authoring panel of the provisioned demo dashboard. scripts/build-dashboard.ts writes its targets (the refIds of
 * src/fixtures/authoring-config.ts) and its field config (the health thresholds and mappings), so the tests read them
 * from there and do not keep a second copy.
 */
const authoringPanel: { targets: PanelTarget[]; fieldConfig: FieldConfig } = JSON.parse(
  fs.readFileSync('provisioning/dashboards/demo.json', 'utf8')
).panels.find((p: { title: string }) => p.title === 'Sanitized authoring topology');
export const authoringTargets = (): PanelTarget[] => structuredClone(authoringPanel.targets);
export const authoringFieldConfig = (): FieldConfig => structuredClone(authoringPanel.fieldConfig);
/** One panel of `createDiagram` with `panels`. */
export type DiagramPanel = {
  config: ConfigV4;
  title?: string;
  svg?: string;
  /** the targets of this panel; default: the `targets` setting */
  targets?: PanelTarget[];
  /** the field config of this panel; default: the `fieldConfig` setting */
  fieldConfig?: FieldConfig;
};
/** The panel datasource for targets of more than one datasource. */
const MIXED = { type: 'datasource', uid: '-- Mixed --' };

export const test = base.extend<{
  /** A new copy of the authoring config for each test: a test can change it. */
  config: ConfigV4;
  createDiagram: (
    config: ConfigV4,
    settings?: {
      clones?: number;
      svg?: string;
      height?: number;
      /** grid columns of the panel; default: the full row */
      width?: number;
      zoom?: Record<string, unknown>;
      /** the panel targets of every panel; default: the targets of the authoring panel */
      targets?: PanelTarget[];
      /** the field config of every panel; default: the field config of the authoring panel */
      fieldConfig?: FieldConfig;
      /** the panel options besides `config`, `diagram` and `zoom`, for example `linkWidth` */
      options?: Record<string, unknown>;
      /** Several panels with their own config, one below the other. Replaces `clones`. */
      panels?: DiagramPanel[];
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
  config: async ({}, use) => {
    await use(structuredClone(authoringConfigV4));
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
            panels: (
              settings.panels ?? Array.from({ length: settings.clones ?? 1 }, (): DiagramPanel => ({ config }))
            ).map((panel, i) => {
              // `panels` lay out one below the other, as wide as the row; `clones` in one row.
              const grid = settings.panels
                ? { x: 0, y: i * (settings.height ?? 20), w: 24 }
                : { x: i * 12, y: 0, w: settings.width ?? (settings.clones ? 12 : 24) };
              return {
                id: i + 1,
                title: panel.title ?? `Sanitized topology ${i + 1}`,
                type: 'simnv-drawiomap-panel',
                gridPos: { ...grid, h: settings.height ?? 20 },
                datasource: MIXED,
                targets: panel.targets ?? settings.targets ?? authoringTargets(),
                fieldConfig: panel.fieldConfig ?? settings.fieldConfig ?? authoringFieldConfig(),
                options: {
                  ...settings.options,
                  config: panel.config,
                  diagram: {
                    svg: panel.svg ?? settings.svg ?? svg,
                    xml,
                    hash: settings.panels ? `${uid}-${i}` : uid,
                  },
                  zoom: settings.zoom ?? { mode: 'fit', wheel: true, pan: true },
                },
              };
            }),
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
