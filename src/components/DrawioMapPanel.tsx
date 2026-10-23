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
import { css } from '@emotion/css';
import { getDisplayProcessor, PanelProps } from '@grafana/data';
import { IconButton, useTheme2 } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { bind, bindPlan } from '../binding/engine';
import { resolvePatterns } from '../binding/patterns';
import { extractSeries } from '../binding/series';
import { buildCard, buildConfiguredCard, DisplayOverride, opensCard } from '../interact/cardModel';
import { Card, SHEET_BELOW } from '../interact/Card';
import { hoverKind, interactiveCells, patchAt } from '../interact/hit';
import { applyPatches, INTERACTIVE_ATTR, markInteractive } from '../render/applier';
import { renderOverlay } from '../render/overlay';
import { cellMetas } from '../render/svgStage';
import { applyLayout, viewBoxFor, ViewBox } from '../render/zoom';
import { DEFAULT_OPTIONS, Options, SeriesInfo, type CellPatch, type Diagram, type LegendCorner } from '../types';
import { usePanZoom } from './usePanZoom';
import { useStage } from './useStage';
import { PanelQueryContext, PanelQueryProvider } from '../query/panel';
import { BindingEditor } from '../editor/BindingEditor';
import { EMPTY_CONFIG } from '../editor/draft';
import type { DiagramConfigV2 } from '../model/config';
import type { PatternPreview } from '../editor/patternPreview';
import { createPreviewResolver, statusDeadlines, usePreviewTime, type QueryPreview } from '../editor/preview';
import { useBindingSnapshots } from '../visuals/useBindingSnapshots';
import { ChartLayer } from '../visuals/ChartLayer';
import type { StatusSummary } from '../binding/status';
import { bandLayout, StatusBand } from './StatusBand';
import { Legend } from '../legend/Legend';
import { buildLegend } from '../legend/model';
import { highlightCells, LEGEND_ACTIVE, LEGEND_HIT, LEGEND_MEMBER } from '../legend/highlight';

/**
 * Height in px that the top-right corner keeps free for the Grafana panel menu button. A panel without a title
 * has a hover header: its menu button is 24 px high, 3 px below the top edge of the panel.
 */
const MENU_CLEARANCE = 32;
/** Heights in px of the items in the top-left row. */
const RESET_SIZE = 32;
const BADGE_HEIGHT = 20;

function usePanelEditing(id: number) {
  const subscribe = useCallback((notify: () => void) => {
    const sub = locationService?.getLocationObservable().subscribe(notify);
    return () => sub?.unsubscribe();
  }, []);
  const editPanel = useSyncExternalStore(subscribe, () => String(locationService?.getSearchObject().editPanel ?? ''));
  return editPanel === String(id);
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
    z-index: 1;
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
  return (
    <PanelQueryProvider
      data={props.data}
      timeRange={props.timeRange}
      timeZone={props.timeZone}
      replaceVariables={props.replaceVariables}
      defaultDatasource={props.options.config?.defaultDatasource}
    >
      {/* Sandbox hosts do not provide a definite percentage-height containing block. */}
      <div style={{ width: props.width, height: props.height }}>
        <DrawioMapPanelView {...props} />
      </div>
    </PanelQueryProvider>
  );
}

