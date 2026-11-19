import { afterEach, describe, expect, it } from 'vitest';
import { canFitGridHeight, fitGridHeight, freeRows, GRID_ROW_PX } from './gridHeight';
import type { ZoomOptions } from '../types';

const zoom = (mode: ZoomOptions['mode'], extra: Partial<ZoomOptions> = {}): ZoomOptions => ({
  mode,
  percent: 100,
  wheel: true,
  pan: true,
  ...extra,
});
// a wide diagram: 400 × 100 user units
const base = { x: 0, y: 0, w: 400, h: 100 };

describe('freeRows', () => {
  it('counts the whole grid rows below a diagram that fills the width', () => {
    // fit in 800 × 600: the diagram is 200 px high, 400 px free: 10 rows of 38 px
    expect(freeRows(zoom('fit'), base, { width: 800, height: 600 })).toBe(Math.floor(400 / GRID_ROW_PX));
    expect(freeRows(zoom('fit-width'), base, { width: 800, height: 600 })).toBe(10);
    expect(freeRows(zoom('original'), base, { width: 800, height: 600 })).toBe(13);
    expect(freeRows(zoom('custom', { percent: 300 }), base, { width: 800, height: 600 })).toBe(7);
  });
  it('gives 0 when the diagram fills the height, overflows it, or is not known', () => {
    // a tall stage limit: the diagram is height-bound in fit, the free space is on the sides
    expect(freeRows(zoom('fit'), { x: 0, y: 0, w: 100, h: 400 }, { width: 800, height: 600 })).toBe(0);
    expect(freeRows(zoom('fit', { minScale: 10 }), base, { width: 800, height: 600 })).toBe(0);
    expect(freeRows(zoom('fit'), base, { width: 800, height: 230 })).toBe(0);
    expect(freeRows(zoom('fit'), undefined, { width: 800, height: 600 })).toBe(0);
  });
});

/** A fake scene: root > grid > item > panel, as the dashboards of Grafana 12 and 13 build it. */
function scene(height: number) {
  const make = (state: Record<string, unknown>, parent?: any) => {
    const node: any = { state, parent, children: [] as any[] };
    node.setState = (s: Record<string, unknown>) => (node.state = { ...node.state, ...s });
    node.forEachChild = (visit: (c: unknown) => void) => node.children.forEach(visit);
    parent?.children.push(node);
    return node;
  };
  const root = make({ isEditing: true });
  const grid = make({ children: [] }, root);
  const item = make({ x: 0, y: 4, width: 24, height }, grid);
  const panel = make({ key: 'panel-7', pluginId: 'simnv-drawiomap-panel' }, item);
  item.state.body = panel;
  grid.state.children = [item];
  (window as any).__grafanaSceneContext = root;
  return { grid, item };
}

describe('fitGridHeight', () => {
  afterEach(() => delete (window as any).__grafanaSceneContext);

  it('makes the grid item lower by the free rows and draws the grid again', () => {
    const { grid, item } = scene(12);
    const children = grid.state.children;
    expect(canFitGridHeight(7)).toBe(true);
    expect(fitGridHeight(7, 5)).toBe(true);
    expect(item.state.height).toBe(7);
    // a new list: the grid draws again and moves the panels below up
    expect(grid.state.children).not.toBe(children);
    expect(grid.state.children).toEqual(children);
  });
  it('keeps two rows at least, and does nothing without a scene or for another panel', () => {
    const { item } = scene(3);
    expect(fitGridHeight(7, 5)).toBe(true);
    expect(item.state.height).toBe(2);
    expect(fitGridHeight(7, 1)).toBe(false);
    expect(canFitGridHeight(8)).toBe(false);
    delete (window as any).__grafanaSceneContext;
    expect(canFitGridHeight(7)).toBe(false);
    expect(fitGridHeight(7, 1)).toBe(false);
  });
  it('finds no grid item in a scene of another shape', () => {
    const { item } = scene(12);
    item.state.height = 'auto';
    expect(canFitGridHeight(7)).toBe(false);
  });
});
