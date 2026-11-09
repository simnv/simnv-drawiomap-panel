import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fitSizes, PANES_STORAGE_KEY, PopupLayout } from './PopupLayout';

const layout = () => (
  <PopupLayout code={<div>code content</div>} stage={<div>stage content</div>} below={<div>report content</div>} />
);
const size = (testId: string) => Number(screen.getByTestId(testId).getAttribute('data-pane-size'));
const codeHandle = () => screen.getByRole('separator', { name: 'Resize code pane' });
const reportHandle = () => screen.getByRole('separator', { name: 'Resize report pane' });
const measure = (width: number, height = 0) => {
  const w = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  const h = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
  return {
    mockReturnValue(next: number) {
      w.mockReturnValue(next);
    },
    mockRestore() {
      w.mockRestore();
      h.mockRestore();
    },
  };
};

describe('PopupLayout', () => {
  beforeEach(() => window.localStorage.removeItem(PANES_STORAGE_KEY));

  it('shows the code box left, the diagram right and the report below, with two handles and the default sizes', () => {
    render(layout());
    const code = screen.getByTestId('dmap-pane-code');
    const stage = screen.getByTestId('dmap-pane-stage');
    const report = screen.getByTestId('dmap-pane-report');
    expect(code.textContent).toBe('code content');
    expect(stage.textContent).toBe('stage content');
    expect(report.textContent).toBe('report content');
    // the code box and the diagram share one row; the report comes after that row
    expect(code.parentElement).toBe(stage.parentElement);
    expect(code.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(report.parentElement).toBe(code.parentElement!.parentElement);
    expect(codeHandle().getAttribute('aria-orientation')).toBe('vertical');
    expect(reportHandle().getAttribute('aria-orientation')).toBe('horizontal');
    expect(size('dmap-pane-code')).toBe(480);
    expect(size('dmap-pane-report')).toBe(240);
  });

  it('fits a stored size to a small dialog: the diagram keeps 240 px and the top row 200 px', () => {
    expect(fitSizes({ code: 900, below: 600 }, 1000, 700)).toEqual({ code: 1000 - 8 - 240, below: 700 - 8 - 200 });
    const sizes = { code: 480, below: 240 };
    expect(fitSizes(sizes, 1600, 900)).toBe(sizes);
    // a size that is not measured yet changes nothing
    expect(fitSizes({ code: 900, below: 600 }, 0, 0)).toEqual({ code: 900, below: 600 });
  });

  it('keeps the stored sizes when a small dialog fits them', () => {
    window.localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify({ code: 900, below: 600 }));
    const box = measure(1000, 700);
    render(layout());
    expect(size('dmap-pane-code')).toBe(752);
    expect(size('dmap-pane-report')).toBe(492);
    expect(JSON.parse(window.localStorage.getItem(PANES_STORAGE_KEY)!)).toEqual({ code: 900, below: 600 });
    box.mockRestore();
  });

  it('keeps the diagram shrinkable and clipped', () => {
    render(layout());
    const centre = screen.getByTestId('dmap-pane-stage');
    const css = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent)
      .join('\n');
    const rule = new RegExp(`\\.${centre.className.split(' ').pop()}\\{[^}]*\\}`).exec(css)?.[0] ?? '';
    expect(rule).toContain('min-width:0');
    expect(rule).toContain('overflow:hidden');
  });

  it('resizes with a drag: right grows the code box, up grows the report', () => {
    render(layout());
    fireEvent.pointerDown(codeHandle(), { clientX: 480, pointerId: 1 });
    fireEvent.pointerMove(codeHandle(), { clientX: 520, pointerId: 1 });
    fireEvent.pointerUp(codeHandle(), { clientX: 520, pointerId: 1 });
    expect(size('dmap-pane-code')).toBe(520);
    fireEvent.pointerDown(reportHandle(), { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(reportHandle(), { clientY: 450, pointerId: 1 });
    fireEvent.pointerUp(reportHandle(), { clientY: 450, pointerId: 1 });
    expect(size('dmap-pane-report')).toBe(290);
  });

  it('resizes with the keys of each orientation and limits the sizes', () => {
    render(layout());
    fireEvent.keyDown(codeHandle(), { key: 'ArrowRight' });
    expect(size('dmap-pane-code')).toBe(496);
    fireEvent.keyDown(reportHandle(), { key: 'ArrowUp', shiftKey: true });
    expect(size('dmap-pane-report')).toBe(304);
    fireEvent.keyDown(reportHandle(), { key: 'ArrowDown' });
    expect(size('dmap-pane-report')).toBe(288);
    fireEvent.keyDown(codeHandle(), { key: 'Home' });
    expect(size('dmap-pane-code')).toBe(280);
    fireEvent.pointerDown(reportHandle(), { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(reportHandle(), { clientY: 3000, pointerId: 1 });
    fireEvent.pointerUp(reportHandle(), { clientY: 3000, pointerId: 1 });
    expect(size('dmap-pane-report')).toBe(120);
  });

  it('persists the sizes and reads them on the next open', () => {
    const first = render(layout());
    fireEvent.keyDown(codeHandle(), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(reportHandle(), { key: 'ArrowUp' });
    expect(JSON.parse(window.localStorage.getItem(PANES_STORAGE_KEY)!)).toEqual({ code: 544, below: 256 });
    first.unmount();
    render(layout());
    expect(size('dmap-pane-code')).toBe(544);
    expect(size('dmap-pane-report')).toBe(256);
  });

  it('resets a pane on a double click', () => {
    render(layout());
    fireEvent.keyDown(codeHandle(), { key: 'ArrowRight' });
    fireEvent.doubleClick(codeHandle());
    expect(size('dmap-pane-code')).toBe(480);
  });

  it('ignores a broken stored value and the sizes of the old three-pane popup', () => {
    window.localStorage.setItem(PANES_STORAGE_KEY, '{not json');
    const first = render(layout());
    expect(size('dmap-pane-code')).toBe(480);
    first.unmount();
    window.localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify({ code: 'wide', below: 9999, list: 300 }));
    render(layout());
    expect(size('dmap-pane-code')).toBe(480);
    expect(size('dmap-pane-report')).toBe(640);
  });

  it('works when the storage throws', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      render(layout());
      fireEvent.keyDown(codeHandle(), { key: 'ArrowRight' });
      expect(size('dmap-pane-code')).toBe(496);
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });

  describe('tab mode', () => {
    const hiddenPanes = () =>
      ['code', 'stage', 'report'].filter((id) => {
        const pane = screen.getByTestId(`dmap-pane-${id}`);
        return pane.hasAttribute('hidden') || !!pane.parentElement?.closest('[hidden]');
      });

    it('shows three panes and no tabs at 1000 px and above', () => {
      const box = measure(1000);
      render(layout());
      expect(screen.getByTestId('dmap-popup-layout').getAttribute('data-dmap-layout')).toBe('panes');
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(hiddenPanes()).toEqual([]);
      box.mockRestore();
    });

    it('shows the tabs Code, Diagram and Report below 1000 px with one visible pane and no handles', () => {
      const box = measure(855);
      render(layout());
      expect(screen.getByTestId('dmap-popup-layout').getAttribute('data-dmap-layout')).toBe('tabs');
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Code', 'Diagram', 'Report']);
      expect(screen.queryAllByRole('separator')).toHaveLength(0);
      expect(screen.getByRole('tab', { name: 'Code' }).getAttribute('aria-selected')).toBe('true');
      expect(hiddenPanes()).toEqual(['stage', 'report']);
      expect(screen.getByRole('tabpanel', { name: 'Code' })).toBe(screen.getByTestId('dmap-pane-code'));
      box.mockRestore();
    });

    it('switches the visible pane with a tab and keeps every pane mounted', () => {
      const box = measure(700);
      render(<PopupLayout code={<i data-testid="c" />} stage={<i data-testid="s" />} below={<i data-testid="r" />} />);
      const stage = screen.getByTestId('s');
      fireEvent.click(screen.getByRole('tab', { name: 'Diagram' }));
      expect(hiddenPanes()).toEqual(['code', 'report']);
      fireEvent.click(screen.getByRole('tab', { name: 'Report' }));
      expect(hiddenPanes()).toEqual(['code', 'stage']);
      // The DOM of the stage survives a tab change.
      expect(screen.getByTestId('s')).toBe(stage);
      box.mockRestore();
    });

    it('follows the ARIA tabs pattern: one tab stop, arrow keys, Home and End move focus and selection', () => {
      const box = measure(700);
      render(layout());
      const tab = (name: string) => screen.getByRole('tab', { name });
      const stops = () => screen.getAllByRole('tab').map((el) => el.tabIndex);
      expect(stops()).toEqual([0, -1, -1]);
      tab('Code').focus();
      fireEvent.keyDown(tab('Code'), { key: 'ArrowRight' });
      expect(tab('Diagram').getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(tab('Diagram'));
      expect(stops()).toEqual([-1, 0, -1]);
      fireEvent.keyDown(tab('Diagram'), { key: 'End' });
      expect(document.activeElement).toBe(tab('Report'));
      expect(hiddenPanes()).toEqual(['code', 'stage']);
      // The ends wrap.
      fireEvent.keyDown(tab('Report'), { key: 'ArrowRight' });
      expect(document.activeElement).toBe(tab('Code'));
      fireEvent.keyDown(tab('Code'), { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(tab('Report'));
      fireEvent.keyDown(tab('Report'), { key: 'Home' });
      expect(document.activeElement).toBe(tab('Code'));
      expect(stops()).toEqual([0, -1, -1]);
      // Other keys do nothing.
      fireEvent.keyDown(tab('Code'), { key: 'a' });
      expect(tab('Code').getAttribute('aria-selected')).toBe('true');
      box.mockRestore();
    });

    it('follows a controlled tab and reports a change', () => {
      const box = measure(700);
      const onTabChange = vi.fn();
      const view = render(
        <PopupLayout code={<i />} stage={<i />} below={<i />} activeTab="report" onTabChange={onTabChange} />
      );
      expect(hiddenPanes()).toEqual(['code', 'stage']);
      fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
      expect(onTabChange).toHaveBeenCalledWith('code');
      view.rerender(
        <PopupLayout code={<i />} stage={<i />} below={<i />} activeTab="stage" onTabChange={onTabChange} />
      );
      expect(hiddenPanes()).toEqual(['code', 'report']);
      box.mockRestore();
    });

    it('keeps the stage DOM when the dialog changes between panes and tabs', () => {
      const callbacks: Array<() => void> = [];
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            callbacks.push(callback);
          }
          observe() {}
          disconnect() {}
        }
      );
      const box = measure(1200);
      render(<PopupLayout code={<i />} stage={<i data-testid="s" />} below={<i />} />);
      const stage = screen.getByTestId('s');
      expect(screen.getByTestId('dmap-popup-layout').getAttribute('data-dmap-layout')).toBe('panes');
      box.mockReturnValue(800);
      act(() => callbacks.forEach((callback) => callback()));
      expect(screen.getByTestId('dmap-popup-layout').getAttribute('data-dmap-layout')).toBe('tabs');
      expect(screen.getByTestId('s')).toBe(stage);
      box.mockReturnValue(1200);
      act(() => callbacks.forEach((callback) => callback()));
      expect(screen.getByTestId('dmap-popup-layout').getAttribute('data-dmap-layout')).toBe('panes');
      expect(screen.getByTestId('s')).toBe(stage);
      box.mockRestore();
      vi.unstubAllGlobals();
    });
  });
});
