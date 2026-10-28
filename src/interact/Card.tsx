import React, {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { css, cx } from '@emotion/css';
import { FieldType, getDefaultTimeRange, getFieldSeriesColor, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { IconButton, LinkButton, useStyles2, useTheme2 } from '@grafana/ui';
import { statusTextColor } from '../binding/color';
import {
  chartHeight,
  staleDeadline,
  type CardModelV4,
  type ConfiguredCardModel,
  type ConfiguredCardRow,
} from './cardModel';
import { historyChart, SparklineView, type ChartLine, type HistoryChart } from '../visuals/SparklineView';
import { MirrorSparkline } from '../visuals/MirrorSparkline';
import { ChartHover, type HoverSeries } from '../visuals/ChartHover';
import { placeTooltip } from '../visuals/tooltipPlace';
import { useClock } from '../visuals/useSampleStale';
import { isPast } from '../binding/status';
import type { HistoryModel } from '../query/frames';

/** Panels narrower than this show the pinned or hover card as a sheet at the bottom of the viewport. */
export const SHEET_BELOW = 480;
const W = 280;
const GAP = 14;
const EDGE = 4;
/** Padding (8 px each side) and border (1 px each side) of the card: the charts of an inline card are narrower by this. */
const INLINE_CHROME = 18;

/** The card input: the v3 card model, or the v4 card model of `buildCardV4`. Both have the same row type. */
export type CardView = Pick<ConfiguredCardModel, 'title' | 'rows' | 'links'> | CardModelV4;

export interface CardProps {
  model: CardView;
  pinned: boolean;
  /**
   * `floating` (default) follows the pointer or sits fixed in the panel; narrow panels show it as a sheet.
   * `inline` is part of the page flow: no placement, no close button, no sheet. The bindings popup uses it.
   */
  variant?: 'floating' | 'inline';
  /** pointer position in panel coordinates (floating) */
  x?: number;
  y?: number;
  /** panel size: the floating card stays inside it. For the inline card: the width of its container. */
  width: number;
  height?: number;
  /** the panel element: the sheet has its horizontal position */
  anchor?: HTMLElement | null;
  /** dashboard time range, for the sparkline x axis */
  timeRange?: TimeRange;
  timeZone?: string;
  onClose?: () => void;
  /** The cell that the card shows, for probes: written as `data-dmap-cell`. */
  cellId?: string;
  /** The latest pointer position of the panel, in client coordinates. The hover card places itself from it. */
  pointerRef?: React.MutableRefObject<{ x: number; y: number } | null>;
  /**
   * The card sets this to a function that places it at the latest `pointerRef` in the next frame, with no render.
   * The panel rect and the card height are read first, then the style is written.
   */
  moveRef?: React.MutableRefObject<(() => void) | null>;
}

const getStyles = (theme: GrafanaTheme2) => ({
  card: css`
    position: absolute;
    z-index: 3;
    display: flex;
    flex-direction: column;
    overflow: auto;
    padding: ${theme.spacing(1)};
    background: ${theme.colors.background.elevated ?? theme.colors.background.secondary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z3};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.primary};
    outline: none;
  `,
  hover: css`
    pointer-events: none;
  `,
  inline: css`
    position: static;
    z-index: auto;
    width: 100%;
    box-sizing: border-box;
    box-shadow: none;
    /* The charts have the width of the card. A chart a few px too wide would widen its pane, and the pane the chart. */
    min-width: 0;
    overflow: hidden;
  `,
  // Fixed to the viewport, so the sheet is visible also in a panel that is taller than the screen. The panel
  // renders it in a portal: a CSS transform of a parent (the Grafana grid item) would move a fixed element.
  sheet: css`
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: ${theme.zIndex.modal};
    max-height: 60vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: calc(${theme.spacing(1)} + env(safe-area-inset-bottom, 0px));
    border-radius: ${theme.shape.radius.default} ${theme.shape.radius.default} 0 0;
    border-bottom: none;
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    margin-bottom: ${theme.spacing(0.5)};
  `,
  title: css`
    flex: 1;
    min-width: 0;
    font-weight: ${theme.typography.fontWeightMedium};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  row: css`
    display: block;
    padding: ${theme.spacing(0.5)};
    margin: 0 ${theme.spacing(-0.5)};
    border-radius: ${theme.shape.radius.default};
    color: inherit;
    text-decoration: none;
    &:hover,
    &:focus-visible {
      background: ${theme.colors.action.hover};
      text-decoration: none;
    }
  `,
  rowHead: css`
    display: flex;
    align-items: baseline;
    gap: ${theme.spacing(1)};
  `,
  rowTitle: css`
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: ${theme.colors.text.secondary};
  `,
  value: css`
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  `,
  // keeps the two spaces between the directions of a combined row
  pre: css`
    white-space: pre;
  `,
  spark: css`
    display: block;
    width: 100%;
    margin-top: ${theme.spacing(0.5)};
  `,
  footer: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.spacing(0.5)};
    margin: ${theme.spacing(0.5, -1, 0)};
    padding: ${theme.spacing(0.5, 0, 0)};
    border-top: 1px solid ${theme.colors.border.weak};
  `,
  hint: css`
    margin-top: ${theme.spacing(0.5)};
    color: ${theme.colors.text.secondary};
  `,
  more: css`
    color: ${theme.colors.text.secondary};
  `,
});

const NO_DEADLINES: readonly number[] = [];

/** A line as the history of the chart tooltip: the tooltip reads the times and the values. */
function lineHistory(line: ChartLine): HistoryModel {
  return {
    state: 'ready',
    field: { name: line.label, type: FieldType.number, config: {}, values: line.values },
    timeField: { name: 'Time', type: FieldType.time, config: {}, values: line.times },
    timestamps: line.times,
    values: line.values,
    fetchedAt: 0,
    fromCache: false,
  };
}

/** Memoised: the card re-renders on each pointer move, the rows change only with the data. */
const Row = memo(function Row({
  row,
  timeRange,
  timeZone,
  pinned,
  styles,
  width,
  chartsReady,
}: {
  row: ConfiguredCardRow;
  timeRange: TimeRange;
  timeZone?: string;
  pinned: boolean;
  styles: ReturnType<typeof getStyles>;
  width: number;
  /** false in the first commit of a hover card: the chart rows show an empty box of their final height */
  chartsReady: boolean;
}) {
  const theme = useTheme2();
  // a v4 row is stale at the bind or after its deadline; a v3 row after its sample time and freshness policy
  const deadline = staleDeadline(row);
  const now = useClock(deadline === undefined ? NO_DEADLINES : [deadline]);
  const stale = row.stale === true || (deadline !== undefined && isPast(deadline, now));
  const { history, directions, lines, domain, format } = row;
  // the chart of a history row: the lines of a v4 row, or one line through the shim of a v3 history
  const chart = useMemo((): HistoryChart | undefined => {
    if (lines && domain) {
      // a v4 row with no series tells why in its text
      return row.state === 'ready' ? { lines, domain } : { message: row.text };
    }
    return history ? historyChart(history, { label: row.title, theme, min: row.min, max: row.max }) : undefined;
  }, [lines, domain, history, row.state, row.text, row.title, row.min, row.max, theme]);
  const hoverSeries = useMemo((): HoverSeries[] => {
    if (directions) {
      return directions.map((d) => ({ name: d.label, color: d.color, history: d.history }));
    }
    if (lines) {
      return lines.map((l) => ({ name: l.label, color: l.color, history: lineHistory(l), format }));
    }
    if (!history) {
      return [];
    }
    const color =
      history.state === 'ready' ? getFieldSeriesColor(history.field, theme).color : theme.colors.primary.main;
    return [{ name: row.title, color, history }];
  }, [directions, lines, format, history, row.title, theme]);
  const chartH = chartHeight(row);
  const body = (
    <>
      <div className={styles.rowHead}>
        <span
          className={styles.rowTitle}
          style={row.status ? { color: statusTextColor({ state: row.status }, theme) } : undefined}
        >
          {row.title}
        </span>
        <span className={cx(styles.value, directions && styles.pre)} data-testid="dmap-card-value">
          {directions
            ? directions.map((d, j) => (
                <React.Fragment key={d.direction}>
                  {j ? '  ' : ''}
                  <span style={{ color: d.color }}>{d.label}</span> {d.text}
                </React.Fragment>
              ))
            : row.text}
          {stale && !chart ? <small role="status"> Stale data</small> : null}
        </span>
      </div>
      {!chartsReady && (chart || (directions && row.domain)) ? (
        <div className={styles.spark} style={{ height: chartH }} data-testid="dmap-card-spark" />
      ) : directions && row.domain ? (
        <div className={styles.spark} style={{ height: chartH }} data-testid="dmap-card-spark">
          <ChartHover enabled={pinned} series={hoverSeries} timeRange={timeRange} timeZone={timeZone} label={row.title}>
            <MirrorSparkline
              directions={directions}
              domain={row.domain}
              width={width}
              height={chartH}
              timeRange={timeRange}
              label={row.title}
            />
          </ChartHover>
        </div>
      ) : chart ? (
        <div className={styles.spark} style={{ height: chartH }} data-testid="dmap-card-spark">
          <ChartHover
            enabled={pinned}
            series={hoverSeries}
            timeRange={timeRange}
            timeZone={timeZone}
            width={width}
            label={row.title}
          >
            <SparklineView
              chart={chart}
              config={history?.state === 'ready' ? history.field.config : undefined}
              width={width}
              height={chartH}
              timeRange={timeRange}
              label={row.title}
              showValue={false}
              stale={stale}
            />
          </ChartHover>
        </div>
      ) : null}
      {row.more ? <div className={styles.more}>+{row.more} more</div> : null}
    </>
  );
  return row.href ? (
    <a className={styles.row} href={row.href} target="_blank" rel="noopener noreferrer" data-testid="dmap-card-row">
      {body}
    </a>
  ) : (
    <div className={styles.row} data-testid="dmap-card-row">
      {body}
    </div>
  );
});

/** Writes the place of the floating card for a pointer at (x, y) in the panel. The height is read before the writes. */
function placeAt(el: HTMLElement, x: number, y: number, width: number, height: number) {
  const h = el.offsetHeight;
  const p = placeTooltip(x, y, W, h, width, height, EDGE, GAP);
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
}

/**
 * The hover card. Unpinned it follows the pointer and ignores the pointer. Pinned it is a non-modal
 * dialog with a close button, row links and footer links. Narrow panels show it as a bottom sheet.
 */
export function Card({
  model,
  pinned,
  variant = 'floating',
  x = 0,
  y = 0,
  width,
  height = 0,
  anchor,
  timeRange,
  timeZone,
  onClose,
  cellId,
  pointerRef,
  moveRef,
}: CardProps) {
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLDivElement>(null);
  const inline = variant === 'inline';
  const sheet = !inline && width < SHEET_BELOW;
  const rowTimeRange = timeRange ?? getDefaultTimeRange();

  // A hover card renders in two commits. The first, in the pointer task, has the texts and an empty box of the final
  // height per chart row, so the card is placed once. The charts (uPlot) come in a transition. A card that unmounts
  // before it (the pointer left the cell) pays for the texts only. A pinned card and the inline card of the popup
  // have the charts at once: the user asked for them, and they are not on a pointer path.
  const [chartsReady, setChartsReady] = useState(pinned || inline);
  useEffect(() => {
    if (!chartsReady) {
      startTransition(() => setChartsReady(true));
    }
  }, [chartsReady]);

  // The place in the panel. A hover card follows the latest pointer position of the panel (`pointerRef`, client
  // coordinates) and nothing else. A pinned card uses only its own x and y.
  const target = () => {
    const rect = anchor?.getBoundingClientRect();
    const at = !pinned ? pointerRef?.current : undefined;
    return at && rect ? { x: at.x - rect.left, y: at.y - rect.top } : { x, y };
  };
  // Place the card after it renders: the height is known only then.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || inline) {
      return;
    }
    if (sheet) {
      // the width of the panel, at the bottom of the viewport
      const r = anchor?.getBoundingClientRect();
      if (r && r.width > 0) {
        el.style.left = `${Math.max(0, r.left)}px`;
        el.style.right = `${Math.max(0, document.documentElement.clientWidth - r.right)}px`;
      }
      return;
    }
    const at = target();
    placeAt(el, at.x, at.y, width, height);
  });

  // The pointer moves inside the cell: place in a frame, no render. Reads come before the writes. The panel gives a
  // new cell or a pin another instance (a React key), so no frame outlives the state it was queued for.
  const frame = useRef<number>();
  const latest = useRef({ target, width, height, floating: !sheet && !inline });
  useEffect(() => {
    latest.current = { target, width, height, floating: !sheet && !inline };
  });
  const move = useCallback(() => {
    if (frame.current !== undefined) {
      return;
    }
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const el = ref.current;
      const now = latest.current;
      // a sheet has its place in the viewport, an inline card has none
      if (!el || !now.floating) {
        return;
      }
      const at = now.target();
      placeAt(el, at.x, at.y, now.width, now.height);
    });
  }, []);
  useEffect(() => {
    if (moveRef) {
      moveRef.current = move;
    }
    return () => {
      if (moveRef) {
        moveRef.current = null;
      }
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current);
        frame.current = undefined;
      }
    };
  }, [moveRef, move]);

  useLayoutEffect(() => {
    if (pinned && !inline) {
      ref.current?.focus({ preventScroll: true });
    }
  }, [pinned, inline, model.title]);

  const style: React.CSSProperties =
    sheet || inline ? {} : { width: W, maxHeight: height - 2 * EDGE, left: x + GAP, top: y + GAP };

  return (
    <div
      ref={ref}
      className={cx(styles.card, sheet && styles.sheet, inline && styles.inline, !pinned && !inline && styles.hover)}
      style={style}
      role={inline ? 'group' : pinned ? 'dialog' : 'tooltip'}
      aria-label={model.title}
      tabIndex={pinned ? -1 : undefined}
      data-testid="dmap-card"
      data-dmap-cell={cellId}
      data-pinned={pinned}
      data-sheet={sheet}
      data-variant={variant}
    >
      <div className={styles.header}>
        <div className={styles.title}>{model.title}</div>
        {pinned && !inline ? <IconButton name="times" size="sm" aria-label="Close" onClick={onClose} /> : null}
      </div>
      {model.rows.map((r) => (
        <Row
          key={r.key}
          row={r}
          timeRange={rowTimeRange}
          timeZone={timeZone}
          pinned={pinned}
          styles={styles}
          width={Math.max(1, inline ? width - INLINE_CHROME : Math.min(W, width) - 16)}
          chartsReady={chartsReady}
        />
      ))}
      {(pinned || inline) && model.links.length ? (
        <div className={styles.footer}>
          {model.links.map((l, i) => (
            <LinkButton
              key={`${i}-${l.href}`}
              size="sm"
              fill="text"
              icon={l.target === '_blank' ? 'external-link-alt' : undefined}
              href={l.href}
              target={l.target}
              rel="noopener noreferrer"
              onClick={l.onClick ? (ev) => l.onClick!(ev) : undefined}
              data-testid="dmap-card-link"
            >
              {l.title}
            </LinkButton>
          ))}
        </div>
      ) : null}
      {!pinned && !inline && (model.links.length || model.rows.some((r) => r.href)) ? (
        <div className={styles.hint}>Click for links</div>
      ) : null}
    </div>
  );
}
