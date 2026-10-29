import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GrafanaTheme2, TimeRange } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { readChartAnchor, type ChartAnchor } from '../render/geometry';
import type { CellEntry, CellIndex } from '../types';
import type { BindResultV4 } from '../binding/bindV4';
import type { UsePath } from '../binding/report';
import { isPast } from '../binding/status';
import { chartRowV4, staleDeadline, type CardContextV4, type CardRowV4 } from '../interact/cardModel';
import type { ChartV4 } from '../model/v4';
import { ChartHover } from './ChartHover';
import { lineHistory, SparklineView } from './SparklineView';
import { BarGaugeView } from './BarGaugeView';
import { MirrorSparkline } from './MirrorSparkline';
import { useClock } from './useSampleStale';

/** The diagram that the regions sit on: each region fills the box of its cell. */
interface StageProps {
  root?: SVGSVGElement;
  cells: CellIndex;
  viewport: HTMLElement | null;
  revision?: unknown;
}

/** One chart region of a v4 cell (spec 3.9): the `chart` of its effective class and the YAML path of the chart. */
export interface ChartUse {
  cellId: string;
  chart: ChartV4;
  /** `classes.<class>.chart` or `overrides.<id>.chart`; an `updown` chart reads the uses `<path>.a2b` and `.b2a` */
  path: UsePath;
}

/**
 * The v4 input: the chart uses of the bind (spec 3.2 step 4 and 11). A region reads the series of its uses from the
 * bind and builds with the rules of a card row; it runs no query of its own.
 */
export interface ChartLayerProps extends StageProps {
  charts: ChartUse[];
  bound: BindResultV4;
  /** the theme, the panel data and the classes of the bind */
  ctx: CardContextV4;
}

/** The chart regions of the bind: one for each cell whose effective class has a `chart` (spec 3.9). */
export function chartUsesV4(bound: BindResultV4): ChartUse[] {
  const charts: ChartUse[] = [];
  for (const [cellId, uses] of bound.uses) {
    // an `updown` chart has two uses, `<path>.a2b` and `<path>.b2a`: the first gives the chart
    const use = uses.find((u) => u.kind === 'chart');
    if (!use?.row || use.row.kind === 'metadata' || use.row.kind === 'drilldown') {
      continue;
    }
    const chart = use.row;
    const path = chart.kind === 'updown' ? use.path.replace(/\.a2b$/, '') : use.path;
    charts.push({ cellId, chart, path });
  }
  return charts;
}

const NO_DEADLINES: readonly number[] = [];
/** Height in px of the title line above a bar gauge or an updown chart, and of the value line of a sparkline. */
const TITLE_HEIGHT = 22;

/** Check the painted element against the panel and every clipping ancestor. */
function displayed(shape: SVGGraphicsElement, viewport: HTMLElement): boolean {
  if (!shape.isConnected || document.visibilityState === 'hidden') {
    return false;
  }
  const rect = shape.getBoundingClientRect();
  let left = Math.max(0, rect.left),
    top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right),
    bottom = Math.min(window.innerHeight, rect.bottom);
  for (let node: Element | null = shape; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.opacity === '0'
    ) {
      return false;
    }
    if (
      node === viewport ||
      /(hidden|clip|auto|scroll)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)
    ) {
      const clip = node.getBoundingClientRect();
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
  }
  return right > left && bottom > top;
}

interface RegionGeometry {
  anchor: ChartAnchor;
  visible: boolean;
}

/**
 * The region of a cell: a `foreignObject` after the shape of the cell with the box and the transform of the shape,
 * and whether the shape shows on the screen. `mark` and `id` name the region in the DOM (`data-dmap-chart`).
 */
