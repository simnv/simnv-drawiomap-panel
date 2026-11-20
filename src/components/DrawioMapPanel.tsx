import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { css } from '@emotion/css';
import type { Field, PanelProps } from '@grafana/data';
import { getDataSourceSrv, locationService } from '@grafana/runtime';
import type { DataSourceRef } from '@grafana/schema';
import { useTheme2 } from '@grafana/ui';
import { bindContextFor } from '../binding/context';
import type { BindResultV4 } from '../binding/bindV4';
import { buildCardV4, opensCard } from '../interact/cardModel';
import { CardHost, hasContent } from '../interact/CardHost';
import { pinnedCellOf } from '../interact/cardState';
import { hoverKind } from '../adapter/portograph';
import { interactiveCells } from '../interact/hit';
import { NEAR_ATTR, useCardInput, useCardState } from '../interact/useCardState';
import {
  CHART_LAYER_ATTR,
  FOCUS_ACTIVE,
  FOCUS_HIDDEN_ATTR,
  FOCUS_KEPT,
  FOCUS_LAYER,
  FOCUS_SCRIM,
  focusMap,
} from '../render/linkFocus';
import { endContextOf } from '../binding/edgeEnds';
import { INTERACTIVE_ATTR, type Marked, markInteractive } from '../render/applier';
import type { ViewBox } from '../render/zoom';
import {
  DEFAULT_OPTIONS,
  Options,
  withDefaults,
  type CellPatch,
  type LegendCorner,
  type LinkWidthOptions,
} from '../types';
import { usePanZoom } from '../stage/usePanZoom';
import { CellFocusRing, FOCUSABLE_CELL } from '../stage/CellFocusRing';
import { DEFER_ABOVE, useStage } from '../stage/useStage';
import { useStageLayout } from '../stage/useStageLayout';
import { useStagePaint } from '../stage/useStagePaint';
import { useBoundDiagram } from '../stage/useBoundDiagram';
import { groupReport, reportGroupLine } from '../stage/reportView';
import {
  describeQueries,
  failedLabels,
  failedQueries,
  failureText,
  groupQueryFailures,
  otherEntries,
} from '../stage/queryFailures';
import { ChartLayer, chartUsesV4 } from '../visuals/ChartLayer';
import { inPortalControl } from '../visuals/ChartHover';
import { bandLayout, bandRowsV4, StatusBand } from './StatusBand';
import { useFollowViewport } from '../util/followViewport';
import { legendCorners } from './legendCorners';
import { LastDataStamp } from './LastDataStamp';
import { lastSampleTime } from '../query/frames';
import { panelStaleColor } from '../binding/color';
import { linkWidthRange } from '../binding/linkWidth';
import type { Box } from '../legend/position';
import { useShiftHeld } from '../interact/useShiftHeld';
import { canFitGridHeight, fitGridHeight, freeRows, useDashboardEditing } from '../stage/gridHeight';
import { CornerControls, cornerRowHeight } from './CornerControls';
import { Legend } from '../legend/Legend';
import { buildLegendV4 } from '../legend/model';
import { highlightCells, LEGEND_ACTIVE, LEGEND_HIT, LEGEND_MEMBER } from '../legend/highlight';
import { bindSymbolLegend } from '../legend/symbolRows';
import { createHighlightStore } from '../legend/highlightStore';
import { currentAddress, subscribe } from '../editor/popup/popupBus';
import { LazyBindingsPopup } from './LazyBindingsPopup';

