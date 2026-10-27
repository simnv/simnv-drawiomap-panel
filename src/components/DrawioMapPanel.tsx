import { createPortal } from 'react-dom';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { css, cx } from '@emotion/css';
import { PanelProps } from '@grafana/data';
import { IconButton, useTheme2 } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { bindContextFor } from '../binding/context';
import { buildConfiguredCard, opensCard } from '../interact/cardModel';
import { Card, SHEET_BELOW } from '../interact/Card';
import { hoverKind } from '../adapter/portograph';
import { interactiveCells, patchAt } from '../interact/hit';
import { INTERACTIVE_ATTR, type Marked, markInteractive } from '../render/applier';
import { cellMetas } from '../render/svgStage';
import type { ViewBox } from '../render/zoom';
import { DEFAULT_OPTIONS, Options, withDefaults, type CellPatch, type LegendCorner } from '../types';
import { usePanZoom } from '../stage/usePanZoom';
import { useStage } from '../stage/useStage';
import { useStageLayout } from '../stage/useStageLayout';
import { useStagePaint } from '../stage/useStagePaint';
import { useBoundDiagram, type BindGroups } from '../stage/useBoundDiagram';
import { useHeld } from './useHeld';
import { PanelQueryContext, PanelQueryProvider, type PanelQueryService } from '../query/panel';
import { EMPTY_CONFIG, legacyRulesWarning } from '../model/config';
import { currentAddress, subscribe, type PopupTarget } from '../editor/popup/popupBus';
import { LazyBindingsPopup } from './LazyBindingsPopup';
import { MAX_DATA_POINTS } from '../query/types';
import { ChartLayer } from '../visuals/ChartLayer';
import { bandLayout, StatusBand } from './StatusBand';
import { legendCorners } from './legendCorners';
import { Legend } from '../legend/Legend';
import { buildLegend } from '../legend/model';
import { highlightCells, LEGEND_ACTIVE, LEGEND_HIT, LEGEND_MEMBER } from '../legend/highlight';
import { bindSymbolLegend, LEGEND_ROW_ATTR } from '../legend/symbolRows';
import { createHighlightStore } from '../legend/highlightStore';

/** Heights in px of the items in the top-left row. */
const RESET_SIZE = 32;
const BADGE_HEIGHT = 20;

/** The address of the open edit session of this panel, or an empty string when the panel is not in panel edit. */
function usePanelEditing(id: number) {
  const subscribe = useCallback((notify: () => void) => {
    const sub = locationService?.getLocationObservable().subscribe(notify);
    return () => sub?.unsubscribe();
  }, []);
  // The snapshot holds the pathname too: the same panel id on another dashboard is another edit session.
  const snapshot = useSyncExternalStore(
    subscribe,
    () => `${locationService?.getLocation().pathname ?? ''}\n${locationService?.getSearchObject().editPanel ?? ''}`
  );
  const [pathname, editPanel] = snapshot.split('\n');
  return editPanel === String(id) ? `${pathname}\n${editPanel}` : '';
}

