import type { Locator, Page, TestInfo } from '@playwright/test';
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

async function captureLayout(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const theme of ['dark', 'light'] as const) {
  test(`binding inspector layout works in ${theme} theme`, async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }, testInfo) => {
    const uid = await createDiagram(config);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPanelEditPage({
      dashboard: { uid },
      id: '1',
    });
    // The panel helper omits theme parameters; Grafana selects the theme at boot.
    const url = new URL(page.url());
    url.searchParams.set('theme', theme);
    await page.goto(url.toString());
    await expect(page).toHaveURL(new RegExp(`[?&]theme=${theme}(?:&|$)`));

    const inspector = page.getByRole('complementary', { name: 'Diagram binding inspector' });
    const device = page.getByTestId('dmap-panel').locator('[data-cell-id="device-1"]');
    await expect(inspector).toBeVisible();
    await expectInspectorTheme(inspector, theme);
    await expect(device).toBeVisible();
    await device.click();

    const heading = inspector.getByRole('heading', { name: /device-1\s*bindings/ });
    await expect(heading).toBeFocused();
    await expectNoHorizontalOverflow(page, inspector);
    await captureLayout(page, testInfo, `${theme}-inspector-layout-typical`);
    await inspector.getByRole('textbox', { name: 'Label template', exact: true }).scrollIntoViewIfNeeded();
    await captureLayout(page, testInfo, `${theme}-inspector-layout-fields`);

    await page.setViewportSize({ width: 1024, height: 768 });
    await expectNoHorizontalOverflow(page, inspector);

    const body = inspector.getByRole('region', { name: 'Binding editor fields', exact: true });
    const footer = inspector.getByLabel('Binding draft actions', { exact: true });
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(footer).toBeInViewport();
    const apply = inspector.getByRole('button', { name: 'Apply bindings', exact: true });
    const cancel = inspector.getByRole('button', { name: 'Cancel changes', exact: true });
    await expect(apply).toBeInViewport();
    await expect(apply).toBeEnabled();
    await expect(cancel).toBeInViewport();
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expect(heading).toBeVisible();
  });
}