/** True while the dashboard shows one panel full size (View panel): the panel has the size of the screen. */
function useViewPanel(): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const sub = locationService?.getLocationObservable().subscribe(notify);
    return () => sub?.unsubscribe();
  }, []);
  return useSyncExternalStore(subscribe, () => !!locationService?.getSearchObject().viewPanel);
}

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
    /* the chart regions (ChartLayer) place themselves in the stage */
    position: relative;
    & > svg {
      display: block;
    }
    /* The outline of a cell group takes the box of the group, the whole viewport with a draw.io HTML label: the focus
       ring is CellFocusRing, on the painted box. */
    & ${FOCUSABLE_CELL} {
      outline: none;
    }
    /* Only cells that open a card show the hand cursor. Other cells keep the parent cursor. */
    & [data-cell-id][role='button']:not([${INTERACTIVE_ATTR}]) {
      cursor: inherit;
    }
    & [${INTERACTIVE_ATTR}],
    &[${NEAR_ATTR}] {
      cursor: pointer;
    }
    /* A link under or near the pointer: one scrim dims the diagram, copies of the link and its ends lie above it. */
    & .${FOCUS_LAYER} {
      display: none;
    }
    & svg.${FOCUS_ACTIVE} > .${FOCUS_LAYER} {
      display: inline;
    }
    /* the Hover focus mode and Shift hide the focus (an attribute of the panel wrapper): the diagram shows as it is */
    [${FOCUS_HIDDEN_ATTR}] & svg.${FOCUS_ACTIVE} > .${FOCUS_LAYER} {
      display: none;
    }
    /* the chart regions are HTML over the svg: they fade with the scrim, except the charts of the kept cells */
    & svg.${FOCUS_ACTIVE} ~ [${CHART_LAYER_ATTR}] [data-dmap-chart]:not(.${FOCUS_KEPT}) {
      opacity: 0.25;
    }
    [${FOCUS_HIDDEN_ATTR}] & svg.${FOCUS_ACTIVE} ~ [${CHART_LAYER_ATTR}] [data-dmap-chart] {
      opacity: 1;
    }
    /* the copies above the scrim take no pointer: the hover and the click hit the cells below. The copies inherit it
       (linkFocus copyOf removes their own pointer-events); a rule for each element of the layer would be a selector
       that the browser tests on each element of the stage */
    & .${FOCUS_LAYER} {
      pointer-events: none !important;
    }
    & .${FOCUS_SCRIM} {
      fill: var(--dmap-scrim);
      fill-opacity: 0.75;
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
};

/** The name of a datasource from the datasource service of Grafana; undefined when the service does not know it. */
function datasourceName(ref: DataSourceRef | string): string | undefined {
  try {
    return getDataSourceSrv().getInstanceSettings(ref)?.name;
  } catch {
    // no datasource service (a test host)
    return undefined;
  }
}

/** The warning of the saved rules of version 1: the panel does not read them. */
function legacyRulesWarning(count: number): string {
  return `The panel ignores ${count} rule${count === 1 ? '' : 's'} of version 1. Write the bindings again as a version 4 config.`;
}

/**
 * The field of each status refId, from the first series that a status use selects: the legend takes the title and
 * the scale of a refId from it (`buildLegendV4`).
 */
function statusFields(bound: BindResultV4): Map<string, Field> {
  const fields = new Map<string, Field>();
  for (const [cellId, uses] of bound.uses) {
    for (const use of uses) {
      if (use.kind === 'status' && !fields.has(use.refId)) {
        const first = bound.series.get(cellId)?.get(use.path)?.[0];
        if (first) {
          fields.set(use.refId, first.field);
        }
      }
    }
  }
  return fields;
}

export function DrawioMapPanel(props: PanelProps<Options>) {
  const session = usePanelEditing(props.id);
  const editing = session !== '';
  const [popup, setPopup] = useState(false);
  // LazyBindingsPopup reads the opener in the render of this state change and gives it the focus back on close.
  const openPopup = useCallback(() => setPopup(true), []);
  // The popup lives as long as the edit session of this panel: leaving panel edit (navigation, "Back to dashboard",
  // browser back) or unmounting drops it with its draft, also while its chunk still loads.
  // A change of the address (another dashboard, another panel id) is a new session too: the draft is dropped.
  const [wasSession, setWasSession] = useState(session);
  if (wasSession !== session) {
    setWasSession(session);
    setPopup(false);
  }
  // The "Edit bindings" button of the options pane asks for the popup through the addressed bus.
  useEffect(() => {
    if (!editing) {
      return;
    }
    return subscribe(currentAddress(), openPopup);
    // The session is the address: a new one subscribes again.
  }, [session, editing, openPopup]);
  const closePopup = useCallback(() => setPopup(false), []);
  // Sandbox hosts do not provide a definite percentage-height containing block.
  return (
    <>
      <div style={{ width: props.width, height: props.height }}>
        <DrawioMapPanelView {...props} editing={editing} onEditBindings={openPopup} />
      </div>
      {editing && popup ? (
        <LazyBindingsPopup
          options={props.options}
          data={props.data}
          timeZone={props.timeZone}
          fieldConfig={props.fieldConfig}
          replaceVariables={props.replaceVariables}
          onOptionsChange={props.onOptionsChange}
          onClose={closePopup}
        />
      ) : null}
    </>
  );
}

