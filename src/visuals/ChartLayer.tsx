import React, { useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GrafanaTheme2, TimeRange } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { CHART_LAYER_ATTR } from '../render/linkFocus';
import { readChartAnchor, toMatrix, toRoot, type ChartAnchor, type Matrix } from '../render/geometry';
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
import { LINE_HEIGHT, plotHeightOf, StaleHint, TWO_LINES, ValueLine } from './StaleHint';
import { useClock } from './useSampleStale';

/** The diagram that the regions sit on: each region fills the box of its cell. */
interface StageProps {
  root?: SVGSVGElement;
  cells: CellIndex;
  viewport: HTMLElement | null;
  revision?: unknown;
  /**
   * false: the charts take no pointer, so a click hits the cell below (the split editor selects cells). Default: the
   * chart takes the pointer (its hover readout) and gives the card of its cell.
   */
  interactive?: boolean;
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

/* ---------- the stage watch: one set of observers and one pass for every region ---------- */

/** A box on the screen, or null for a node that does not show (display none, hidden, zero opacity). */
type Clip = { left: number; top: number; right: number; bottom: number } | null;

/**
 * One pass over the regions. The computed style and the clip box of a node are read once and shared, so N regions
 * under one stage cost the nodes above them once, not N times.
 */
class RegionPass {
  private readonly clips = new Map<Element, Clip>();
  constructor(private readonly viewport: HTMLElement) {}

  /** The box a node clips its content to, after every ancestor; null when it or an ancestor does not show. */
  private clipOf(node: Element | null): Clip {
    if (!node) {
      return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    }
    const known = this.clips.get(node);
    if (known !== undefined) {
      return known;
    }
    let clip = this.clipOf(node.parentElement);
    if (clip) {
      const style = getComputedStyle(node);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0'
      ) {
        clip = null;
      } else if (
        node === this.viewport ||
        /(hidden|clip|auto|scroll)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)
      ) {
        const box = node.getBoundingClientRect();
        clip = {
          left: Math.max(clip.left, box.left),
          top: Math.max(clip.top, box.top),
          right: Math.min(clip.right, box.right),
          bottom: Math.min(clip.bottom, box.bottom),
        };
      }
    }
    this.clips.set(node, clip);
    return clip;
  }

  /** Check the painted element against the panel and every clipping ancestor. */
  displayed(shape: SVGGraphicsElement): boolean {
    if (!shape.isConnected || document.visibilityState === 'hidden') {
      return false;
    }
    const clip = this.clipOf(shape);
    if (!clip) {
      return false;
    }
    const rect = shape.getBoundingClientRect();
    return (
      Math.min(clip.right, rect.right) > Math.max(clip.left, rect.left) &&
      Math.min(clip.bottom, rect.bottom) > Math.max(clip.top, rect.top)
    );
  }
}

/** A region on the watch: its shape and the update that reads its geometry and its visibility. */
interface Watcher {
  shape: SVGGraphicsElement;
  update: (pass: RegionPass) => void;
}

/**
 * The observers of a stage, shared by all its regions: one `MutationObserver` on the root (the attributes that move
 * or hide a cell; not the viewBox: a pan or a zoom moves the plane of the regions, and the `revision` of the layer
 * reads their visibility again when the view settles) and on the ancestors of the viewport, one `ResizeObserver`,
 * one `IntersectionObserver` for every shape, and the document and window listeners. A mutation runs only the
 * regions under its target, so a hover class on another cell runs none.
 */
interface StageWatch {
  add(watcher: Watcher): () => void;
  /** one pass over every region (or the given ones): they share the reads of the nodes above them */
  run(only?: Iterable<Watcher>): void;
  /** one pass over the regions that no pass has read yet (new regions of a new set of charts) */
  runFresh(): void;
  /** true when the browser reported the shape in the viewport (true without an IntersectionObserver) */
  intersecting(shape: Element): boolean;
  start(): () => void;
}

