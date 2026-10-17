import { expect, test } from '@grafana/plugin-e2e';

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
  await expect(frameEl).toHaveAttribute('data-dmap-editor-kind', 'bundled');
  await expect(frameEl).toHaveAttribute('srcdoc', /public\/plugins\/simnv-drawiomap-panel\/drawio\//);
  await expect(page.getByTestId('dmap-editor-modal')).toHaveAttribute('data-dmap-editor-phase', 'loaded', {
    timeout: 60_000,
  });

  const frame = page.frameLocator('[data-testid="dmap-editor-frame"]');
  const canvas = frame.locator('.geDiagramContainer');
  await expect(canvas).toBeVisible({ timeout: 60_000 });

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
