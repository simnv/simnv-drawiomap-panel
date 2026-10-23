import React from 'react';
import { createTheme, FieldType, getDefaultTimeRange } from '@grafana/data';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BindingResolver, PlanCellPatch } from '../../binding/engine';
import type { CardContext } from '../../interact/cardModel';
import type { QueryBinding } from '../../model/config';
import { toHistory } from '../../query/frames';
import { CardPreview } from './CardPreview';

const binding: QueryBinding = { queryId: 'cpu', match: {}, reducer: 'last' };
const patch = (hover?: PlanCellPatch['hover']): PlanCellPatch =>
  ({
    cellId: 'pg-node~rtr-a',
    ruleNames: [],
    scope: { cell: { 'pg-id': 'rtr-a', key: 'rtr-a', label: 'Router A' } },
    urls: [],
    warnings: [],
    hover,
  }) as PlanCellPatch;
const withRows = patch({
  rows: [
    { kind: 'metadata', label: 'Device', path: 'cell.key' },
    { kind: 'value', label: 'CPU', binding },
  ],
});
const cardContext: CardContext = {
  series: [],
  theme: createTheme(),
  display: (_s, v) => ({ text: String(v), numeric: v }),
  replaceVariables: (text) => text,
};
const resolverFor =
  (value: number): BindingResolver =>
  () =>
    toHistory(
      {
        state: 'ready',
        fetchedAt: 1,
        fromCache: false,
        frames: [
          {
            length: 1,
            fields: [
              { name: 'Time', type: FieldType.time, config: {}, values: [1000] },
              {
                name: 'CPU',
                type: FieldType.number,
                config: {},
                values: [value],
                display: (v) => ({ text: `${v} %`, numeric: Number(v) }),
              },
            ],
          },
        ],
      },
      binding
    );

const view = (p: PlanCellPatch | undefined, resolve: BindingResolver) => (
  <CardPreview
    patch={p}
    resolve={resolve}
    cardContext={cardContext}
    timeRange={getDefaultTimeRange()}
    timeZone="utc"
    width={320}
  />
);

describe('CardPreview', () => {
  it('shows the rows that the panel card shows for the same patch and data', () => {
    render(view(withRows, resolverFor(42)));
    const section = screen.getByRole('region', { name: 'Hover card preview' });
    const rows = section.querySelectorAll('[data-testid="dmap-card-row"]');
    expect(Array.from(rows).map((r) => r.textContent)).toEqual(['Devicertr-a', 'CPU42 %']);
    expect(screen.getByText('Router A')).toBeTruthy();
    expect(section.querySelector('[data-variant="inline"]')).toBeTruthy();
  });

  it('updates the rows when the data changes, with no click', () => {
    const { rerender } = render(view(withRows, resolverFor(42)));
    expect(screen.getByText('42 %')).toBeTruthy();
    rerender(view(withRows, resolverFor(77)));
    expect(screen.queryByText('42 %')).toBeNull();
    expect(screen.getByText('77 %')).toBeTruthy();
  });

  it('shows the links of a card that has only a drilldown, with no "Click for links" hint', () => {
    const only = patch({ rows: [{ kind: 'drilldown', label: 'Dashboard', url: '/d/device' }] });
    render(view(only, resolverFor(1)));
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/d/device');
    expect(screen.queryByText('Click for links')).toBeNull();
    expect(screen.queryByText('No card for this element')).toBeNull();
  });

  it('shows an empty state for an element without a card and for no element', () => {
    const { rerender } = render(view(patch(), resolverFor(1)));
    expect(screen.getByText('No card for this element')).toBeTruthy();
    rerender(view(undefined, resolverFor(1)));
    expect(screen.getByText('No card for this element')).toBeTruthy();
    rerender(view(patch({ enabled: false, rows: withRows.hover!.rows }), resolverFor(1)));
    expect(screen.getByText('No card for this element')).toBeTruthy();
  });
});
