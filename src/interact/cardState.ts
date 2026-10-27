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
  /** A pointer down outside the panel and the card. */
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