function createStageWatch(root: SVGSVGElement, viewport: HTMLElement): StageWatch {
  const watchers = new Set<Watcher>();
  const fresh = new Set<Watcher>();
  const seen = new Map<Element, boolean>();
  const hasIntersection = typeof IntersectionObserver !== 'undefined';
  let intersection: IntersectionObserver | undefined;
  const run = (only?: Iterable<Watcher>) => {
    const pass = new RegionPass(viewport);
    for (const w of only ?? watchers) {
      fresh.delete(w);
      w.update(pass);
    }
  };
  const runAll = () => run();
  const onMutation = (records: MutationRecord[]) => {
    const hit = new Set<Watcher>();
    for (const w of watchers) {
      if (records.some((r) => r.target === w.shape || r.target.contains(w.shape))) {
        hit.add(w);
      }
    }
    if (hit.size) {
      run(hit);
    }
  };
  return {
    add(watcher) {
      watchers.add(watcher);
      fresh.add(watcher);
      if (!seen.has(watcher.shape)) {
        seen.set(watcher.shape, !hasIntersection);
      }
      intersection?.observe(watcher.shape);
      return () => {
        watchers.delete(watcher);
        fresh.delete(watcher);
        intersection?.unobserve(watcher.shape);
        seen.delete(watcher.shape);
      };
    },
    run,
    runFresh() {
      if (fresh.size) {
        run([...fresh]);
      }
    },
    intersecting: (shape) => seen.get(shape) ?? !hasIntersection,
    start() {
      const observer = new MutationObserver(onMutation);
      observer.observe(root, {
        attributes: true,
        subtree: true,
        attributeFilter: ['transform', 'style', 'class', 'x', 'y', 'width', 'height', 'display', 'visibility'],
      });
      // Ancestor visibility and panel clipping can change without an SVG mutation.
      for (let node: Element | null = viewport; node; node = node.parentElement) {
        observer.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      }
      const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(runAll);
      resize?.observe(viewport);
      intersection = hasIntersection
        ? new IntersectionObserver((entries) => {
            const hit = new Set<Watcher>();
            for (const entry of entries) {
              // an entry names its shape; an observer double that reports none counts for every shape
              const target = entry.target as Element | undefined;
              for (const w of watchers) {
                if (!target || w.shape === target) {
                  seen.set(w.shape, entry.isIntersecting);
                  hit.add(w);
                }
              }
            }
            run(hit);
          })
        : undefined;
      for (const w of watchers) {
        intersection?.observe(w.shape);
      }
      document.addEventListener('visibilitychange', runAll);
      window.addEventListener('resize', runAll);
      window.addEventListener('scroll', runAll, true);
      return () => {
        observer.disconnect();
        resize?.disconnect();
        intersection?.disconnect();
        intersection = undefined;
        document.removeEventListener('visibilitychange', runAll);
        window.removeEventListener('resize', runAll);
        window.removeEventListener('scroll', runAll, true);
      };
    },
  };
}

/**
 * The watch of the stage, one per root and viewport; its observers run while the layer is mounted. The regions
 * register in their own layout effects, which run before these: one pass of the layer then reads them all at once
 * on the mount and on a new `revision` (the view settled, a new box), and reads the new regions of a new set of
 * charts (a refresh binds again, the regions that stay need no read).
 */
function useStageWatch(props: ChartLayerProps, plane: HTMLDivElement | undefined): StageWatch | undefined {
  const { root, viewport, revision, charts, cells } = props;
  // the object only holds the lists: the observers start in the effect below
  const watch = useMemo(() => (root && viewport ? createStageWatch(root, viewport) : undefined), [root, viewport]);
  useLayoutEffect(() => watch?.start(), [watch]);
  useLayoutEffect(() => {
    watch?.run();
  }, [watch, revision]);
  // the regions register once the plane exists
  useLayoutEffect(() => {
    watch?.runFresh();
  }, [watch, charts, cells, plane]);
  return watch;
}

const css = (m: Matrix) => `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`;

/**
 * The HTML plane of the regions: a box on the box of the svg in the stage (it clips the regions as the svg clips
 * its shapes) and, in it, a plane in root user units (its CSS transform is the screen CTM of the root). The regions
 * are HTML over the diagram, not a `foreignObject` in it: WebKit draws positioned HTML in a `foreignObject` (the
 * canvas of a sparkline) without the transforms of the svg, so it would stand at the wrong place and size. A pan or a
 * zoom writes only the transform of the plane; a region keeps its matrix in root user units.
 */
