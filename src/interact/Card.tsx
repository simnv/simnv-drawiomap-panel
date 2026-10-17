import React, { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { IconButton, LinkButton, useStyles2, useTheme2 } from '@grafana/ui';
import { CardModel, CardRowModel, sparkPoints } from './cardModel';

/** Panels narrower than this show the card as a bottom sheet. */
export const SHEET_BELOW = 480;
const W = 280;
const GAP = 14;
const EDGE = 4;
/** The sparkline viewBox. preserveAspectRatio="none" stretches it to the full row width, the height is in px. */
const SPARK_W = 200;
const SPARK_H = 40;

export interface CardProps {
  model: CardModel;
  pinned: boolean;
  /** pointer position in panel coordinates */
  x: number;
  y: number;
  /** panel size: the card stays inside it */
  width: number;
  height: number;
  /** dashboard time range in ms, for the sparkline x axis */
  range?: { from: number; to: number };
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
  from,
  to,
  styles,
  baseline,
}: {
  row: CardRowModel;
  from?: number;
  to?: number;
  styles: ReturnType<typeof getStyles>;
  /** colour of the thin line at the bottom of the sparkline */
  baseline: string;
}) {
  const points = useMemo(
    () =>
      sparkPoints(
        row.values,
        row.times,
        from !== undefined && to !== undefined ? { from, to } : undefined,
        SPARK_W,
        SPARK_H
      ),
    [row.values, row.times, from, to]
  );
  const body = (
    <>
      <div className={styles.rowHead}>
        <span className={styles.rowTitle}>
          <span className={styles.dot} style={{ background: row.color }} />
          {row.title}
        </span>
        <span className={styles.value} style={row.status === 'ok' ? undefined : { color: row.color }}>
          {row.text}
        </span>
      </div>
      {points ? (
        <>
          <svg
            className={styles.spark}
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            preserveAspectRatio="none"
            data-testid="dmap-card-spark"
            aria-hidden="true"
          >
            <line
              x1={0}
              y1={SPARK_H - 0.5}
              x2={SPARK_W}
              y2={SPARK_H - 0.5}
              stroke={baseline}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={points}
              fill="none"
              stroke={row.color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {row.min !== undefined && row.max !== undefined ? (
            <div className={styles.range} data-testid="dmap-card-range">
              <span>min {row.min}</span>
              <span>max {row.max}</span>
            </div>
          ) : null}
        </>
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
export function Card({ model, pinned, x, y, width, height, range, onClose }: CardProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
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
          from={range?.from}
          to={range?.to}
          styles={styles}
          baseline={theme.colors.border.weak}
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
