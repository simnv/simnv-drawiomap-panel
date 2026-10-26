import { createPortal } from 'react-dom';
import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { css, cx } from '@emotion/css';
import { PanelProps } from '@grafana/data';
import { IconButton, useTheme2 } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { bindPlan } from '../binding/engine';
import { bindContextFor, cardContextFor } from '../binding/context';
import { resolvePatterns } from '../binding/patterns';
import { buildConfiguredCard, opensCard } from '../interact/cardModel';
import { Card, SHEET_BELOW } from '../interact/Card';
import { hoverKind, interactiveCells, patchAt } from '../interact/hit';
import { applyPatches, type Applied, INTERACTIVE_ATTR, type Marked, markInteractive } from '../render/applier';
import { renderLinkLabels, setLinkLabelScale, watchLinkLabelFonts } from '../render/linkLabels';
import { renderOverlay } from '../render/overlay';
import { cellMetas } from '../render/svgStage';
import { applyLayout, viewBoxFor, ViewBox } from '../render/zoom';
import { DEFAULT_OPTIONS, Options, type CellPatch, type LegendCorner } from '../types';
import { usePanZoom } from './usePanZoom';
import { useStage } from './useStage';
import { useHeld } from './useHeld';
import { PanelQueryContext, PanelQueryProvider, type PanelQueryService } from '../query/panel';
import { EMPTY_CONFIG } from '../editor/draft';
import { legacyRulesWarning } from '../model/config';
import { currentAddress, subscribe, type PopupTarget } from '../editor/popup/popupBus';
import { LazyBindingsPopup } from './LazyBindingsPopup';
import { useStaleStatus } from '../visuals/useSampleStale';
import { useOsDark } from '../visuals/useOsDark';
import { demandMap, demandsOf, resolverFrom } from '../query/store';
import { useBindings } from '../query/useBindings';
import { ChartLayer } from '../visuals/ChartLayer';
import { bandLayout, StatusBand } from './StatusBand';
import { Legend } from '../legend/Legend';
import { buildLegend } from '../legend/model';
import { highlightCells, LEGEND_ACTIVE, LEGEND_HIT, LEGEND_MEMBER } from '../legend/highlight';
import { bindSymbolLegend, LEGEND_ROW_ATTR, type RowMarks } from '../legend/symbolRows';

/**
 * Height in px that the top-right corner keeps free for the Grafana panel menu button. A panel without a title
 * has a hover header: its menu button is 24 px high, 3 px below the top edge of the panel.
 */
