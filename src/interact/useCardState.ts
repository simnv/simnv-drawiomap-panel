import React, { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { LEGEND_ROW_ATTR } from '../legend/symbolRows';
import type { CellIndex, CellPatch, PatchMap } from '../types';
import { cardReducer, type CardAction, type CardState } from './cardState';
import { patchAt } from './hit';

/** Touch screens and other devices without hover: only a tap opens (and pins) the card. */
const canHover = () => !(typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches);

/**
 * The card state of the panel. The bind reads the open cell, so this part comes before the bind; useCardInput adds
 * the events after it. The dispatch goes through a state updater, as a plain setState did: React can skip the render
 * of an action that keeps the state (for example a pointer that leaves the panel with no card).
 */
export function useCardState(paused: boolean) {
  const [card, setCard] = useState<CardState | null>(null);
  const dispatch = useCallback((action: CardAction) => setCard((c) => cardReducer(c, action)), []);
  // Opening the popup closes the card of the panel (state adjustment during render).
  if (paused && card) {
    dispatch({ type: 'close' });
  }
  const cardRef = useRef<HTMLDivElement>(null);
  const inCard = useCallback((t: EventTarget | null) => t instanceof Node && !!cardRef.current?.contains(t), []);
  return { card, dispatch, cardRef, inCard };
}

interface InputArgs extends ReturnType<typeof useCardState> {
  /** The card of the open cell has rows or links. */
  open: boolean;
  wrapperRef: RefObject<HTMLDivElement | null>;
  /** The same element as wrapperRef, as state: the pointerleave listener follows it. */
  wrapperEl: HTMLDivElement | null;
  stageRef: RefObject<HTMLDivElement | null>;
  patches: PatchMap;
  index: CellIndex;
  /** The patch opens a card. */
  cardable: (p: CellPatch) => boolean;
  /** The target is a control of the panel (the corner, the band, the legend): a click on it leaves the card alone. */
  onControl: (t: EventTarget | null) => boolean;
  panZoom: { takeClick: () => boolean; busy: () => boolean };
}

/** The events of the card: hover, click, tap and Enter open it; Esc, a click outside and leaving the panel close it. */
export function useCardInput(args: InputArgs) {
  const { card, dispatch, cardRef, inCard, open, wrapperRef, wrapperEl, stageRef, patches, index, cardable } = args;
  const pinned = !!card?.pinned && open;

  // A card opened from the keyboard gives the focus back to its cell when it closes.
  const opener = useRef<Element | null>(null);
  const finish = useCallback(
    (action: CardAction) => {
      dispatch(action);
      const el = opener.current as (Element & HTMLOrSVGElement) | null;
      opener.current = null;
      if (el?.isConnected) {
        el.focus({ preventScroll: true });
      }
    },
    [dispatch]
  );
  const close = useCallback(() => finish({ type: 'close' }), [finish]);

  // The pointer leaves the panel: the hover card closes, a pinned card stays. A native listener: React makes
  // onPointerLeave from pointerout, and the browser sends no pointerout when the overlay redraw removed the
  // element under the pointer.
  useEffect(() => {
    if (!wrapperEl) {
      return;
    }
    const onLeave = () => dispatch({ type: 'leave' });
    wrapperEl.addEventListener('pointerleave', onLeave);
    return () => wrapperEl.removeEventListener('pointerleave', onLeave);
  }, [wrapperEl, dispatch]);

  // Esc closes the card. A pointer down outside the panel closes a pinned card.
  useEffect(() => {
    if (!open) {
      return;
    }
    // Capture phase: Esc closes the card only, Grafana does not also leave the panel view.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // a chart with a tooltip hides the tooltip first (ChartHover); the next Esc closes the card
        if ((e.target as Element | null)?.closest?.('[data-tooltip-open="true"]')) {
          return;
        }
        e.stopPropagation();
        finish({ type: 'escape' });
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // the sheet is in a portal outside the panel
      if (pinned && !wrapperRef.current?.contains(t) && !cardRef.current?.contains(t)) {
        opener.current = null;
        dispatch({ type: 'outside' });
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, pinned, finish, dispatch, wrapperRef, cardRef]);

  const local = (e: React.MouseEvent) => {
    const r = wrapperRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // A click or a tap pins the card of the cell. A click on empty space closes it.
  const onClick = (e: React.MouseEvent) => {
    const stageEl = stageRef.current;
    // a drag that moved the view is not a click
    if (
      args.panZoom.takeClick() ||
      inCard(e.target) ||
      args.onControl(e.target) ||
      // a tap on a linked legend row of the diagram toggles its highlight and leaves the card alone
      (e.target instanceof Element && e.target.closest(`[${LEGEND_ROW_ATTR}]`)) ||
      !stageEl
    ) {
      return;
    }
    const patch = patchAt(e.target, stageEl, patches, index, cardable);
    opener.current = null;
    dispatch({ type: 'pin', at: patch ? { cellId: patch.cellId, ...local(e) } : null });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const stageEl = stageRef.current;
    if ((e.key !== 'Enter' && e.key !== ' ') || !stageEl || inCard(e.target) || !(e.target instanceof Element)) {
      return;
    }
    const patch = patchAt(e.target, stageEl, patches, index, cardable);
    if (!patch) {
      return;
    }
    e.preventDefault();
    const r = wrapperRef.current!.getBoundingClientRect();
    const b = e.target.getBoundingClientRect();
    opener.current = e.target;
    dispatch({ type: 'pin', at: { cellId: patch.cellId, x: b.left + b.width / 2 - r.left, y: b.bottom - r.top } });
  };
  const moveRef = useRef<(() => void) | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const onPointerMove = (e: React.PointerEvent) => {
    // Hover is for a mouse or a pen. A pinned card stays until the user closes it or pins another cell.
    const stageEl = stageRef.current;
    if (e.pointerType === 'touch' || !canHover() || pinned || args.panZoom.busy() || !stageEl) {
      return;
    }
    pointerRef.current = { x: e.clientX, y: e.clientY };
    const patch = patchAt(e.target, stageEl, patches, index, cardable);
    if (patch && card?.cellId === patch.cellId) {
      // the same cell: only the card moves, with no render
      moveRef.current?.();
      return;
    }
    if (!patch && !card) {
      return;
    }
    dispatch({ type: 'hover', at: patch ? { cellId: patch.cellId, ...local(e) } : null });
  };

  return { pinned, close, onClick, onKeyDown, onPointerMove, moveRef, pointerRef };
}
