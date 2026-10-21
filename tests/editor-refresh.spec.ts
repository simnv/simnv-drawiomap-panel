import { expect, test } from './authoring-fixtures';

// A dashboard refresh while the editor is open must not touch the editor: the same frame, the same srcdoc document
// and the same channel. The panel behind the modal gets the new data.
for (const entry of ['Diagram option', 'geometry'] as const) {
  test(`the ${entry} editor keeps working through two dashboard refreshes`, async ({
    gotoPanelEditPage,
    page,
    config,
    createDiagram,
    selectors,
  }) => {
    const uid = await createDiagram(config);
    const panelEditPage = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    if (entry === 'geometry') {
      const inspector = page.getByRole('complementary', { name: 'Diagram binding inspector' });
      await inspector.getByRole('button', { name: 'Edit geometry in draw.io' }).click();
    } else {
      await panelEditPage.getCustomOptions('Diagram').expand();
      await page.getByTestId('dmap-open-editor').click();
    }
    const modal = page.getByTestId('dmap-editor-modal');
    await expect(modal).toHaveAttribute('data-dmap-editor-phase', 'loaded', { timeout: 60_000 });
    const frameEl = page.getByTestId('dmap-editor-frame');
    const srcdoc = await frameEl.getAttribute('srcdoc');
    // A mark on the element: a new frame element would not have it.
    await frameEl.evaluate((el) => el.setAttribute('data-dmap-test-mark', 'before-refresh'));

    const queries: string[] = [];
    page.on('request', (r) => new URL(r.url()).pathname === '/api/ds/query' && queries.push(r.url()));
    // The modal covers the time picker, so dispatch the click on the Refresh button directly.
    const refresh = panelEditPage.getByGrafanaSelector(selectors.components.RefreshPicker.runButtonV2);
    for (let i = 1; i <= 2; i++) {
      const count = queries.length;
      await refresh.dispatchEvent('click');
      await expect.poll(() => queries.length).toBeGreaterThan(count);
      await page.waitForLoadState('networkidle');
    }

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
}
