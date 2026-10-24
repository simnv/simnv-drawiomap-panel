import 'intersection-observer';
import React from 'react';
import { FieldType, getDefaultTimeRange, LoadingState, toDataFrame, type PanelData } from '@grafana/data';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buttonNamed } from '../testUtils';
import type { NamedQuery } from '../../model/config';
import type { QuerySnapshot } from '../../query/types';
import { QueryPane, PREVIEW_ROWS, type QueryPaneProps } from './QueryPane';

vi.hoisted(() => {
  if (!window.localStorage) {
    Object.defineProperty(window, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
  }
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});
vi.mock('@grafana/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@grafana/runtime')>()),
  getDataSourceSrv: () => ({ get: async () => ({ components: {} }), getInstanceSettings: () => undefined }),
}));

const query: NamedQuery = { id: 'cpu', name: 'CPU', source: { kind: 'panel', refId: 'A' } };
const context = {
  timeRange: getDefaultTimeRange(),
  timeZone: 'utc',
  scopedVars: {},
  refreshMs: 0,
  intervalMs: 1000,
  generation: 1,
};
const data: PanelData = { state: LoadingState.Done, series: [], timeRange: context.timeRange };

const props = (over: Partial<QueryPaneProps> = {}): QueryPaneProps => ({
  query,
  epoch: 0,
  context,
  data,
  timeZone: 'utc',
  uses: 0,
  usedBy: [],
  snapshot: { state: 'idle' },
  fields: [],
  queryError: '',
  onValidity: vi.fn(),
  onChange: vi.fn(),
  onPreview: vi.fn(),
  onDelete: vi.fn(),
  ...over,
});

const ready = (rows: number): QuerySnapshot => ({
  state: 'ready',
  fetchedAt: 1,
  fromCache: false,
  frames: [
    toDataFrame({
      name: 'cpu',
      fields: [
        { name: 'host', type: FieldType.string, values: Array.from({ length: rows }, (_, i) => `host-${i}`) },
        {
          name: 'usage',
          type: FieldType.number,
          config: { unit: 'percent', decimals: 1 },
          values: Array.from({ length: rows }, (_, i) => i + 0.25),
        },
      ],
    }),
    toDataFrame({ fields: [{ name: 'other', type: FieldType.number, values: [1] }] }),
  ],
});

describe('QueryPane', () => {
  it('shows the first frame as a table: one column per field, values as the field display formats them', () => {
    render(<QueryPane {...props({ snapshot: ready(3), fields: ['host', 'usage', 'other'] })} />);
    const table = screen.getByRole('table', { name: 'Query preview table' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent)
    ).toEqual(['host', 'usage']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => Array.from(row.querySelectorAll('td')).map((td) => td.textContent))).toEqual([
      ['host-0', '0.3%'],
      ['host-1', '1.3%'],
      ['host-2', '2.3%'],
    ]);
    expect(screen.getByLabelText('Query preview result').textContent).toBe(
      'ready: 2 frames, 4 rows, fields: host, usage, other'
    );
  });

  it('limits the table to 20 rows and says so', () => {
    render(<QueryPane {...props({ snapshot: ready(PREVIEW_ROWS + 5) })} />);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(PREVIEW_ROWS + 1);
    expect(screen.getByText('Showing the first 20 of 25 rows.')).toBeTruthy();
  });

  it('shows no table before a ready preview', () => {
    for (const snapshot of [
      { state: 'idle' },
      { state: 'loading' },
      { state: 'empty', fetchedAt: 1, fromCache: false },
    ]) {
      const view = render(<QueryPane {...props({ snapshot: snapshot as QuerySnapshot })} />);
      expect(screen.queryByRole('table')).toBeNull();
      view.unmount();
    }
  });

  it.each([
    ['error', 'Query failed'],
    ['unsupported', 'Query not supported'],
  ] as const)('marks a %s result with an error alert', (state, title) => {
    render(<QueryPane {...props({ snapshot: { state, message: 'boom' } })} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(title);
    expect(alert.textContent).toContain('boom');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('lists the users of the query as buttons that select them', () => {
    const open = vi.fn();
    render(
      <QueryPane
        {...props({
          uses: 2,
          usedBy: [
            { key: 'p', label: 'Pattern Core routers', open },
            { key: 'o', label: 'Override device-1', open: vi.fn() },
          ],
        })}
      />
    );
    const list = screen.getByRole('list', { name: 'Used by' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['Pattern Core routers', 'Override device-1']);
    fireEvent.click(within(list).getByRole('button', { name: 'Pattern Core routers' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Query use count').textContent).toBe('Used by 2 bindings.');
  });

  it('deletes an unused query at once', () => {
    const onDelete = vi.fn();
    render(<QueryPane {...props({ onDelete })} />);
    expect(screen.queryByRole('list', { name: 'Used by' })).toBeNull();
    fireEvent.click(buttonNamed('Delete query'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Delete query?')).toBeNull();
  });

  it('asks before it deletes a query that bindings use; Keep query leaves it', async () => {
    const onDelete = vi.fn();
    render(<QueryPane {...props({ uses: 1, onDelete })} />);
    fireEvent.click(buttonNamed('Delete query'));
    expect(await screen.findByText('Delete query?')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(buttonNamed('Keep query'));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes a used query after the confirmation', async () => {
    const onDelete = vi.fn();
    render(<QueryPane {...props({ uses: 1, onDelete })} />);
    fireEvent.click(buttonNamed('Delete query'));
    const button = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(button);
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });
});
