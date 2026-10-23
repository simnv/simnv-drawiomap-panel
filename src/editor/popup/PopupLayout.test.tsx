import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PANES_STORAGE_KEY, PopupLayout } from './PopupLayout';

const layout = () => (
  <PopupLayout
    list={<div>list content</div>}
    stage={<div>stage content</div>}
    inspector={<div>inspector content</div>}
  />
);
const size = (testId: string) => Number(screen.getByTestId(testId).getAttribute('data-pane-size'));

describe('PopupLayout', () => {
  beforeEach(() => window.localStorage.removeItem(PANES_STORAGE_KEY));

  it('gives a wide inspector 45% until the user sets a size', () => {
    const wide = <PopupLayout list={<i />} stage={<i />} inspector={<i />} wideInspector />;
    const view = render(wide);
    expect(screen.getByTestId('dmap-pane-inspector').style.flexBasis).toBe('45%');
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize inspector pane' }), { key: 'ArrowLeft' });
    expect(screen.getByTestId('dmap-pane-inspector').style.flexBasis).toBe('416px');
    view.unmount();
    // the stored size of an earlier session counts as set
    render(wide);
    expect(screen.getByTestId('dmap-pane-inspector').style.flexBasis).toBe('416px');
  });

  it('fits restored side widths to a narrow dialog and keeps the centre at least 240 px', () => {
    window.localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify({ list: 520, inspector: 720 }));
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1216);
    render(layout());
    const [list, inspector] = [size('dmap-pane-list'), size('dmap-pane-inspector')];
    expect(list).toBeLessThan(520);
    expect(inspector).toBeLessThan(720);
    expect(list + inspector + 16 + 240).toBeLessThanOrEqual(1216);
    // the stored values stay as the user set them
    expect(JSON.parse(window.localStorage.getItem(PANES_STORAGE_KEY)!)).toEqual({ list: 520, inspector: 720 });
    width.mockRestore();
  });

  it('grows a fitted pane from the displayed sizes and stores them', () => {
    window.localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify({ list: 520, inspector: 720 }));
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1216);
    render(layout());
    const [list, inspector] = [size('dmap-pane-list'), size('dmap-pane-inspector')];
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize list pane' }), { key: 'ArrowRight' });
    expect(size('dmap-pane-list')).toBeGreaterThan(list);
    expect(size('dmap-pane-list')).toBeLessThanOrEqual(list + 16);
    expect(size('dmap-pane-inspector')).toBe(inspector);
    expect(JSON.parse(window.localStorage.getItem(PANES_STORAGE_KEY)!)).toEqual({
      list: size('dmap-pane-list'),
      inspector,
    });
    width.mockRestore();
  });

  it('keeps the stored widths when the dialog is wide enough', () => {
    window.localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify({ list: 520, inspector: 720 }));
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1800);
    render(layout());
    expect(size('dmap-pane-list')).toBe(520);
    expect(size('dmap-pane-inspector')).toBe(720);
    width.mockRestore();
  });

  it('shows the three regions and two handles with the default sizes', () => {
    render(layout());
    expect(screen.getByTestId('dmap-pane-list')).toHaveProperty('textContent', 'list content');
    expect(screen.getByTestId('dmap-pane-stage')).toHaveProperty('textContent', 'stage content');
    expect(screen.getByTestId('dmap-pane-inspector')).toHaveProperty('textContent', 'inspector content');
    expect(screen.getAllByRole('separator')).toHaveLength(2);
    expect(size('dmap-pane-list')).toBe(280);
    expect(size('dmap-pane-inspector')).toBe(400);
  });

  it('keeps the centre pane shrinkable and clipped', () => {
    render(layout());
    const centre = screen.getByTestId('dmap-pane-stage');
    const css = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent)
      .join('\n');
    const rule = new RegExp(`\\.${centre.className.split(' ').pop()}\\{[^}]*\\}`).exec(css)?.[0] ?? '';
    expect(rule).toContain('min-width:0');
    expect(rule).toContain('overflow:hidden');
  });

  it('resizes with a drag: the left handle grows the list, the right handle grows the inspector to the left', () => {
    render(layout());
    const [listHandle, inspectorHandle] = screen.getAllByRole('separator');
    fireEvent.pointerDown(listHandle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(listHandle, { clientX: 340, pointerId: 1 });
    fireEvent.pointerUp(listHandle, { clientX: 340, pointerId: 1 });
    expect(size('dmap-pane-list')).toBe(320);
    fireEvent.pointerDown(inspectorHandle, { clientX: 900, pointerId: 1 });
    fireEvent.pointerMove(inspectorHandle, { clientX: 850, pointerId: 1 });
    fireEvent.pointerUp(inspectorHandle, { clientX: 850, pointerId: 1 });
    expect(size('dmap-pane-inspector')).toBe(450);
  });

  it('limits the sizes', () => {
    render(layout());
    const [listHandle] = screen.getAllByRole('separator');
    fireEvent.pointerDown(listHandle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(listHandle, { clientX: -2000, pointerId: 1 });
    fireEvent.pointerUp(listHandle, { clientX: -2000, pointerId: 1 });
    expect(size('dmap-pane-list')).toBe(200);
  });

  it('persists the sizes and reads them on the next open', () => {
    const first = render(layout());
    const [listHandle, inspectorHandle] = screen.getAllByRole('separator');
    fireEvent.keyDown(listHandle, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(inspectorHandle, { key: 'ArrowLeft' });
    expect(JSON.parse(window.localStorage.getItem(PANES_STORAGE_KEY)!)).toEqual({ list: 344, inspector: 416 });
    first.unmount();
    render(layout());
    expect(size('dmap-pane-list')).toBe(344);
    expect(size('dmap-pane-inspector')).toBe(416);
  });

  it('resets a pane on a double click', () => {
    render(layout());
    const [listHandle] = screen.getAllByRole('separator');
    fireEvent.keyDown(listHandle, { key: 'ArrowRight' });
    expect(size('dmap-pane-list')).toBe(296);
    fireEvent.doubleClick(listHandle);
    expect(size('dmap-pane-list')).toBe(280);
  });

  it('ignores a broken stored value', () => {
    window.localStorage.setItem(PANES_STORAGE_KEY, '{not json');
    render(layout());
    expect(size('dmap-pane-list')).toBe(280);
    window.localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify({ list: 'wide', inspector: 9999 }));
    render(layout());
    expect(screen.getAllByTestId('dmap-pane-inspector').map((el) => el.getAttribute('data-pane-size'))).toContain(
      '720'
    );
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
      const [listHandle] = screen.getAllByRole('separator');
      fireEvent.keyDown(listHandle, { key: 'ArrowRight' });
      expect(size('dmap-pane-list')).toBe(296);
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });

  describe('tab mode', () => {
    const at = (width: number) => vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
    const hiddenPanes = () =>
      ['list', 'stage', 'inspector'].filter((id) => screen.getByTestId(`dmap-pane-${id}`).hasAttribute('hidden'));

    it('shows three panes and no tabs at 1000 px and above', () => {
      const width = at(1000);
      render(layout());
      expect(screen.getByTestId('dmap-popup-layout').getAttribute('data-dmap-layout')).toBe('panes');
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(hiddenPanes()).toEqual([]);
      width.mockRestore();
    });

    it('shows the tabs List, Diagram and Inspector below 1000 px with one visible pane and no handles', () => {
      const width = at(855);
      render(layout());
      expect(screen.getByTestId('dmap-popup-layout').getAttribute('data-dmap-layout')).toBe('tabs');
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['List', 'Diagram', 'Inspector']);
      expect(screen.queryAllByRole('separator')).toHaveLength(0);
      expect(screen.getByRole('tab', { name: 'List' }).getAttribute('aria-selected')).toBe('true');
      expect(hiddenPanes()).toEqual(['stage', 'inspector']);
      expect(screen.getByRole('tabpanel', { name: 'List' })).toBe(screen.getByTestId('dmap-pane-list'));
      width.mockRestore();
    });

    it('switches the visible pane with a tab and keeps every pane mounted', () => {
      const width = at(700);
      render(
        <PopupLayout list={<i data-testid="l" />} stage={<i data-testid="s" />} inspector={<i data-testid="i" />} />
      );
      const stage = screen.getByTestId('s');
      fireEvent.click(screen.getByRole('tab', { name: 'Diagram' }));
      expect(hiddenPanes()).toEqual(['list', 'inspector']);
      fireEvent.click(screen.getByRole('tab', { name: 'Inspector' }));
      expect(hiddenPanes()).toEqual(['list', 'stage']);
      // The DOM of the stage survives a tab change.
      expect(screen.getByTestId('s')).toBe(stage);
      width.mockRestore();
    });

    it('follows the ARIA tabs pattern: one tab stop, arrow keys, Home and End move focus and selection', () => {
      const width = at(700);
      render(layout());
      const tab = (name: string) => screen.getByRole('tab', { name });
      const stops = () => screen.getAllByRole('tab').map((el) => el.tabIndex);
      expect(stops()).toEqual([0, -1, -1]);
      tab('List').focus();
      fireEvent.keyDown(tab('List'), { key: 'ArrowRight' });
      expect(tab('Diagram').getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(tab('Diagram'));
      expect(stops()).toEqual([-1, 0, -1]);
      fireEvent.keyDown(tab('Diagram'), { key: 'End' });
      expect(document.activeElement).toBe(tab('Inspector'));
      expect(hiddenPanes()).toEqual(['list', 'stage']);
      // The ends wrap.
      fireEvent.keyDown(tab('Inspector'), { key: 'ArrowRight' });
      expect(document.activeElement).toBe(tab('List'));
      fireEvent.keyDown(tab('List'), { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(tab('Inspector'));
      fireEvent.keyDown(tab('Inspector'), { key: 'Home' });
      expect(document.activeElement).toBe(tab('List'));
      expect(stops()).toEqual([0, -1, -1]);
      // Other keys do nothing.
      fireEvent.keyDown(tab('List'), { key: 'a' });
      expect(tab('List').getAttribute('aria-selected')).toBe('true');
      width.mockRestore();
    });

    it('follows a controlled tab and reports a change', () => {
      const width = at(700);
      const onTabChange = vi.fn();
      const view = render(
        <PopupLayout list={<i />} stage={<i />} inspector={<i />} activeTab="inspector" onTabChange={onTabChange} />
      );
      expect(hiddenPanes()).toEqual(['list', 'stage']);
      fireEvent.click(screen.getByRole('tab', { name: 'List' }));
      expect(onTabChange).toHaveBeenCalledWith('list');
      view.rerender(
        <PopupLayout list={<i />} stage={<i />} inspector={<i />} activeTab="stage" onTabChange={onTabChange} />
      );
      expect(hiddenPanes()).toEqual(['list', 'inspector']);
      width.mockRestore();
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
      const width = at(1200);
      render(<PopupLayout list={<i />} stage={<i data-testid="s" />} inspector={<i />} />);
      const stage = screen.getByTestId('s');
      expect(screen.getByTestId('dmap-popup-layout').getAttribute('data-dmap-layout')).toBe('panes');
      width.mockReturnValue(800);
      act(() => callbacks.forEach((callback) => callback()));
      expect(screen.getByTestId('dmap-popup-layout').getAttribute('data-dmap-layout')).toBe('tabs');
      expect(screen.getByTestId('s')).toBe(stage);
      width.mockReturnValue(1200);
      act(() => callbacks.forEach((callback) => callback()));
      expect(screen.getByTestId('dmap-popup-layout').getAttribute('data-dmap-layout')).toBe('panes');
      expect(screen.getByTestId('s')).toBe(stage);
      width.mockRestore();
      vi.unstubAllGlobals();
    });
  });
});
