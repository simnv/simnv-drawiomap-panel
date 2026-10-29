import React from 'react';
import { createTheme } from '@grafana/data';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StatusView } from '../binding/status';
import type { PatchMap, StatusV4Fields } from '../types';
import { BAND_ROW, bandLayout, bandRowsV4, StatusBand } from './StatusBand';

vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: (theme: ReturnType<typeof createTheme>) => unknown) => fn(createTheme()),
}));

describe('bandLayout', () => {
  it('shows all causes up to the cap, then the most severe causes and a "+k more" row', () => {
    expect(bandLayout(0, 3, false, 600)).toMatchObject({ causes: 0, toggle: false, height: 0 });
    expect(bandLayout(2, 3, false, 600)).toMatchObject({ causes: 2, hidden: 0, toggle: false });
    expect(bandLayout(5, 3, false, 600)).toMatchObject({ causes: 2, hidden: 3, toggle: true });
    expect(bandLayout(5, 0, false, 600).height).toBe(0);
  });
  it('a cap of one row shows only the toggle row', () => {
    const layout = bandLayout(4, 1, false, 600);
    expect(layout).toMatchObject({ causes: 0, hidden: 4, toggle: true });
    expect(layout.height).toBeLessThan(2 * BAND_ROW);
  });
  it('never takes more than half of a short panel', () => {
    for (const height of [40, 60, 100]) {
      for (const count of [1, 3, 9]) {
        for (const expanded of [false, true]) {
          const layout = bandLayout(count, 3, expanded, height);
          expect(layout.height).toBeLessThanOrEqual(Math.max(BAND_ROW + 4, height / 2));
        }
      }
    }
    expect(bandLayout(3, 3, false, 60)).toMatchObject({ causes: 0, hidden: 3, toggle: true });
  });
});

type V4Status = StatusView & StatusV4Fields;
const v4 = (refId: string, severity: StatusView['state'], text: string, reason = ''): V4Status => ({
  state: severity,
  severity,
  reason,
  queryIds: [],
  conditionKey: '',
  coverage: { available: 1, expected: 1 },
  refId,
  text,
});
const patchesOf = (list: Array<[string, V4Status]>): PatchMap =>
  new Map(list.map(([cellId, statusView]) => [cellId, { cellId, scope: { cell: {} }, urls: [], statusView }]));

describe('bandRowsV4', () => {
  it('gives one row per text and refId, with the band text of spec 3.4', () => {
    const rows = bandRowsV4(
      patchesOf([
        ['n1', v4('scrape_up', 'down', 'Offline')],
        ['n2', v4('scrape_up', 'down', 'Offline')],
      ])
    );
    expect(rows).toEqual([{ text: 'Offline · scrape_up: 2 cells', refId: 'scrape_up', count: 2, severity: 'down' }]);
  });
  it('lists only the rows that are not normal, worst first, then the most cells first', () => {
    const rows = bandRowsV4(
      patchesOf([
        ['n1', v4('cpu', 'warning', '81%')],
        ['n2', v4('cpu', 'normal', '12%')],
        ['n3', v4('temp', 'missing', '–', 'Query failed')],
        ['n4', v4('cpu', 'critical', '97%')],
        ['n5', v4('mem', 'warning', 'High')],
        ['n6', v4('mem', 'warning', 'High')],
        ['n7', v4('up', 'stale', 'Online')],
      ])
    );
    expect(rows.map((r) => r.text)).toEqual([
      '97% · cpu: 1 cell',
      'High · mem: 2 cells',
      '81% · cpu: 1 cell',
      'Stale · up: 1 cell',
      'Query failed · temp: 1 cell',
    ]);
  });
  it('gives stale cells a Stale row and never groups them under their last fresh text (A10)', () => {
    const rows = bandRowsV4(
      patchesOf([
        ['n1', v4('health', 'stale', 'Healthy', 'Sample is stale')],
        ['n2', v4('health', 'stale', 'Healthy', 'Sample is stale')],
        ['n3', v4('health', 'stale', 'Degraded', 'Sample is stale')],
        ['n4', v4('health', 'warning', 'Healthy')],
      ])
    );
    expect(rows.map((r) => [r.text, r.severity])).toEqual([
      ['Healthy · health: 1 cell', 'warning'],
      ['Stale · health: 3 cells', 'stale'],
    ]);
  });
  it('shows the reason when the cell has no value text', () => {
    const rows = bandRowsV4(patchesOf([['n1', v4('cpu', 'down', '–', 'No data')]]));
    expect(rows.map((r) => r.text)).toEqual(['No data · cpu: 1 cell']);
  });
});

describe('StatusBand', () => {
  it('shows the row text, the state and the count of the row', () => {
    const rows = bandRowsV4(
      patchesOf([
        ['n1', v4('scrape_up', 'down', 'Offline')],
        ['n2', v4('scrape_up', 'down', 'Offline')],
      ])
    );
    render(
      <StatusBand rowsV4={rows} layout={bandLayout(rows.length, 3, false, 600)} expanded={false} onToggle={() => {}} />
    );
    const row = screen.getByTestId('dmap-status-band').querySelector('.dmap-status-summary')!;
    expect(row.textContent).toContain('Offline · scrape_up: 2 cells');
    expect(row.getAttribute('data-dmap-state')).toBe('down');
    expect(row.getAttribute('data-dmap-count')).toBe('2');
  });
  it('counts the cells of the hidden rows in the toggle text', () => {
    const rows = bandRowsV4(
      patchesOf([
        ['n1', v4('a', 'down', 'Offline')],
        ['n2', v4('d', 'critical', '97%')],
        ['n3', v4('d', 'critical', '97%')],
        ['n4', v4('e', 'warning', '81%')],
        ['n5', v4('f', 'warning', 'High')],
      ])
    );
    render(
      <StatusBand rowsV4={rows} layout={bandLayout(rows.length, 2, false, 600)} expanded={false} onToggle={() => {}} />
    );
    expect(screen.getByRole('button').textContent).toBe('+3 more (4 cells)');
  });
});