const MENU_CLEARANCE = 32;
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
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    zoom: { ...DEFAULT_OPTIONS.zoom, ...options.zoom },
    linkWidth: { ...DEFAULT_OPTIONS.linkWidth, ...options.linkWidth },
    summary: { ...DEFAULT_OPTIONS.summary!, ...options.summary },
    hover: { ...DEFAULT_OPTIONS.hover!, ...options.hover },
    legend: { ...DEFAULT_OPTIONS.legend!, ...options.legend },
  };
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const attachStage = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    setViewport(element);
  }, []);
  const stage = useStage(containerRef, opts.diagram?.svg, opts.diagram?.hash);
  const patchedRef = useRef<Applied>();
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
  const plan = useMemo(
    () => resolvePatterns(cellMetas(stage.index), opts.config ?? EMPTY_CONFIG),
    [stage.index, opts.config]
  );
  // The visible bindings and the rows of the open card are two groups of the store with one owner. A hover over a
  // new cell changes the card frame only: the resolver of the diagram, the bind and the patches do not run again.
  const queryContext = queryService?.context;
  const maxDataPoints = Math.max(1, Math.min(264, width - 16));
  const visibleDemands = useMemo(
    () => demandsOf(plan, queryContext, maxDataPoints, 'visible'),
    [plan, queryContext, maxDataPoints]
  );
  const visible = useBindings(queryService, `panel:${id}`, 'visible', visibleDemands, paused);
  const openCellId = card?.cellId;
  const cardDemands = useMemo(
    () => demandsOf(plan, queryContext, maxDataPoints, 'hover', openCellId),
    [plan, queryContext, maxDataPoints, openCellId]
  );
  const cardFrame = useBindings(queryService, `panel:${id}`, 'card', cardDemands, paused);
  const format = useMemo(() => ({ theme, timeZone }), [theme, timeZone]);
  const visibleMap = useMemo(() => demandMap(visibleDemands), [visibleDemands]);
  const resolve = useMemo(
    () => resolverFrom([visible], visibleMap, plan, data, format),
    [visible, visibleMap, plan, data, format]
  );
  // The card reads its own entries first, then the visible ones: a row that reads the query of the link has its data
  // on the first render, before the card group watches.
  const cardMap = useMemo(() => demandMap(cardDemands, visibleDemands), [cardDemands, visibleDemands]);
  const cardResolve = useMemo(
    () => (cardDemands.length ? resolverFrom([cardFrame, visible], cardMap, plan, data, format) : resolve),
    [cardDemands.length, cardFrame, visible, cardMap, plan, data, format, resolve]
  );
  // The bind takes no clock: a tick of the freshness clock runs the pass over the patches, never the bind.
  const bound = useMemo(() => bindPlan(plan, resolve, bindingContext), [plan, resolve, bindingContext]);
  const shown = useStaleStatus(bound);
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
  const cardContext = useMemo(
    () => cardContextFor({ theme, replaceVariables, fieldThresholds: fieldConfig.defaults.thresholds }),
    [theme, replaceVariables, fieldConfig.defaults.thresholds]
  );
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
  const [legendHits, setLegendHits] = useState<string[] | null>(null);
  // Opening the popup also ends the legend highlight.
  if (paused && legendHits) {
    setLegendHits(null);
  }
  // The marks of a legend row inside the diagram (portograph rows with a symbol). They come before the panel legend.
  const [rowMarks, setRowMarks] = useState<RowMarks | null>(null);
  if (paused && rowMarks) {
    setRowMarks(null);
  }
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

  // draw.io writes color-scheme: light dark on the root, so light-dark() colours follow the OS preference.
  // Override it with the Grafana theme.
  const isDark = theme.isDark;
  useLayoutEffect(() => {
    const root = containerRef.current?.querySelector<SVGSVGElement>(':scope > svg');
    if (root) {
      root.style.colorScheme = isDark ? 'dark' : 'light';
    }
  }, [stage.root, isDark]);

  // Apply patches, redraw the overlay and the value labels once per frame. The OS preference is an input of the
  // applier's colour scheme: a change of it writes every cell again (an element with its own color-scheme follows it).
  const osDark = useOsDark();
  const { min: linkMin, max: linkMax } = opts.linkWidth;
  useEffect(() => {
    if (!stage.root) {
      return;
    }
    const root = stage.root;
    const linkWidth = { min: linkMin, max: linkMax };
    const id = requestAnimationFrame(() => {
      const ctx = { theme, osDark };
      patchedRef.current = applyPatches(stage.index, result.patches, patchedRef.current, interactive, ctx);
      interactiveRef.current = markInteractive(stage.index, interactive, interactiveRef.current);
      renderOverlay(root, stage.index, result.patches, { theme });
      // after the overlay: its arrow heads are obstacles of the labels
      renderLinkLabels(root, stage.index, result.patches, { theme, linkWidth, bounds: stage.base });
    });
    return () => cancelAnimationFrame(id);
  }, [stage.root, stage.index, stage.base, result, theme, osDark, interactive, linkMin, linkMax]);

  // After the patches (the same frame order): mark the cells of the legend entry under the pointer.
  const hits = legendBlocks.length ? legendHits : null;
  useEffect(() => {
    if (!stage.root) {
      return;
    }
    const root = stage.root;
    const id = requestAnimationFrame(() =>
      rowMarks
        ? highlightCells(root, stage.index, rowMarks.members, rowMarks.hits)
        : highlightCells(root, stage.index, legendMembers, hits)
    );
    return () => cancelAnimationFrame(id);
  }, [stage.root, stage.index, legendMembers, hits, rowMarks, result]);

  // The legend rows of the diagram: a row with a symbol marks the nodes of that symbol.
  useEffect(
    () => (stage.root ? bindSymbolLegend(stage.root, stage.index, setRowMarks) : undefined),
    [stage.root, stage.index]
  );

  // A web font that loads late widens the glyphs: cut the strokes under the labels again.
  useEffect(() => (stage.root ? watchLinkLabelFonts(stage.root) : undefined), [stage.root]);

  // Zoom layout.
  useEffect(() => {
    if (!stage.root || !stage.base) {
      return;
    }
    const layout = viewBoxFor(
      { ...DEFAULT_OPTIONS.zoom, mode: zoomMode, percent: zoomPercent, align, minScale },
      stage.base,
      { width, height: stageHeight },
      view ?? stage.base
    );
    applyLayout(stage.root, layout);
    setLinkLabelScale(stage.root);
    if (containerRef.current) {
      containerRef.current.style.overflow = layout.overflow;
    }
  }, [stage.root, stage.base, zoomMode, zoomPercent, align, minScale, width, stageHeight, view]);

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
  // The start place of the legend (the user can drag it): the top-left legend is below the reset button and the
  // warning badge. The top-right legend starts below the area of the Grafana panel menu button.
  // On a narrow panel the open legend can reach the left side: it goes below the row of the reset button and the badge.
  const rowHeight = panZoom.zoomed || editing ? RESET_SIZE : warnings.length ? BADGE_HEIGHT : 0;
  const topRightLegendTop =
    width < SHEET_BELOW && rowHeight ? band.height + 4 + rowHeight + 4 : Math.max(band.height + 4, MENU_CLEARANCE);
  const corners: Partial<Record<LegendCorner, React.CSSProperties>> = {
    'top-left': { left: 4, top: band.height + 4 + (rowHeight ? rowHeight + 4 : 0) },
    'top-right': { right: 4, top: topRightLegendTop },
    'bottom-left': { left: 4, bottom: 4 },
    'bottom-right': { right: 4, bottom: 4 },
  };
  const legendCorner: LegendCorner = corners[legendOptions.corner] ? legendOptions.corner : 'bottom-right';
  const legend = legendOptions.show ? (
    <Legend
      ref={legendRef}
      blocks={legendBlocks}
      maxBlocks={legendOptions.maxBlocks}
      collapsed={legendOptions.collapsed}
      onHighlight={setLegendHits}
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