function useRegion(
  { root, viewport, revision }: StageProps,
  cell: CellEntry | undefined,
  mark: string,
  id: string
): { portal?: SVGForeignObjectElement; geometry?: RegionGeometry } {
  const updateRef = useRef<() => void>();
  const [portal, setPortal] = useState<SVGForeignObjectElement>();
  const [geometry, setGeometry] = useState<RegionGeometry>();

  useLayoutEffect(() => {
    const shape = cell?.shape;
    const parent = shape?.parentElement as unknown as SVGGraphicsElement;
    if (!root || !cell || !shape || !parent || !viewport) {
      return;
    }
    const region = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    let intersecting = typeof IntersectionObserver === 'undefined';
    region.setAttribute(mark, id);
    region.style.overflow = 'hidden';
    region.style.pointerEvents = 'none';
    shape.after(region);
    // The portal target belongs to the external SVG DOM and exists only after attachment.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortal(region);
    const update = () => {
      const anchor = readChartAnchor(cell, parent);
      if (!anchor) {
        setGeometry(undefined);
        return;
      }
      const { matrix: m } = anchor;
      const attrs = {
        x: anchor.x,
        y: anchor.y,
        width: anchor.width,
        height: anchor.height,
        transform: `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`,
      };
      for (const [name, value] of Object.entries(attrs)) {
        if (region.getAttribute(name) !== String(value)) {
          region.setAttribute(name, String(value));
        }
      }
      const next = {
        anchor,
        visible: intersecting && displayed(shape, viewport),
      };
      setGeometry((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    updateRef.current = update;
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      subtree: true,
      attributeFilter: ['viewBox', 'transform', 'style', 'class', 'x', 'y', 'width', 'height', 'display', 'visibility'],
    });
    // Ancestor visibility and panel clipping can change without an SVG mutation.
    for (let node: Element | null = viewport; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    resize?.observe(viewport);
    const intersection =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver((entries) => {
            intersecting = entries.some((entry) => entry.isIntersecting);
            update();
          });
    intersection?.observe(shape);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      resize?.disconnect();
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      updateRef.current = undefined;
      region.remove();
    };
  }, [root, cell, viewport, mark, id]);

  useLayoutEffect(() => {
    updateRef.current?.();
  }, [revision]);
  return { portal, geometry };
}

/** The look of a region: the font of the theme over the background of the panel. */
function regionStyle(theme: GrafanaTheme2, width: number, height: number): React.CSSProperties {
  return {
    width,
    height,
    overflow: 'hidden',
    fontSize: 12,
    fontFamily: theme.typography.fontFamily,
    lineHeight: 'normal',
    color: theme.colors.text.primary,
    background: theme.colors.background.primary,
    position: 'relative',
  };
}

/** The body of a v4 region: the chart of its kind, or why it has no data (spec 3.6). */
function ChartBody({
  row,
  width,
  height,
  timeRange,
  stale,
  timeZone,
}: {
  timeZone?: string;
  row: CardRowV4;
  width: number;
  height: number;
  timeRange: TimeRange;
  stale: boolean;
}) {
  const theme = useTheme2();
  const hint = stale ? <span role="status">Stale data</span> : null;
  if (row.kind === 'history' && row.state === 'ready' && row.lines && row.domain) {
    const more = row.more ? `+${row.more} more` : '';
    return (
      <ChartHover
        enabled
        series={row.lines.map((l) => ({
          name: l.label,
          color: l.color,
          history: lineHistory(l),
          format: row.format,
          noData: l.noData,
        }))}
        timeRange={timeRange}
        timeZone={timeZone}
        width={width}
        label={row.title}
        more={row.more}
      >
        <SparklineView
          chart={{ lines: row.lines, domain: row.domain }}
          config={row.config}
          width={width}
          height={height}
          timeRange={timeRange}
          label={row.title}
          value={[row.text, more].filter(Boolean).join(' ')}
          stale={stale}
        />
      </ChartHover>
    );
  }
  if (row.kind === 'value' && row.display) {
    return (
      <>
        <div>{row.title}</div>
        <BarGaugeView
          value={row.display}
          field={row.config ?? {}}
          width={width}
          height={Math.max(1, height - TITLE_HEIGHT)}
          stale={stale}
        />
      </>
    );
  }
  if (row.kind === 'updown' && row.state === 'ready' && row.directions && row.domain) {
    return (
      <>
        <div>
          {row.title} <span data-testid="dmap-chart-value">{row.text}</span>
        </div>
        {hint}
        <ChartHover
          enabled
          series={row.directions.map((d) => ({ name: d.label, color: d.color, history: d.history }))}
          timeRange={timeRange}
          timeZone={timeZone}
          width={width}
          label={row.title}
        >
          <MirrorSparkline
            directions={row.directions}
            domain={row.domain}
            width={width}
            height={Math.max(1, height - TITLE_HEIGHT)}
            timeRange={timeRange}
            label={row.title}
          />
        </ChartHover>
      </>
    );
  }
  // missing data is grey, never the colour of a value
  return (
    <div role="status" style={{ color: theme.colors.text.secondary }}>
      {row.title}: {row.text}
    </div>
  );
}

/** A v4 chart region: the `chart` of the class of the cell, in the box of the cell (spec 3.9). */
function RegionV4({ use, ...props }: ChartLayerProps & { use: ChartUse }) {
  const { cells, bound, ctx } = props;
  const theme = useTheme2();
  const { portal, geometry } = useRegion(props, cells.get(use.cellId), 'data-dmap-chart', use.cellId);
  // the chart builds on each bind (spec 3.2 step 11)
  const row = useMemo(() => chartRowV4(use, bound, ctx), [use, bound, ctx]);
  const deadline = row ? staleDeadline(row) : undefined;
  const now = useClock(deadline === undefined ? NO_DEADLINES : [deadline]);
  if (!row) {
    return null;
  }
  if (!geometry) {
    return (
      <span role="status" data-dmap-chart-error={use.cellId}>
        {row.title} needs a rectangle with a valid transform.
      </span>
    );
  }
  if (!portal || !geometry.visible) {
    return null;
  }
  const { width, height } = geometry.anchor;
  const stale = row.stale === true || (deadline !== undefined && isPast(deadline, now));
  return createPortal(
    <div
      data-testid="dmap-chart"
      aria-label={row.title}
      style={{ ...regionStyle(theme, width, height), pointerEvents: 'auto' }}
    >
      <ChartBody
        row={row}
        width={width}
        height={height}
        timeRange={ctx.data.timeRange}
        timeZone={ctx.data.request?.timezone}
        stale={stale}
      />
    </div>,
    portal
  );
}

/** The chart regions over the diagram: one for each chart use of the bind (spec 3.9). */
export function ChartLayer(props: ChartLayerProps) {
  return (
    <>
      {props.charts.map((use) => (
        <RegionV4 key={use.cellId} {...props} use={use} />
      ))}
    </>
  );
}
