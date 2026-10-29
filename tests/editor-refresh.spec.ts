import type { Locator, Page } from '@playwright/test';
import { expect, test } from './authoring-fixtures';

// A dashboard refresh while an editor is open must not touch the editor. The draw.io editor keeps the same frame, the
// same srcdoc document and the same channel. The split editor keeps the same dialog, the same code box and its draft.
// The panel behind the modal gets the new data. The split editor has no draw.io entry: geometry stays with the Diagram
// option (spec 5.1).
/** Two dashboard refreshes, each one over when every query that it sent has an answer. */
async function refreshTwice(page: Page, refresh: Locator) {
  const queries: string[] = [];
  let inflight = 0;
  const isQuery = (url: string) => new URL(url).pathname === '/api/ds/query';
  page.on('request', (r) => {
    if (!isQuery(r.url())) return;
    queries.push(r.url());
    inflight++;
  });
  const settle = (r: { url(): string }) => {
    if (isQuery(r.url())) inflight--;
  };
  page.on('requestfinished', settle);
  page.on('requestfailed', settle);
  for (let i = 1; i <= 2; i++) {
    const count = queries.length;
    await refresh.dispatchEvent('click');
    await expect.poll(() => queries.length).toBeGreaterThan(count);
    await expect.poll(() => inflight).toBe(0);
  }
}

test('the Diagram option editor keeps working through two dashboard refreshes', async ({
  gotoPanelEditPage,
  page,
  config,
  createDiagram,
  selectors,
}) => {
  const uid = await createDiagram(config);
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  await panelEditPage.getCustomOptions('Diagram').expand();
  await page.getByTestId('dmap-open-editor').click();
  const modal = page.getByTestId('dmap-editor-modal');
  await expect(modal).toHaveAttribute('data-dmap-editor-phase', 'loaded', { timeout: 60_000 });
  const frameEl = page.getByTestId('dmap-editor-frame');
  const srcdoc = await frameEl.getAttribute('srcdoc');
  // A mark on the element: a new frame element would not have it.
  await frameEl.evaluate((el) => el.setAttribute('data-dmap-test-mark', 'before-refresh'));

  // The modal covers the time picker, so dispatch the click on the Refresh button directly.
  const refresh = panelEditPage.getByGrafanaSelector(selectors.components.RefreshPicker.runButtonV2);
  await refreshTwice(page, refresh);

  await expect(frameEl).toHaveAttribute('data-dmap-test-mark', 'before-refresh');
  expect(await frameEl.getAttribute('srcdoc')).toBe(srcdoc);
  await expect(modal).toHaveAttribute('data-dmap-editor-phase', 'loaded');
  // The editor still responds, and Save still updates the panel.
  const frame = page.frameLocator('[data-testid="dmap-editor-frame"]');
  await frame.locator('.geSidebar .geItem').first().click({ timeout: 10_000 });
  const stage = page.getByTestId('dmap-panel');
  const previousHash = await stage.getAttribute('data-dmap-hash');
  await frame.getByTitle(/^Save \(/).dispatchEvent('click');
  await expect(stage).not.toHaveAttribute('data-dmap-hash', previousHash!);
});

test('the split editor keeps its draft through two dashboard refreshes', async ({
  gotoPanelEditPage,
  page,
  config,
  createDiagram,
  selectors,
}) => {
  const uid = await createDiagram(config);
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const normal = () => page.getByTestId('dmap-panel').locator('[data-dmap-status="normal"]');
  await expect(normal()).toHaveCount(2);
  // The entry of the options pane (spec 5.1).
  await panelEditPage.getCustomOptions('Diagram').expand();
  await page.getByTestId('dmap-edit-bindings-option').click();
  const popup = page.getByTestId('dmap-bindings-popup');
  const code = popup.getByTestId('data-testid Code editor container');
  const lines = code.locator('.view-lines');
  await expect(lines).toContainText('version: 4', { timeout: 30_000 });
  const popupNormal = () => popup.getByTestId('dmap-popup-stage').locator('[data-dmap-status="normal"]');
  await expect(popupNormal()).toHaveCount(2);

  // A draft: the routers read a refId that no target has. Monaco renders only the lines in view, so page down to the
  // line of the router status.
  const statusLine = lines.locator('.view-line').filter({ hasText: /status:\s+health/ });
  await lines.locator('.view-line').first().click();
  await expect
    .poll(async () => {
      if (await statusLine.count()) {
        return true;
      }
      await page.keyboard.press('PageDown');
      return false;
    })
    .toBe(true);
  await statusLine.click();
  await page.keyboard.press('End');
  await page.keyboard.type('-draft');
  await expect(popupNormal()).toHaveCount(0);
  await expect(normal()).toHaveCount(2);
  // Marks on the elements: a new dialog or a new code box would not have them. A new Monaco model has a new URI.
  const editor = code.getByRole('code');
  const model = await editor.getAttribute('data-uri');
  expect(model).toBeTruthy();
  await popup.evaluate((el) => el.setAttribute('data-dmap-test-mark', 'before-refresh'));
  await editor.evaluate((el) => el.setAttribute('data-dmap-test-mark', 'before-refresh'));

  const refresh = panelEditPage.getByGrafanaSelector(selectors.components.RefreshPicker.runButtonV2);
  await refreshTwice(page, refresh);

  await expect(popup).toHaveAttribute('data-dmap-test-mark', 'before-refresh');
  await expect(editor).toHaveAttribute('data-dmap-test-mark', 'before-refresh');
  await expect(editor).toHaveAttribute('data-uri', model!);
  await expect(lines).toContainText('status: health-draft');
  // The draft still binds the popup stage with the new data; the panel behind keeps the saved bindings.
  await expect(popupNormal()).toHaveCount(0);
  await expect(normal()).toHaveCount(2);
  // The code box still responds, and Apply still updates the panel.
  await page.keyboard.press('Backspace');
  await expect(statusLine).toHaveText(/health-draf$/);
  await popup.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(normal()).toHaveCount(0);
  // The draft is clean after Apply: Close closes at once.
  await page.getByRole('dialog', { name: 'Edit bindings' }).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(popup).toHaveCount(0);
});