function DrawioMapPanelView({
  id,
  options,
  data,
  width,
  height,
  fieldConfig,
  replaceVariables,
  timeZone,
  timeRange,
  onOptionsChange,
}: PanelProps<Options>) {
  const theme = useTheme2();
  const editing = usePanelEditing(id);
  const savedRevision = `${options.diagram?.hash}:${JSON.stringify(options.config)}`;
  const [draftConfig, setDraftConfig] = useState<{ base: string; config: DiagramConfigV2 }>();
  const [draftDiagram, setDraftDiagram] = useState<{ base: string; diagram: Diagram }>();
  const [patternPreview, setPatternPreview] = useState<PatternPreview>();
  const [queryPreview, setQueryPreview] = useState<QueryPreview>();
  const [wasEditing, setWasEditing] = useState(editing);
  if (wasEditing !== editing) {
    setWasEditing(editing);
    setDraftConfig(undefined);
    setDraftDiagram(undefined);
    setQueryPreview(undefined);
    setPatternPreview(undefined);
  }
  const previewConfig = useCallback(
    (config: DiagramConfigV2) => setDraftConfig({ base: savedRevision, config }),
    [savedRevision]
  );
  const previewDiagram = useCallback(
    (diagram: Diagram) => setDraftDiagram({ base: savedRevision, diagram }),
    [savedRevision]
  );
  const queryService = useContext(PanelQueryContext);
  const inspectorWidth = Math.min(420, Math.max(240, width * 0.4));
  const stageWidth = editing ? Math.max(1, width - inspectorWidth) : width;
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    config: editing && draftConfig?.base === savedRevision ? draftConfig.config : options.config,
    diagram: editing && draftDiagram?.base === savedRevision ? draftDiagram.diagram : options.diagram,
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
  const patchedRef = useRef<Set<string>>(new Set());
  const interactiveRef = useRef<Set<string>>(new Set());
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

  const series = useMemo(() => extractSeries(data.series), [data.series]);
  // Grafana attaches field.display (effective config incl. overrides) to panel data; fall back for tests.
  const display = useCallback(
    (s: SeriesInfo, v: number) => (s.field.display ?? getDisplayProcessor({ field: s.field, theme, timeZone }))(v),
    [theme, timeZone]
  );
  const bindingContext = useMemo(
    () => ({
      theme,
      fieldThresholds: fieldConfig.defaults.thresholds,
      replaceVariables,
      display,
      linkWidth: { min: opts.linkWidth.min, max: opts.linkWidth.max },
    }),
    [theme, fieldConfig.defaults.thresholds, replaceVariables, display, opts.linkWidth.min, opts.linkWidth.max]
  );
  const plan = useMemo(
    () => resolvePatterns(cellMetas(stage.index), opts.config ?? EMPTY_CONFIG),
    [stage.index, opts.config]
  );
  const savedPlan = useMemo(
    () => resolvePatterns(cellMetas(stage.index), options.config ?? EMPTY_CONFIG),
    [stage.index, options.config]
  );
  // Prepared chart results belong to the current saved plan, stage and query service only.
  const chartOwner = useMemo(
    () => ({ plan: savedPlan, root: stage.root, context: queryService?.context, controller: queryService?.controller }),
    [savedPlan, stage.root, queryService?.context, queryService?.controller]
  );
  const [chartResults, setChartResults] = useState<{ owner: object; values: Record<string, QueryPreview> }>();
  if (chartResults && chartResults.owner !== chartOwner) {
    setChartResults(undefined);
  }
  const onChartPrepared = useCallback(
    (id: string, preview?: QueryPreview) => {
      setChartResults((previous) => {
        const values = previous?.owner === chartOwner ? { ...previous.values } : {};
        if (preview) {
          values[id] = preview;
        } else {
          if (previous?.owner !== chartOwner || !values[id]) {
            return previous;
          }
          delete values[id];
        }
        return { owner: chartOwner, values };
      });
    },
    [chartOwner]
  );
  const chartSnapshots = useMemo(
    () => Object.values(chartResults?.owner === chartOwner ? chartResults.values : {}),
    [chartResults, chartOwner]
  );
  const bindingSnapshots = useBindingSnapshots(
    savedPlan,
    options.config ?? EMPTY_CONFIG,
    queryService,
    editing ? undefined : card?.cellId,
    Math.max(1, Math.min(264, width - 16)),
    chartSnapshots
  );
  const activeSnapshots = useMemo(() => [...bindingSnapshots, ...chartSnapshots], [bindingSnapshots, chartSnapshots]);
  const patternSnapshots = useMemo(
    () =>
      patternPreview && patternPreview.config === opts.config && patternPreview.context === queryService?.context
        ? patternPreview.previews
        : [],
    [patternPreview, opts.config, queryService?.context]
  );
  const resolve = useMemo(
    () =>
      createPreviewResolver(
        plan,
        opts.config ?? EMPTY_CONFIG,
        data,
        queryPreview,
        {
          theme,
          timeZone,
          generation: queryService?.context.generation,
        },
        [...patternSnapshots, ...activeSnapshots]
      ),
    [
      plan,
      opts.config,
      data,
      queryPreview,
      theme,
      timeZone,
      queryService?.context.generation,
      activeSnapshots,
      patternSnapshots,
    ]
  );
  const nowMs = usePreviewTime(
    data,
    queryService?.context.generation,
    queryPreview?.snapshot,
    [...patternSnapshots, ...activeSnapshots].map((value) => value.snapshot),
    statusDeadlines(plan, resolve)
  );
  const result = useMemo(() => {
    if (opts.config) {
      const bound = bindPlan(plan, resolve, bindingContext, nowMs);
      return {
        patches: bound.patches,
        warnings: bound.diagnostics.map((d) => `${d.path}: ${d.message}`),
        summaries: bound.summaries,
      };
    }
    const summaries: StatusSummary[] = [];
    return { ...bind(opts.rules ?? [], cellMetas(stage.index), series, bindingContext), summaries };
  }, [opts.config, opts.rules, plan, resolve, bindingContext, nowMs, stage.index, series]);

  // The status band takes its height from the panel; the stage gets the rest.
  const [bandExpanded, setBandExpanded] = useState(false);
  const band = bandLayout(result.summaries.length, opts.summary.maxRows, bandExpanded, height);
  const stageHeight = Math.max(1, height - band.height);
  const bandRef = useRef<HTMLElement>(null);

  // The card resolves its rows only for the open cell. A data refresh updates it in place.
  const cardPatch = !editing && card ? result.patches.get(card.cellId) : undefined;
  if (card && !cardPatch) {
    // the rules or the diagram changed and the cell has no patch now
    setCard(null);
  }
  const cardContext = useMemo(() => {
    const displayFor = (s: SeriesInfo, v: number, o?: DisplayOverride) => {
      if (!o) {
        return display(s, v);
      }
      const config = { ...s.field.config };
      if (o.unit !== undefined) {
        config.unit = o.unit;
      }
      if (o.decimals !== undefined) {
        config.decimals = o.decimals;
      }
      return getDisplayProcessor({ field: { ...s.field, config }, theme, timeZone })(v);
    };
    return { series, theme, display: displayFor, replaceVariables, fieldThresholds: fieldConfig.defaults.thresholds };
  }, [series, theme, timeZone, display, replaceVariables, fieldConfig.defaults.thresholds]);
  const configured = !!opts.config;
  const model = useMemo(() => {
    if (!cardPatch) {
      return undefined;
    }
    return configured ? buildConfiguredCard(cardPatch, resolve, cardContext) : buildCard(cardPatch, cardContext);
  }, [cardPatch, configured, resolve, cardContext]);
  // Only the cell kinds of the Hover kinds option open a card (the canvas, groups and the legend do not by default),
  // and only when the card has rows or links. Computed once per data update: these cells get the hand cursor.
  const hoverKinds = opts.hover.kinds;
  const interactive = useMemo(
    () =>
      interactiveCells(result.patches, stage.index, (p) => {
        const entry = stage.index.get(p.cellId);
        return !!entry && hoverKinds.includes(hoverKind(entry)) && opensCard(p, configured, cardContext);
      }),
    [result.patches, stage.index, hoverKinds, configured, cardContext]
  );
  const cardable = (p: CellPatch) => interactive.has(p.cellId);

  // The colour legend: the scales of the bound cells. A legend entry under the pointer highlights its cells.
  const legendOptions = opts.legend;
  const queries = opts.config?.queries;
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

  // Apply patches and redraw the overlay once per frame.
  useEffect(() => {
    if (!stage.root) {
      return;
    }
    const root = stage.root;
    const id = requestAnimationFrame(() => {
      patchedRef.current = applyPatches(stage.index, result.patches, patchedRef.current, interactive);
      interactiveRef.current = markInteractive(stage.index, interactive, interactiveRef.current);
      renderOverlay(root, stage.index, result.patches, { theme });
    });
    return () => cancelAnimationFrame(id);
  }, [stage.root, stage.index, result, theme, editing, interactive]);

  // After the patches (the same frame order): mark the cells of the legend entry under the pointer.
  const hits = legendBlocks.length ? legendHits : null;
  useEffect(() => {
    if (!stage.root) {
      return;
    }
    const root = stage.root;
    const id = requestAnimationFrame(() => highlightCells(root, stage.index, legendMembers, hits));
    return () => cancelAnimationFrame(id);
  }, [stage.root, stage.index, legendMembers, hits, result]);

  // Zoom layout.
  useEffect(() => {
    if (!stage.root || !stage.base) {
      return;
    }
    const layout = viewBoxFor(
      { ...DEFAULT_OPTIONS.zoom, mode: zoomMode, percent: zoomPercent, align, minScale },
      stage.base,
      { width: stageWidth, height: stageHeight },
      view ?? stage.base
    );
    applyLayout(stage.root, layout);
    if (containerRef.current) {
      containerRef.current.style.overflow = layout.overflow;
    }
  }, [stage.root, stage.base, zoomMode, zoomPercent, align, minScale, stageWidth, stageHeight, view]);

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
    if (editing) {
      if (panZoom.takeClick()) {
        e.stopPropagation();
      }
      return;
    }
    const stageEl = containerRef.current;
    // a drag that moved the view is not a click
    if (
      panZoom.takeClick() ||
      inCard(e.target) ||
      corner.current?.contains(e.target as Node) ||
      bandRef.current?.contains(e.target as Node) ||
      legendRef.current?.contains(e.target as Node) ||
      !stageEl
    ) {
      return;
    }
    const patch = patchAt(e.target, stageEl, result.patches, stage.index, cardable);
    opener.current = null;
    setCard(patch ? { cellId: patch.cellId, ...local(e), pinned: true } : null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) {
      return;
    }
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
  const onPointerMove = (e: React.PointerEvent) => {
    if (editing) {
      return;
    }
    // Hover is for a mouse or a pen. A pinned card stays until the user closes it or pins another cell.
    const stageEl = containerRef.current;
    if (e.pointerType === 'touch' || !canHover() || pinned || panZoom.busy() || !stageEl) {
      return;
    }
    const patch = patchAt(e.target, stageEl, result.patches, stage.index, cardable);
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
  const rowHeight = panZoom.zoomed ? RESET_SIZE : warnings.length ? BADGE_HEIGHT : 0;
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

  const preview = (
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
          plan={savedPlan}
          queries={options.config?.queries ?? []}
          controller={queryService.controller}
          context={queryService.context}
          viewport={viewport}
          revision={`${viewKey}|${stageHeight}${JSON.stringify(view)}`}
          replaceVariables={replaceVariables}
          onPrepared={onChartPrepared}
          draft={
            editing
              ? {
                  plan,
                  queries: opts.config.queries,
                  defaultDatasource: opts.config.defaultDatasource,
                  data,
                  preview: queryPreview,
                  active: [...patternSnapshots, ...activeSnapshots],
                }
              : undefined
          }
        />
      ) : null}
      {stage.error ? <div className={styles.empty}>{stage.error}</div> : null}
      <div
        ref={corner}
        className={styles.corner}
        style={{ left: 4, top: band.height + 4, maxHeight: `calc(100% - ${band.height + 8}px)` }}
        data-testid="dmap-corner"
      >
        {panZoom.zoomed || warnings.length ? (
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
              <div
                className={styles.badge}
                style={{ background: theme.colors.warning.main, color: theme.colors.warning.contrastText }}
                title={warnings.join('\n')}
                data-testid="dmap-warning-badge"
              >
                {warnings.length} warning{warnings.length > 1 ? 's' : ''}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {legend}
      {open && model && card
        ? portalSheet(
            <div ref={cardRef}>
              <Card
                model={model}
                pinned={pinned}
                x={card.x}
                y={card.y}
                width={width}
                height={height}
                anchor={wrapperEl}
                timeRange={timeRange}
                timeZone={timeZone}
                onClose={close}
              />
            </div>,
            width < SHEET_BELOW
          )
        : null}
    </div>
  );
  return editing ? (
    <BindingEditor
      key={savedRevision}
      config={options.config ?? EMPTY_CONFIG}
      cells={stage.index}
      data={data}
      inspectorWidth={inspectorWidth}
      onPreview={previewConfig}
      onQueryPreview={setQueryPreview}
      onPatternPreview={setPatternPreview}
      prepared={activeSnapshots}
      bindContext={bindingContext}
      diagram={options.diagram}
      onDiagramPreview={previewDiagram}
      onSave={(config, diagram) => onOptionsChange({ ...options, config, diagram: diagram ?? options.diagram })}
    >
      {preview}
    </BindingEditor>
  ) : (
    preview
  );
}
