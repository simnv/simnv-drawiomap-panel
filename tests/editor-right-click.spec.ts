import { expect, test } from './authoring-fixtures';

// Safari on macOS sends a quick two-finger tap as a right press with no right-button bit and no release. The shim
// (src/editor/drawio-shim.js) adds the release: draw.io opens the menu at once, and later moves do not pan.
test('a right press without a release opens the menu and does not pan the canvas', async ({
  gotoPanelEditPage,
  page,
}) => {
  const panelEditPage = await gotoPanelEditPage({ dashboard: { uid: 'drawiomap-demo' }, id: '2' });
  await panelEditPage.getCustomOptions('Diagram').expand();
  await page.getByTestId('dmap-open-editor').click();
  await expect(page.getByTestId('dmap-editor-modal')).toHaveAttribute('data-dmap-editor-phase', 'loaded', {
    timeout: 60_000,
  });
  const frame = page.frameLocator('[data-testid="dmap-editor-frame"]');
  const canvas = frame.locator('.geDiagramContainer');
  const menu = frame.locator('.mxPopupMenu');
  await expect(canvas).toBeVisible({ timeout: 60_000 });

  const scroll = () => canvas.evaluate((c) => `${c.scrollLeft},${c.scrollTop}`);
  /** The scroll position once it stops changing: the editor scrolls the diagram into place after the load. */
  const settled = async () => {
    let last = '';
    await expect
      .poll(
        async () => {
          const now = await scroll();
          const same = now === last;
          last = now;
          return same;
        },
        { intervals: [300] }
      )
      .toBe(true);
    return last;
  };

  // The middle of the first rect or ellipse that is fully in view (a cell or a label background), in frame coordinates.
  const shape = await canvas.evaluate((c) => {
    const view = c.getBoundingClientRect();
    const r = [...c.querySelectorAll('svg rect, svg ellipse')]
      .map((e) => e.getBoundingClientRect())
      .find(
        (b) =>
          b.width > 30 &&
          b.height > 20 &&
          b.left > view.left &&
          b.top > view.top &&
          b.right < view.right &&
          b.bottom < view.bottom
      );
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  });
  expect(shape).not.toBeNull();
  const frameBox = (await page.getByTestId('dmap-editor-frame').boundingBox())!;
  const at = { x: frameBox.x + shape!.x, y: frameBox.y + shape!.y };

  // A real right-button drag still pans, and the browser's own release ends it without a menu.
  const start = await settled();
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(at.x + 80, at.y + 60, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  const panned = await settled();
  expect(panned).not.toBe(start);
  await expect(menu).toHaveCount(0);

  // The events of a two-finger tap in Safari: press and context menu, all with buttons = 0, and no release.
  await canvas.evaluate((_c, { x, y }) => {
    const target = document.elementFromPoint(x, y)!;
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 2,
      buttons: 0,
      clientX: x,
      clientY: y,
    };
    target.dispatchEvent(
      new PointerEvent('pointerdown', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true })
    );
    target.dispatchEvent(new MouseEvent('mousedown', init));
    target.dispatchEvent(new MouseEvent('contextmenu', init));
  }, shape!);
  await expect(menu.first()).toBeVisible();

  // A move with no button down after the tap: the canvas stays where it was.
  await page.mouse.move(at.x - 40, at.y - 40, { steps: 10 });
  expect(await settled()).toBe(panned);
});
