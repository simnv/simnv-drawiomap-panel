import type { RowMarks } from './symbolRows';

export interface HighlightState {
  /** The cells of the active entry of the panel legend; null: no entry. */
  legend: string[] | null;
  /** The marks of the active legend row of the diagram; null: no row. */
  rows: RowMarks | null;
}

export interface HighlightStore {
  /** The same object until a change. */
  get(): HighlightState;
  setLegend(ids: string[] | null): void;
  setRows(marks: RowMarks | null): void;
  /** Sets both to null. */
  clear(): void;
  /** Calls `listener` after each change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * The legend highlight of one panel, outside React state: a hover writes it, and only the highlight effect reads it,
 * so a hover does not render the panel. A write of the same value (identity) does not call the listeners.
 */
export function createHighlightStore(): HighlightStore {
  let state: HighlightState = { legend: null, rows: null };
  const listeners = new Set<() => void>();
  const set = (next: HighlightState) => {
    if (next.legend === state.legend && next.rows === state.rows) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return {
    get: () => state,
    setLegend: (legend) => set({ ...state, legend }),
    setRows: (rows) => set({ ...state, rows }),
    clear: () => set({ legend: null, rows: null }),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