function useRegionPlane(root: SVGSVGElement | undefined, viewport: HTMLElement | null): HTMLDivElement | undefined {
  const [plane, setPlane] = useState<HTMLDivElement>();
  useLayoutEffect(() => {
    if (!root || !viewport) {
      return;
    }
    const clip = document.createElement('div');
    clip.setAttribute(CHART_LAYER_ATTR, '');
    Object.assign(clip.style, { position: 'absolute', overflow: 'hidden', pointerEvents: 'none', left: '0', top: '0' });
    const inner = document.createElement('div');
    Object.assign(inner.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0' });
    inner.style.transformOrigin = '0 0';
    clip.append(inner);
    // the stage is `position: relative` (its CSS): the clip box places itself in it
    viewport.append(clip);
    const place = () => {
      const stage = viewport.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      const left = box.left - stage.left - viewport.clientLeft + viewport.scrollLeft;
      const top = box.top - stage.top - viewport.clientTop + viewport.scrollTop;
      Object.assign(clip.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      });
      const screen = toMatrix(typeof root.getScreenCTM === 'function' ? root.getScreenCTM() : null);
      // root user units to the box of the clip; the identity where the engine has no screen CTM (jsdom)
      const m = screen ? { ...screen, e: screen.e - box.left, f: screen.f - box.top } : undefined;
      inner.style.transform = m ? css(m) : '';
    };
    place();
    // a pan or a zoom writes the viewBox; a resize of the panel or a new view writes the size of the svg
    const attrs = new MutationObserver(place);
    attrs.observe(root, {
      attributes: true,
      attributeFilter: ['viewBox', 'width', 'height', 'style', 'preserveAspectRatio'],
    });
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    resize?.observe(viewport);
    resize?.observe(root);
    window.addEventListener('resize', place);
    // the plane is DOM of the stage, made only here
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlane(inner);
    return () => {
      attrs.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', place);
      clip.remove();
      setPlane(undefined);
    };
  }, [root, viewport]);
  return plane;
}

interface RegionGeometry {
  anchor: ChartAnchor;
  visible: boolean;
}

const sameGeometry = (a: RegionGeometry | undefined, b: RegionGeometry): boolean =>
  !!a &&
  a.visible === b.visible &&
  a.anchor.x === b.anchor.x &&
  a.anchor.y === b.anchor.y &&
  a.anchor.width === b.anchor.width &&
  a.anchor.height === b.anchor.height &&
  (['a', 'b', 'c', 'd', 'e', 'f'] as const).every((k) => a.anchor.matrix[k] === b.anchor.matrix[k]);

/**
 * The region of a cell: a `div` on the plane of the regions with the box of the shape and its matrix in root user
 * units, and whether the shape shows on the screen. `mark` and `id` name the region in the DOM (`data-dmap-chart`);
 * `data-dmap-cell` gives a pointer on the region the card of its cell.
 */
function useRegion(
  { root, viewport }: StageProps,
  plane: HTMLDivElement | undefined,
  watch: StageWatch | undefined,
  cell: CellEntry | undefined,
  mark: string,
  id: string
): { portal?: HTMLDivElement; geometry?: RegionGeometry } {
  const [portal, setPortal] = useState<HTMLDivElement>();
  const [geometry, setGeometry] = useState<RegionGeometry>();

  useLayoutEffect(() => {
    const shape = cell?.shape;
    const parent = shape?.parentElement as unknown as SVGGraphicsElement;
    if (!root || !cell || !shape || !parent || !viewport || !watch || !plane) {
      return;
    }
    const region = document.createElement('div');
    region.setAttribute(mark, id);
    region.setAttribute('data-dmap-cell', cell.meta.id);
    Object.assign(region.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
    });
    region.style.transformOrigin = '0 0';
    plane.append(region);
    const written: Record<string, string> = {};
    // The portal target is DOM of the stage and exists only after attachment.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortal(region);
    const update = (pass: RegionPass) => {
      const box = readChartAnchor(cell, parent);
      const matrix = box && toRoot(shape, root);
      if (!box || !matrix) {
        setGeometry(undefined);
        return;
      }
      const anchor = { ...box, matrix };
      const style = {
        width: `${anchor.width}px`,
        height: `${anchor.height}px`,
        transform: `${css(matrix)} translate(${anchor.x}px, ${anchor.y}px)`,
      };
      // the engine writes a style in its own form (translate(0px)): compare with what this region wrote last
      for (const [name, value] of Object.entries(style)) {
        if (written[name] !== value) {
          written[name] = value;
          region.style.setProperty(name, value);
        }
      }
      const next = { anchor, visible: watch.intersecting(shape) && pass.displayed(shape) };
      setGeometry((old) => (sameGeometry(old, next) ? old : next));
    };
    // the first read comes with the pass of the layer, after every region registered
    const release = watch.add({ shape, update });
    return () => {
      release();
      region.remove();
    };
  }, [root, cell, viewport, watch, plane, mark, id]);
  return { portal, geometry };
}

