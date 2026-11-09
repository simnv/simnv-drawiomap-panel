import type { APIRequestContext, Locator } from '@playwright/test';
import { expect, test } from '../authoring-fixtures';

export const dark = (params: Record<string, string> = {}) => new URLSearchParams({ theme: 'dark', ...params });
/** The dark theme and no Grafana chrome: no menu, no time picker, no variables, no links. For dashboard views. */
export const quiet = (params: Record<string, string> = {}) =>
  dark({
    kiosk: 'true',
    '_dash.hideTimePicker': 'true',
    '_dash.hideVariables': 'true',
    '_dash.hideLinks': 'true',
    ...params,
  });
export const half = (scope: Locator, cell: string) =>
  scope.locator(`polyline.dmap-half[data-dmap-half="a2b"][data-dmap-cell="${cell}"]`);

/**
 * A copy of the demo dashboard with the link value labels of the WAN links, so the images show them. Each spec file
 * has its own uid: Playwright runs the files in parallel, and one file must not delete the copy of another.
 */
export const LABELLED = 'docs-demo-labels';
export const LABELLED_HERO = 'docs-demo-labels-hero';
async function createLabelledCopy(request: APIRequestContext, uid: string) {
  const demo = await (await request.get('/api/dashboards/uid/drawiomap-demo')).json();
  const source = demo.dashboard.panels.find((p: { id: number }) => p.id === 1);
  const config = structuredClone(source.options.config);
  config.classes.wan.linkLabel = 'value';
  const panel = { ...source, options: { ...source.options, config } };
  const dashboard = { ...demo.dashboard, id: null, uid, title: uid, refresh: '', panels: [panel] };
  const response = await request.post('/api/dashboards/db', { data: { dashboard, overwrite: true } });
  expect(response.ok(), await response.text()).toBe(true);
}

const adminRequest = (playwright: typeof import('@playwright/test'), baseURL: string | undefined) =>
  playwright.request.newContext({ baseURL, storageState: 'playwright/.auth/admin.json' });

/** Creates the labelled copy before the tests of the file and deletes it after them. */
export function useLabelledCopy(uid: string) {
  test.beforeAll(async ({ playwright }, testInfo) => {
    const request = await adminRequest(playwright, testInfo.project.use.baseURL);
    await createLabelledCopy(request, uid);
    await request.dispose();
  });
  test.afterAll(async ({ playwright }, testInfo) => {
    const request = await adminRequest(playwright, testInfo.project.use.baseURL);
    await request.delete(`/api/dashboards/uid/${uid}`);
    await request.dispose();
  });
}
