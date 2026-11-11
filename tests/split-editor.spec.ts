import { mkdir } from 'node:fs/promises';
import { devices } from '@playwright/test';
import type { APIRequestContext, Locator, Request } from '@playwright/test';
import type { ConfigV4 } from '../src/model/v4';
import {
  codeBox,
  codeCursor,
  codeLines,
  codeMarkers,
  codeText,
  cursorToLine,
  inspector,
  matchReport,
  openSplitEditor,
  popupCell,
  popupStage,
  replaceCode,
  splitDialog,
} from './authoring-controls';
import { expect, saveDashboard, test } from './authoring-fixtures';

/**
 * The split editor (spec 5, acceptance P3.5-P3.9). The whole file is in `matrix`: the code box is the Monaco of
 * Grafana, and the Monaco version can differ between Grafana 12.4 and 13.2 (spec 5.2).
 */

/** The authoring config plus a row that no series feeds: the tx series have no `device` label of a router. */
function withEmptyRow(config: ConfigV4): ConfigV4 {
  config.classes.routers.rows!.push({ kind: 'value', label: 'Uplink', query: 'tx' });
  return config;
}

/** The ids of the cells of the popup stage that carry `data-dmap-<flag>="true"`. */
const flagged = (dialog: Locator, flag: 'highlight' | 'selected') =>
  popupStage(dialog)
    .locator(`[data-cell-id][data-dmap-${flag}="true"]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-cell-id')).sort());
const viewBox = (dialog: Locator) => popupStage(dialog).locator(':scope > svg').getAttribute('viewBox');
/** The saved options of the first panel. */
async function savedOptions(request: APIRequestContext, uid: string) {
  const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
  return saved.dashboard.panels[0].options;
}
/** The draw.io XML of page 1. The panel stores it uncompressed, also after a save in draw.io. */
function pageXml(xml: string) {
  expect(xml).toMatch(/<diagram[^>]*>\s*<mxGraphModel/);
  return xml;
}
/** The attributes of the `<object>` of a cell, and the attributes of the `<mxCell>` in it. */
function wrapperOf(xml: string, id: string) {
  const found = new RegExp(`<object ([^>]*\\bid="${id}"[^>]*)>\\s*<mxCell([^>]*)>`).exec(pageXml(xml));
  return { object: attrsOf(found?.[1]), mxCell: attrsOf(found?.[2]) };
}
/** The attributes of the cell group of a cell in the SVG. */
const cellGroupOf = (svg: string, id: string) =>
  attrsOf(new RegExp(`<g ([^>]*data-cell-id="${id}"[^>]*)>`).exec(svg)?.[1]);
const attrsOf = (text = '') => Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
// Chromium with the iPhone 13 viewport of `tests/phone-sheet.spec.ts`. The webkit browser of the preset needs a separate worker.
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13'];
const badge = (dialog: Locator, id: string) =>
  dialog.locator(`[data-testid="dmap-cell-badge"][data-dmap-badge="${id}"]`);

test(
  'the code box loads, completion opens above the modal and the cursor events fire (P3.9)',
  { tag: '@matrix' },
  async ({ page, config, createDiagram, gotoPanelEditPage }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openSplitEditor(page);
    expect(await codeText(dialog)).toMatch(/^version: 4\n/);

    // A click in the text is a cursor event of the mouse: after 150 ms the cells of the class light up.
    const line = await cursorToLine(dialog, /^ {2}trend-region:$/);
    await codeBox(dialog)
      .locator('.view-line')
      .filter({ hasText: /^\s*trend-region:\s*$/ })
      .click();
    await expect.poll(() => flagged(dialog, 'highlight')).toEqual(['chart-1']);
    expect((await codeCursor(dialog)).lineNumber).toBe(line);

    // Completion on a new line of a class: the schema keys of a class. `extends` is not a word of the text, so the item
    // comes from the provider of the panel. The suggest box draws above the modal: the point at the centre of its first
    // row hits the box, so no parent of the dialog clips it or covers it.
    await cursorToLine(dialog, /^ {4}status: health$/);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+Space');
    const suggest = page.locator('.suggest-widget.visible');
    await expect(suggest).toBeVisible();
    await expect(suggest.getByRole('option', { name: /^extends\b/ })).toBeVisible();
    const hit = await suggest
      .getByRole('option')
      .first()
      .evaluate((row) => {
        const r = row.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { inside: !!top && row.closest('.suggest-widget')!.contains(top), inView: r.bottom <= innerHeight };
      });
    expect(hit).toEqual({ inside: true, inView: true });
    // The first Esc closes the suggest box only.
    await page.keyboard.press('Escape');
    await expect(suggest).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0);
  }
);

const at0 = (dialog: Locator) => inspector(dialog).getByTestId('dmap-inspector-at');

test('the cursor lights the cells of its path and zooms; a report entry lights its cells and moves the cursor (P3.5)', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(withEmptyRow(config));
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openSplitEditor(page);
  await expect(popupCell(dialog, 'device-1')).toHaveAttribute('data-dmap-status', 'normal');
  const fitted = await viewBox(dialog);

  // The cursor on a class: its cells light up, and the stage zooms to them.
  await cursorToLine(dialog, /^ {2}routers:$/);
  await expect.poll(() => flagged(dialog, 'highlight')).toEqual(['device-1', 'device-2']);
  await expect.poll(() => viewBox(dialog)).not.toBe(fitted);
  await expect(dialog.getByTestId('dmap-popup-reset-zoom')).toBeVisible();
  const zoomed = await viewBox(dialog);

  // A plain field of the same class has the same cells: no new zoom.
  await cursorToLine(dialog, /^ {4}status: health$/);
  await expect(badge(dialog, 'device-1')).toHaveText('1');
  expect(await flagged(dialog, 'highlight')).toEqual(['device-1', 'device-2']);
  expect(await viewBox(dialog)).toBe(zoomed);

  // The cursor in a row: the count of series of that row per cell. A row with a series shows 1; a row with none, a red 0.
  await cursorToLine(dialog, /^ {8}query: detail$/);
  for (const id of ['device-1', 'device-2']) {
    await expect(badge(dialog, id)).toHaveText('1');
    await expect(badge(dialog, id)).toHaveAttribute('data-dmap-red', 'false');
  }
  const txLine = await cursorToLine(dialog, /^ {8}query: tx$/);
  for (const id of ['device-1', 'device-2']) {
    await expect(badge(dialog, id)).toHaveText('0');
    await expect(badge(dialog, id)).toHaveAttribute('data-dmap-red', 'true');
  }

  // Another class: other cells and another zoom. The report shows the tab of the class.
  await cursorToLine(dialog, /^ {2}trend-region:$/);
  await expect.poll(() => flagged(dialog, 'highlight')).toEqual(['chart-1']);
  await expect(matchReport(dialog).getByRole('tab', { name: /^trend-region/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect.poll(() => viewBox(dialog)).not.toBe(zoomed);
  await expect(dialog.getByTestId('dmap-cell-badge')).toHaveCount(0);

  // A click on a report entry lights its cells and moves the cursor to its path: the start of the row.
  const rowLines = await codeLines(dialog, /^ {6}- kind:/);
  const rowStart = Math.max(...rowLines.filter((line) => line < txLine));
  await matchReport(dialog)
    .getByRole('tab', { name: /^routers/ })
    .click();
  await matchReport(dialog).getByRole('button', { name: '2 cells have no series' }).click();
  await expect.poll(() => flagged(dialog, 'highlight')).toEqual(['device-1', 'device-2']);
  expect((await codeCursor(dialog)).lineNumber).toBe(rowStart);
  await expect(codeBox(dialog)).toHaveClass(/focused/);
  await expect(inspector(dialog)).toHaveCount(0);

  // A selection replaces the highlight: nothing stays outlined, and the selected cell is not dimmed. Escape ends a
  // highlight before it closes the editor.
  await popupCell(dialog, 'device-1').click();
  await expect.poll(() => flagged(dialog, 'highlight')).toEqual([]);
  await expect(popupCell(dialog, 'device-1')).not.toHaveClass(/dmap-legend-member/);
  await matchReport(dialog).getByRole('button', { name: '2 cells have no series' }).click();
  await expect.poll(() => flagged(dialog, 'highlight')).toEqual(['device-1', 'device-2']);
  // The code box keeps its own Escape (Monaco handles it); a focus on the diagram gives it to the editor.
  await popupCell(dialog, 'device-1').focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => flagged(dialog, 'highlight')).toEqual([]);
  await expect(dialog).toBeVisible();
});

test('a click on a cell opens the inspector and moves the cursor to its class; "key is at the target" swaps the halves (P3.6)', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  // Value labels on the link: the label of each half shows the value of its feed.
  config.classes['directional-link'].linkLabel = 'value';
  const uid = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openSplitEditor(page);

  await popupCell(dialog, 'device-2').click();
  await expect(inspector(dialog).getByTestId('dmap-inspector-id')).toHaveText('device-2');
  await expect(inspector(dialog).getByTestId('dmap-inspector-chain')).toHaveText('routers');
  const [routers] = await codeLines(dialog, /^ {2}routers:$/);
  await expect.poll(async () => (await codeCursor(dialog)).lineNumber).toBe(routers);

  const labels = () =>
    popupStage(dialog)
      .locator('[data-dmap-cell="link-1"][data-dmap-mode]')
      .evaluateAll((els) => Object.fromEntries(els.map((el) => [el.getAttribute('data-dmap-half'), el.textContent])));
  await expect.poll(async () => Object.keys(await labels()).sort()).toEqual(['a2b', 'b2a']);
  const before = await labels();
  // tx and rx of the demo link have different rates, so a swap shows.
  expect(before.a2b).not.toBe(before.b2a);

  await popupCell(dialog, 'link-1').click();
  await expect(inspector(dialog).getByTestId('dmap-inspector-id')).toHaveText('link-1');
  const [link] = await codeLines(dialog, /^ {2}directional-link:$/);
  await expect.poll(async () => (await codeCursor(dialog)).lineNumber).toBe(link);
  await expect(inspector(dialog).getByTestId('dmap-inspector-source')).toHaveAttribute('title', 'device-1');
  await expect(inspector(dialog).getByTestId('dmap-inspector-target')).toHaveAttribute('title', 'device-2');
  await expect(inspector(dialog).getByTestId('dmap-inspector-keyed')).toHaveText(/^The key names the source end/);
  // The link section is in view without a scroll (the default height of the report row).
  await expect(at0(dialog)).toBeInViewport();
  await mkdir('/tmp/s1b', { recursive: true });
  await dialog.screenshot({ path: '/tmp/s1b/inspector-link.png' });
  await expect(inspector(dialog).getByTestId('dmap-inspector-a2b')).toHaveText('a → b: tx (tx)');
  // A hand-made panel: no note about the generator.
  await expect(inspector(dialog).getByTestId('dmap-inspector-generated')).toHaveCount(0);

  const at = at0(dialog);
  await expect(at).toHaveText('Use the target end');
  await at.click();
  await expect(popupCell(dialog, 'link-1')).toHaveAttribute('data-meta-at', 'target');
  await expect(at).toHaveText('Use the source end');
  await expect(inspector(dialog).getByTestId('dmap-inspector-keyed')).toHaveText(/^The key names the target end/);
  await expect(inspector(dialog).getByTestId('dmap-inspector-a2b')).toHaveText('a → b: rx (rx)');
  await expect.poll(labels).toEqual({ a2b: before.b2a, b2a: before.a2b });
});

test('the attribute row adds port=x to a cell, shows it in the list and Undo removes it (T3c)', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  const uid = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openSplitEditor(page);

  // The authoring diagram has no portograph port; a plain cell takes the same attribute row.
  await popupCell(dialog, 'device-2').click();
  const panel = inspector(dialog);
  await panel.getByRole('textbox', { name: 'Attribute name' }).fill('Port');
  await panel.getByRole('textbox', { name: 'Attribute value' }).fill('x');
  await panel.getByRole('button', { name: 'Add attribute', exact: true }).click();
  await expect(popupCell(dialog, 'device-2')).toHaveAttribute('data-meta-port', 'x');
  await expect(panel.getByTestId('dmap-inspector-attrs').getByText('port', { exact: true })).toBeVisible();
  await mkdir('/tmp/t3c', { recursive: true });
  await dialog.screenshot({ path: '/tmp/t3c/inspector-attrs.png' });

  await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(popupCell(dialog, 'device-2')).not.toHaveAttribute('data-meta-port', /.*/);
  await expect(panel.getByTestId('dmap-inspector-attrs').getByText('port', { exact: true })).toHaveCount(0);
});

test(
  'assign a class to 3 cells, Apply, save and reload; the XML wraps a bare mxCell; a draw.io save keeps the attributes (P3.7)',
  { tag: '@matrix' },
  async ({ page, request, config, createDiagram, gotoPanelEditPage }) => {
    const uid = await createDiagram(config);
    let edit = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    // `ordinary-chart` is a bare <mxCell> in the stored XML.
    expect(wrapperOf((await savedOptions(request, uid)).diagram.xml, 'ordinary-chart').object).toEqual({});
    const keys = { 'device-1': 'router-1', 'device-2': 'router-2', 'ordinary-chart': 'chart-key' };
    const dialog = await openSplitEditor(page);

    // Write 1: a key on the bare cell.
    await popupCell(dialog, 'ordinary-chart').click();
    await inspector(dialog).getByTestId('dmap-inspector-key').fill(keys['ordinary-chart']);
    await inspector(dialog).getByRole('button', { name: 'Set bind and key', exact: true }).click();
    await expect(popupCell(dialog, 'ordinary-chart')).toHaveAttribute('data-meta-key', keys['ordinary-chart']);
    // Write 2: Shift+click adds two cells, and "Assign class" sets `bind` on the three cells.
    await popupCell(dialog, 'device-1').click({ modifiers: ['Shift'] });
    await popupCell(dialog, 'device-2').click({ modifiers: ['Shift'] });
    await expect(inspector(dialog).getByRole('heading', { name: '3 cells selected' })).toBeVisible();
    expect(await flagged(dialog, 'selected')).toEqual(['device-1', 'device-2', 'ordinary-chart']);
    await inspector(dialog).getByTestId('dmap-inspector-bind').fill('trend-region');
    await inspector(dialog).getByRole('button', { name: 'Assign class', exact: true }).click();
    for (const [id, key] of Object.entries(keys)) {
      await expect(popupCell(dialog, id)).toHaveAttribute('data-meta-bind', 'trend-region');
      await expect(popupCell(dialog, id)).toHaveAttribute('data-meta-key', key);
    }
    // A text edit in the same draft: Apply writes the config and the diagram in one change.
    await replaceCode(dialog, 'freshness: 3x', 'freshness: 5x');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    const panel = page.getByTestId('dmap-panel');
    await expect(panel.locator('[data-cell-id="ordinary-chart"]')).toHaveAttribute('data-meta-bind', 'trend-region');
    // The draft is clean after Apply: Esc closes with no question.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dmap-bindings-popup')).toHaveCount(0);

    await saveDashboard(page, edit);
    const stored = async () => {
      const options = await savedOptions(request, uid);
      expect(options.config.freshness).toBe('5x');
      for (const [id, key] of Object.entries(keys)) {
        expect(wrapperOf(options.diagram.xml, id).object, id).toMatchObject({ id, bind: 'trend-region', key });
        expect(cellGroupOf(options.diagram.svg, id), id).toMatchObject({
          'data-meta-bind': 'trend-region',
          'data-meta-key': key,
        });
      }
      // The wrapper of the formerly bare cell: `id` and `value` (as `label`) moved to the <object>; the <mxCell> keeps
      // its parent and its kind.
      const { object, mxCell } = wrapperOf(options.diagram.xml, 'ordinary-chart');
      expect(object.label).toBe('Трафик α 🚀');
      expect(mxCell).toMatchObject({ vertex: '1', parent: 'chart-group' });
      expect(mxCell).not.toHaveProperty('id');
      expect(mxCell).not.toHaveProperty('value');
    };
    await stored();

    // Reload: the cells keep `bind` and their own `key`.
    edit = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    for (const [id, key] of Object.entries(keys)) {
      await expect(panel.locator(`[data-cell-id="${id}"]`).first()).toHaveAttribute('data-meta-bind', 'trend-region');
      await expect(panel.locator(`[data-cell-id="${id}"]`).first()).toHaveAttribute('data-meta-key', key);
    }

    // draw.io opens the stored diagram, and a save with no change keeps the attributes.
    await edit.getCustomOptions('Diagram').expand();
    await page.getByTestId('dmap-open-editor').click();
    const modal = page.getByTestId('dmap-editor-modal');
    await expect(modal).toHaveAttribute('data-dmap-editor-phase', 'loaded', { timeout: 60_000 });
    const frame = page.frameLocator('[data-testid="dmap-editor-frame"]');
    await expect(frame.locator('.geDiagramContainer')).toBeVisible();
    // The floating Format window can cover the Save button, so dispatch the click event directly.
    await frame.getByTitle(/^Save \(/).dispatchEvent('click');
    await expect(page.getByTestId('dmap-diagram-message')).toContainText('Saved', { timeout: 60_000 });
    await page.getByRole('dialog').filter({ has: modal }).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await saveDashboard(page, edit);
    await stored();
  }
);

test(
  'a schema error marks its line; invalid YAML keeps the last valid draft and turns Apply off; Ctrl+Z undoes in its own place (P3.8)',
  { tag: '@matrix' },
  async ({ page, config, createDiagram, gotoPanelEditPage }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openSplitEditor(page);
    const apply = dialog.getByRole('button', { name: 'Apply', exact: true });
    const report = matchReport(dialog);
    await expect(popupCell(dialog, 'device-1')).toHaveAttribute('data-dmap-status', 'normal');

    // An item error: a marker on its line and a report entry. It does not block Apply.
    await replaceCode(dialog, 'status: health', 'status: 42');
    const [statusLine] = await codeLines(dialog, /^ {4}status: 42$/);
    await expect.poll(async () => (await codeMarkers(dialog)).map((m) => m.line)).toContain(statusLine);
    await report.getByRole('tab', { name: /^routers/ }).click();
    await expect(report.getByRole('button', { name: /^status: / })).toBeVisible();
    await expect(apply).toBeEnabled();
    // The draft binds: the routers lose the status of the saved config.
    await expect(popupCell(dialog, 'device-1')).not.toHaveAttribute('data-dmap-status', 'normal');
    const draftStatus = await popupCell(dialog, 'device-1').getAttribute('data-dmap-status');

    // YAML that does not parse: a marker, a `yaml` entry, Apply off. The diagram keeps the last valid draft.
    await replaceCode(dialog, 'freshness: 3x', 'freshness: [3x');
    await expect(apply).toBeDisabled();
    await expect.poll(async () => (await codeMarkers(dialog)).length).toBeGreaterThan(0);
    await report.getByRole('tab', { name: /^Not in a class/ }).click();
    await expect(report.getByRole('button', { name: /^line \d+: / }).first()).toBeVisible();
    expect(await popupCell(dialog, 'device-1').getAttribute('data-dmap-status')).toBe(draftStatus);

    // A diagram write: a new key on device-2.
    await popupCell(dialog, 'device-2').click();
    await inspector(dialog).getByTestId('dmap-inspector-key').fill('router-x');
    await inspector(dialog).getByRole('button', { name: 'Set bind and key', exact: true }).click();
    await expect(popupCell(dialog, 'device-2')).toHaveAttribute('data-meta-key', 'router-x');

    // Ctrl+Z in the code box undoes the last text edit of Monaco. The diagram write stays. The browser of the tests
    // tells a Windows user agent (the Playwright device "Desktop Chrome"), so Monaco binds undo to Ctrl+Z on each host.
    await cursorToLine(dialog, /^freshness:/);
    await page.keyboard.press('Control+z');
    await expect.poll(() => codeText(dialog)).toContain('\nfreshness: 3x\n');
    expect(await codeText(dialog)).toContain('status: 42');
    await expect(apply).toBeEnabled();
    await expect(popupCell(dialog, 'device-2')).toHaveAttribute('data-meta-key', 'router-x');

    // Ctrl+Z on the stage undoes the last diagram write. The text stays.
    await popupCell(dialog, 'device-1').focus();
    await page.keyboard.press('Control+z');
    await expect(popupCell(dialog, 'device-2')).toHaveAttribute('data-meta-key', 'router-2');
    expect(await codeText(dialog)).toContain('status: 42');
    expect(await codeText(dialog)).toContain('\nfreshness: 3x\n');
  }
);

test(
  'the saved panel changes under the draft: "Reload" drops the draft, "Keep my draft" applies over it (P3.8)',
  { tag: '@matrix' },
  async ({ page, request, config, createDiagram, gotoPanelEditPage }) => {
    const uid = await createDiagram(config);
    const edit = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    // The YAML option of the options pane is the other editor of the saved config in the same tab. Grafana gives a save
    // in another tab to this tab only as its own "Dashboard changed" question (see the next test).
    const bindings = edit.getCustomOptions('Bindings');
    await bindings.expand();
    await expect(bindings.element.locator('.monaco-editor .view-lines')).toBeVisible();
    const banner = (dialog: Locator) => dialog.getByRole('alert').filter({ hasText: 'The saved panel changed' });

    let dialog = await openSplitEditor(page);
    await replaceCode(dialog, 'freshness: 3x', 'freshness: 4x');
    await replaceCode(bindings.element, 'freshness: 3x', 'freshness: 5x');
    await expect(banner(dialog)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    await banner(dialog).getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(banner(dialog)).toHaveCount(0);
    await expect.poll(() => codeText(dialog)).toContain('\nfreshness: 5x\n');
    // The reloaded draft is clean: Esc closes with no question.
    await popupCell(dialog, 'device-1').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dmap-bindings-popup')).toHaveCount(0);

    dialog = await openSplitEditor(page);
    await replaceCode(dialog, 'freshness: 5x', 'freshness: 6x');
    await replaceCode(bindings.element, 'freshness: 5x', 'freshness: 7x');
    await expect(banner(dialog)).toBeVisible();
    await banner(dialog).getByRole('button', { name: 'Keep my draft', exact: true }).click();
    await expect(banner(dialog)).toHaveCount(0);
    expect(await codeText(dialog)).toContain('\nfreshness: 6x\n');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await popupCell(dialog, 'device-1').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dmap-bindings-popup')).toHaveCount(0);
    await saveDashboard(page, edit);
    expect((await savedOptions(request, uid)).config.freshness).toBe('6x');
  }
);

test(
  'a save in another session: Grafana asks in its own dialog, and "Continue editing" keeps the popup and the draft',
  { tag: '@matrix' },
  async ({ page, request, config, createDiagram, gotoPanelEditPage }) => {
    const uid = await createDiagram(config);
    const edit = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    // Grafana tells the tab about the save through Grafana Live. It asks only when the dashboard has unsaved changes;
    // else it loads the dashboard again, and the popup closes with its draft. The draft of the popup is not a change of
    // the dashboard, so first change the panel through the YAML option, and wait until Grafana marks the dashboard.
    const bindings = edit.getCustomOptions('Bindings');
    await bindings.expand();
    await expect(bindings.element.locator('.monaco-editor .view-lines')).toBeVisible();
    await replaceCode(bindings.element, 'freshness: 3x', 'freshness: 4x');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __grafanaSceneContext?: { state: { isDirty?: boolean } } }).__grafanaSceneContext
              ?.state.isDirty
        )
      )
      .toBe(true);
    const dialog = await openSplitEditor(page);
    await replaceCode(dialog, 'freshness: 4x', 'freshness: 6x');
    const saved = await (await request.get(`/api/dashboards/uid/${uid}`)).json();
    saved.dashboard.panels[0].options.config.freshness = '5x';
    const response = await request.post('/api/dashboards/db', {
      data: { dashboard: saved.dashboard, overwrite: true },
    });
    expect(response.ok()).toBe(true);
    const changed = page.getByRole('dialog').filter({ hasText: 'Dashboard changed' });
    await expect(changed).toBeVisible();
    await changed.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(changed).toHaveCount(0);
    // The panel options of this tab do not change, so the popup shows no conflict banner: the draft stays as it is.
    await expect(dialog).toBeVisible();
    expect(await codeText(dialog)).toContain('\nfreshness: 6x\n');
    await expect(dialog.getByRole('alert').filter({ hasText: 'The saved panel changed' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  }
);

test(
  'Esc and the close button ask before a dirty draft goes; the nested dialogs own the focus; a refresh keeps the draft',
  { tag: '@matrix' },
  async ({ page, selectors, config, createDiagram, gotoPanelEditPage }) => {
    const uid = await createDiagram(config);
    const edit = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const question = page.getByRole('dialog', { name: 'Discard changes?' });
    const focusIn = (scope: Locator) => scope.evaluate((el) => el.contains(document.activeElement));

    await test.step('a clean draft closes on Esc, and the focus returns to the opener', async () => {
      const dialog = await openSplitEditor(page);
      expect(await focusIn(splitDialog(page))).toBe(true);
      await popupCell(dialog, 'device-1').focus();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('dmap-bindings-popup')).toHaveCount(0);
      await expect(page.getByTestId('dmap-edit-bindings')).toBeFocused();
    });

    await test.step('a dirty draft asks first; the question takes the focus; Esc in it keeps editing', async () => {
      const dialog = await openSplitEditor(page, 'option');
      await replaceCode(dialog, 'freshness: 3x', 'freshness: 4x');
      await popupCell(dialog, 'device-1').focus();
      await page.keyboard.press('Escape');
      await expect(question).toBeVisible();
      await expect.poll(() => focusIn(question)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(question).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect.poll(() => focusIn(splitDialog(page))).toBe(true);
      // The close button asks too; Cancel keeps the draft.
      await splitDialog(page).getByRole('button', { name: 'Close', exact: true }).click();
      await expect(question).toBeVisible();
      await question.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(question).toHaveCount(0);
      expect(await codeText(dialog)).toContain('\nfreshness: 4x\n');
    });

    await test.step('text that does not parse is a dirty draft too', async () => {
      const dialog = page.getByTestId('dmap-bindings-popup');
      await replaceCode(dialog, 'freshness: 4x', 'freshness: [4x');
      await popupCell(dialog, 'device-1').focus();
      await page.keyboard.press('Escape');
      await expect(question).toBeVisible();
      await question.getByRole('button', { name: 'Cancel', exact: true }).click();
      await replaceCode(dialog, 'freshness: [4x', 'freshness: 4x');
    });

    await test.step('two dashboard refreshes keep the popup and the draft', async () => {
      const dialog = page.getByTestId('dmap-bindings-popup');
      // The popup covers the Refresh button, so send the click event to it directly, as a keyboard shortcut would.
      // Grafana skips a refresh while the queries of the last one still run, so each refresh waits for its answers.
      const refresh = edit.getByGrafanaSelector(selectors.components.RefreshPicker.runButtonV2);
      const isQuery = (r: Request) => new URL(r.url()).pathname.endsWith('/api/ds/query');
      let running = 0;
      page.on('request', (r) => isQuery(r) && running++);
      page.on('requestfinished', (r) => isQuery(r) && running--);
      page.on('requestfailed', (r) => isQuery(r) && running--);
      for (let i = 0; i < 2; i++) {
        const queried = page.waitForRequest(isQuery);
        await refresh.dispatchEvent('click');
        await queried;
        await expect.poll(() => running).toBe(0);
      }
      await expect(dialog).toBeVisible();
      expect(await codeText(dialog)).toContain('\nfreshness: 4x\n');
      await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
      await expect(dialog.getByRole('alert').filter({ hasText: 'The saved panel changed' })).toHaveCount(0);
    });

    await test.step('Discard closes the dirty draft', async () => {
      await popupCell(page.getByTestId('dmap-bindings-popup'), 'device-1').focus();
      await page.keyboard.press('Escape');
      await question.getByRole('button', { name: 'Discard', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }
);

const SHOTS = process.env.DMAP_SCREENSHOTS; // a directory: write the screenshots there
/** True when the page has no horizontal scroll and the element is inside the viewport width. */
const fitsWidth = (el: Locator) =>
  el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const root = document.scrollingElement ?? document.documentElement;
    return { pageScroll: root.scrollWidth > root.clientWidth, inside: r.left >= 0 && r.right <= innerWidth };
  });

test.describe('the split view at 1440×900 (P3.11)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the code box, the diagram and the report show side by side', async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
    const uid = await createDiagram(config);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openSplitEditor(page);
    await expect(dialog.getByTestId('dmap-popup-layout')).toHaveAttribute('data-dmap-layout', 'panes');
    for (const pane of [codeBox(dialog), popupStage(dialog), matchReport(dialog)]) {
      await expect(pane).toBeVisible();
      expect(await fitsWidth(pane)).toEqual({ pageScroll: false, inside: true });
    }
    // The dialog has the geometry of the draw.io dialog: 96 % x 94 % of the viewport, in the middle.
    const frame = (await splitDialog(page).boundingBox())!;
    expect(Math.abs(frame.width - 0.96 * 1440)).toBeLessThan(2);
    expect(Math.abs(frame.height - 0.94 * 900)).toBeLessThan(2);
    expect(Math.abs(frame.x - (1440 - frame.width) / 2)).toBeLessThan(2);
    expect(Math.abs(frame.y - (900 - frame.height) / 2)).toBeLessThan(2);
    // The report has one tab per class. The cursor in a class lights its cells and opens the tab of the class, so the
    // screenshot shows the link between the text, the diagram and the report.
    const report = matchReport(dialog);
    const tabStops = report.locator('[role="tab"][tabindex="0"]');
    await expect(tabStops).toHaveCount(1);
    // the classes in the order of the stored config, then maybe the tab of the entries without a class; a count of
    // entries can follow the name
    const tabNames = async () => (await report.getByRole('tab').allTextContents()).map((t) => t.replace(/\d+$/, ''));
    await expect
      .poll(async () => (await tabNames()).slice(0, 3).sort())
      .toEqual(['directional-link', 'routers', 'trend-region']);
    const names = await tabNames();
    const afterRouters = names[(names.indexOf('routers') + 1) % names.length];
    // a click on a cell opens the tab of its class
    await popupCell(dialog, 'device-1').click();
    await expect(report.getByRole('tab', { name: /^routers/ })).toHaveAttribute('aria-selected', 'true');
    // the keyboard: the arrow keys move between the tabs
    await report.getByRole('tab', { name: /^routers/ }).focus();
    await page.keyboard.press('ArrowRight');
    const next = report.getByRole('tab', { name: new RegExp(`^${afterRouters}\\d*$`) });
    await expect(next).toHaveAttribute('aria-selected', 'true');
    await expect(next).toBeFocused();
    await expect(tabStops).toHaveCount(1);
    await expect(next).toHaveAttribute('tabindex', '0');
    // Tab leaves the class tabs; Shift+Tab returns to the selected class.
    await page.keyboard.press('Tab');
    expect(await report.getByRole('tablist').evaluate((el) => el.contains(document.activeElement))).toBe(false);
    await page.keyboard.press('Shift+Tab');
    await expect(next).toBeFocused();
    await cursorToLine(dialog, /^ {2}trend-region:$/);
    await expect(report.getByRole('tab', { name: /^trend-region/ })).toHaveAttribute('aria-selected', 'true');
    await cursorToLine(dialog, /^ {2}routers:$/);
    await expect.poll(async () => (await flagged(dialog, 'highlight')).length).toBeGreaterThan(0);
    await expect(report.getByRole('tab', { name: /^routers/ })).toHaveAttribute('aria-selected', 'true');
    await expect(report.getByRole('tabpanel', { name: 'Class routers' })).toBeVisible();
    if (SHOTS) {
      await splitDialog(page).screenshot({ path: `${SHOTS}/split-editor.png` });
      await page.screenshot({ path: 'local/split-editor-size.png' });
      await dialog.getByTestId('dmap-pane-report').screenshot({ path: 'local/split-editor-tabs.png' });
    }
  });
});

test('bindings and draw.io dialogs share viewport geometry at both phone breakpoints', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const uid = await createDiagram(config);
  const edit = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openSplitEditor(page);
  const viewports = [
    { width: 641, height: 800 },
    { width: 640, height: 800 },
    { width: 620, height: 800 },
    { width: 844, height: 390 },
  ];
  const frames = [];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const full = viewport.width <= 640 || viewport.height <= 480;
    await expect
      .poll(async () => (await splitDialog(page).boundingBox())!.width)
      .toBeCloseTo(viewport.width * (full ? 1 : 0.96), 0);
    const frame = (await splitDialog(page).boundingBox())!;
    expect(Math.abs(frame.height - viewport.height * (full ? 1 : 0.94))).toBeLessThan(2);
    frames.push(frame);
  }
  await splitDialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await edit.getCustomOptions('Diagram').expand();
  await page.getByTestId('dmap-open-editor').click();
  const drawio = page.getByRole('dialog').filter({ has: page.getByTestId('dmap-editor-modal') });
  await expect(drawio).toBeVisible();
  for (const [i, viewport] of viewports.entries()) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => (await drawio.boundingBox())!.width).toBeCloseTo(frames[i].width, 0);
    const frame = (await drawio.boundingBox())!;
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs(frame[dimension] - frames[i][dimension]),
        `${viewport.width}x${viewport.height} ${dimension}`
      ).toBeLessThan(2);
    }
  }
  if (process.env.DMAP_SCREENSHOTS) {
    await drawio.screenshot({ path: 'local/ux-fixes-drawio-landscape.png' });
  }
});

test.describe('the split view on a phone (P3.13)', () => {
  test.use(iPhone);

  test(
    'the panes are tabs with no horizontal scroll; the focus starts in the code box and stays in the dialog; Esc closes',
    { tag: '@matrix' },
    async ({ page, config, createDiagram, gotoPanelEditPage }) => {
      const uid = await createDiagram(config);
      await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
      const dialog = await openSplitEditor(page);
      await expect(dialog.getByTestId('dmap-popup-layout')).toHaveAttribute('data-dmap-layout', 'tabs');
      const focusIn = (scope: Locator) => scope.evaluate((el) => el.contains(document.activeElement));
      await expect.poll(() => focusIn(codeBox(dialog))).toBe(true);

      // In the code box Monaco takes Tab and Shift+Tab for the indent, so the focus stays there.
      const frame = splitDialog(page);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      expect(await focusIn(codeBox(dialog))).toBe(true);

      for (const [name, pane] of [
        ['Code', codeBox(dialog)],
        ['Diagram', popupStage(dialog)],
        ['Report', matchReport(dialog)],
      ] as const) {
        await dialog.getByRole('tab', { name, exact: true }).click();
        await expect(pane).toBeVisible();
        expect(await fitsWidth(pane)).toEqual({ pageScroll: false, inside: true });
        if (SHOTS && name === 'Diagram') {
          await page.screenshot({ path: `${SHOTS}/split-editor-phone.png` });
        }
      }

      // Outside the code box Tab and Shift+Tab move the focus and wrap at the ends, but never leave the dialog.
      const close = frame.getByRole('button', { name: 'Close', exact: true });
      await close.focus();
      await page.keyboard.press('Shift+Tab');
      expect(await focusIn(frame)).toBe(true);
      await expect(close).not.toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      const seen = new Set<string>();
      for (const key of [...Array(8).fill('Tab'), ...Array(8).fill('Shift+Tab')]) {
        await page.keyboard.press(key);
        expect(await focusIn(frame)).toBe(true);
        seen.add(await page.evaluate(() => document.activeElement!.outerHTML.slice(0, 120)));
      }
      expect(seen.size).toBeGreaterThan(2);

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
  );
});
