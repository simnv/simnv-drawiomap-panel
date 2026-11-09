import fs from 'node:fs';
import { pointOnHalf } from '../authoring-controls';
import { expect, test } from '../authoring-fixtures';
import { half, LABELLED_HERO, quiet, useLabelledCopy } from './shared';

const RADIO = 'pg-link~radio:dhcp->rtr-a:wan2';
const HERO_VIDEO = 'test-results/docs-hero/hero.webm';

// The video of the page is the source of src/img/screenshots/hero.gif (scripts/docs-hero-gif.sh).
test.use({
  viewport: { width: 1000, height: 740 },
  video: { mode: 'on', size: { width: 1000, height: 740 } },
  colorScheme: 'dark',
  timezoneId: 'Europe/Berlin',
});
useLabelledCopy(LABELLED_HERO);

test('hero.webm: the pointer moves to a link and the hover card opens', async ({ gotoDashboardPage, page }) => {
  const opened = Date.now();
  const dashboardPage = await gotoDashboardPage({
    uid: LABELLED_HERO,
    queryParams: quiet(),
  });
  const panel = (await dashboardPage.getPanelByTitle('demo-lab L3')).locator;
  await expect(half(panel, RADIO)).toHaveAttribute('data-dmap-status', 'ok');
  await expect(panel.locator('text.dmap-link-label').first()).toBeVisible();
  await page.mouse.move(40, 600);
  // the video starts when the page opens: the GIF starts when the map is ready
  const start = (Date.now() - opened) / 1000 + 0.5;
  await page.waitForTimeout(1000);
  const { x, y } = await pointOnHalf(half(panel, RADIO));
  await page.mouse.move(x + 60, y + 50, { steps: 25 });
  await page.mouse.move(x, y, { steps: 20 });
  await expect(panel.getByRole('tooltip')).toContainText('dhcp ↔ rtr-a wan2');
  await expect(panel.getByRole('tooltip').getByTestId('dmap-mirror-spark')).toBeVisible();
  await page.waitForTimeout(4300);
  await page.close();
  fs.mkdirSync('test-results/docs-hero', { recursive: true });
  await page.video()!.saveAs(HERO_VIDEO);
  fs.writeFileSync('test-results/docs-hero/start.txt', String(start));
});
