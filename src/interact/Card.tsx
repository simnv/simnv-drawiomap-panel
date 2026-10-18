import React, { memo, useLayoutEffect, useRef } from 'react';
import { css, cx } from '@emotion/css';
import { dateTime, FieldType, getDefaultTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { IconButton, LinkButton, useStyles2 } from '@grafana/ui';
import { CardModel, CardRowModel, type ConfiguredCardModel, type ConfiguredCardRow } from './cardModel';
import { SparklineView } from '../visuals/SparklineView';
import type { HistoryModel } from '../query/frames';
import { useSampleStale } from '../visuals/useSampleStale';

/** Panels narrower than this show the card as a bottom sheet. */
export const SHEET_BELOW = 480;
const W = 280;
const GAP = 14;
const EDGE = 4;
/** The sparkline viewBox. preserveAspectRatio="none" stretches it to the full row width, the height is in px. */
const SPARK_H = 40;

export interface CardProps {
  model: CardModel | ConfiguredCardModel;
  pinned: boolean;
  /** pointer position in panel coordinates */
  x: number;
  y: number;
  /** panel size: the card stays inside it */
  width: number;
  height: number;
  /** dashboard time range in ms, for the sparkline x axis */
  range?: { from: number; to: number };
  timeRange?: TimeRange;
  onClose: () => void;
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
  sheet: css`
    left: 0;
    right: 0;
    bottom: 0;
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
  dot: css`
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: ${theme.spacing(0.5)};
  `,
  spark: css`
    display: block;
    width: 100%;
    height: ${SPARK_H}px;
    margin-top: ${theme.spacing(0.5)};
  `,
  range: css`
    display: flex;
    justify-content: space-between;
    gap: ${theme.spacing(1)};
    font-size: ${theme.typography.pxToRem(11)};
    line-height: 1.3;
    color: ${theme.colors.text.secondary};
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
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
});

/** Memoised: the card re-renders on each pointer move, the rows change only with the data. */
const Row = memo(function Row({
  row,
  timeRange,
  styles,
  width,
}: {
  row: CardRowModel | ConfiguredCardRow;
  timeRange: TimeRange;
  styles: ReturnType<typeof getStyles>;
  width: number;
}) {
  const legacy = 'values' in row;
  const stale = useSampleStale(legacy ? undefined : row.sampleAt, legacy ? undefined : row.freshness);
  let history: HistoryModel | undefined = legacy ? undefined : row.history;
  if (legacy && row.values.length) {
    const values = row.values;
    const times =
      row.times ??
      values.map(
        (_, i) =>
          timeRange.from.valueOf() +
          (i * (timeRange.to.valueOf() - timeRange.from.valueOf())) / Math.max(1, values.length - 1)
      );
    history = {
      state: 'ready',
      field: { name: row.title, type: FieldType.number, config: {}, values },
      timeField: { name: 'Time', type: FieldType.time, config: {}, values: times },
      timestamps: times,
      values,
      latestValue: values.at(-1),
      fetchedAt: 0,
      fromCache: false,
    };
  }
  const body = (
    <>
      <div className={styles.rowHead}>
        <span className={styles.rowTitle}>
          {legacy ? <span className={styles.dot} style={{ background: row.color }} /> : null}
          {row.title}
        </span>
        <span className={styles.value}>
          {row.text}
          {stale && !history ? <small role="status"> Stale data</small> : null}
        </span>
      </div>
      {history ? (
        <div className={styles.spark} data-testid="dmap-card-spark">
          <SparklineView
            model={history}
            width={width}
            height={SPARK_H}
            timeRange={timeRange}
            label={row.title}
            showValue={false}
            freshness={legacy ? undefined : row.freshness}
          />
        </div>
      ) : null}
      {legacy && row.min !== undefined && row.max !== undefined ? (
        <div className={styles.range} data-testid="dmap-card-range">
          <span>min {row.min}</span>
          <span>max {row.max}</span>
        </div>
      ) : null}
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

/**
 * The hover card. Unpinned it follows the pointer and ignores the pointer. Pinned it is a non-modal
 * dialog with a close button, row links and footer links. Narrow panels show it as a bottom sheet.
 */
export function Card({ model, pinned, x, y, width, height, range, timeRange, onClose }: CardProps) {
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLDivElement>(null);
  const sheet = width < SHEET_BELOW;

  // Place the card after it renders: the height is known only then.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || sheet) {
      return;
    }
    const h = el.offsetHeight;
    let left = x + GAP;
    if (left + W > width - EDGE) {
      left = x - W - GAP;
    }
    let top = y + GAP;
    if (top + h > height - EDGE) {
      top = y - h - GAP;
    }
    el.style.left = `${Math.max(EDGE, Math.min(left, width - W - EDGE))}px`;
    el.style.top = `${Math.max(EDGE, Math.min(top, height - h - EDGE))}px`;
  });

  useLayoutEffect(() => {
    if (pinned) {
      ref.current?.focus({ preventScroll: true });
    }
  }, [pinned, model.title]);

  const style: React.CSSProperties = sheet
    ? { maxHeight: Math.max(120, Math.round(height * 0.6)) }
    : { width: W, maxHeight: height - 2 * EDGE, left: x + GAP, top: y + GAP };

  return (
    <div
      ref={ref}
      className={cx(styles.card, sheet && styles.sheet, !pinned && styles.hover)}
      style={style}
      role={pinned ? 'dialog' : 'tooltip'}
      aria-label={model.title}
      tabIndex={pinned ? -1 : undefined}
      data-testid="dmap-card"
      data-pinned={pinned}
      data-sheet={sheet}
    >
      <div className={styles.header}>
        <div className={styles.title}>{model.title}</div>
        {pinned ? <IconButton name="times" size="sm" aria-label="Close" onClick={onClose} /> : null}
      </div>
      {model.rows.map((r) => (
        <Row
          key={r.key}
          row={r}
          timeRange={
            timeRange ??
            (range
              ? {
                  from: dateTime(range.from),
                  to: dateTime(range.to),
                  raw: { from: dateTime(range.from), to: dateTime(range.to) },
                }
              : getDefaultTimeRange())
          }
          styles={styles}
          width={Math.max(1, Math.min(W, width) - 16)}
        />
      ))}
      {pinned && model.links.length ? (
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
      {!pinned && (model.links.length || model.rows.some((r) => r.href)) ? (
        <div className={styles.hint}>Click for links</div>
      ) : null}
    </div>
  );
}
