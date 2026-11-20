/** The open card of the panel: the cell, the place and whether it is pinned. Null: no card. */
export interface CardState {
  cellId: string;
  /** pointer position in panel coordinates */
  x: number;
  y: number;
  pinned: boolean;
}

/** A cell under the pointer or the focus, at a place in panel coordinates. Null: no cell. */
export type CardAt = Omit<CardState, 'pinned'> | null;

export type CardAction =
  /** A mouse or a pen moves to a cell, or off all cells. */
  | { type: 'hover'; at: CardAt }
  /** A click, a tap or Enter on a cell, or a click on empty space. */
  | { type: 'pin'; at: CardAt }
  /** The close button, or a control of the panel that opens the bindings popup. */
  | { type: 'close' }
  /** The pointer leaves the panel. */
  | { type: 'leave' }
  /** A pointer down outside the panel and the card. The caller sends it only for a pinned card with content. */
  | { type: 'outside' }
  | { type: 'escape' }
  /** The open cell has no patch now: the bindings or the diagram changed. */
  | { type: 'stale-cell' }
  | { type: 'diagram-changed' };

/**
 * The card state machine. A hover opens a card that follows the pointer; a pin keeps it until the user closes it or
 * pins another cell. The caller ignores a hover while a card with content is pinned: only it knows the content.
 */
export function cardReducer(state: CardState | null, action: CardAction): CardState | null {
  switch (action.type) {
    case 'hover':
      return action.at && { ...action.at, pinned: false };
    case 'pin':
      return action.at && { ...action.at, pinned: true };
    case 'leave':
      return state?.pinned ? state : null;
    case 'outside':
      return state?.pinned ? null : state;
    case 'close':
    case 'escape':
    case 'stale-cell':
    case 'diagram-changed':
      return null;
  }
}

/**
 * The card state outside React: a hover writes it, and only the card host renders. The panel view reads only the
 * pinned cell, so a hover from cell to cell does not render the panel.
 */
export interface CardStore {
  get(): CardState | null;
  subscribe(listener: () => void): () => void;
  dispatch(action: CardAction): void;
  /**
   * The same action during a render of the panel (a state adjustment): no listener runs, because a listener would
   * update another component during the render. The card host renders in the same pass and reads the new state.
   */
  adjust(action: CardAction): void;
  /**
   * True while a hover card with content is open, also when Shift hides it (the host writes it after each commit): the
   * Shift key reads it when it goes down.
   */
  hoverOpen(): boolean;
  setHoverOpen(open: boolean): void;
}

export function createCardStore(): CardStore {
  let state: CardState | null = null;
  let hoverOpen = false;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(action) {
      const next = cardReducer(state, action);
      // an action that keeps the state (a pointer that leaves the panel with no card) renders nothing
      if (next !== state) {
        state = next;
        listeners.forEach((l) => l());
      }
    },
    adjust(action) {
      state = cardReducer(state, action);
    },
    hoverOpen: () => hoverOpen,
    setHoverOpen(open) {
      hoverOpen = open;
    },
  };
}

/** The cell of a pinned card, or undefined: the only part of the card state that the panel view reads. */
export const pinnedCellOf = (state: CardState | null): string | undefined => (state?.pinned ? state.cellId : undefined);
