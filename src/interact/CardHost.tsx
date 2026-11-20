import React, { useLayoutEffect, useMemo, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { TimeRange } from '@grafana/data';
import type { BindResultV4 } from '../binding/bindV4';
import { Card, SHEET_BELOW } from './Card';
import { buildCardV4, type CardContextV4, type CardModelV4 } from './cardModel';
import type { CardAction, CardStore } from './cardState';
import { useCardDismiss } from './useCardState';

/** The sheet goes to document.body: position: fixed does not work below a CSS transform (the Grafana grid item). */
const portalSheet = (card: React.ReactElement, sheet: boolean) =>
  sheet && typeof document !== 'undefined' ? createPortal(card, document.body) : card;

/** A card without rows and links has nothing to show: the cell opens no card. */
export const hasContent = (model: CardModelV4 | undefined): model is CardModelV4 =>
  !!model && (model.rows.length > 0 || model.links.length > 0);

interface CardHostProps {
  store: CardStore;
  cardRef: RefObject<HTMLDivElement>;
  /** The cell of the pinned card that the panel view read, and its model: the host builds no model a second time. */
  pinnedCell: string | undefined;
  pinnedModel: CardModelV4 | undefined;
  /** The bind result at the current clock: its patches name the cells that a card can show. */
  bound: BindResultV4;
  ctx: CardContextV4;
  /** Shift hides the hover card (the hover focus mode `on`). */
  hidden: boolean;
  width: number;
  height: number;
  anchor: HTMLElement | null;
  wrapperRef: RefObject<HTMLDivElement | null>;
  timeRange: TimeRange;
  timeZone?: string;
  onClose: () => void;
  finish: (action: CardAction) => void;
  outside: () => void;
  pointerRef: React.MutableRefObject<{ x: number; y: number } | null>;
  moveRef: React.MutableRefObject<(() => void) | null>;
}

/**
 * The card of the panel. It reads the whole card state, so a hover from cell to cell renders this component only,
 * not the panel view. A hover card stays mounted from cell to cell; a pin gives a new instance.
 *
 * It must render in every pass of the panel view: no React.memo. The panel drops the state with `store.adjust`, which
 * notifies nobody, and this host sees the drop only because it renders in the same pass.
 */
export function CardHost(props: CardHostProps) {
  const { store, cardRef, pinnedCell, pinnedModel, bound, ctx, width, height } = props;
  const card = useSyncExternalStore(store.subscribe, store.get);
  // the cell has no patch: the panel drops the state in the same render (a new diagram or new bindings)
  const cell = card && bound.patches.has(card.cellId) ? card.cellId : undefined;
  const fromPanel = !!card?.pinned && cell === pinnedCell;
  // The card resolves its rows only for the open cell. A data refresh updates it in place.
  const ownCell = fromPanel ? undefined : cell;
  const own = useMemo(
    () => (ownCell === undefined ? undefined : buildCardV4(ownCell, bound, ctx)),
    [ownCell, bound, ctx]
  );
  const model = fromPanel ? pinnedModel : own;
  const open = cell !== undefined && hasContent(model);
  const pinned = open && !!card?.pinned;
  const hoverOpen = open && !pinned;
  useLayoutEffect(() => store.setHoverOpen(hoverOpen), [store, hoverOpen]);
  useCardDismiss({
    open,
    pinned,
    finish: props.finish,
    outside: props.outside,
    wrapperRef: props.wrapperRef,
    cardRef,
  });
  if (!open || !card || props.hidden) {
    return null;
  }
  return portalSheet(
    <div ref={cardRef}>
      <Card
        key={pinned ? `pinned:${card.cellId}` : 'hover'}
        model={model}
        cellId={card.cellId}
        pinned={pinned}
        x={card.x}
        y={card.y}
        width={width}
        height={height}
        anchor={props.anchor}
        timeRange={props.timeRange}
        timeZone={props.timeZone}
        onClose={props.onClose}
        pointerRef={props.pointerRef}
        moveRef={props.moveRef}
      />
    </div>,
    width < SHEET_BELOW
  );
}
