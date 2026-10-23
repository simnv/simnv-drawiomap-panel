import { openBindingsPopup, popupInspector, selectStageCell } from './authoring-controls';
import { expect, saveDashboard, test } from './authoring-fixtures';
import { inflateRawSync } from 'node:zlib';

test('edit mode opens the bundled draw.io editor, saves, and the panel updates', async ({
  gotoPanelEditPage,
  page,
}) => {
  // The bundled editor is served by Grafana from the plugin directory. It must not contact other hosts.
  const grafanaHost = new URL(process.env.GRAFANA_URL || 'http://localhost:3012').host;
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.host !== grafanaHost) {
      external.push(r.url());
    }
  });
  const cspViolations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) {
      cspViolations.push(m.text());
    }
  });
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '2' });
  // The Diagram option group is collapsed by default.
  await panelEditPage.getCustomOptions('Diagram').expand();
  const status = page.getByTestId('dmap-diagram-status');
  await expect(status).toBeVisible();
  const hashBefore = await status.getAttribute('data-dmap-hash');
  expect(hashBefore).toBeTruthy();

  await page.getByTestId('dmap-open-editor').click();
  const frameEl = page.getByTestId('dmap-editor-frame');
  await expect(frameEl).toBeAttached();
  await expect(frameEl).toHaveAttribute('srcdoc', /public\/plugins\/simnv-drawiomap-panel\/drawio\//);
  // Opaque origin: an iframe sandbox without allow-same-origin.
  const sandbox = (await frameEl.getAttribute('sandbox')) ?? '';
  expect(sandbox.split(' ')).toContain('allow-scripts');
  expect(sandbox.split(' ')).not.toContain('allow-same-origin');
  await expect(page.getByTestId('dmap-editor-modal')).toHaveAttribute('data-dmap-editor-phase', 'loaded', {
    timeout: 60_000,
  });

  const frame = page.frameLocator('[data-testid="dmap-editor-frame"]');
  const canvas = frame.locator('.geDiagramContainer');
  await expect(canvas).toBeVisible({ timeout: 60_000 });

  // Script in the editor frame cannot reach the Grafana page, its cookies, its storage or its API.
  const isolation = await canvas.evaluate(async () => {
    const probe = (f: () => unknown) => {
      try {
        const v = f();
        return v === '' ? 'empty' : `readable: ${String(v).slice(0, 40)}`;
      } catch (e) {
        return `throws ${(e as Error).name}`;
      }
    };
    // The CSP <meta> blocks /api. A file that the CSP allows still fails: Grafana sends no CORS headers.
    let api: string;
    try {
      const r = await fetch('js/PreConfig.js', { credentials: 'include' });
      api = `status ${r.status}`;
    } catch (e) {
      api = `throws ${(e as Error).name}`;
    }
    return {
      origin: window.origin,
      parentDocument: probe(() => window.top!.document.title),
      cookie: probe(() => document.cookie),
      localStorage: probe(() => window.localStorage.length),
      fetch: api,
    };
  });
  expect(isolation).toEqual({
    origin: 'null',
    parentDocument: 'throws SecurityError',
    cookie: 'throws SecurityError',
    localStorage: 'throws SecurityError',
    fetch: 'throws TypeError',
  });

  // Minimal edit: a click on the first shape in the Shapes sidebar inserts that shape into the diagram.
  await frame.locator('.geSidebar .geItem').first().click({ timeout: 10_000 });

  // Plain Save posts {event:'save'}. The host answers with an export and stores {xml, svg}.
  // The floating Format window covers part of the Save button, so dispatch the click event directly.
  await frame.getByTitle(/^Save \(/).dispatchEvent('click');

  await expect(page.getByTestId('dmap-diagram-message')).toContainText('Saved', { timeout: 60_000 });
  await expect(status).not.toHaveAttribute('data-dmap-hash', hashBefore!);
  await expect(page.getByTestId('dmap-panel')).not.toHaveAttribute('data-dmap-hash', hashBefore!);
  // The modal stays open after a plain save.
  await expect(page.getByTestId('dmap-editor-modal')).toBeVisible();
  expect(external).toEqual([]);
  expect(cspViolations).toEqual([]);
});