/**
 * The look of a region: the font of the theme over the background of the panel, or over the diagram with
 * `background: none`.
 */
function regionStyle(theme: GrafanaTheme2, width: number, height: number, clear: boolean): React.CSSProperties {
  return {
    width,
    height,
    overflow: 'hidden',
    fontSize: 12,
    fontFamily: theme.typography.fontFamily,
    lineHeight: 'normal',
    color: theme.colors.text.primary,
    background: clear ? 'transparent' : theme.colors.background.primary,
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
  // the inputs of the charts keep their identity per row: the memoised views below draw again only for a new row
  const history = useMemo(
    () =>
      row.kind === 'history' && row.state === 'ready' && row.lines && row.domain
        ? {
            chart: { lines: row.lines, domain: row.domain },
            series: row.lines.map((l) => ({
              name: l.label,
              color: l.color,
              history: lineHistory(l),
              format: row.format,
              noData: l.noData,
            })),
          }
        : undefined,
    [row]
  );
  const directions = useMemo(
    () =>
      row.kind === 'updown' && row.state === 'ready' && row.directions
        ? row.directions.map((d) => ({ name: d.label, color: d.color, history: d.history }))
        : undefined,
    [row]
  );
  // no room for the title line and the hint line below it: the hint ends the title line
  const merged = stale === true && height < TWO_LINES;
  const hint = stale && !merged ? <StaleHint /> : null;
  const mirrorHeight = plotHeightOf(height, stale && !merged ? 2 : 1);
  if (row.kind === 'history' && history) {
    const more = row.more ? `+${row.more} more` : '';
    return (
      <ChartHover
        enabled
        series={history.series}
        timeRange={timeRange}
        timeZone={timeZone}
        width={width}
        label={row.title}
        more={row.more}
      >
        <SparklineView
          chart={history.chart}
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
        <ValueLine label={row.title} inlineHint={merged} />
        <BarGaugeView
          value={row.display}
          field={row.config ?? {}}
          width={width}
          height={Math.max(0, height - LINE_HEIGHT)}
          stale={stale && !merged}
        />
      </>
    );
  }
  if (row.kind === 'updown' && row.state === 'ready' && row.directions && row.domain && directions) {
    return (
      <>
        <ValueLine label={row.title} value={row.text} valueTestId="dmap-chart-value" inlineHint={merged} />
        {hint}
        {mirrorHeight === null ? null : (
          <ChartHover
            enabled
            series={directions}
            timeRange={timeRange}
            timeZone={timeZone}
            width={width}
            label={row.title}
          >
            <MirrorSparkline
              directions={row.directions}
              domain={row.domain}
              width={width}
              height={mirrorHeight}
              timeRange={timeRange}
              label={row.title}
            />
          </ChartHover>
        )}
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
function RegionV4({
  use,
  watch,
  plane,
  ...props
}: ChartLayerProps & { use: ChartUse; watch: StageWatch | undefined; plane: HTMLDivElement | undefined }) {
  const { cells, bound, ctx } = props;
  const theme = useTheme2();
  const { portal, geometry } = useRegion(props, plane, watch, cells.get(use.cellId), 'data-dmap-chart', use.cellId);
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
      style={{
        ...regionStyle(theme, width, height, use.chart.background === 'none'),
        pointerEvents: props.interactive === false ? 'none' : 'auto',
      }}
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

/**
 * The chart regions over the diagram: one for each chart use of the bind (spec 3.9). Memoised: a commit of the panel
 * that changes none of its props (a hover card, a legend highlight) draws no region again.
 */
export const ChartLayer = React.memo(function ChartLayer(props: ChartLayerProps) {
  const plane = useRegionPlane(props.root, props.viewport);
  const watch = useStageWatch(props, plane);
  return (
    <>
      {props.charts.map((use) => (
        <RegionV4 key={use.cellId} {...props} use={use} watch={watch} plane={plane} />
      ))}
    </>
  );
});
