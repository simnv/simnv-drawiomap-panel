import { expect, test } from '@grafana/plugin-e2e';

test('edit mode opens the self-hosted draw.io editor, saves, and the panel updates', async ({
  gotoPanelEditPage,
  page,
}) => {
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
  await expect(frameEl).toHaveAttribute('src', /localhost:8080\/\?embed=1&proto=json&configure=1/);
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
});
