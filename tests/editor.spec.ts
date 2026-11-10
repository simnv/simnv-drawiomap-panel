import { expect, saveDashboard, test } from './authoring-fixtures';

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
  const help = page.getByTestId('dmap-editor-help');
  await help.click();
  await expect(page.getByTestId('dmap-editor-help-text')).toContainText('Keep cell IDs unchanged to retain bindings');
  await expect(page.getByTestId('dmap-editor-modal')).not.toContainText('Move or resize');
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

test('geometry export through the Diagram option keeps bind and key through dashboard save and reopen', async ({
  page,
  request,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(config);
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const stage = page.getByTestId('dmap-panel');
  // The cells bind before the edit: a router has its status, the chart cell has its chart region.
  await expect(stage.locator('[data-cell-id="device-1"]')).toHaveAttribute('data-dmap-status', 'normal');
  await expect(stage.locator('[data-dmap-chart="chart-1"]')).toBeAttached();
  const previousHash = await stage.getAttribute('data-dmap-hash');
  // P1 has no bindings popup (spec 5.0): the Diagram option opens the editor.
  await panelEditPage.getCustomOptions('Diagram').expand();
  await page.getByTestId('dmap-open-editor').click();
  const modal = page.getByTestId('dmap-editor-modal');
  await expect(modal).toHaveAttribute('data-dmap-editor-phase', 'loaded', { timeout: 60_000 });
  const frame = page.frameLocator('[data-testid="dmap-editor-frame"]');
  await expect(frame.locator('.geDiagramContainer')).toBeVisible();
  await frame.locator('.geSidebar .geItem').first().click();
  await frame.getByTitle(/^Save \(/).dispatchEvent('click');
  // The Diagram option stores the new geometry at once: the panel shows it.
  await expect(page.getByTestId('dmap-diagram-message')).toContainText('Saved', { timeout: 60_000 });
  await expect(stage).not.toHaveAttribute('data-dmap-hash', previousHash!);
  await page.getByRole('dialog').filter({ has: modal }).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(modal).toHaveCount(0);
  // The cell attributes `bind` and `key` survive the export, so the cells still bind (spec 2.1).
  const bound = async () => {
    for (const [id, bind, key] of [
      ['device-1', 'routers', 'router-1'],
      ['device-2', 'routers', 'router-2'],
      ['chart-1', 'trend-region', 'trend'],
    ]) {
      const cell = stage.locator(`[data-cell-id="${id}"]`);
      await expect(cell, id).toHaveAttribute('data-meta-bind', bind);
      await expect(cell, id).toHaveAttribute('data-meta-key', key);
    }
    await expect(stage.locator('[data-cell-id="device-1"]')).toHaveAttribute('data-dmap-status', 'normal');
    await expect(stage.locator('[data-dmap-chart="chart-1"]')).toBeAttached();
  };
  await bound();

  await saveDashboard(page, panelEditPage);
  const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
  const options = saved.dashboard.panels[0].options;
  // The stored page is not compressed: the inspector can write to it without another save in draw.io.
  expect(options.diagram.xml).toMatch(/<diagram[^>]*>\s*<mxGraphModel/);
  expect(options.diagram.xml).toMatch(/<object [^>]*id="device-1"[^>]*bind="routers"[^>]*key="router-1"/);
  expect(options.diagram.xml).toMatch(/<object [^>]*id="chart-1"[^>]*bind="trend-region"[^>]*key="trend"/);
  expect(options.diagram.svg).toContain('data-meta-bind="routers"');
  // The geometry edit does not change the bindings of the panel.
  expect(options.config).toEqual(config);

  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  await expect(stage).toHaveAttribute('data-dmap-hash', options.diagram.hash);
  await bound();
});

test('a chart assignment through the split editor survives Apply, dashboard save and reopen', async ({
  page,
  request,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(config);
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const stage = page.getByTestId('dmap-panel');
  // `ordinary-chart` is a bare mxCell with no bind: it has no chart region.
  await expect(stage.locator('[data-dmap-chart="chart-1"]')).toBeAttached();
  await expect(stage.locator('[data-dmap-chart="ordinary-chart"]')).toHaveCount(0);

  await page.getByTestId('dmap-edit-bindings').click();
  const popup = page.getByTestId('dmap-bindings-popup');
  const popupStage = popup.getByTestId('dmap-popup-stage');
  await popupStage.locator('[data-cell-id="ordinary-chart"]').click();
  const inspector = popup.getByTestId('dmap-inspector');
  await expect(inspector.getByTestId('dmap-inspector-id')).toHaveText('ordinary-chart');
  // Write 1 of spec 5.5: the cell gets the chart class and the key of the trend series.
  await inspector.getByTestId('dmap-inspector-bind').fill('trend-region');
  await inspector.getByTestId('dmap-inspector-key').fill('trend');
  await inspector.getByRole('button', { name: 'Set bind and key', exact: true }).click();
  // The write is a draft: the popup stage shows the chart region, the panel behind waits for Apply.
  await expect(popupStage.locator('[data-dmap-chart="ordinary-chart"]')).toBeAttached();
  await expect(stage.locator('[data-dmap-chart="ordinary-chart"]')).toHaveCount(0);
  await popup.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(stage.locator('[data-dmap-chart="ordinary-chart"]')).toBeAttached();
  await expect(stage.locator('[data-dmap-chart="ordinary-chart"] canvas')).toBeVisible();
  // After Apply the draft is clean: Close closes at once.
  await page.getByRole('dialog', { name: 'Edit bindings' }).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(popup).toHaveCount(0);

  await saveDashboard(page, panelEditPage);
  const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
  const options = saved.dashboard.panels[0].options;
  const decoded = options.diagram.xml;
  // The bare mxCell now has the <object> wrapper that holds the attributes (spec 5.5).
  expect(decoded).toMatch(/<object [^>]*id="ordinary-chart"[^>]*bind="trend-region"[^>]*key="trend"/);
  expect(decoded).not.toMatch(/<mxCell [^>]*id="ordinary-chart"/);
  expect(options.diagram.svg).toMatch(/data-cell-id="ordinary-chart"[^>]*data-meta-bind="trend-region"/);
  // The assignment is a diagram write: the config stays as it was.
  expect(options.config).toEqual(config);

  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  await expect(stage).toHaveAttribute('data-dmap-hash', options.diagram.hash);
  await expect(stage.locator('[data-dmap-chart="ordinary-chart"] canvas')).toBeVisible();
  await page.getByTestId('dmap-edit-bindings').click();
  await popupStage.locator('[data-cell-id="ordinary-chart"]').click();
  await expect(inspector.getByTestId('dmap-inspector-chain')).toHaveText('trend-region');
  await expect(inspector.getByTestId('dmap-inspector-use').getByTestId('dmap-inspector-refid')).toHaveText('trend');
});
