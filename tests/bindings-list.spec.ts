import { attachJson, expect, test } from './authoring-fixtures';

test('the All bindings tab lists patterns, overrides and widgets, filters them and opens a row for editing', async ({
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
  const inspector = page.getByRole('complementary', { name: 'Diagram binding inspector' });

  await expect(inspector.getByRole('tab', { name: 'Element', exact: true })).toHaveAttribute('aria-selected', 'true');
  await inspector.getByRole('tab', { name: /All bindings/ }).click();
  await expect(inspector.getByRole('button', { name: 'Patterns (2)', exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Overrides (2)', exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Widgets (1)', exact: true })).toBeVisible();

  // problems: a pattern without a match and an override of a deleted cell
  const ghost = inspector.getByRole('button', { name: 'Edit pattern Ghost pattern', exact: true });
  await expect(ghost).toContainText('0 cells');
  await inspector.getByRole('button', { name: 'Show problems of Ghost pattern', exact: true }).click();
  await expect(inspector.getByRole('list', { name: 'Problems of Ghost pattern' })).toContainText('matches no element');

  // the inspector must not overflow horizontally
  const overflow = await inspector.evaluate((el) =>
    Array.from(el.querySelectorAll<HTMLElement>('*'))
      .filter((n) => n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0)
      .map((n) => `${n.tagName}:${n.getAttribute('aria-label') ?? n.textContent?.slice(0, 30)}`)
  );
  await attachJson(testInfo, 'list-overflow', overflow);

  await inspector.getByText('Problems only').click();
  await expect(inspector.getByRole('button', { name: 'Edit pattern Repeated routers' })).toHaveCount(0);
  await expect(ghost).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Edit override removed-cell' })).toBeVisible();
  await inspector.getByText('Problems only').click();

  await inspector.getByLabel('Filter bindings').fill('device-2');
  await expect(inspector.getByRole('button', { name: 'Edit override device-2' })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Edit override removed-cell' })).toHaveCount(0);

  await inspector.getByRole('button', { name: 'Edit override device-2' }).click();
  await expect(inspector.getByRole('tab', { name: 'Element', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(inspector.getByRole('heading', { name: 'device-2 bindings' })).toBeVisible();
  await expect(inspector.getByText('Element override: Yes')).toBeVisible();
  await expect(page.getByTestId('dmap-panel').locator('[data-cell-id="device-2"]')).toHaveAttribute(
    'data-dmap-selected',
    'true'
  );
});

test('a pattern row opens the pattern for editing and an override can be deleted into the draft', async ({
  page,
  config,
  createDiagram,
  gotoPanelEditPage,
}) => {
  config.overrides = [{ cellId: 'device-2', display: { label: 'Second router' } }];
  const uid = await createDiagram(config);
  await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
  const inspector = page.getByRole('complementary', { name: 'Diagram binding inspector' });
  await inspector.getByRole('tab', { name: /All bindings/ }).click();

  await inspector.getByRole('button', { name: 'Edit pattern Repeated routers' }).click();
  await expect(inspector.getByRole('heading', { name: 'device-1 bindings' })).toBeVisible();
  await expect(inspector.getByText('Affected elements: 2')).toBeVisible();

  await inspector.getByRole('tab', { name: /All bindings/ }).click();
  await inspector.getByRole('button', { name: 'Delete override device-2' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(inspector.getByRole('button', { name: 'Overrides (0)', exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Cancel changes' }).click();
  await expect(inspector.getByRole('button', { name: 'Overrides (1)', exact: true })).toBeVisible();
});

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 1200 }],
  ['narrow', { width: 760, height: 1100 }],
] as const) {
  test(`the All bindings tab fits the inspector (${name})`, async ({
    page,
    config,
    createDiagram,
    gotoPanelEditPage,
  }) => {
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
    const inspector = page.getByRole('complementary', { name: 'Diagram binding inspector' });
    await inspector.getByRole('tab', { name: /All bindings/ }).click();
    if (process.env.DMAP_SHOTS) {
      await page.screenshot({
        path: `${process.env.DMAP_SHOTS}/all-bindings-${name}-groups-${process.env.GRAFANA_URL?.slice(-4)}.png`,
      });
    }
    await inspector.getByRole('button', { name: /Show problems of Ghost/ }).click();
    expect(await inspector.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const body = inspector.getByRole('region', { name: 'All bindings list' });
    expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (process.env.DMAP_SHOTS) {
      await page.screenshot({
        path: `${process.env.DMAP_SHOTS}/all-bindings-${name}-${process.env.GRAFANA_URL?.slice(-4)}.png`,
      });
    }
  });
}
