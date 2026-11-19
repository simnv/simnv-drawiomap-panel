import { useSyncExternalStore } from 'react';
import type { ViewBox } from '../render/zoom';
import type { ZoomOptions } from '../types';

/** One row of the dashboard grid in px: a cell of 30 px and the margin of 8 px below it. */
export const GRID_ROW_PX = 38;
/** The fit leaves the panel at least this many rows high. */
const MIN_ROWS = 2;

/** The height in px of the diagram in a stage of this size, for the zoom mode, before a pan or a zoom. */
function drawnHeight(zoom: ZoomOptions, base: ViewBox, box: { width: number; height: number }): number {
  const min = zoom.minScale ?? 0;
  switch (zoom.mode) {
    case 'fit':
      return base.h * Math.max(min, Math.min(box.width / base.w, box.height / base.h));
    case 'fit-width':
      return base.h * Math.max(min, box.width / base.w);
    case 'original':
      return base.h;
    case 'custom':
      return (base.h * (zoom.percent || 100)) / 100;
  }
}

/**
 * The whole grid rows of free space below the diagram in the stage: the panel can be this many rows lower and still
 * show all of the diagram at the same size. 0 when the diagram fills the height (or overflows it).
 */
export function freeRows(zoom: ZoomOptions, base: ViewBox | undefined, box: { width: number; height: number }): number {
  if (!base || !(base.w > 0) || !(base.h > 0) || !(box.width > 0) || !(box.height > 0)) {
    return 0;
  }
  return Math.max(0, Math.floor((box.height - drawnHeight(zoom, base, box)) / GRID_ROW_PX));
}

/*
 * Grafana gives a panel no API to change its own height: the dashboard grid sets it. The "Fit height" button uses
 * the scene objects of the dashboard (`window.__grafanaSceneContext`, Grafana 11 and later), which are not a public
 * API. Every read below checks the shape of what it finds; a shape that differs gives "not found", and the corner
 * then shows only the hint, never an error.
 */

interface SceneNode {
  state: Record<string, unknown>;
  parent?: SceneNode;
  setState?: (state: Record<string, unknown>) => void;
  forEachChild?: (visit: (child: SceneNode) => void) => void;
  subscribeToState?: (handler: () => void) => { unsubscribe: () => void };
}

const isNode = (o: unknown): o is SceneNode =>
  !!o && typeof o === 'object' && !!(o as SceneNode).state && typeof (o as SceneNode).state === 'object';

function sceneRoot(): SceneNode | undefined {
  const root =
    typeof window === 'undefined' ? undefined : (window as { __grafanaSceneContext?: unknown }).__grafanaSceneContext;
  return isNode(root) && typeof root.setState === 'function' ? root : undefined;
}

/** The grid item of the panel: the parent of the scene panel `panel-<id>`, with a whole-row height and a y. */
function gridItemOf(panelId: number): SceneNode | undefined {
  const root = sceneRoot();
  const key = `panel-${panelId}`;
  let found: SceneNode | undefined;
  const visit = (node: SceneNode, depth: number) => {
    if (found || depth > 24) {
      return;
    }
    if (node.state.key === key) {
      const item = node.parent;
      if (
        isNode(item) &&
        item.state.body === node &&
        Number.isInteger(item.state.height) &&
        Number.isInteger(item.state.y) &&
        typeof item.setState === 'function'
      ) {
        found = item;
      }
      return;
    }
    node.forEachChild?.((child) => isNode(child) && visit(child, depth + 1));
  };
  try {
    if (root) {
      visit(root, 0);
    }
  } catch {
    return undefined;
  }
  return found;
}

/** True while the dashboard is in edit mode (from the scene); false when the scene is not found. */
export function useDashboardEditing(): boolean {
  return useSyncExternalStore(
    (notify) => {
      try {
        const sub = sceneRoot()?.subscribeToState?.(notify);
        return () => sub?.unsubscribe();
      } catch {
        return () => {};
      }
    },
    () => sceneRoot()?.state.isEditing === true,
    () => false
  );
}

/**
 * Makes the grid item of the panel `rows` rows lower (never below MIN_ROWS) and draws the grid again: the grid
 * moves the panels below up and keeps their places. The dashboard counts it as a change to save. False when the
 * grid item is not found or the write fails.
 */
export function fitGridHeight(panelId: number, rows: number): boolean {
  const item = gridItemOf(panelId);
  if (!item || rows < 1) {
    return false;
  }
  try {
    const height = item.state.height as number;
    const next = Math.max(MIN_ROWS, height - rows);
    if (next === height) {
      return false;
    }
    item.setState!({ height: next });
    const grid = item.parent;
    if (isNode(grid) && Array.isArray(grid.state.children) && typeof grid.setState === 'function') {
      grid.setState({ children: [...grid.state.children] });
    }
    return true;
  } catch {
    return false;
  }
}

/** True when the panel has a grid item that the fit can write. */
export const canFitGridHeight = (panelId: number): boolean => gridItemOf(panelId) !== undefined;
