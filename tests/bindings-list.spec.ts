import { filterBindings, openBindingsPopup, popupInspector } from './authoring-controls';
import { attachJson, expect, test } from './authoring-fixtures';

const listOf = (dialog: ReturnType<typeof openBindingsPopup> extends Promise<infer T> ? T : never) =>
  dialog.getByTestId('dmap-pane-list');

test('the list pane lists patterns, overrides, widgets and queries, filters them and opens a row for editing', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}, testInfo) => {
  config.patterns = [
    ...config.patterns.filter((p) => p.id === 'routers'),
    { id: 'ghost', name: 'Ghost pattern', select: { ids: ['no-such-cell'] }, display: { label: 'Ghost' } },
  ];
  config.overrides = [
    { cellId: 'device-2', display: { label: 'Second router' } },
    { cellId: 'removed-cell', display: { label: 'Old' } },
  ];
  config.widgets = [
    {
      id: 'load',
      anchorCellId: 'chart-1',
      kind: 'sparkline',
      label: 'Load chart',
      binding: { queryId: 'trend', match: {}, reducer: 'last' },
    },
  ];
  const uid = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openBindingsPopup(page);
  const list = listOf(dialog);
  const inspector = popupInspector(dialog);

  await expect(list.getByRole('button', { name: 'Patterns (2)', exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Overrides (2)', exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Widgets (1)', exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: /^Queries \(/ })).toBeVisible();
  // nothing is selected yet
  await expect(inspector).toContainText('Select an element in the diagram or a row in the list.');

  // problems: a pattern without a match and an override of a deleted cell
  const ghost = list.getByRole('button', { name: 'Edit pattern Ghost pattern', exact: true });
  await expect(ghost).toContainText('0 cells');
  await list.getByRole('button', { name: 'Show problems of Ghost pattern', exact: true }).click();
  await expect(list.getByRole('list', { name: 'Problems of Ghost pattern' })).toContainText('matches no element');

  // the list must not overflow horizontally
  const overflow = await list.evaluate((el) =>
    Array.from(el.querySelectorAll<HTMLElement>('*'))
      .filter((n) => n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0)
      .map((n) => `${n.tagName}:${n.getAttribute('aria-label') ?? n.textContent?.slice(0, 30)}`)
  );
  await attachJson(testInfo, 'list-overflow', overflow);

  await list.getByText('Problems only').click();
  await expect(list.getByRole('button', { name: 'Edit pattern Repeated routers' })).toHaveCount(0);
  await expect(ghost).toBeVisible();
  await expect(list.getByRole('button', { name: 'Edit override removed-cell' })).toBeVisible();
  await list.getByText('Problems only').click();

  await filterBindings(dialog, 'device-2');
  await expect(list.getByRole('button', { name: 'Edit override device-2' })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Edit override removed-cell' })).toHaveCount(0);

  await list.getByRole('button', { name: 'Edit override device-2' }).click();
  await expect(inspector.getByRole('heading', { name: 'device-2 bindings' })).toBeVisible();
  await expect(inspector.getByText('Element override: Yes')).toBeVisible();
  // the selection shows in the stage of the popup, not in the panel behind it
  await expect(dialog.getByTestId('dmap-popup-stage').locator('[data-cell-id="device-2"]')).toHaveAttribute(
    'data-dmap-selected',
    'true'
  );
  await expect(page.getByTestId('dmap-panel').locator('[data-cell-id="device-2"]')).not.toHaveAttribute(
    'data-dmap-selected',
    'true'
  );
});

test('a pattern row opens the pattern for editing, a query row opens its editor, and an override can be deleted into the draft', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  config.overrides = [{ cellId: 'device-2', display: { label: 'Second router' } }];
  const uid = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const dialog = await openBindingsPopup(page);
  const list = listOf(dialog);
  const inspector = popupInspector(dialog);

  await list.getByRole('button', { name: 'Edit pattern Repeated routers' }).click();
  await expect(inspector.getByRole('heading', { name: 'device-1 bindings' })).toBeVisible();
  await expect(inspector.getByText('Affected elements: 2')).toBeVisible();

  await list.getByRole('button', { name: 'Edit query health' }).click();
  await expect(inspector.getByRole('heading', { name: 'health query' })).toBeVisible();

  await list.getByRole('button', { name: 'Delete override device-2' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Overrides (0)', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel changes', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Overrides (1)', exact: true })).toBeVisible();
});

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['narrow', { width: 900, height: 800 }],
] as const) {
  test(`the list pane fits its pane (${name})`, async ({ page, config, createDiagram, gotoPanelEditPage }) => {
    config.patterns = [
      ...config.patterns.filter((p) => p.id === 'routers'),
      {
        id: 'ghost',
        name: 'Ghost pattern with a rather long display name',
        select: { ids: ['no-such-cell'] },
        display: {},
      },
    ];
    config.overrides = [
      { cellId: 'device-2', display: { label: 'Second router' } },
      { cellId: 'removed-cell', display: { label: 'Old' } },
    ];
    const uid = await createDiagram(config);
    await page.setViewportSize(viewport);
    await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const dialog = await openBindingsPopup(page);
    const list = listOf(dialog);
    if (process.env.DMAP_SHOTS) {
      await page.screenshot({
        path: `${process.env.DMAP_SHOTS}/bindings-list-${name}-groups-${process.env.GRAFANA_URL?.slice(-4)}.png`,
      });
    }
    await list.getByRole('button', { name: /Show problems of Ghost/ }).click();
    expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const body = list.getByRole('region', { name: 'All bindings list' });
    expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    // the footer stays inside the pane and its fields are reachable
    await expect(list.getByRole('textbox', { name: 'Default datasource UID' })).toBeVisible();
  });
}
