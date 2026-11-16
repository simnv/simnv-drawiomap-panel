import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { LEGEND_ROW_ATTR } from '../legend/symbolRows';
import { markNearLink } from '../render/overlay';
import { paintedClientBox } from '../render/paintedBox';
import { LAYOUT_EVENT } from '../stage/useStageLayout';
import type { CellIndex, CellPatch, PatchMap } from '../types';
import { cardReducer, type CardAction, type CardState } from './cardState';
import { inPortalControl, PORTAL_CONTROL_ATTR } from '../visuals/ChartHover';
import { patchAt } from './hit';
import { NearLinkFinder } from './nearLink';

/** The attribute of the stage while the pointer is near a link (not on it): the panel CSS shows the hand cursor. */
export const NEAR_ATTR = 'data-dmap-near';

/** Touch screens and other devices without hover: only a tap opens (and pins) the card. */
const canHover = () => !(typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches);

/**
 * The card state of the panel. The bind reads the open cell, so this part comes before the bind; useCardInput adds
 * the events after it. The dispatch is useState with an updater, not useReducer: useReducer gets no eager bail-out,
 * so an action that keeps the state (a pointer that leaves the panel with no card) would render the view.
 */
export function useCardState() {
  const [card, setCard] = useState<CardState | null>(null);
  const dispatch = useCallback((action: CardAction) => setCard((c) => cardReducer(c, action)), []);
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
  /** The svg root of the stage: the near-link finder reads its links. */
  root: SVGSVGElement | undefined;
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
  const { card, dispatch, cardRef, inCard, open, wrapperRef, wrapperEl, stageRef, root, patches, index, cardable } =
    args;
  const pinned = !!card?.pinned && open;

  // A thin link is hard to hit: a pointer near it (in screen px) catches it when nothing that opens a card is under
  // the pointer. The finder caches the segments and the screen transform; the events below make it read them again.
  const [finder] = useState(() => new NearLinkFinder());
  const near = useRef<string | undefined>(undefined);
  // a new stage has no mark yet; the stage element outlives its root and keeps the cursor attribute
  useEffect(() => {
    near.current = undefined;
    stageRef.current?.removeAttribute(NEAR_ATTR);
  }, [root, stageRef]);
  const setNear = useCallback(
    (id: string | undefined) => {
      if (near.current === id) {
        return;
      }
      near.current = id;
      if (root) {
        markNearLink(root, id);
      }
      stageRef.current?.toggleAttribute(NEAR_ATTR, !!id);
    },
    [root, stageRef]
  );
  const frame = useRef<number | undefined>(undefined);
  const stopFrame = useCallback(() => {
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
      frame.current = undefined;
    }
  }, []);
  useEffect(() => {
    if (!root) {
      return;
    }
    const invalidate = () => finder.invalidate();
    // A new view (a zoom, a pan, a new size) moves the links under a pointer that stays: the mark goes, and the next
    // move checks again.
    const onLayout = () => {
      finder.invalidate();
      setNear(undefined);
    };
    // the stage layout and any scroll (the stage or the page) move the screen transform
    root.addEventListener(LAYOUT_EVENT, onLayout);
    window.addEventListener('scroll', invalidate, true);
    window.addEventListener('resize', invalidate);
    return () => {
      root.removeEventListener(LAYOUT_EVENT, onLayout);
      window.removeEventListener('scroll', invalidate, true);
      window.removeEventListener('resize', invalidate);
      finder.invalidate();
    };
  }, [root, finder, setNear]);
  useEffect(() => () => stopFrame(), [stopFrame]);
  // A pinned card takes the mark away: the pointer does not hover while it stays.
  useEffect(() => {
    if (pinned) {
      stopFrame();
      setNear(undefined);
    }
  }, [pinned, stopFrame, setNear]);
  /** The patch of the link near the client point that opens a card. */
  const nearPatch = (x: number, y: number, pointerType: string) => {
    if (!root) {
      return undefined;
    }
    const id = finder.find(root, index, x, y, pointerType, (cellId) => {
      const p = patches.get(cellId);
      return !!p && cardable(p);
    });
    return id === undefined ? undefined : patches.get(id);
  };
  // the pointer type of the last pointer down: a click event of an older engine has none
  const downType = useRef('mouse');

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
    const onLeave = () => {
      stopFrame();
      setNear(undefined);
      dispatch({ type: 'leave' });
    };
    // the dashboard can move the panel while the pointer is outside it
    const onEnter = () => finder.invalidate();
    const onDown = (e: PointerEvent) => {
      downType.current = e.pointerType || 'mouse';
      // the page can move the panel with no event here (a row that opens above it): a click reads the transform again
      finder.invalidate();
    };
    wrapperEl.addEventListener('pointerleave', onLeave);
    wrapperEl.addEventListener('pointerenter', onEnter);
    wrapperEl.addEventListener('pointerdown', onDown, true);
    return () => {
      wrapperEl.removeEventListener('pointerleave', onLeave);
      wrapperEl.removeEventListener('pointerenter', onEnter);
      wrapperEl.removeEventListener('pointerdown', onDown, true);
    };
  }, [wrapperEl, dispatch, finder, stopFrame, setNear]);

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
        // an open warning list closes first (also when a press on its edge left the focus on the page); the next Esc
        // closes the card
        if (inPortalControl(e.target) || document.querySelector(`[${PORTAL_CONTROL_ATTR}]`)) {
          return;
        }
        e.stopPropagation();
        finish({ type: 'escape' });
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // the sheet is in a portal outside the panel
      if (pinned && !wrapperRef.current?.contains(t) && !cardRef.current?.contains(t) && !inPortalControl(t)) {
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

  const local = (e: { clientX: number; clientY: number }) => {
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
    const pointerType = (e.nativeEvent as Partial<PointerEvent>).pointerType || downType.current;
    const patch =
      patchAt(e.target, stageEl, patches, index, cardable) ??
      (stageEl.contains(e.target as Node) ? nearPatch(e.clientX, e.clientY, pointerType) : undefined);
    opener.current = null;
    stopFrame();
    setNear(undefined);
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
    // the painted box: the group box of a cell with a draw.io HTML label is the whole viewport
    const c = e.target.getBoundingClientRect();
    const b = paintedClientBox(e.target) ?? { x: c.left, y: c.top, width: c.width, height: c.height };
    opener.current = e.target;
    dispatch({ type: 'pin', at: { cellId: patch.cellId, x: b.x + b.width / 2 - r.left, y: b.y + b.height - r.top } });
  };
  const moveRef = useRef<(() => void) | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const hover = (patch: CellPatch | undefined, at: { clientX: number; clientY: number }) => {
    if (patch && card?.cellId === patch.cellId) {
      // the same cell: only the card moves, with no render
      moveRef.current?.();
      return;
    }
    if (!patch && !card) {
      return;
    }
    dispatch({ type: 'hover', at: patch ? { cellId: patch.cellId, ...local(at) } : null });
  };
  // The near-link check runs at most once per frame. The first move runs it at once; the moves after it in the same
  // frame keep only their last position, and the next frame checks that one. A frame with no move ends the chain, so
  // nothing runs while the pointer is still. The frame reads the handler of the last render (the card of now).
  const pending = useRef<{ clientX: number; clientY: number; pointerType: string } | null>(null);
  const runNear = () => {
    const at = pending.current;
    pending.current = null;
    if (!at || pinned) {
      return;
    }
    if (args.panZoom.busy()) {
      setNear(undefined);
      return;
    }
    const patch = nearPatch(at.clientX, at.clientY, at.pointerType);
    setNear(patch?.cellId);
    hover(patch, at);
  };
  const nearFrame = useRef(runNear);
  useLayoutEffect(() => {
    nearFrame.current = runNear;
  });
  const tick = () => {
    frame.current = undefined;
    if (pending.current) {
      nearFrame.current();
      frame.current = requestAnimationFrame(tick);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    // Hover is for a mouse or a pen. A pinned card stays until the user closes it or pins another cell.
    const stageEl = stageRef.current;
    if (args.panZoom.busy()) {
      // a drag that pans the view shows no mark
      setNear(undefined);
      return;
    }
    if (e.pointerType === 'touch' || !canHover() || pinned || !stageEl) {
      return;
    }
    pointerRef.current = { x: e.clientX, y: e.clientY };
    const patch = patchAt(e.target, stageEl, patches, index, cardable);
    // A direct hit wins. Off the stage (the card, a chart, the corner, the legend) no link is near.
    if (patch || !stageEl.contains(e.target as Node)) {
      stopFrame();
      pending.current = null;
      setNear(undefined);
      hover(patch, e);
      return;
    }
    pending.current = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
    if (frame.current === undefined) {
      runNear();
      frame.current = requestAnimationFrame(tick);
    }
  };

  return { pinned, close, onClick, onKeyDown, onPointerMove, moveRef, pointerRef };
}
