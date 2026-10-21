import React from 'react';
import { createTheme } from '@grafana/data';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Legend } from './Legend';
import type { LegendBlock } from './model';

vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: (theme: ReturnType<typeof createTheme>) => unknown) => fn(createTheme()),
}));

const blocks: LegendBlock[] = [
  {
    key: 'load',
    title: 'Link load %',
    entries: [
      { key: 'step-0', label: '< 60%', color: '#0f0', cellIds: ['l1'] },
      { key: 'step-1', label: '≥ 60%', color: '#ff0', cellIds: ['l2', 'l3'] },
    ],
    cellIds: ['l1', 'l2', 'l3'],
  },
  {
    key: 'wan',
    title: 'WAN load %',
    entries: [],
    gradient: { colors: ['#0f0', '#f00'], min: '0%', max: '100%' },
    cellIds: ['w1'],
  },
  {
    key: 'status',
    title: 'Status',
    entries: [{ key: 'critical', label: 'Down, critical', color: '#f00', cellIds: [] }],
    cellIds: ['n1'],
  },
];

const view = (over: Partial<React.ComponentProps<typeof Legend>> = {}) => {
  const onHighlight = vi.fn();
  const r = render(<Legend blocks={blocks} maxBlocks={4} narrow={false} onHighlight={onHighlight} {...over} />);
  return { ...r, onHighlight, legend: screen.getByTestId('dmap-legend') };
};

describe('Legend', () => {
  it('shows each block with its title, swatches and threshold texts in order', () => {
    const { legend } = view();
    expect(
      within(legend)
        .getAllByTestId('dmap-legend-block')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Link load %', 'WAN load %', 'Status']);
    const entries = within(legend).getAllByTestId('dmap-legend-entry');
    expect(entries.map((e) => e.textContent)).toEqual(['< 60%', '≥ 60%', '0%100%', 'Down, critical']);
    expect(entries[1].getAttribute('aria-label')).toBe('≥ 60%: 2 elements');
    expect((entries[0].querySelector('[data-dmap-swatch]') as HTMLElement).style.background).toBe('rgb(0, 255, 0)');
    expect((entries[2].querySelector('[data-dmap-gradient]') as HTMLElement).style.background).toContain(
      'linear-gradient'
    );
  });
  it('highlights the cells of an entry on hover and on focus, and clears on leave and on blur', () => {
    const { legend, onHighlight } = view();
    const [, high, gradient] = within(legend).getAllByTestId('dmap-legend-entry');
    fireEvent.mouseEnter(high);
    expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
    fireEvent.mouseLeave(high);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
    fireEvent.focus(gradient);
    expect(onHighlight).toHaveBeenLastCalledWith(['w1']);
    fireEvent.blur(gradient);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
    expect(high.tabIndex).toBe(0);
  });
  it('shows at most maxBlocks blocks and tells how many it hides', () => {
    const { legend } = view({ maxBlocks: 2 });
    expect(within(legend).getAllByTestId('dmap-legend-block')).toHaveLength(2);
    expect(legend.textContent).toContain('+1 more');
  });
  it('is a collapsed chip on a narrow panel that opens and closes', () => {
    const { legend } = view({ narrow: true });
    const chip = within(legend).getByRole('button', { name: 'Legend' });
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(within(legend).queryAllByTestId('dmap-legend-block')).toHaveLength(0);
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(within(legend).getAllByTestId('dmap-legend-block')).toHaveLength(3);
    fireEvent.click(chip);
    expect(within(legend).queryAllByTestId('dmap-legend-block')).toHaveLength(0);
  });
  it('is open on a wide panel and shows nothing without blocks', () => {
    const { legend } = view();
    expect(within(legend).getByRole('button', { name: 'Legend' }).getAttribute('aria-expanded')).toBe('true');
    const { container } = render(<Legend blocks={[]} maxBlocks={4} narrow={false} onHighlight={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});
