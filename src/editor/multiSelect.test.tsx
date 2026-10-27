import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_CONFIG } from '../model/config';
import { renderEditor, svgOf } from './editorHarness';
import { buttonNamed, editorField } from './testUtils';

const click = (id: string, shiftKey = false) =>
  fireEvent.click(screen.getByTestId('dmap-popup-stage').querySelector(`[data-cell-id="${id}"] rect`) as Element, {
    shiftKey,
  });
const marks = (attr: string) =>
  Array.from(screen.getByTestId('dmap-popup-stage').querySelectorAll(`[${attr}="true"]`)).map((el) =>
    el.getAttribute('data-cell-id')
  );

describe('multi-select on the stage', () => {
  const setup = () => renderEditor({ config: EMPTY_CONFIG, svg: svgOf('a', 'b', 'c') });

  it('a plain click replaces the selection; the cell is selected and primary', () => {
    setup();
    click('a');
    click('b');
    expect(marks('data-dmap-selected')).toEqual(['b']);
    expect(marks('data-dmap-primary')).toEqual(['b']);
    expect(screen.getByRole('heading', { name: 'b bindings' })).toBeTruthy();
  });

  it('Shift + click toggles cells; the last one is primary; the heading counts the elements', () => {
    setup();
    click('a');
    click('b', true);
    click('c', true);
    expect(marks('data-dmap-selected')).toEqual(['a', 'b', 'c']);
    expect(marks('data-dmap-primary')).toEqual(['c']);
    expect(screen.getByRole('heading', { name: '3 elements' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /bindings$/ })).toBeNull();
    // toggle the primary off: the one before it becomes primary
    click('c', true);
    expect(marks('data-dmap-selected')).toEqual(['a', 'b']);
    expect(marks('data-dmap-primary')).toEqual(['b']);
    expect(screen.getByRole('heading', { name: '2 elements' })).toBeTruthy();
  });

  it('back to one cell shows the sections of that cell; none left clears the selection', () => {
    setup();
    click('a');
    click('b', true);
    click('a', true);
    expect(screen.getByRole('heading', { name: 'b bindings' })).toBeTruthy();
    click('b', true);
    expect(marks('data-dmap-selected')).toEqual([]);
    expect(screen.queryByRole('heading', { name: /bindings$|elements$/ })).toBeNull();
  });

  it('Shift + click starts a selection when nothing is selected, and a plain click then replaces many', () => {
    setup();
    click('a', true);
    expect(screen.getByRole('heading', { name: 'a bindings' })).toBeTruthy();
    click('b', true);
    click('c');
    expect(marks('data-dmap-selected')).toEqual(['c']);
  });
});

