import type { Locator, Page, TestInfo } from '@playwright/test';
import { openBindingsPopup, popupInspector, selectStageCell } from './authoring-controls';
import { expect, test } from './authoring-fixtures';

async function expectNoHorizontalOverflow(page: Page, inspector: Locator) {
  await expect.poll(async () => inspector.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect
    .poll(() =>
      inspector
        .getByRole('region', { name: 'Binding editor fields', exact: true })
        .evaluate((el) => el.scrollWidth <= el.clientWidth)
    )
    .toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectInspectorTheme(inspector: Locator, theme: 'dark' | 'light') {
  const backgroundLuminance = await inspector.evaluate((el) => {
    const [r, g, b] = getComputedStyle(el)
      .backgroundColor.match(/\d+(\.\d+)?/g)!
      .map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });
  expect(backgroundLuminance < 0.5).toBe(theme === 'dark');
}

/** A full-page screenshot is slow. Take it only when DMAP_SCREENSHOTS is set, as the other specs do. */
async function captureLayout(page: Page, testInfo: TestInfo, name: string) {
  if (!process.env.DMAP_SCREENSHOTS) return;
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const theme of ['dark', 'light'] as const) {
  test(`bindings popup layout works in ${theme} theme`, async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }, testInfo) => {
    const uid = await createDiagram(config);
    await page.setViewportSize({ width: 1440, height: 900 });
    // Grafana selects the theme at boot: give it on the first load.
    await gotoPanelEditPage({
      dashboard: { uid },
      id: '1',
      queryParams: new URLSearchParams({ theme }),
    });
    await expect(page).toHaveURL(new RegExp(`[?&]theme=${theme}(?:&|$)`));

    const dialog = await openBindingsPopup(page);
    const inspector = popupInspector(dialog);
    await expect(inspector).toBeVisible();
    await expectInspectorTheme(inspector, theme);
    await selectStageCell(dialog, 'device-1');

    const heading = inspector.getByRole('heading', { name: /device-1\s*bindings/ });
    await expect(heading).toBeFocused();
    await expectNoHorizontalOverflow(page, inspector);
    await captureLayout(page, testInfo, `${theme}-popup-layout-typical`);
    await inspector.getByRole('textbox', { name: 'Label template', exact: true }).scrollIntoViewIfNeeded();
    await captureLayout(page, testInfo, `${theme}-popup-layout-fields`);

    await page.setViewportSize({ width: 1024, height: 768 });
    await expectNoHorizontalOverflow(page, inspector);

    const body = inspector.getByRole('region', { name: 'Binding editor fields', exact: true });
    const footer = dialog.getByRole('toolbar', { name: 'Binding draft actions', exact: true });
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    // The draft actions stay in view while the fields scroll.
    await expect(footer).toBeInViewport();
    const apply = dialog.getByRole('button', { name: 'Apply bindings', exact: true });
    const cancel = dialog.getByRole('button', { name: 'Cancel changes', exact: true });
    await expect(apply).toBeInViewport();
    await expect(cancel).toBeInViewport();
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expect(heading).toBeVisible();
    // Below 1000 px the popup is in tab mode: the Inspector tab shows (a cell was selected) and the other panes stay
    // mounted but hidden. Above, the three panes stay inside the popup.
    await expect(page.getByTestId('dmap-popup-layout')).toHaveAttribute('data-dmap-layout', 'tabs');
    await expect(dialog.getByTestId('dmap-pane-inspector')).toBeInViewport({ ratio: 0.9 });
    for (const pane of ['dmap-pane-list', 'dmap-pane-stage']) {
      await expect(dialog.getByTestId(pane)).toBeHidden();
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId('dmap-popup-layout')).toHaveAttribute('data-dmap-layout', 'panes');
    for (const pane of ['dmap-pane-list', 'dmap-pane-stage', 'dmap-pane-inspector']) {
      await expect(dialog.getByTestId(pane)).toBeInViewport({ ratio: 0.9 });
    }
  });
}
