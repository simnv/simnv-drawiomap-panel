import React from 'react';
import { createTheme } from '@grafana/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Legend } from './Legend';
import type { LegendBlock } from './model';

vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
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
  const r = render(<Legend blocks={blocks} maxBlocks={4} collapsed={false} onHighlight={onHighlight} {...over} />);
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
  it('is a collapsed chip by default that opens and closes on a click', () => {
    const { legend } = view({ collapsed: undefined });
    const chip = within(legend).getByRole('button', { name: 'Legend' });
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(within(legend).queryAllByTestId('dmap-legend-block')).toHaveLength(0);
    expect(legend.querySelector('[data-dmap-chip-swatch]')).not.toBeNull();
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(within(legend).getAllByTestId('dmap-legend-block')).toHaveLength(3);
    fireEvent.click(chip);
    expect(within(legend).queryAllByTestId('dmap-legend-block')).toHaveLength(0);
  });
  it('is a focusable native button, so Enter and Space toggle it (the browser sends the click)', () => {
    const { legend } = view({ collapsed: true });
    const chip = within(legend).getByRole('button', { name: 'Legend' });
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.getAttribute('type')).toBe('button');
    chip.focus();
    expect(document.activeElement).toBe(chip);
    // a keyboard click has no pointer events before it
    fireEvent.click(chip, { detail: 0 });
    expect(chip.getAttribute('aria-expanded')).toBe('true');
  });
  it('is open when the option Start collapsed is false, and shows nothing without blocks', () => {
    const { legend } = view({ collapsed: false });
    expect(within(legend).getByRole('button', { name: 'Legend' }).getAttribute('aria-expanded')).toBe('true');
    const { container } = render(<Legend blocks={[]} maxBlocks={4} collapsed={false} onHighlight={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
  it('follows a change of the option', () => {
    const { legend, rerender, onHighlight } = view({ collapsed: false });
    rerender(<Legend blocks={blocks} maxBlocks={4} collapsed onHighlight={onHighlight} />);
    expect(within(legend).getByRole('button', { name: 'Legend' }).getAttribute('aria-expanded')).toBe('false');
  });

  describe('drag and keyboard move', () => {
    // The panel is 400 x 300. The legend is 100 x 40 and starts in the bottom-right corner (x 290, y 250).
    const PANEL = { w: 400, h: 300 };
    const SIZE = { w: 100, h: 40 };
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    spy.mockImplementation(function (this: Element) {
      const rect = (x: number, y: number, w: number, h: number) =>
        ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
      if (this instanceof HTMLElement && this.dataset.testid === 'dmap-legend') {
        const x = this.style.left ? parseFloat(this.style.left) : PANEL.w - SIZE.w - 10;
        const y = this.style.top ? parseFloat(this.style.top) : PANEL.h - SIZE.h - 10;
        return rect(x, y, SIZE.w, SIZE.h);
      }
      return rect(0, 0, PANEL.w, PANEL.h);
    });
    afterEach(() => spy.mockClear());
    const at = (legend: HTMLElement) => ({ x: parseFloat(legend.style.left), y: parseFloat(legend.style.top) });
    const drag = (handle: HTMLElement, from: [number, number], to: [number, number]) => {
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: from[0],
        clientY: from[1],
      });
      fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'mouse', clientX: to[0], clientY: to[1] });
      fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'mouse', clientX: to[0], clientY: to[1] });
      fireEvent.click(handle);
    };

    it('moves with a drag and does not toggle', () => {
      const { legend } = view({ collapsed: true });
      const handle = within(legend).getByRole('button', { name: 'Legend' });
      drag(handle, [300, 260], [250, 200]);
      expect(at(legend)).toEqual({ x: 240, y: 190 });
      expect(handle.getAttribute('aria-expanded')).toBe('false');
      // the next click toggles again
      fireEvent.pointerDown(handle, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 1, clientY: 1 });
      fireEvent.pointerUp(handle, { pointerId: 2, pointerType: 'mouse' });
      fireEvent.click(handle);
      expect(handle.getAttribute('aria-expanded')).toBe('true');
    });
    it('treats a move under 4 px as a click', () => {
      const { legend } = view({ collapsed: true });
      const handle = within(legend).getByRole('button', { name: 'Legend' });
      drag(handle, [300, 260], [302, 262]);
      expect(legend.style.left).toBe('');
      expect(handle.getAttribute('aria-expanded')).toBe('true');
    });
    it('moves an open legend too', () => {
      const { legend } = view({ collapsed: false });
      drag(within(legend).getByRole('button', { name: 'Legend' }), [300, 260], [200, 160]);
      expect(at(legend)).toEqual({ x: 190, y: 150 });
      expect(within(legend).getAllByTestId('dmap-legend-block')).toHaveLength(3);
    });
    it('stays inside the panel', () => {
      const { legend } = view({ collapsed: true });
      const handle = within(legend).getByRole('button', { name: 'Legend' });
      drag(handle, [300, 260], [-500, -500]);
      expect(at(legend)).toEqual({ x: 0, y: 0 });
      drag(handle, [10, 10], [900, 900]);
      expect(at(legend)).toEqual({ x: 300, y: 260 });
    });
    it('moves 10 px with an arrow key and 50 px with Shift, inside the panel', () => {
      const { legend } = view({ collapsed: true });
      const handle = within(legend).getByRole('button', { name: 'Legend' });
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });
      expect(at(legend)).toEqual({ x: 280, y: 250 });
      fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
      expect(at(legend)).toEqual({ x: 280, y: 200 });
      fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
      fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
      expect(at(legend)).toEqual({ x: 300, y: 200 });
      expect(handle.getAttribute('aria-expanded')).toBe('false');
    });
    it('goes back to the corner on a double click or Home', () => {
      const { legend } = view({ collapsed: true });
      const handle = within(legend).getByRole('button', { name: 'Legend' });
      drag(handle, [300, 260], [250, 200]);
      fireEvent.doubleClick(handle);
      expect(legend.style.left).toBe('');
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });
      expect(legend.style.left).toBe('280px');
      fireEvent.keyDown(handle, { key: 'Home' });
      expect(legend.style.left).toBe('');
    });
    it('keeps the entries highlight working in an open legend that moved', () => {
      const { legend, onHighlight } = view({ collapsed: false });
      drag(within(legend).getByRole('button', { name: 'Legend' }), [300, 260], [200, 160]);
      fireEvent.mouseEnter(within(legend).getAllByTestId('dmap-legend-entry')[1]);
      expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
    });
  });
  it('follows a data refresh: the active entry highlights its new cells', () => {
    const { legend, onHighlight, rerender } = view();
    fireEvent.mouseEnter(within(legend).getAllByTestId('dmap-legend-entry')[1]);
    expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
    const moved = blocks.map((b) =>
      b.key === 'load'
        ? { ...b, entries: b.entries.map((e) => ({ ...e, cellIds: e.key === 'step-1' ? ['l1'] : [] })) }
        : b
    );
    rerender(<Legend blocks={moved} maxBlocks={4} collapsed={false} onHighlight={onHighlight} />);
    expect(onHighlight).toHaveBeenLastCalledWith(['l1']);
  });
  it('clears the highlight when the legend collapses', () => {
    const { legend, onHighlight } = view();
    fireEvent.focus(within(legend).getAllByTestId('dmap-legend-entry')[0]);
    expect(onHighlight).toHaveBeenLastCalledWith(['l1']);
    fireEvent.click(within(legend).getByRole('button', { name: 'Legend' }));
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });
});
