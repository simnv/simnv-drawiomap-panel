import { createPortal } from 'react-dom';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { Field, PanelProps } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { bindContextFor } from '../binding/context';
import type { BindResultV4 } from '../binding/bindV4';
import { buildCardV4, opensCard } from '../interact/cardModel';
import { Card, SHEET_BELOW } from '../interact/Card';
import { hoverKind } from '../adapter/portograph';
import { interactiveCells } from '../interact/hit';
import { useCardInput, useCardState } from '../interact/useCardState';
import { INTERACTIVE_ATTR, type Marked, markInteractive } from '../render/applier';
import type { ViewBox } from '../render/zoom';
import { DEFAULT_OPTIONS, Options, withDefaults, type CellPatch, type LegendCorner } from '../types';
import { usePanZoom } from '../stage/usePanZoom';
import { useStage } from '../stage/useStage';
import { useStageLayout } from '../stage/useStageLayout';
import { useStagePaint } from '../stage/useStagePaint';
import { reportLine, useBoundDiagram } from '../stage/useBoundDiagram';
import { ChartLayer, chartUsesV4 } from '../visuals/ChartLayer';
import { bandLayout, bandRowsV4, StatusBand } from './StatusBand';
import { legendCorners } from './legendCorners';
import { CornerControls, cornerRowHeight } from './CornerControls';
import { Legend } from '../legend/Legend';
import { buildLegendV4 } from '../legend/model';
import { highlightCells, LEGEND_ACTIVE, LEGEND_HIT, LEGEND_MEMBER } from '../legend/highlight';
import { bindSymbolLegend } from '../legend/symbolRows';
import { createHighlightStore } from '../legend/highlightStore';

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
    /* Only cells that open a card show the hand cursor. Other cells keep the parent cursor. */
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
};

/** The sheet goes to document.body: position: fixed does not work below a CSS transform (the Grafana grid item). */
const portalSheet = (card: React.ReactElement, sheet: boolean) =>
  sheet && typeof document !== 'undefined' ? createPortal(card, document.body) : card;

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
  // Sandbox hosts do not provide a definite percentage-height containing block.
  return (
    <div style={{ width: props.width, height: props.height }}>
      <DrawioMapPanelView {...props} />
    </div>
  );
}

function DrawioMapPanelView(props: PanelProps<Options>) {
  const { options, data, width, height, fieldConfig, replaceVariables, timeZone, timeRange } = props;
  const theme = useTheme2();
  const opts = withDefaults(options);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const attachStage = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    setViewport(element);
  }, []);
  const stage = useStage(containerRef, opts.diagram?.svg, opts.diagram?.hash);
  const interactiveRef = useRef<Marked>();
  const cards = useCardState();
  const { card, dispatch, cardRef } = cards;
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
    dispatch({ type: 'diagram-changed' });
  }
  // A new panel size or a new zoom option resets the live view to the configured view.
  const viewKey = `${width}x${height}|${zoomMode}|${zoomPercent}|${align}|${minScale}`;
  const [lastViewKey, setLastViewKey] = useState(viewKey);
  if (lastViewKey !== viewKey) {
    setLastViewKey(viewKey);
    setView(null);
  }

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
  // The bind runs on new data, a new diagram or a new config; the clock runs only the stale pass (spec 3.5).
  const { bound, patches, cardContext } = useBoundDiagram({
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
    const warnings = bound.report.map(reportLine);
    if (legacyRules) {
      warnings.unshift(legacyRulesWarning(legacyRules));
    }
    return { patches: patches as Map<string, CellPatch>, warnings, bandRows: bandRowsV4(patches) };
  }, [bound, patches, legacyRules]);

  // The status band takes its height from the panel; the stage gets the rest.
  const [bandExpanded, setBandExpanded] = useState(false);
  const band = bandLayout(result.bandRows.length, opts.summary.maxRows, bandExpanded, height);
  const stageHeight = Math.max(1, height - band.height);
  const bandRef = useRef<HTMLElement>(null);

  // The card resolves its rows only for the open cell. A data refresh updates it in place.
  const cardPatch = card ? result.patches.get(card.cellId) : undefined;
  if (card && !cardPatch) {
    // the bindings or the diagram changed and the cell has no patch now
    dispatch({ type: 'stale-cell' });
  }
  const cardCell = cardPatch ? card?.cellId : undefined;
  const model = useMemo(
    () => (cardCell === undefined ? undefined : buildCardV4(cardCell, shown, cardContext)),
    [cardCell, shown, cardContext]
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
    });
  }, [legendOptions.show, result.patches, bound, theme, fieldConfig.defaults.thresholds]);
  // The chart regions: one for each cell whose effective class has a `chart` (spec 3.9).
  const charts = useMemo(() => chartUsesV4(bound), [bound]);
  const legendMembers = useMemo(() => [...new Set(legendBlocks.flatMap((b) => b.cellIds))], [legendBlocks]);
  // The active entry of the panel legend and the marks of a legend row inside the diagram (portograph rows with a
  // symbol). They are not state: a hover writes the store, and only the highlight effect below reads it, so a hover
  // does not render the view.
  const [highlight] = useState(createHighlightStore);
  const legendRef = useRef<HTMLElement>(null);
  // A card without rows and links has nothing to show: the cell opens no card.
  const open = !!model && (model.rows.length > 0 || model.links.length > 0);

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
  useStageLayout(stage, zoomLayout, { width, height: stageHeight }, view, containerRef);

  const corner = useRef<HTMLDivElement>(null);
  // The controls of the panel: a pointer on them does not pan the view and does not change the card.
  const onControl = (t: EventTarget | null) =>
    t instanceof Node &&
    (!!corner.current?.contains(t) || !!bandRef.current?.contains(t) || !!legendRef.current?.contains(t));
  const panZoom = usePanZoom({
    wrapperRef,
    root: stage.root,
    base: stage.base,
    view,
    setView,
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

  const { pinned, close, onClick, onKeyDown, onPointerMove, moveRef, pointerRef } = useCardInput({
    ...cards,
    open,
    wrapperRef,
    wrapperEl,
    stageRef: containerRef,
    patches: result.patches,
    index: stage.index,
    cardable,
    onControl,
    panZoom,
  });

  if (!opts.diagram?.svg) {
    return (
      <div className={styles.empty} data-testid="dmap-empty">
        No diagram. Edit the panel and open the draw.io editor or import a .drawio file.
      </div>
    );
  }

  const warnings = [...stage.warnings, ...result.warnings];
  const corners = legendCorners(band.height, cornerRowHeight(panZoom.zoomed, warnings.length), width);
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
        rowsV4={result.bandRows}
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
      <CornerControls
        ref={corner}
        bandHeight={band.height}
        zoomed={panZoom.zoomed}
        warnings={warnings}
        onReset={resetView}
      />
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
                moveRef={moveRef}
              />
            </div>,
            width < SHEET_BELOW
          )
        : null}
    </div>
  );
}
