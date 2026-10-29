import React, { createRef } from 'react';
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
  const r = render(<Legend blocks={blocks} collapsed={false} onHighlight={onHighlight} {...over} />);
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
  it('draws a scale with a bar as one bar: a segment of the same width for each entry, the step values under it', () => {
    const load: LegendBlock = {
      ...blocks[0],
      entries: [...blocks[0].entries, { key: 'step-2', label: '≥ 85%', color: '#f00', cellIds: [] }],
      bar: {
        segments: [
          { from: 0, to: 1 / 3, range: '< 60%' },
          { from: 1 / 3, to: 2 / 3, tick: '60%', range: '60% to 85%' },
          { from: 2 / 3, to: 1, tick: '85%', range: '≥ 85%' },
        ],
      },
    };
    const { legend, onHighlight } = view({ blocks: [load] });
    const bar = legend.querySelector('[data-dmap-bar]') as HTMLElement;
    expect(bar.textContent).toBe('60%85%');
    const segments = within(legend).getAllByTestId('dmap-legend-entry');
    expect(segments.map((e) => e.getAttribute('aria-label'))).toEqual([
      '< 60%: 1 element',
      '60% to 85%: 2 elements',
      '≥ 85%: 0 elements',
    ]);
    expect(segments.map((e) => e.style.width)).toEqual(['33.3%', '33.3%', '33.3%']);
    expect(segments.map((e) => (e.querySelector('[data-dmap-swatch]') as HTMLElement).style.background)).toEqual([
      'rgb(0, 255, 0)',
      'rgb(255, 255, 0)',
      'rgb(255, 0, 0)',
    ]);
    expect(
      Array.from(bar.querySelectorAll<HTMLElement>('[data-dmap-tick]'), (t) => [t.textContent, t.style.left])
    ).toEqual([
      ['60%', '33.3%'],
      ['85%', '66.7%'],
    ]);
    fireEvent.pointerEnter(segments[1]);
    expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
    fireEvent.pointerLeave(segments[1]);
    fireEvent.focus(segments[0]);
    expect(onHighlight).toHaveBeenLastCalledWith(['l1']);
    expect(segments[2].tabIndex).toBe(0);
  });
  it('highlights the cells of an entry on hover and on focus, and clears on leave and on blur', () => {
    const { legend, onHighlight } = view();
    const [, high, gradient] = within(legend).getAllByTestId('dmap-legend-entry');
    fireEvent.pointerEnter(high);
    expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
    fireEvent.pointerLeave(high);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
    fireEvent.focus(gradient);
    expect(onHighlight).toHaveBeenLastCalledWith(['w1']);
    fireEvent.blur(gradient);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
    expect(high.tabIndex).toBe(0);
  });
  it('toggles the highlight on a tap, ignores the tap focus and emulated hover, and ends on a tap elsewhere', () => {
    const { legend, onHighlight } = view();
    const [, high, gradient] = within(legend).getAllByTestId('dmap-legend-entry');
    const touch = { pointerType: 'touch' };
    fireEvent.pointerDown(high, touch);
    fireEvent.pointerEnter(high, touch);
    fireEvent.focus(high);
    fireEvent.click(high);
    expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
    fireEvent.pointerLeave(high, touch);
    expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
    fireEvent.pointerDown(gradient, touch);
    fireEvent.click(gradient);
    expect(onHighlight).toHaveBeenLastCalledWith(['w1']);
    fireEvent.pointerDown(gradient, touch);
    fireEvent.click(gradient);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
    fireEvent.pointerDown(high, touch);
    fireEvent.click(high);
    expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
    fireEvent.pointerDown(document.body, touch);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });
  it('a tap in another legend ends the tapped highlight of this one', () => {
    const a = vi.fn();
    const b = vi.fn();
    render(
      <>
        <Legend blocks={blocks} collapsed={false} onHighlight={a} />
        <Legend blocks={blocks} collapsed={false} onHighlight={b} />
      </>
    );
    const [legendA, legendB] = screen.getAllByTestId('dmap-legend');
    const touch = { pointerType: 'touch' };
    const entryA = within(legendA).getAllByTestId('dmap-legend-entry')[1];
    const entryB = within(legendB).getAllByTestId('dmap-legend-entry')[1];
    fireEvent.pointerDown(entryA, touch);
    fireEvent.click(entryA);
    expect(a).toHaveBeenLastCalledWith(['l2', 'l3']);
    fireEvent.pointerDown(entryB, touch);
    fireEvent.click(entryB);
    expect(b).toHaveBeenLastCalledWith(['l2', 'l3']);
    expect(a).toHaveBeenLastCalledWith(null);
  });
  it('the focus highlights again after a tap, a tap elsewhere and a key', () => {
    const { legend, onHighlight } = view();
    const [, high] = within(legend).getAllByTestId('dmap-legend-entry');
    fireEvent.pointerDown(high, { pointerType: 'touch' });
    fireEvent.click(high);
    fireEvent.pointerDown(document.body, { pointerType: 'touch' });
    expect(onHighlight).toHaveBeenLastCalledWith(null);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    fireEvent.focus(high);
    expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
  });
  it('a mouse move after a tap makes the hover work again', () => {
    const { legend, onHighlight } = view();
    const [, high] = within(legend).getAllByTestId('dmap-legend-entry');
    fireEvent.pointerDown(high, { pointerType: 'touch' });
    fireEvent.pointerDown(document.body, { pointerType: 'mouse' });
    fireEvent.focus(high);
    expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
  });
  it('shows every block with no "+N more" line: the legend scrolls instead', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...blocks[0], key: `b${i}`, title: `Block ${i}` }));
    const { legend } = view({ blocks: many });
    expect(within(legend).getAllByTestId('dmap-legend-block')).toHaveLength(7);
    expect(legend.textContent).not.toMatch(/more/);
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
  it('is open when the option Start collapsed is false, and shows nothing without blocks', () => {
    const { legend } = view({ collapsed: false });
    expect(within(legend).getByRole('button', { name: 'Legend' }).getAttribute('aria-expanded')).toBe('true');
    const { container } = render(<Legend blocks={[]} collapsed={false} onHighlight={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
  it('follows a change of the option', () => {
    const { legend, rerender, onHighlight } = view({ collapsed: false });
    rerender(<Legend blocks={blocks} collapsed onHighlight={onHighlight} />);
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
    afterEach(() => {
      spy.mockClear();
      PANEL.h = 300;
    });
    const at = (legend: HTMLElement) => ({ x: parseFloat(legend.style.left), y: parseFloat(legend.style.top) });
    const drag = (handle: HTMLElement, from: [number, number], to: [number, number]) => {
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: from[0],
        clientY: from[1],
      });
      fireEvent.pointerMove(handle, {
        pointerId: 1,
        pointerType: 'mouse',
        buttons: 1,
        clientX: to[0],
        clientY: to[1],
      });
      fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'mouse', clientX: to[0], clientY: to[1] });
      fireEvent.click(handle, { detail: 1 });
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
    const down = (handle: HTMLElement) =>
      fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 260 });
    const move = (handle: HTMLElement, x: number, y: number, buttons = 1) =>
      fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'mouse', buttons, clientX: x, clientY: y });

    it('ends the drag on pointercancel and on a lost capture, and moves only while a button is down', () => {
      const { legend } = view({ collapsed: true });
      const handle = within(legend).getByRole('button', { name: 'Legend' });
      down(handle);
      move(handle, 250, 200);
      expect(at(legend)).toEqual({ x: 240, y: 190 });
      fireEvent.pointerCancel(handle, { pointerId: 1 });
      move(handle, 100, 100);
      expect(at(legend)).toEqual({ x: 240, y: 190 });
      down(handle);
      fireEvent.lostPointerCapture(handle, { pointerId: 1 });
      move(handle, 100, 100);
      expect(at(legend)).toEqual({ x: 240, y: 190 });
      // a move with no button down: the release was lost
      down(handle);
      move(handle, 100, 100, 0);
      move(handle, 100, 100, 1);
      expect(at(legend)).toEqual({ x: 240, y: 190 });
    });
    it('swallows only the click right after a real drag: not after a cancel, not a keyboard click', () => {
      const { legend } = view({ collapsed: true });
      const handle = within(legend).getByRole('button', { name: 'Legend' });
      down(handle);
      move(handle, 250, 200);
      fireEvent.pointerCancel(handle, { pointerId: 1 });
      // Enter or Space after the cancel
      fireEvent.click(handle, { detail: 0 });
      expect(handle.getAttribute('aria-expanded')).toBe('true');
      // a real drag whose click never comes: the keyboard click still works
      down(handle);
      move(handle, 200, 150);
      fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'mouse' });
      fireEvent.click(handle, { detail: 0 });
      expect(handle.getAttribute('aria-expanded')).toBe('false');
      // and the pointer click of the drag is swallowed
      down(handle);
      move(handle, 150, 100);
      fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'mouse' });
      fireEvent.click(handle, { detail: 1 });
      expect(handle.getAttribute('aria-expanded')).toBe('false');
    });
    it('keeps the legend in a small panel at its corner: the corner offset caps its height', () => {
      PANEL.h = 100;
      const { legend } = view({ collapsed: true, corner: 'top-left', style: { left: 4, top: 60 } });
      // 100 - 60 offset - 4 gap, and never more than half of the panel
      expect(legend.style.maxHeight).toBe('36px');
      const handle = within(legend).getByRole('button', { name: 'Legend' });
      drag(handle, [300, 260], [250, 200]);
      expect(legend.style.maxHeight).toBe('');
      fireEvent.doubleClick(handle);
      expect(legend.style.maxHeight).toBe('36px');
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });
      fireEvent.keyDown(handle, { key: 'Home' });
      expect(legend.style.maxHeight).toBe('36px');
    });

    it('keeps an 80 px panel: the corner top is clamped so the legend bottom stays inside', () => {
      PANEL.h = 80;
      // a 24 px status band and a 32 px reset button: top 64. The legend gets at least 24 px and moves up to 56.
      const { legend } = view({ collapsed: true, corner: 'top-left', style: { left: 4, top: 64 } });
      expect(legend.style.maxHeight).toBe('24px');
      expect(legend.style.top).toBe('56px');
      expect(parseFloat(legend.style.top) + parseFloat(legend.style.maxHeight)).toBeLessThanOrEqual(PANEL.h);
      const handle = within(legend).getByRole('button', { name: 'Legend' });
      drag(handle, [300, 260], [250, 200]);
      fireEvent.doubleClick(handle);
      expect(legend.style.top).toBe('56px');
    });
    it('keeps the entries highlight working in an open legend that moved', () => {
      const { legend, onHighlight } = view({ collapsed: false });
      drag(within(legend).getByRole('button', { name: 'Legend' }), [300, 260], [200, 160]);
      fireEvent.pointerEnter(within(legend).getAllByTestId('dmap-legend-entry')[1]);
      expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
    });
  });
  it('points the forwarded ref at the current element when the blocks come late or come back', () => {
    const ref = createRef<HTMLElement>();
    const props = { collapsed: false, onHighlight: () => {} };
    const { rerender } = render(<Legend ref={ref} blocks={[]} {...props} />);
    expect(ref.current).toBeNull();
    rerender(<Legend ref={ref} blocks={blocks} {...props} />);
    expect(ref.current).toBe(screen.getByTestId('dmap-legend'));
    rerender(<Legend ref={ref} blocks={[]} {...props} />);
    expect(ref.current).toBeNull();
    rerender(<Legend ref={ref} blocks={blocks} {...props} />);
    expect(ref.current).toBe(screen.getByTestId('dmap-legend'));
    const seen: Array<HTMLElement | null> = [];
    const callback = (n: HTMLElement | null) => seen.push(n);
    rerender(<Legend ref={callback} blocks={blocks} {...props} />);
    expect(seen[seen.length - 1]).toBe(screen.getByTestId('dmap-legend'));
  });
  it('observes the size of the legend and of the panel when the blocks come late', () => {
    const observed: Element[] = [];
    class Observer {
      observe = (el: Element) => observed.push(el);
      disconnect = () => {};
    }
    vi.stubGlobal('ResizeObserver', Observer);
    try {
      const props = { collapsed: false, onHighlight: () => {} };
      const { rerender } = render(<Legend blocks={[]} {...props} />);
      expect(observed).toHaveLength(0);
      rerender(<Legend blocks={blocks} {...props} />);
      const legend = screen.getByTestId('dmap-legend');
      expect(observed).toContain(legend);
      expect(observed).toContain(legend.parentElement);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('follows a data refresh: the active entry highlights its new cells', () => {
    const { legend, onHighlight, rerender } = view();
    fireEvent.pointerEnter(within(legend).getAllByTestId('dmap-legend-entry')[1]);
    expect(onHighlight).toHaveBeenLastCalledWith(['l2', 'l3']);
    const moved = blocks.map((b) =>
      b.key === 'load'
        ? { ...b, entries: b.entries.map((e) => ({ ...e, cellIds: e.key === 'step-1' ? ['l1'] : [] })) }
        : b
    );
    rerender(<Legend blocks={moved} collapsed={false} onHighlight={onHighlight} />);
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
