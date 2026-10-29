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

/**
 * Open the split editor with the "Edit bindings" button of the corner (`corner`) or of the Bindings option (`option`).
 * Return the popup body after the code box loaded: Monaco loads lazily and shows "Loading editor" first.
 */
export async function openSplitEditor(page: Page, entry: 'corner' | 'option' = 'corner') {
  await page.getByTestId(entry === 'corner' ? 'dmap-edit-bindings' : 'dmap-edit-bindings-option').click();
  const dialog = page.getByTestId('dmap-bindings-popup');
  await expect(codeBox(dialog).locator('.view-lines')).toBeVisible();
  return dialog;
}

/** The dialog frame of the split editor: the title, the close button and the body. */
export const splitDialog = (page: Page) => page.getByRole('dialog', { name: 'Edit bindings', exact: true });
/** The Monaco editor of the code box. */
export const codeBox = (dialog: Locator) => dialog.getByTestId('dmap-pane-code').locator('.monaco-editor[data-uri]');
export const popupStage = (dialog: Locator) => dialog.getByTestId('dmap-popup-stage');
export const popupCell = (dialog: Locator, id: string) => popupStage(dialog).locator(`[data-cell-id="${id}"]`).first();
export const matchReport = (dialog: Locator) => dialog.getByTestId('dmap-match-report');
export const inspector = (dialog: Locator) => dialog.getByTestId('dmap-inspector');

/** The parts of the Monaco API that the helpers use. Grafana puts its Monaco instance on `window.monaco`. */
type Position = { lineNumber: number; column: number };
type TextModel = {
  uri: unknown;
  getValue(): string;
  getFullModelRange(): unknown;
  pushStackElement(): void;
};
type CodeEditor = {
  getDomNode(): HTMLElement | null;
  getModel(): TextModel | null;
  getPosition(): Position | null;
  setPosition(position: Position): void;
  revealLineInCenter(line: number): void;
  focus(): void;
  executeEdits(source: string, edits: Array<{ range: unknown; text: string }>): boolean;
};
type MonacoGlobal = {
  editor: {
    getEditors(): CodeEditor[];
    getModelMarkers(filter: { resource: unknown }): Array<{ startLineNumber: number; message: string }>;
  };
};

type EditorOp =
  | { op: 'text' }
  | { op: 'cursor' }
  | { op: 'markers' }
  | { op: 'replace'; from: string; to: string }
  | { op: 'place'; line: number };

/**
 * Run one operation in the page on the Monaco editor inside the `scope` element. One function with no closure:
 * Playwright sends it to the page as text.
 */
function onEditor(scope: Locator, request: EditorOp) {
  return scope.evaluate((el, request) => {
    const monaco = (window as unknown as { monaco: MonacoGlobal }).monaco;
    const editor = monaco.editor.getEditors().find((e) => {
      const node = e.getDomNode();
      return !!node && el.contains(node) && e.getModel() !== null;
    });
    const model = editor?.getModel();
    if (!editor || !model) {
      throw new Error('no Monaco editor');
    }
    switch (request.op) {
      case 'text':
        return model.getValue();
      case 'cursor':
        return editor.getPosition();
      case 'markers':
        return monaco.editor
          .getModelMarkers({ resource: model.uri })
          .map((m) => ({ line: m.startLineNumber, message: m.message }));
      case 'replace': {
        const text = model.getValue();
        if (!text.includes(request.from)) {
          throw new Error(`the code has no ${request.from}`);
        }
        model.pushStackElement();
        editor.executeEdits('e2e', [
          { range: model.getFullModelRange(), text: text.replace(request.from, request.to) },
        ]);
        model.pushStackElement();
        return null;
      }
      case 'place':
        editor.setPosition({ lineNumber: request.line, column: 1 });
        editor.revealLineInCenter(request.line);
        editor.focus();
        return null;
    }
  }, request);
}

/** The whole text of the code box. The DOM shows only the visible lines. */
export const codeText = async (dialog: Locator) => (await onEditor(dialog, { op: 'text' })) as string;

/** The cursor of the code box. */
export const codeCursor = async (dialog: Locator) => (await onEditor(dialog, { op: 'cursor' })) as Position;

/** The line numbers of the code box (from 1) that match `pattern`. */
export async function codeLines(dialog: Locator, pattern: RegExp) {
  const lines = (await codeText(dialog)).split('\n');
  return lines.flatMap((line, i) => (pattern.test(line) ? [i + 1] : []));
}

/** The markers of the code box: the line and the message. */
export const codeMarkers = async (dialog: Locator) =>
  (await onEditor(dialog, { op: 'markers' })) as Array<{ line: number; message: string }>;

/**
 * Replace `from` with `to` in the text of the Monaco editor in `scope` (the code box of the popup, or an option
 * group), as one edit that the undo of Monaco can take back.
 */
export async function replaceCode(scope: Locator, from: string, to: string) {
  await onEditor(scope, { op: 'replace', from, to });
}

/**
 * Put the cursor at the end of the first line of the code box that matches `pattern`, with the End key. The editor
 * ignores a cursor move of the API (a report click moves the cursor that way), so the last move is a key press.
 */
export async function cursorToLine(dialog: Locator, pattern: RegExp) {
  const [line] = await codeLines(dialog, pattern);
  expect(line, `a line matches ${pattern}`).toBeDefined();
  await onEditor(dialog, { op: 'place', line });
  await dialog.page().keyboard.press('End');
  return line;
}

export type TouchPoint = { x: number; y: number };

/** Real touch input through the browser input pipeline (Chromium), so touch-action applies. */
export async function touch(page: Page, from: TouchPoint[], to: TouchPoint[], steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  const at = (t: number) => from.map((p, i) => ({ id: i, x: p.x + (to[i].x - p.x) * t, y: p.y + (to[i].y - p.y) * t }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / steps) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
