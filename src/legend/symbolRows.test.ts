import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCellIndex, mountSvg } from '../render/svgStage';
import { bindSymbolLegend, symbolOfLegendId, type RowMarks } from './symbolRows';

const node = (id: string, symbol?: string) =>
  `<g data-cell-id="pg-node~${id}" data-meta-pg-kind="node" data-meta-pg-id="${id}"${
    symbol ? ` data-meta-pg-symbol="${symbol}"` : ''
  }><rect/></g>`;
const svg = (withSymbol: boolean) => `<svg><g data-cell-id="0" data-meta-pg-schema="1"></g>
  ${node('r1', withSymbol ? 'router' : undefined)}${node('r2', withSymbol ? 'router' : undefined)}${node(
    'm1',
    withSymbol ? 'modem' : undefined
  )}
  <g data-cell-id="pg-legend"><g data-cell-id="pg-legendRow~symbol:router"><g data-cell-id="pg-legendSwatch~symbol:router"><rect/></g></g>
  <g data-cell-id="pg-legendRow~symbol:ghost"><rect/></g></g></svg>`;

function setup(withSymbol = true) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = mountSvg(host, svg(withSymbol));
  const cells = buildCellIndex(root);
  const onChange = vi.fn<(m: RowMarks | null) => void>();
  const stop = bindSymbolLegend(root, cells, onChange);
  const el = (id: string) => root.querySelector(`[data-cell-id="${id}"]`)!;
  return { root, onChange, stop, el };
}
const pointer = (type: string, pointerType: string) => {
  const e = new Event(type, { bubbles: type !== 'pointerleave' });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  return e;
};
const click = () => new MouseEvent('click', { bubbles: true });

afterEach(() => document.body.replaceChildren());

describe('symbolOfLegendId', () => {
  it('reads the symbol of a legend cell and nothing else', () => {
    expect(symbolOfLegendId('pg-legendRow~symbol:router')).toBe('router');
    expect(symbolOfLegendId('pg-legendSwatch~symbol:a%7eb')).toBe('a~b');
    expect(symbolOfLegendId('pg-legend')).toBeNull();
    expect(symbolOfLegendId('pg-node~r1')).toBeNull();
  });
});

describe('bindSymbolLegend', () => {
  it('marks the nodes of the row on hover and restores on leave', () => {
    const { onChange, el, root } = setup();
    el('pg-legendSwatch~symbol:router').dispatchEvent(pointer('pointerover', 'mouse'));
    expect(onChange).toHaveBeenLastCalledWith({
      members: ['pg-node~r1', 'pg-node~r2', 'pg-node~m1'],
      hits: ['pg-node~r1', 'pg-node~r2'],
    });
    root.dispatchEvent(pointer('pointerleave', 'mouse'));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
  it('does nothing for a row without nodes and for other cells', () => {
    const { onChange, el } = setup();
    el('pg-legendRow~symbol:ghost').dispatchEvent(pointer('pointerover', 'mouse'));
    el('pg-node~m1').dispatchEvent(pointer('pointerover', 'mouse'));
    expect(onChange).not.toHaveBeenCalled();
  });
  it('does nothing and changes nothing without the pg-symbol attribute', () => {
    const { onChange, el } = setup(false);
    el('pg-legendRow~symbol:router').dispatchEvent(pointer('pointerover', 'mouse'));
    expect(onChange).not.toHaveBeenCalled();
    expect(el('pg-legendRow~symbol:router').hasAttribute('tabindex')).toBe(false);
  });
  it('makes the linked row focusable and follows the focus', () => {
    const { onChange, el } = setup();
    const row = el('pg-legendRow~symbol:router');
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(el('pg-legendRow~symbol:ghost').hasAttribute('tabindex')).toBe(false);
    row.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hits: ['pg-node~r1', 'pg-node~r2'] }));
    row.dispatchEvent(new Event('focusout', { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
  it('toggles on a tap and ignores the hover that a tap emulates', () => {
    const { onChange, el } = setup();
    const swatch = el('pg-legendSwatch~symbol:router');
    swatch.dispatchEvent(pointer('pointerdown', 'touch'));
    swatch.dispatchEvent(pointer('pointerover', 'touch'));
    expect(onChange).not.toHaveBeenCalled();
    swatch.dispatchEvent(click());
    expect(onChange).toHaveBeenCalledTimes(1);
    swatch.dispatchEvent(click());
    expect(onChange).toHaveBeenLastCalledWith(null);
    swatch.dispatchEvent(click());
    el('pg-node~m1').dispatchEvent(click());
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
  it('a tap outside the linked rows ends a tapped highlight, and a tap on the row selects again', () => {
    const { onChange, el } = setup();
    const swatch = el('pg-legendSwatch~symbol:router');
    swatch.dispatchEvent(pointer('pointerdown', 'touch'));
    swatch.dispatchEvent(click());
    expect(onChange).toHaveBeenCalledTimes(1);
    swatch.dispatchEvent(pointer('pointerdown', 'touch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    document.body.dispatchEvent(pointer('pointerdown', 'touch'));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(onChange).toHaveBeenCalledTimes(2);
    swatch.dispatchEvent(pointer('pointerdown', 'touch'));
    swatch.dispatchEvent(click());
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hits: ['pg-node~r1', 'pg-node~r2'] }));
  });
  it('the focus works again after a tap and a tap elsewhere in the page', () => {
    const { onChange, el } = setup();
    const row = el('pg-legendRow~symbol:router');
    row.dispatchEvent(pointer('pointerdown', 'touch'));
    document.body.dispatchEvent(pointer('pointerdown', 'touch'));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    row.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hits: ['pg-node~r1', 'pg-node~r2'] }));
  });
  it('cleanup removes the marks and the listeners and clears the highlight', () => {
    const { onChange, el, stop } = setup();
    el('pg-legendRow~symbol:router').dispatchEvent(pointer('pointerover', 'mouse'));
    stop();
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(el('pg-legendRow~symbol:router').hasAttribute('data-dmap-legend-row')).toBe(false);
    onChange.mockClear();
    el('pg-legendRow~symbol:router').dispatchEvent(pointer('pointerover', 'mouse'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