// An image shape that uses a PNG file of dist/drawio. The opaque-origin frame cannot read that file (no CORS):
// the host reads it for the export (src/editor/files.ts).
const IMAGE_XML =
  '<mxfile><diagram id="img" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="2" value="" style="shape=image;image=img/clipart/Gear_128x128.png;" vertex="1" parent="1">' +
  '<mxGeometry x="20" y="20" width="80" height="80" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';

test('the bundled editor embeds image files of the plugin in the saved SVG', async ({ gotoPanelEditPage, page }) => {
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '2' });
  await panelEditPage.getCustomOptions('Diagram').expand();
  // Apply pasted XML: the editor opens in export-only mode, exports the SVG and closes.
  await page.getByTestId('dmap-paste-xml').fill(IMAGE_XML);
  await page.getByRole('button', { name: 'Apply pasted XML' }).click();
  await expect(page.getByTestId('dmap-diagram-message')).toContainText('Saved', { timeout: 60_000 });
  await expect(page.getByTestId('dmap-editor-modal')).toHaveCount(0);
  const href = await page
    .getByTestId('dmap-panel')
    .locator('image')
    .first()
    .evaluate((el) => el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '');
  expect(href).toMatch(/^data:image\/png;base64,/);
});

test('geometry export keeps semantic identities and chart assignments through dashboard save and reopen', async ({
  page,
  request,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(config);
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const popup = await openBindingsPopup(page);
  await popupInspector(popup).getByRole('button', { name: 'Edit geometry in draw.io' }).click();
  await expect(page.getByTestId('dmap-editor-modal')).toHaveAttribute('data-dmap-editor-phase', 'loaded', {
    timeout: 60000,
  });
  const frame = page.frameLocator('[data-testid="dmap-editor-frame"]');
  await expect(frame.locator('.geDiagramContainer')).toBeVisible();
  await frame.locator('.geSidebar .geItem').first().click();
  const stage = page.getByTestId('dmap-panel');
  const previousHash = await stage.getAttribute('data-dmap-hash');
  const popupStage = popup.getByTestId('dmap-popup-stage');
  await frame.getByTitle(/^Save \(/).dispatchEvent('click');
  // The new geometry is a draft in the popup stage. The panel behind keeps the saved diagram until Apply.
  await expect(popupStage).not.toHaveAttribute('data-dmap-hash', previousHash!);
  await expect(stage).toHaveAttribute('data-dmap-hash', previousHash!);
  await page
    .getByRole('dialog')
    .filter({ has: page.getByTestId('dmap-editor-modal') })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(popupStage.locator('[data-cell-id="device-1"]')).toHaveAttribute('data-meta-pg-id', 'device-1');
  await expect(popupStage.locator('[data-cell-id="chart-1"]')).toBeAttached();
  await popup.getByRole('button', { name: 'Apply and close', exact: true }).click();
  await expect(stage).not.toHaveAttribute('data-dmap-hash', previousHash!);
  await expect(stage.locator('[data-cell-id="device-1"]')).toHaveAttribute('data-meta-pg-id', 'device-1');
  await saveDashboard(page, panelEditPage);
  const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
  const options = saved.dashboard.panels[0].options;
  const encoded = /<diagram[^>]*>([^<]+)<\/diagram>/.exec(options.diagram.xml)?.[1];
  const decoded = encoded
    ? decodeURIComponent(inflateRawSync(Buffer.from(encoded, 'base64')).toString())
    : options.diagram.xml;
  expect(decoded).toContain('pg-id="device-1"');
  expect(options.config.widgets[0].anchorCellId).toBe('chart-1');
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const again = await openBindingsPopup(page);
  await selectStageCell(again, 'chart-1');
  await expect(popupInspector(again).getByLabel('Chart label', { exact: true })).toHaveValue('Standalone trend');
});