interface ViewProps extends PanelProps<Options> {
  /** The panel is open in the panel editor: the corner shows the "Edit bindings" button. */
  editing: boolean;
  onEditBindings: () => void;
}

function DrawioMapPanelView(props: ViewProps) {
  const { options, data, width, height, fieldConfig, replaceVariables, timeZone, timeRange, editing } = props;
  const theme = useTheme2();
  const opts = withDefaults(options);
  // The **Stale colour** option: a Grafana colour name (it follows the theme) or a CSS colour.
  const staleColor = panelStaleColor(theme, opts.stale?.color);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const attachStage = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    setViewport(element);
  }, []);
  const stage = useStage(containerRef, opts.diagram?.svg, DEFER_ABOVE);
  const interactiveRef = useRef<Marked>();
  const cards = useCardState();
  const { store: cardStore, dispatch } = cards;
  const [view, setView] = useState<ViewBox | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const attachWrapper = useCallback((element: HTMLDivElement | null) => {
    wrapperRef.current = element;
    setWrapperEl(element);
  }, []);
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
    // the card host renders in this pass too and reads the dropped state. Limit: if React throws this render away (a
    // transition, Suspense), the state is dropped already and the shown card stays until the next notify or render.
    cardStore.adjust({ type: 'diagram-changed' });
  }
  // A new panel size or a new zoom option resets the live view to the configured view.
  const viewKey = `${width}x${height}|${zoomMode}|${zoomPercent}|${align}|${minScale}`;
  const [lastViewKey, setLastViewKey] = useState(viewKey);
  if (lastViewKey !== viewKey) {
    setLastViewKey(viewKey);
    setView(null);
  }

  // the width options by value: a new options object with the same widths binds nothing again (the tiers array
  // keeps its identity until the option changes)
  const linkWidth = useMemo<LinkWidthOptions>(
    () => ({
      min: opts.linkWidth.min,
      max: opts.linkWidth.max,
      mode: opts.linkWidth.mode,
      tiers: opts.linkWidth.tiers,
    }),
    [opts.linkWidth.min, opts.linkWidth.max, opts.linkWidth.mode, opts.linkWidth.tiers]
  );
  const bindingContext = useMemo(
    () =>
      bindContextFor({
        theme,
        fieldThresholds: fieldConfig.defaults.thresholds,
        replaceVariables,
        timeZone,
        linkWidth,
      }),
    [theme, fieldConfig.defaults.thresholds, replaceVariables, timeZone, linkWidth]
  );
  // The bind runs on new data, a new diagram or a new config; the clock runs only the stale pass (spec 3.5).
  // While the deferred build of a large diagram runs, the stage is empty: nothing of another diagram binds or shows.
  const { validated, bound, patches, cardContext } = useBoundDiagram({
    index: stage.index,
    xml: opts.diagram?.xml,
    config: options.config,
    data,
    bindContext: bindingContext,
  });
  // The bind result at the current clock: the cards and the chart regions read the stale status.
  const shown = useMemo((): BindResultV4 => ({ ...bound, patches }), [bound, patches]);
  // The rules of version 1 are not read. A saved value gives a warning, so the author sees why nothing is bound.
  const legacyRules = Array.isArray(options.rules) ? options.rules.length : 0;
  const result = useMemo(() => {
    // A failed query gives one warning for each datasource and cause, with the failed queries and their expressions,
    // not one line of the same error for each refId.
    const failed = failedQueries(bound.report, data);
    const failures = groupQueryFailures(failed, describeQueries(data.request, datasourceName, replaceVariables));
    const rest = otherEntries(bound.report, failed).filter((entry) => entry.kind !== 'unmeasured-link');
    const warnings = [
      ...failures.map(failureText),
      ...groupReport(rest, validated.parsed.config).map((row) => reportGroupLine(row, true)),
    ];
    if (legacyRules) {
      warnings.unshift(legacyRulesWarning(legacyRules));
    }
    return {
      patches: patches as Map<string, CellPatch>,
      warnings,
      bandRows: bandRowsV4(patches, failedLabels(failures)),
    };
  }, [bound, patches, legacyRules, validated.parsed.config, data, replaceVariables]);

  // The status band takes its height from the panel; the stage gets the rest.
  const [bandExpanded, setBandExpanded] = useState(false);
  const band = bandLayout(result.bandRows.length, opts.summary.maxRows, bandExpanded, height);
  // The corner row, the legend and the timestamp stay in the part of the panel that the page shows.
  useFollowViewport(wrapperEl, band.height);
  const stageHeight = Math.max(1, height - band.height);
  const bandRef = useRef<HTMLElement>(null);

  // The open card: the bindings or the diagram changed and its cell has no patch now. The card host renders in this
  // pass too (its bind result is new) and reads the dropped state. The same limit as the diagram change above: a
  // render that React throws away still drops the state.
  const openCard = cardStore.get();
  if (openCard && !result.patches.has(openCard.cellId)) {
    cardStore.adjust({ type: 'stale-cell' });
  }
  // The view reads only the cell of a pinned card: a hover from cell to cell renders the card host, not the view.
  const pinnedCell = useSyncExternalStore(cardStore.subscribe, () => pinnedCellOf(cardStore.get()));
  // The pinned card resolves its rows here: the pin, the focus and Shift depend on its content. A data refresh
  // updates it in place.
  const pinnedModel = useMemo(
    () => (pinnedCell === undefined ? undefined : buildCardV4(pinnedCell, shown, cardContext)),
    [pinnedCell, shown, cardContext]
  );
  // Only the cell kinds of the Hover kinds option open a card (the canvas, groups and the legend do not by default),
  // and only when the card has rows or links. Computed once per data update: these cells get the hand cursor.
  const hoverKinds = opts.hover.kinds;
  const interactive = useMemo(
    () =>
      interactiveCells(result.patches, stage.index, (p) => {
        const entry = stage.index.get(p.cellId);
        return !!entry && hoverKinds.includes(hoverKind(entry)) && opensCard(p, bound.series.get(p.cellId));
      }),
    [result.patches, bound, stage.index, hoverKinds]
  );
  const cardable = (p: CellPatch) => interactive.has(p.cellId);

  // The colour legend: the scales of the bound cells. A legend entry under the pointer highlights its cells.
  const legendOptions = opts.legend;
  const legendBlocks = useMemo(() => {
    if (!legendOptions.show) {
      return [];
    }
    return buildLegendV4(result.patches, statusFields(bound), {
      theme,
      fieldThresholds: fieldConfig.defaults.thresholds,
      staleColor,
      linkWidth,
    });
  }, [legendOptions.show, result.patches, bound, theme, fieldConfig.defaults.thresholds, staleColor, linkWidth]);
  // The chart regions: one for each cell whose effective class has a `chart` (spec 3.9).
  const charts = useMemo(() => chartUsesV4(bound), [bound]);
  const legendMembers = useMemo(() => [...new Set(legendBlocks.flatMap((b) => b.cellIds))], [legendBlocks]);
  // The active entry of the panel legend and the marks of a legend row inside the diagram (portograph rows with a
  // symbol). They are not state: a hover writes the store, and only the highlight effect below reads it, so a hover
  // does not render the view.
  const [highlight] = useState(createHighlightStore);
  const legendRef = useRef<HTMLElement>(null);
  // The last data timestamp shares the bottom row with the legend: it reads the box of the legend at its corner.
  const [legendBox, setLegendBox] = useState<Box | null>(null);
  const onLegendBox = useCallback(
    (b: Box | null) =>
      setLegendBox((old) =>
        old && b && old.x === b.x && old.y === b.y && old.width === b.width && old.height === b.height ? old : b
      ),
    []
  );
  const stampRef = useRef<HTMLElement>(null);
  const lastTime = useMemo(
    () => (legendOptions.timestamp === false ? undefined : lastSampleTime(data.series)),
    [legendOptions.timestamp, data.series]
  );
  // A pinned card without rows and links has nothing to show: it is not open, and the pointer hovers again.
  const openPinned = hasContent(pinnedModel) ? pinnedCell : undefined;

  // Apply patches, redraw the overlay and the value labels once per frame.
  useStagePaint(stage, result.patches, {
    theme,
    linkWidth: linkWidthRange(opts.linkWidth),
    interactive,
    xml: opts.diagram?.xml,
    staleColor,
  });
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
  }, [stage.root, stage.index, legendMembers, hasBlocks, result, highlight]);

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
  const { live } = useStageLayout(stage, zoomLayout, { width, height: stageHeight }, view, containerRef);
  // Dashboard edit: the free grid rows below the diagram. Not in panel edit or View panel: the panel then has the
  // size of the editor or of the screen, not of its grid item.
  const dashboardEditing = useDashboardEditing();
  const viewPanel = useViewPanel();
  const inGrid = dashboardEditing && !editing && !viewPanel;
  const fitRows = inGrid ? freeRows(zoomLayout, stage.base, { width, height: stageHeight }) : 0;
  const canFit = useMemo(() => fitRows > 0 && canFitGridHeight(props.id), [fitRows, props.id]);

  const corner = useRef<HTMLDivElement>(null);
  // the drawn height of the top-left row (CornerControls); 0 without layout
  const [cornerRow, setCornerRow] = useState(0);
  // The controls of the panel: a pointer on them does not pan the view and does not change the card.
  const onControl = (t: EventTarget | null) =>
    t instanceof Node &&
    (inPortalControl(t) ||
      !!corner.current?.contains(t) ||
      !!bandRef.current?.contains(t) ||
      !!legendRef.current?.contains(t) ||
      !!stampRef.current?.contains(t));
  const panZoom = usePanZoom({
    wrapperRef,
    root: stage.root,
    base: stage.base,
    view,
    setView,
    live,
    wheel: wheelZoom,
    dragPan,
    align,
    ignore: (t) => cards.inCard(t) || onControl(t),
    // the hover surface of a chart region (ChartHover): a finger on it reads the samples
    scrub: (t) => t instanceof Element && !!t.closest('[data-testid="dmap-chart-hover"]'),
  });

  // The configured view starts at the top-left corner of a stage that scrolls.
  const resetView = () => {
    setView(null);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
      containerRef.current.scrollLeft = 0;
    }
  };

  // the cells that stay bright with a hovered link or node (built once for a diagram, not on each hover)
  const diagramXml = opts.diagram?.xml;
  const focusOf = useMemo(() => {
    const ctx = endContextOf(diagramXml, stage.index);
    return focusMap(stage.index, ctx.ends, ctx.parents);
  }, [diagramXml, stage.index]);
  // Hover focus: `on`, or `off` (the focus only while Shift is held)
  const focusMode = opts.hover.focus;
  const shiftHeld = useShiftHeld();
  const input = useCardInput({
    ...cards,
    pinnedCell: openPinned,
    wrapperRef,
    wrapperEl,
    stageRef: containerRef,
    root: stage.root,
    patches: result.patches,
    index: stage.index,
    cardable,
    onControl,
    panZoom,
    focusOf,
  });
  // `on`: what Shift does depends on the moment it goes down. A hover card open: Shift hides the hover cards and
  // keeps the focus. No hover card: Shift turns the focus off for the whole map. A pinned card keeps its card and its
  // focus. `off`: the focus shows only while Shift is held, also for a pinned card.
  const pinned = openPinned !== undefined;
  const [shiftKind, setShiftKind] = useState<'card' | 'focus' | undefined>(undefined);
  const [shiftSeen, setShiftSeen] = useState(false);
  if (shiftSeen !== shiftHeld) {
    // state from the change of the key (adjust state during render): the kind holds until the key goes up
    setShiftSeen(shiftHeld);
    // the card host writes whether a hover card is open: the view does not render for a hover
    setShiftKind(shiftHeld && focusMode === 'on' ? (cardStore.hoverOpen() ? 'card' : 'focus') : undefined);
  }
  // the kind applies only in the mode `on`: another mode while the key is down masks it
  const cardHidden = focusMode === 'on' && shiftKind === 'card' && !pinned;
  const focusHidden = focusMode === 'off' ? !shiftHeld : shiftKind === 'focus' && !pinned;

  if (!opts.diagram?.svg) {
    return (
      <div className={styles.empty} data-testid="dmap-empty">
        No diagram. Edit the panel and open the draw.io editor or import a .drawio file.
      </div>
    );
  }

  const warnings = [...stage.warnings, ...result.warnings];
  const rowHeight = Math.max(cornerRowHeight(panZoom.zoomed || editing, warnings.length), cornerRow);
  const corners = legendCorners(band.height, rowHeight, width);
  // a saved corner that this version does not know
  const legendCorner: LegendCorner = corners[legendOptions.corner] ? legendOptions.corner : 'bottom-right';
  const legend = legendOptions.show ? (
    <Legend
      ref={legendRef}
      blocks={legendBlocks}
      collapsed={legendOptions.collapsed}
      onHighlight={highlight.setLegend}
      style={corners[legendCorner]}
      corner={legendCorner}
      onCornerBox={onLegendBox}
    />
  ) : null;
  // At the configured view one finger scrolls the page and the page does not pinch-zoom over the panel.
  // A zoomed view takes all touches: one finger pans it.
  const touchAction = panZoom.zoomed ? 'none' : 'pan-x pan-y';

  return (
    <div
      className={styles.wrapper}
      ref={attachWrapper}
      {...{ [FOCUS_HIDDEN_ATTR]: focusHidden ? '' : undefined }}
      data-testid="dmap-panel"
      data-dmap-cells={stage.index.size}
      data-dmap-patched={result.patches.size}
      data-dmap-warnings={warnings.length}
      data-dmap-hash={opts.diagram.hash}
      data-dmap-pending={stage.pending ? 'true' : undefined}
      style={{ colorScheme: theme.isDark ? 'dark' : 'light', touchAction }}
      onClick={input.onClick}
      onKeyDown={input.onKeyDown}
      onPointerMove={input.onPointerMove}
    >
      {/* Chrome does not carry pan restrictions into a scroll container: the stage needs its own touch-action. */}
      <StatusBand
        ref={bandRef}
        rowsV4={result.bandRows}
        layout={band}
        expanded={bandExpanded}
        onToggle={() => setBandExpanded((v) => !v)}
        staleColor={staleColor}
      />
      <div
        ref={attachStage}
        className={styles.stage}
        style={{
          touchAction,
          height: stageHeight,
          // the focus scrim of a diagram with no page colour: the colour behind the panel (the dashboard canvas on a
          // transparent panel)
          ['--dmap-scrim' as string]: props.transparent
            ? theme.colors.background.canvas
            : theme.components.panel.background,
        }}
        data-testid="dmap-stage"
      />
      {charts.length ? (
        <ChartLayer
          root={stage.root}
          cells={stage.index}
          viewport={viewport}
          revision={`${viewKey}|${stageHeight}${JSON.stringify(view)}`}
          charts={charts}
          bound={shown}
          ctx={cardContext}
        />
      ) : null}
      {stage.error ? <div className={styles.empty}>{stage.error}</div> : null}
      <CellFocusRing stage={stage} wrapperRef={wrapperRef} container={viewport} />
      <CornerControls
        ref={corner}
        bandHeight={band.height}
        zoomed={panZoom.zoomed}
        editing={editing}
        width={width}
        warnings={warnings}
        onReset={resetView}
        onRowHeight={setCornerRow}
        fitRows={canFit ? fitRows : 0}
        onFitHeight={() => fitGridHeight(props.id, fitRows)}
        onEditBindings={() => {
          dispatch({ type: 'close' });
          props.onEditBindings();
        }}
      />
      {lastTime === undefined ? null : (
        <LastDataStamp
          ref={stampRef}
          time={lastTime}
          timeZone={timeZone}
          corner={legendCorner}
          legend={legendOptions.show ? legendBox : null}
          area={{ width, height }}
        />
      )}
      {legend}
      <CardHost
        store={cardStore}
        cardRef={cards.cardRef}
        pinnedCell={pinnedCell}
        pinnedModel={pinnedModel}
        bound={shown}
        ctx={cardContext}
        hidden={cardHidden}
        width={width}
        height={height}
        anchor={wrapperEl}
        wrapperRef={wrapperRef}
        timeRange={timeRange}
        timeZone={timeZone}
        onClose={input.close}
        finish={input.finish}
        outside={input.outside}
        pointerRef={input.pointerRef}
        moveRef={input.moveRef}
      />
    </div>
  );
}
