import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The centre of a link half in the viewport, after the half scrolled into view and has a layout box.
 *
 * Playwright never calls a vertical or horizontal link half visible: its polyline has a bounding box with zero width
 * or height. A pointer action on it works only with `force: true`, and it then depends on the half being laid out at
 * that moment ("Element is not visible" otherwise, see the flake in sparkline-range.spec.ts). Wait for a layout box
 * with a plain poll, scroll with the DOM (that needs no size) and give the point to `page.mouse`.
 */
export async function pointOnHalf(half: Locator) {
  const read = () =>
    half.evaluate((el) => {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
  let point: { x: number; y: number } | null = null;
  await expect.poll(async () => (point = await read()), { message: 'the link half has a layout box' }).not.toBeNull();
  return point!;
}

/** Move the pointer onto a link half: from a point beside it, so the page sees an enter. */
export async function hoverHalf(half: Locator) {
  const { x, y } = await pointOnHalf(half);
  const mouse = half.page().mouse;
  await mouse.move(x + 24, y);
  await mouse.move(x, y, { steps: 4 });
}

export async function openEditorSection(inspector: Locator, title: string) {
  const toggle = inspector.getByRole('button', { name: title, exact: true });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

export async function chooseEditorOption(inspector: Locator, label: string, option: string) {
  const input = inspector.getByRole('combobox', { name: label, exact: true });
  await input.click();
  await inspector.page().getByRole('option', { name: option, exact: true }).click();
}

/** Open the bindings popup with the corner button of the panel in panel edit. Return the popup body. */
export async function openBindingsPopup(page: Page) {
  await page.getByTestId('dmap-edit-bindings').click();
  const dialog = page.getByTestId('dmap-bindings-popup');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Close the popup with its Cancel button. The draft must be clean. */
export async function closeBindingsPopup(page: Page) {
  await page.getByTestId('dmap-bindings-popup').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Press Discard when the draft has changes. The button is disabled while the draft is clean. */
export async function discardDraft(dialog: Locator) {
  const discard = dialog.getByRole('button', { name: 'Discard', exact: true });
  if (await discard.isEnabled()) {
    await discard.click();
  }
}

/** The right pane of the popup. */
export const popupInspector = (dialog: Locator) =>
  dialog.getByRole('complementary', { name: 'Diagram binding inspector' });

/** Click a cell in the stage of the popup. */
export async function selectStageCell(dialog: Locator, id: string) {
  await dialog.getByTestId('dmap-popup-stage').locator(`[data-cell-id="${id}"]`).first().click();
  await expect(popupInspector(dialog).getByRole('heading', { name: `${id} bindings` })).toBeFocused();
}

/** Type into the filter of the list pane. */
export async function filterBindings(dialog: Locator, text: string) {
  await dialog.getByRole('textbox', { name: 'Filter bindings', exact: true }).fill(text);
}
