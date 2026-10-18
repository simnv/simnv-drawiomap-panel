import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { getDisplayProcessor, PanelProps } from '@grafana/data';
import { IconButton, useTheme2 } from '@grafana/ui';
import { bind } from '../binding/engine';
import { extractSeries } from '../binding/series';
import { buildCard, DisplayOverride } from '../interact/cardModel';
import { Card } from '../interact/Card';
import { patchAt } from '../interact/hit';
import { applyPatches } from '../render/applier';
import { renderOverlay } from '../render/overlay';
import { cellMetas } from '../render/svgStage';
import { applyLayout, viewBoxFor, ViewBox } from '../render/zoom';
import { DEFAULT_OPTIONS, Options, SeriesInfo } from '../types';
import { usePanZoom } from './usePanZoom';
import { useStage } from './useStage';
import { PanelQueryProvider } from '../query/panel';

const styles = {
  wrapper: css`
    position: relative;
    width: 100%;
    height: 100%;
  `,
  stage: css`
    width: 100%;
    height: 100%;
    & > svg {
      display: block;
    }
  `,
  empty: css`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    opacity: 0.7;
  `,
  // The reset button and the warning badge stack in the top-right corner.
  corner: css`
    position: absolute;
    right: 4px;
    top: 4px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    z-index: 1;
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
      <DrawioMapPanelView {...props} />
    </PanelQueryProvider>
  );
}

function DrawioMapPanelView({
  options,
  data,
  width,
  height,
  fieldConfig,
  replaceVariables,
  timeZone,
  timeRange,
}: PanelProps<Options>) {
  const theme = useTheme2();
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    zoom: { ...DEFAULT_OPTIONS.zoom, ...options.zoom },
    linkWidth: { ...DEFAULT_OPTIONS.linkWidth, ...options.linkWidth },
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const stage = useStage(containerRef, opts.diagram?.svg, opts.diagram?.hash);
  const patchedRef = useRef<Set<string>>(new Set());
  const [card, setCard] = useState<CardState | null>(null);
  const [view, setView] = useState<ViewBox | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const zoomMode = opts.zoom.mode;
  const zoomPercent = opts.zoom.percent;
  const wheelZoom = opts.zoom.wheel;
  const dragPan = opts.zoom.pan;
  const align = opts.zoom.align ?? 'top';

  // Reset the custom view and close the card when the diagram changes (state adjustment during render).
  const hash = opts.diagram?.hash;
  const [viewHash, setViewHash] = useState(hash);
  if (viewHash !== hash) {
    setViewHash(hash);
    setView(null);
    setCard(null);
  }
  // A new panel size or a new zoom option resets the live view to the configured view.
  const viewKey = `${width}x${height}|${zoomMode}|${zoomPercent}|${align}`;
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
  const result = useMemo(
    () =>
      bind(opts.rules ?? [], cellMetas(stage.index), series, {
        theme,
        fieldThresholds: fieldConfig.defaults.thresholds,
        replaceVariables,
        display,
        linkWidth: opts.linkWidth,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      opts.rules,
      stage.index,
      series,
      theme,
      fieldConfig.defaults.thresholds,
      replaceVariables,
      display,
      opts.linkWidth.min,
      opts.linkWidth.max,
    ]
  );

  // The card resolves its rows only for the open cell. A data refresh updates it in place.
  const cardPatch = card ? result.patches.get(card.cellId) : undefined;
  if (card && !cardPatch) {
    // the rules or the diagram changed and the cell has no patch now
    setCard(null);
  }
  const model = useMemo(() => {
    if (!cardPatch) {
      return undefined;
    }
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
    return buildCard(cardPatch, { series, theme, display: displayFor, replaceVariables });
  }, [cardPatch, series, theme, timeZone, display, replaceVariables]);
  const open = !!model;
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

  // Esc closes the card. A pointer down outside the panel closes a pinned card.
  useEffect(() => {
    if (!open) {
      return;
    }
    // Capture phase: Esc closes the card only, Grafana does not also leave the panel view.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (pinned && !wrapperRef.current?.contains(e.target as Node)) {
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
      patchedRef.current = applyPatches(stage.index, result.patches, patchedRef.current);
      renderOverlay(root, stage.index, result.patches, { theme });
    });
    return () => cancelAnimationFrame(id);
  }, [stage.root, stage.index, result, theme]);

  // Zoom layout.
  useEffect(() => {
    if (!stage.root || !stage.base) {
      return;
    }
    const layout = viewBoxFor(
      { ...DEFAULT_OPTIONS.zoom, mode: zoomMode, percent: zoomPercent, align },
      view ?? stage.base,
      { width, height }
    );
    applyLayout(stage.root, layout);
    if (containerRef.current) {
      containerRef.current.style.overflow = layout.overflow;
    }
  }, [stage.root, stage.base, zoomMode, zoomPercent, align, width, height, view]);

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
    ignore: (t) => inCard(t) || (t instanceof Node && !!corner.current?.contains(t)),
  });

  // A click or a tap pins the card of the cell. A click on empty space closes it.
  const onClick = (e: React.MouseEvent) => {
    const stageEl = containerRef.current;
    // a drag that moved the view is not a click
    if (panZoom.takeClick() || inCard(e.target) || corner.current?.contains(e.target as Node) || !stageEl) {
      return;
    }
    const patch = patchAt(e.target, stageEl, result.patches, stage.index);
    opener.current = null;
    setCard(patch ? { cellId: patch.cellId, ...local(e), pinned: true } : null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const stageEl = containerRef.current;
    if ((e.key !== 'Enter' && e.key !== ' ') || !stageEl || inCard(e.target) || !(e.target instanceof Element)) {
      return;
    }
    const patch = patchAt(e.target, stageEl, result.patches, stage.index);
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
    // Hover is for a mouse or a pen. A pinned card stays until the user closes it or pins another cell.
    const stageEl = containerRef.current;
    if (e.pointerType === 'touch' || !canHover() || pinned || panZoom.busy() || !stageEl) {
      return;
    }
    const patch = patchAt(e.target, stageEl, result.patches, stage.index);
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
  // At the configured view one finger scrolls the page and the page does not pinch-zoom over the panel.
  // A zoomed view takes all touches: one finger pans it.
  const touchAction = panZoom.zoomed ? 'none' : 'pan-x pan-y';

  return (
    <div
      className={styles.wrapper}
      ref={wrapperRef}
      data-testid="dmap-panel"
      data-dmap-cells={stage.index.size}
      data-dmap-patched={result.patches.size}
      data-dmap-warnings={warnings.length}
      data-dmap-hash={opts.diagram.hash}
      style={{ colorScheme: theme.isDark ? 'dark' : 'light', touchAction }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        if (!pinned) {
          setCard(null);
        }
      }}
    >
      {/* Chrome does not carry pan restrictions into a scroll container: the stage needs its own touch-action. */}
      <div ref={containerRef} className={styles.stage} style={{ touchAction }} />
      {stage.error ? <div className={styles.empty}>{stage.error}</div> : null}
      <div ref={corner} className={styles.corner} data-testid="dmap-corner">
        {panZoom.zoomed ? (
          <IconButton
            name="search-minus"
            size="lg"
            tooltip="Reset zoom"
            tooltipPlacement="left"
            className={styles.reset}
            style={{ background: theme.colors.background.primary, border: `1px solid ${theme.colors.border.medium}` }}
            data-testid="dmap-reset-zoom"
            onClick={() => setView(null)}
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
      {model && card ? (
        <div ref={cardRef}>
          <Card
            model={model}
            pinned={pinned}
            x={card.x}
            y={card.y}
            width={width}
            height={height}
            range={{ from: timeRange.from.valueOf(), to: timeRange.to.valueOf() }}
            onClose={close}
          />
        </div>
      ) : null}
    </div>
  );
}