const styles = {
  // The status band and the stage stack: the band never covers the diagram.
  wrapper: css`
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  `,
  stage: css`
    flex: none;
    width: 100%;
    & > svg {
      display: block;
    }
    /* Only the cells that open a card show the hand cursor. Grafana gives it to every role="button", and in panel
       edit mode the binding editor makes every cell a role="button": the other cells take the parent cursor. */
    & [data-cell-id][role='button']:not([${INTERACTIVE_ATTR}]) {
      cursor: inherit;
    }
    & [${INTERACTIVE_ATTR}] {
      cursor: pointer;
    }
    /* A legend entry under the pointer: the other cells of the legend dim. */
    & .${LEGEND_MEMBER} {
      transition: opacity 120ms;
    }
    & svg.${LEGEND_ACTIVE} .${LEGEND_MEMBER}:not(.${LEGEND_HIT}):not(:has(.${LEGEND_HIT})) {
      opacity: 0.2;
    }
  `,
  empty: css`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    opacity: 0.7;
  `,
  // The top-left stack: the reset button and the warning badge in one row.
  // The top-right corner is free: Grafana puts its panel menu button there.
  corner: css`
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    max-width: calc(100% - 8px);
    /* above the legend: in a tiny panel the legend may cover the corner, but the reset button stays clickable */
    z-index: 2;
    /* The empty space beside the row is part of the diagram: only the row and the legend catch the pointer. */
    pointer-events: none;
  `,
  cornerRow: css`
    display: flex;
    align-items: center;
    gap: 4px;
    pointer-events: auto;
  `,
  // 32 px: a touch target for a finger
  reset: css`
    margin: 0;
    min-width: 32px;
    min-height: 32px;
    border-radius: 4px;
  `,
  badge: css`
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    z-index: 1;
  `,
  // In panel edit the badge is a button: reset the browser button look, keep the size of the badge.
  badgeButton: css`
    border: 0;
    margin: 0;
    font-family: inherit;
    line-height: inherit;
    cursor: pointer;
  `,
};

interface CardState {
  cellId: string;
  /** pointer position in panel coordinates */
  x: number;
  y: number;
  pinned: boolean;
}

/** The store groups of the panel: the visible bindings and the open card. */
const PANEL_GROUPS: BindGroups = { visible: 'visible', card: 'card' };

/** The sheet goes to document.body: position: fixed does not work below a CSS transform (the Grafana grid item). */
const portalSheet = (card: React.ReactElement, sheet: boolean) =>
  sheet && typeof document !== 'undefined' ? createPortal(card, document.body) : card;

/** Touch screens and other devices without hover: only a tap opens (and pins) the card. */
const canHover = () => !(typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches);

export function DrawioMapPanel(props: PanelProps<Options>) {
  const session = usePanelEditing(props.id);
  const editing = session !== '';
  const [popup, setPopup] = useState<PopupTarget | null>(null);
  // The element that opened the popup gets the focus back on close. The chunk loader and the dialog mount later and
  // would see another active element, so the panel records it at the click.
  const opener = useRef<HTMLElement | null>(null);
  const openPopup = useCallback((target: PopupTarget) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPopup(target);
  }, []);
  // The popup lives as long as the edit session of this panel: leaving panel edit (navigation, "Back to dashboard",
  // browser back) or unmounting drops it with its draft, also while its chunk still loads.
  // A change of the address (another dashboard, another panel id) is a new session too: the draft is dropped.
  const [wasSession, setWasSession] = useState(session);
  if (wasSession !== session) {
    setWasSession(session);
    setPopup(null);
  }
  // The "Edit bindings" button of the options pane asks for the popup through the addressed bus.
  useEffect(() => {
    if (!editing) {
      return;
    }
    return subscribe(currentAddress(), openPopup);
    // The session is the address: a new one subscribes again.
  }, [session, editing, openPopup]);
  const closePopup = useCallback(() => {
    setPopup(null);
    const target = opener.current;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) {
        target.focus();
      }
    });
  }, []);
  // The query session follows the panel on its dashboard: the panel editor, a lazy scroll and a layout change mount
  // a new component for the same panel, and it must not run every diagram query again.
  const querySession = `${locationService?.getLocation().pathname ?? ''}#${props.id}`;
  return (
    <PanelQueryProvider
      session={querySession}
      data={props.data}
      timeRange={props.timeRange}
      timeZone={props.timeZone}
      replaceVariables={props.replaceVariables}
      defaultDatasource={props.options.config?.defaultDatasource}
    >
      {/* Sandbox hosts do not provide a definite percentage-height containing block. */}
      <div style={{ width: props.width, height: props.height }}>
        <PanelBody {...props} editing={editing} paused={!!popup} onOpenBindings={openPopup} />
      </div>
      {editing && popup ? (
        <LazyBindingsPopup
          id={props.id}
          target={popup}
          options={props.options}
          data={props.data}
          timeZone={props.timeZone}
          fieldConfig={props.fieldConfig}
          replaceVariables={props.replaceVariables}
          onOptionsChange={props.onOptionsChange}
          onClose={closePopup}
        />
      ) : null}
    </PanelQueryProvider>
  );
}

