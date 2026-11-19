import { useSyncExternalStore } from 'react';
import { configuredSize, type ViewBox } from '../render/zoom';
import type { ZoomOptions } from '../types';

/** One row of the dashboard grid in px: a cell of 30 px and the margin of 8 px below it. */
export const GRID_ROW_PX = 38;
/** The fit leaves the panel at least this many rows high. */
const MIN_ROWS = 2;
/** The height of a classic horizontal scroll bar (Windows, Linux); an overlay scroll bar takes none. */
const SCROLL_BAR_PX = 17;

/**
 * The whole grid rows of free space below the diagram in the stage: the panel can be this many rows lower and still
 * show all of the diagram at the same size. 0 when the diagram fills the height (or overflows it).
 */
export function freeRows(zoom: ZoomOptions, base: ViewBox | undefined, box: { width: number; height: number }): number {
  if (!base || !(base.w > 0) || !(base.h > 0) || !(box.width > 0) || !(box.height > 0)) {
    return 0;
  }
  const drawn = configuredSize(zoom, base, box);
  // a diagram wider than the stage scrolls: the horizontal scroll bar takes height
  const bar = drawn.width > box.width + 0.5 ? SCROLL_BAR_PX : 0;
  return Math.max(0, Math.floor((box.height - drawn.height - bar) / GRID_ROW_PX));
}

/*
 * Grafana gives a panel no API to change its own height: the dashboard grid sets it. The "Fit height" button uses
 * the scene objects of the dashboard (`window.__grafanaSceneContext`, Grafana 11 and later), which are not a public
 * API. Every read below checks the shape of what it finds; a shape that differs gives "not found", and the
 * button does not show.
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
      // a repeated panel: the item holds the height of all its repeats, and the dashboard saves another field
      const repeated = !!item?.state.variableName || Array.isArray(item?.state.repeatedPanels);
      if (
        isNode(item) &&
        !repeated &&
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

function subscribeEditing(notify: () => void): () => void {
  try {
    const sub = sceneRoot()?.subscribeToState?.(notify);
    return () => sub?.unsubscribe();
  } catch {
    return () => {};
  }
}
const readEditing = () => sceneRoot()?.state.isEditing === true;

/**
 * True while the dashboard is in edit mode (from the scene); false when the scene is not found. The scene of a
 * dashboard exists before its panels mount; a new dashboard mounts the panel again.
 */
export function useDashboardEditing(): boolean {
  return useSyncExternalStore(subscribeEditing, readEditing, () => false);
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
    // the grid draws again (a panel in a row: the row and the grid above it), so it moves the panels below up
    for (let node = item.parent, depth = 0; isNode(node) && depth < 4; node = node.parent, depth++) {
      if (Array.isArray(node.state.children) && typeof node.setState === 'function') {
        node.setState({ children: [...node.state.children] });
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** True when the panel has a grid item that the fit can write. */
export const canFitGridHeight = (panelId: number): boolean => gridItemOf(panelId) !== undefined;