describe('pattern from the selection', () => {
  const routers = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">${[
    ['r1', 'router', 'core-1'],
    ['r2', 'router', 'core-2'],
    ['r3', 'router', 'edge-3'],
    ['s1', 'switch', 'sw-1'],
  ]
    .map(
      ([id, role, label], i) =>
        `<g data-cell-id="${id}" data-meta-pg-kind="node" data-meta-role="${role}"><rect x="${i * 60}" y="10" width="50" height="30"/><text>${label}</text></g>`
    )
    .join('')}</svg>`;
  const open = () => {
    const view = renderEditor({ config: EMPTY_CONFIG, svg: routers });
    click('r1');
    click('r2', true);
    return view;
  };

  it('proposes the label with no extra first; the attribute proposal shows its counts and marks the extra cell', () => {
    open();
    expect((editorField('Proposed label regex') as HTMLInputElement).value).toBe('/^core-/');
    expect(marks('data-dmap-extra')).toEqual([]);
    fireEvent.click(screen.getByRole('radio', { name: /Attributes/ }));
    const counts = () => screen.getByTestId('dmap-proposal-counts').textContent;
    expect(screen.getByRole('heading', { name: '2 elements' })).toBeTruthy();
    expect((editorField('Proposed attributes') as HTMLTextAreaElement).value).toBe('role=router');
    expect((editorField('Proposed element IDs') as HTMLInputElement).value).toBe('');
    expect(counts()).toBe('matches 3, extra 1, missed 0');
    expect(marks('data-dmap-extra')).toEqual(['r3']);
    expect(marks('data-dmap-missed')).toEqual([]);
  });

  it('re-evaluates when the selector is edited: ids clears the extras, a bad ids list shows the missed', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: /Element IDs/ }));
    expect(marks('data-dmap-extra')).toEqual([]);
    expect(screen.getByTestId('dmap-proposal-counts').textContent).toBe('matches 2, extra 0, missed 0');
    fireEvent.change(editorField('Proposed element IDs'), { target: { value: 'r1' } });
    expect(marks('data-dmap-missed')).toEqual(['r2']);
    expect(screen.getByTestId('dmap-proposal-counts').textContent).toBe('matches 1, extra 0, missed 1');
  });

  it('shows the label proposal and a regex error', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: /Label/ }));
    expect((editorField('Proposed label regex') as HTMLInputElement).value).toBe('/^core-/');
    expect(screen.getByTestId('dmap-proposal-counts').textContent).toBe('matches 2, extra 0, missed 0');
    fireEvent.change(editorField('Proposed label regex'), { target: { value: '/(/' } });
    expect(screen.getByRole('alert').textContent).toContain('invalid regex');
    expect((buttonNamed('Create pattern') as HTMLButtonElement).disabled).toBe(true);
  });

  it('creates the pattern as one step, opens it in the pattern scope and clears the marks', () => {
    const view = open();
    fireEvent.click(screen.getByRole('radio', { name: /Attributes/ }));
    fireEvent.click(buttonNamed('Create pattern'));
    expect(marks('data-dmap-extra')).toEqual([]);
    expect(screen.getByRole('heading', { name: 'r1 bindings' })).toBeTruthy();
    // the pattern scope shows the selector of the new pattern
    expect(editorField('Pattern element IDs')).toBeTruthy();
    fireEvent.click(buttonNamed('Apply bindings'));
    expect(view.save.mock.calls[0][0].patterns).toEqual([
      expect.objectContaining({
        id: 'pattern-1',
        name: 'Pattern 1',
        select: { kind: 'other', attrs: { role: 'router' } },
      }),
    ]);
  });

  it('one undo removes the created pattern, one redo brings it back', () => {
    const view = open();
    fireEvent.click(buttonNamed('Create pattern'));
    fireEvent.click(buttonNamed('Undo'));
    fireEvent.click(buttonNamed('Apply bindings'));
    expect(view.save.mock.calls[0][0].patterns).toEqual([]);
  });

  it('redo restores the created pattern', () => {
    const view = open();
    fireEvent.click(buttonNamed('Create pattern'));
    fireEvent.click(buttonNamed('Undo'));
    fireEvent.click(buttonNamed('Redo'));
    fireEvent.click(buttonNamed('Apply bindings'));
    expect(view.save.mock.calls[0][0].patterns).toHaveLength(1);
  });

  it('a box select adds the cells under the band to the selection', () => {
    renderEditor({ config: EMPTY_CONFIG, svg: routers });
    click('r1');
    const stage = screen.getByTestId('dmap-popup-stage');
    const rect = (l: number) => ({ left: l, top: 0, right: l + 50, bottom: 40, width: 50, height: 40 }) as DOMRect;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const id = this.getAttribute('data-cell-id');
      const at = ['r1', 'r2', 'r3', 's1'].indexOf(id ?? '');
      return at >= 0
        ? rect(at * 60)
        : ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 } as DOMRect);
    });
    const wrapper = stage.parentElement as HTMLElement;
    const mouse = { pointerType: 'mouse', pointerId: 1, button: 0 };
    fireEvent.pointerDown(wrapper, { ...mouse, shiftKey: true, clientX: 55, clientY: 5 });
    fireEvent.pointerMove(wrapper, { ...mouse, clientX: 170, clientY: 60 });
    fireEvent.pointerUp(wrapper, { ...mouse, clientX: 170, clientY: 60 });
    spy.mockRestore();
    expect(marks('data-dmap-selected')).toEqual(['r1', 'r2', 'r3']);
    expect(marks('data-dmap-primary')).toEqual(['r3']);
    expect(screen.getByRole('heading', { name: '3 elements' })).toBeTruthy();
  });
});