interface BodyProps extends PanelProps<Options> {
  /** The panel is open in the panel editor. */
  editing: boolean;
  /**
   * The bindings popup is open: the view keeps its last render and does no per-refresh work. Each input is held
   * apart (ref-based, no state write in render). The clock runs on: a freshness deadline still re-binds once.
   */
  paused: boolean;
  onOpenBindings: (target: PopupTarget) => void;
}

/**
 * Reads the query context outside of the paused view: a new context (a refresh changes the request id or the time
 * range) renders only this small component, and the view gets the held service. The view never reads the context.
 */
function PanelBody(props: BodyProps) {
  const queryService = useHeld(useContext(PanelQueryContext), props.paused);
  return <DrawioMapPanelView {...props} queryService={queryService} />;
}

interface ViewProps extends BodyProps {
  /** The query service of the panel; held by the parent while the panel is paused. */
  queryService: PanelQueryService | undefined;
}

/** While the popup is open and the panel is paused, a new props object of the dashboard does not render the view. */
const bothPaused = (a: ViewProps, b: ViewProps) => a.paused && b.paused;

const DrawioMapPanelView = React.memo(function DrawioMapPanelView(props: ViewProps) {
  const { id, editing, paused, onOpenBindings } = props;
  const options = useHeld(props.options, paused);
  const data = useHeld(props.data, paused);
  const width = useHeld(props.width, paused);
  const height = useHeld(props.height, paused);
  const fieldConfig = useHeld(props.fieldConfig, paused);
  const replaceVariables = useHeld(props.replaceVariables, paused);
  const timeZone = useHeld(props.timeZone, paused);
  const timeRange = useHeld(props.timeRange, paused);
  const theme = useTheme2();
  const { queryService } = props;
  const opts = withDefaults(options);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const attachStage = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    setViewport(element);
  }, []);
  const stage = useStage(containerRef, opts.diagram?.svg, opts.diagram?.hash);
  const interactiveRef = useRef<Marked>();
  const [card, setCard] = useState<CardState | null>(null);
  const [view, setView] = useState<ViewBox | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const attachWrapper = useCallback((element: HTMLDivElement | null) => {
    wrapperRef.current = element;
    setWrapperEl(element);
  }, []);
  const cardRef = useRef<HTMLDivElement>(null);
  const zoomMode = opts.zoom.mode;
  const zoomPercent = opts.zoom.percent;
  const wheelZoom = opts.zoom.wheel;
  const dragPan = opts.zoom.pan;
  const align = opts.zoom.align ?? 'top';
  const minScale = opts.zoom.minScale ?? 0;

  // Reset the custom view and close the card when the diagram changes (state adjustment during render).
  const hash = opts.diagram?.hash;
  const [viewHash, setViewHash] = useState(hash);
  if (viewHash !== hash) {
    setViewHash(hash);
    setView(null);
    setCard(null);
  }
  // A new panel size or a new zoom option resets the live view to the configured view.
  const viewKey = `${width}x${height}|${zoomMode}|${zoomPercent}|${align}|${minScale}`;
  const [lastViewKey, setLastViewKey] = useState(viewKey);
  if (lastViewKey !== viewKey) {
    setLastViewKey(viewKey);
    setView(null);
  }

  // Opening the popup closes the card of the panel (state adjustment during render).
  if (paused && card) {
    setCard(null);
  }
  const openBindings = (target: PopupTarget) => {
    setCard(null);
    onOpenBindings(target);
  };

  const bindingContext = useMemo(
    () =>
      bindContextFor({
        theme,
        fieldThresholds: fieldConfig.defaults.thresholds,
        replaceVariables,
        timeZone,
        linkWidth: { min: opts.linkWidth.min, max: opts.linkWidth.max },
      }),
    [theme, fieldConfig.defaults.thresholds, replaceVariables, timeZone, opts.linkWidth.min, opts.linkWidth.max]
  );
  const metas = useMemo(() => cellMetas(stage.index), [stage.index]);
  const format = useMemo(() => ({ theme, timeZone }), [theme, timeZone]);
  // The visible bindings and the rows of the open card are two groups of the store with one owner. A hover over a
  // new cell changes the card frame only: the resolver of the diagram, the bind and the patches do not run again.
  const { plan, cardResolve, bound, shown, cardContext } = useBoundDiagram({
    metas,
    config: opts.config ?? EMPTY_CONFIG,
    service: queryService,
    owner: `panel:${id}`,
    groups: PANEL_GROUPS,
    maxDataPoints: Math.max(1, Math.min(MAX_DATA_POINTS, width - 16)),
    data,
    bindContext: bindingContext,
    format,
    openCellId: card?.cellId,
    paused,
  });
  // The rules of version 1 are not read. A saved value gives a warning, so the author sees why nothing is bound.
  const legacyRules = Array.isArray(options.rules) ? options.rules.length : 0;
  const result = useMemo(() => {
    const warnings = bound.diagnostics.map((d) => `${d.path}: ${d.message}`);
    if (legacyRules) {
      warnings.unshift(legacyRulesWarning(legacyRules));
    }
    return { patches: shown.patches, warnings, diagnostics: bound.diagnostics, summaries: shown.summaries };
  }, [bound, shown, legacyRules]);

  // The status band takes its height from the panel; the stage gets the rest.
  const [bandExpanded, setBandExpanded] = useState(false);
  const band = bandLayout(result.summaries.length, opts.summary.maxRows, bandExpanded, height);
  const stageHeight = Math.max(1, height - band.height);
  const bandRef = useRef<HTMLElement>(null);

  // The card resolves its rows only for the open cell. A data refresh updates it in place.
  const cardPatch = card ? result.patches.get(card.cellId) : undefined;
  if (card && !cardPatch) {
    // the bindings or the diagram changed and the cell has no patch now
    setCard(null);
  }
  const model = useMemo(
    () => (cardPatch ? buildConfiguredCard(cardPatch, cardResolve, cardContext) : undefined),
    [cardPatch, cardResolve, cardContext]
  );
  // Only the cell kinds of the Hover kinds option open a card (the canvas, groups and the legend do not by default),
  // and only when the card has rows or links. Computed once per data update: these cells get the hand cursor.
  const hoverKinds = opts.hover.kinds;
  const interactive = useMemo(
    () =>
      interactiveCells(result.patches, stage.index, (p) => {
        const entry = stage.index.get(p.cellId);
        return !!entry && hoverKinds.includes(hoverKind(entry)) && opensCard(p, cardContext);
      }),
    [result.patches, stage.index, hoverKinds, cardContext]
  );
  const cardable = (p: CellPatch) => interactive.has(p.cellId);

  // The colour legend: the scales of the bound cells. A legend entry under the pointer highlights its cells.
  const legendOptions = opts.legend;
  const queries = plan.config.queries;
  const legendBlocks = useMemo(() => {
    if (!legendOptions.show) {
      return [];
    }
    const names = new Map((queries ?? []).map((q) => [q.id, q.name]));
    return buildLegend(result.patches, {
      theme,
      fieldThresholds: fieldConfig.defaults.thresholds,
      queryName: (id) => names.get(id),
    });
  }, [legendOptions.show, queries, result.patches, theme, fieldConfig.defaults.thresholds]);
  const legendMembers = useMemo(() => [...new Set(legendBlocks.flatMap((b) => b.cellIds))], [legendBlocks]);
  // The active entry of the panel legend and the marks of a legend row inside the diagram (portograph rows with a
  // symbol). They are not state: a hover writes the store, and only the highlight effect below reads it, so a hover
  // does not render the view.
  const [highlight] = useState(createHighlightStore);
  // Opening the popup ends the legend highlight, and a hover behind the popup marks nothing, also after it closes.
  useEffect(() => highlight.clear(), [paused, highlight]);
  const legendRef = useRef<HTMLElement>(null);
  // A card without rows and links has nothing to show: the cell opens no card.
  const open = !!model && (model.rows.length > 0 || model.links.length > 0);
  const pinned = !!card?.pinned && open;

  // A card opened from the keyboard gives the focus back to its cell when it closes.
  const opener = useRef<Element | null>(null);
  const close = useCallback(() => {
    setCard(null);
    const el = opener.current as (Element & HTMLOrSVGElement) | null;
    opener.current = null;
    if (el?.isConnected) {
      el.focus({ preventScroll: true });
    }
  }, []);

  // The pointer leaves the panel: the hover card closes, a pinned card stays. A native listener: React makes
  // onPointerLeave from pointerout, and the browser sends no pointerout when the overlay redraw removed the
  // element under the pointer.
  useEffect(() => {
    if (!wrapperEl) {
      return;
    }
    const onLeave = () => setCard((c) => (c?.pinned ? c : null));
    wrapperEl.addEventListener('pointerleave', onLeave);
    return () => wrapperEl.removeEventListener('pointerleave', onLeave);
  }, [wrapperEl]);

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
        close();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // the sheet is in a portal outside the panel
      if (pinned && !wrapperRef.current?.contains(t) && !cardRef.current?.contains(t)) {
        opener.current = null;
        setCard(null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, pinned, close]);

  // Apply patches, redraw the overlay and the value labels once per frame.
  useStagePaint(stage, result.patches, { theme, linkWidth: opts.linkWidth, interactive });
  // The cells that open a card get the interactive mark. The applier, the overlay and the labels do not read or write
  // it, so its place in the frame does not matter.
  useEffect(() => {
    if (!stage.root) {
      return;
    }
    const id = requestAnimationFrame(() => {
      interactiveRef.current = markInteractive(stage.index, interactive, interactiveRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [stage.root, stage.index, interactive]);

  // After the patches (the same frame order): mark the cells of the legend entry under the pointer. The effect runs
  // again for a new stage or new data; a change of the store paints in the next frame with no render. The rows of the
  // diagram come before the panel legend.
  const hasBlocks = legendBlocks.length > 0;
  useEffect(() => {
    if (!stage.root) {
      return;
    }
    const root = stage.root;
    if (paused) {
      const id = requestAnimationFrame(() => highlightCells(root, stage.index, [], null));
      return () => cancelAnimationFrame(id);
    }
    let frame: number | undefined;
    const paint = () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const { legend, rows } = highlight.get();
        if (rows) {
          highlightCells(root, stage.index, rows.members, rows.hits);
        } else {
          highlightCells(root, stage.index, legendMembers, hasBlocks ? legend : null);
        }
      });
    };
    paint();
    const unsubscribe = highlight.subscribe(paint);
    return () => {
      unsubscribe();
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [stage.root, stage.index, legendMembers, hasBlocks, result, highlight, paused]);

  // The legend rows of the diagram: a row with a symbol marks the nodes of that symbol.
  useEffect(
    () => (stage.root ? bindSymbolLegend(stage.root, stage.index, highlight.setRows) : undefined),
    [stage.root, stage.index, highlight]
  );

  // Zoom layout.
  const zoomLayout = useMemo(
    () => ({ ...DEFAULT_OPTIONS.zoom, mode: zoomMode, percent: zoomPercent, align, minScale }),
    [zoomMode, zoomPercent, align, minScale]
  );
  useStageLayout(stage, zoomLayout, { width, height: stageHeight }, view, containerRef);

  const local = (e: React.MouseEvent) => {
    const r = wrapperRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const inCard = (t: EventTarget | null) => t instanceof Node && !!cardRef.current?.contains(t);
  const corner = useRef<HTMLDivElement>(null);
  const panZoom = usePanZoom({
    wrapperRef,
    root: stage.root,
    base: stage.base,
    view,
    setView,
    wheel: wheelZoom,
    dragPan,
    align,
    ignore: (t) =>
      inCard(t) ||
      (t instanceof Element && !!t.closest('[data-dmap-widget] a')) ||
      (t instanceof Node &&
        (!!corner.current?.contains(t) || !!bandRef.current?.contains(t) || !!legendRef.current?.contains(t))),
  });

  // The configured view starts at the top-left corner of a stage that scrolls.
  const resetView = () => {
    setView(null);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
      containerRef.current.scrollLeft = 0;
    }
  };

  // A click or a tap pins the card of the cell. A click on empty space closes it.
  const onClick = (e: React.MouseEvent) => {
    const stageEl = containerRef.current;
    // a drag that moved the view is not a click
    if (
      panZoom.takeClick() ||
      inCard(e.target) ||
      corner.current?.contains(e.target as Node) ||
      bandRef.current?.contains(e.target as Node) ||
      legendRef.current?.contains(e.target as Node) ||
      // a tap on a linked legend row of the diagram toggles its highlight and leaves the card alone
      (e.target instanceof Element && e.target.closest(`[${LEGEND_ROW_ATTR}]`)) ||
      !stageEl
    ) {
      return;
    }
    const patch = patchAt(e.target, stageEl, result.patches, stage.index, cardable);
    opener.current = null;
    setCard(patch ? { cellId: patch.cellId, ...local(e), pinned: true } : null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const stageEl = containerRef.current;
    if ((e.key !== 'Enter' && e.key !== ' ') || !stageEl || inCard(e.target) || !(e.target instanceof Element)) {
      return;
    }
    const patch = patchAt(e.target, stageEl, result.patches, stage.index, cardable);
    if (!patch) {
      return;
    }
    e.preventDefault();
    const r = wrapperRef.current!.getBoundingClientRect();
    const b = e.target.getBoundingClientRect();
    opener.current = e.target;
    setCard({ cellId: patch.cellId, x: b.left + b.width / 2 - r.left, y: b.bottom - r.top, pinned: true });
  };
  const moveCard = useRef<(() => void) | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const onPointerMove = (e: React.PointerEvent) => {
    // Hover is for a mouse or a pen. A pinned card stays until the user closes it or pins another cell.
    const stageEl = containerRef.current;
    if (e.pointerType === 'touch' || !canHover() || pinned || panZoom.busy() || !stageEl) {
      return;
    }
    pointerRef.current = { x: e.clientX, y: e.clientY };
    const patch = patchAt(e.target, stageEl, result.patches, stage.index, cardable);
    if (patch && card?.cellId === patch.cellId) {
      // the same cell: only the card moves, with no render
      moveCard.current?.();
      return;
    }
    if (!patch && !card) {
      return;
    }
    setCard(patch ? { cellId: patch.cellId, ...local(e), pinned: false } : null);
  };

  if (!opts.diagram?.svg) {
    return (
      <div className={styles.empty} data-testid="dmap-empty">
        No diagram. Edit the panel and open the draw.io editor or import a .drawio file.
      </div>
    );
  }

  const warnings = [...stage.warnings, ...result.warnings];
  const rowHeight = panZoom.zoomed || editing ? RESET_SIZE : warnings.length ? BADGE_HEIGHT : 0;
  const corners = legendCorners(band.height, rowHeight, width);
  // a saved corner that this version does not know
  const legendCorner: LegendCorner = corners[legendOptions.corner] ? legendOptions.corner : 'bottom-right';
  const legend = legendOptions.show ? (
    <Legend
      ref={legendRef}
      blocks={legendBlocks}
      maxBlocks={legendOptions.maxBlocks}
      collapsed={legendOptions.collapsed}
      onHighlight={highlight.setLegend}
      style={corners[legendCorner]}
      corner={legendCorner}
    />
  ) : null;
  // At the configured view one finger scrolls the page and the page does not pinch-zoom over the panel.
  // A zoomed view takes all touches: one finger pans it.
  const touchAction = panZoom.zoomed ? 'none' : 'pan-x pan-y';

  return (
    <div
      className={styles.wrapper}
      ref={attachWrapper}
      data-testid="dmap-panel"
      data-dmap-cells={stage.index.size}
      data-dmap-patched={result.patches.size}
      data-dmap-warnings={warnings.length}
      data-dmap-hash={opts.diagram.hash}
      style={{ colorScheme: theme.isDark ? 'dark' : 'light', touchAction }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
    >
      {/* Chrome does not carry pan restrictions into a scroll container: the stage needs its own touch-action. */}
      <StatusBand
        ref={bandRef}
        summaries={result.summaries}
        layout={band}
        expanded={bandExpanded}
        onToggle={() => setBandExpanded((v) => !v)}
      />
      <div
        ref={attachStage}
        className={styles.stage}
        style={{ touchAction, height: stageHeight }}
        data-testid="dmap-stage"
      />
      {queryService && opts.config ? (
        <ChartLayer
          root={stage.root}
          cells={stage.index}
          plan={plan}
          service={queryService}
          viewport={viewport}
          owner={`panel:${id}`}
          revision={`${viewKey}|${stageHeight}${JSON.stringify(view)}`}
          replaceVariables={replaceVariables}
          paused={paused}
        />
      ) : null}
      {stage.error ? <div className={styles.empty}>{stage.error}</div> : null}
      <div
        ref={corner}
        className={styles.corner}
        style={{ left: 4, top: band.height + 4, maxHeight: `calc(100% - ${band.height + 8}px)` }}
        data-testid="dmap-corner"
      >
        {panZoom.zoomed || warnings.length || editing ? (
          <div className={styles.cornerRow}>
            {panZoom.zoomed ? (
              <IconButton
                name="search-minus"
                size="lg"
                tooltip="Reset zoom"
                tooltipPlacement="right"
                className={styles.reset}
                style={{
                  background: theme.colors.background.primary,
                  border: `1px solid ${theme.colors.border.medium}`,
                }}
                data-testid="dmap-reset-zoom"
                onClick={resetView}
              />
            ) : null}
            {warnings.length ? (
              editing ? (
                <button
                  type="button"
                  className={cx(styles.badge, styles.badgeButton)}
                  style={{ background: theme.colors.warning.main, color: theme.colors.warning.contrastText }}
                  title={warnings.join('\n')}
                  data-testid="dmap-warning-badge"
                  onClick={() =>
                    openBindings(
                      result.diagnostics[0] ? { kind: 'problem', path: result.diagnostics[0].path } : { kind: 'none' }
                    )
                  }
                >
                  {warnings.length} warning{warnings.length > 1 ? 's' : ''}
                </button>
              ) : (
                <div
                  className={styles.badge}
                  style={{ background: theme.colors.warning.main, color: theme.colors.warning.contrastText }}
                  title={warnings.join('\n')}
                  data-testid="dmap-warning-badge"
                >
                  {warnings.length} warning{warnings.length > 1 ? 's' : ''}
                </div>
              )
            ) : null}
            {editing ? (
              <IconButton
                name="link"
                size="lg"
                tooltip="Edit bindings"
                tooltipPlacement="right"
                className={styles.reset}
                style={{
                  background: theme.colors.background.primary,
                  border: `1px solid ${theme.colors.border.medium}`,
                }}
                data-testid="dmap-edit-bindings"
                onClick={() => openBindings({ kind: 'none' })}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {legend}
      {open && model && card
        ? portalSheet(
            <div ref={cardRef}>
              <Card
                key={`${card.cellId}:${pinned}`}
                model={model}
                cellId={card.cellId}
                pinned={pinned}
                x={card.x}
                y={card.y}
                width={width}
                height={height}
                anchor={wrapperEl}
                timeRange={timeRange}
                timeZone={timeZone}
                onClose={close}
                pointerRef={pointerRef}
                moveRef={moveCard}
              />
            </div>,
            width < SHEET_BELOW
          )
        : null}
    </div>
  );
}, bothPaused);
