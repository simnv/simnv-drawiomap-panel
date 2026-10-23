import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EMPTY_CONFIG } from './draft';
import { renderEditor, svgOf } from './editorHarness';

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
