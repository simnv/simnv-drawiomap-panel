import { describe, expect, it } from 'vitest';
import { buildCellIndex } from '../render/svgStage';
import { highlightCells } from './highlight';

describe('highlightCells', () => {
  const host = document.createElement('div');
  host.innerHTML = `<svg><g data-cell-id="a"><rect/></g><g data-cell-id="icon-a"><ellipse/></g>
    <g data-cell-id="b"><rect/></g><g data-cell-id="free"><rect/></g></svg>`;
  const root = host.querySelector('svg')!;
  const cells = buildCellIndex(root);
  cells.get('icon-a')!.ownerId = 'a';
  const classes = (id: string) => [...cells.get(id)!.group.classList].sort();
  it('marks the hit cells and their parts, and the other legend cells as members that dim', () => {
    highlightCells(root, cells, ['a', 'b'], ['a']);
    expect(root.classList.contains('dmap-legend-active')).toBe(true);
    expect(classes('a')).toEqual(['dmap-legend-hit', 'dmap-legend-member']);
    expect(classes('icon-a')).toEqual(['dmap-legend-hit', 'dmap-legend-member']);
    expect(classes('b')).toEqual(['dmap-legend-member']);
    expect(classes('free')).toEqual([]);
  });
  it('clears all marks without hits', () => {
    highlightCells(root, cells, ['a', 'b'], ['a']);
    highlightCells(root, cells, ['a', 'b'], null);
    expect(root.classList.contains('dmap-legend-active')).toBe(false);
    for (const id of ['a', 'icon-a', 'b']) {
      expect(classes(id)).toEqual([]);
    }
  });
});
