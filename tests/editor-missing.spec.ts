import { expect, test } from './authoring-fixtures';
import type { Page } from '@playwright/test';

const MISSING = 'The draw.io editor is not installed with this plugin build (dist/drawio is missing).';

/** Grafana answers like this for every file of a plugin build without dist/drawio. */
async function withoutBundledEditor(page: Page) {
  await page.route(/\/public\/plugins\/simnv-drawiomap-panel\/drawio\//, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json; charset=UTF-8',
      body: '{"message":"Plugin file not found"}',
    })
  );
}

async function watchLongTasks(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { dmapLongTasks: number[] };
    w.dmapLongTasks = [];
    new PerformanceObserver((list) => list.getEntries().forEach((e) => w.dmapLongTasks.push(e.duration))).observe({
      type: 'longtask',
    });
  });
  return () => page.evaluate(() => (window as unknown as { dmapLongTasks: number[] }).dmapLongTasks);
}

test('without dist/drawio the editor shows a clear message, Close works and the page stays responsive', async ({
  gotoPanelEditPage,
  page,
}) => {
  await withoutBundledEditor(page);
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '2' });
  await panelEditPage.getCustomOptions('Diagram').expand();
  const longTasks = await watchLongTasks(page);

  await page.getByTestId('dmap-open-editor').click();
  const modal = page.getByTestId('dmap-editor-modal');
  await expect(modal.getByRole('alert')).toContainText(MISSING, { timeout: 5_000 });
  await expect(modal.getByRole('alert')).toContainText('npm run build');
  await expect(modal).toHaveAttribute('data-dmap-editor-load', 'missing');
  // No frame: the editor document is not made when its files are missing.
  await expect(page.getByTestId('dmap-editor-frame')).toHaveCount(0);
  await modal.getByTestId('dmap-editor-close').click();
  await expect(modal).toHaveCount(0);

  // The rest of the panel editor stays usable.
  const paste = page.getByTestId('dmap-paste-xml');
  await paste.fill('<mxfile><diagram id="a" name="A"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>');
  await expect(paste).toHaveValue(/<mxfile>/);
  // Import opens the editor in export-only mode: the same message, and Close works.
  await page.getByRole('button', { name: 'Apply pasted XML' }).click();
  await expect(modal.getByRole('alert')).toContainText(MISSING, { timeout: 5_000 });
  await modal.getByTestId('dmap-editor-close').click();
  await expect(modal).toHaveCount(0);
  await panelEditPage.getCustomOptions('Diagram').collapse();
  await expect(page.getByTestId('dmap-open-editor')).toBeHidden();

  expect((await longTasks()).filter((d) => d > 1_000)).toEqual([]);
});
