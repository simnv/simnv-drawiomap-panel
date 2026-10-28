import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { STATUS_SEVERITY, type StatusSummary, type StatusView } from '../binding/status';
import { NO_DATA_TEXT } from '../binding/statusV4';
import { statusColor } from '../binding/color';
import type { PatchMap } from '../types';

/** Height of one band row in px. The panel computes the band height from it before it renders. */
export const BAND_ROW = 20;
const BAND_PAD = 4;

export interface BandLayout {
  /** causes that the band shows */
  causes: number;
  /** causes behind the "+k more" row */
  hidden: number;
  /** the last row is "+k more" or "Show less" */
  toggle: boolean;
  /** band height in px, 0 when the band is not shown */
  height: number;
}

/**
 * The band above the diagram. Collapsed, it has at most maxRows rows and at most half of the panel height: when
 * there are more causes, the last row is "+k more" (with one row: "k causes"). Expanded, it shows all causes and
 * a "Show less" row, up to half of the panel height (then it scrolls). maxRows 0 hides the band. The band takes
 * its own space, so it never covers the diagram.
 */
export function bandLayout(count: number, maxRows: number, expanded: boolean, panelHeight: number): BandLayout {
  const max = Math.min(Math.floor(maxRows), Math.max(1, Math.floor((panelHeight / 2 - BAND_PAD) / BAND_ROW)));
  if (count === 0 || !(max > 0)) {
    return { causes: 0, hidden: 0, toggle: false, height: 0 };
  }
  if (count <= max) {
    return { causes: count, hidden: 0, toggle: false, height: count * BAND_ROW + BAND_PAD };
  }
  if (expanded) {
    const content = (count + 1) * BAND_ROW + BAND_PAD;
    const height = Math.min(content, Math.max(BAND_ROW + BAND_PAD, Math.floor(panelHeight / 2)));
    return { causes: count, hidden: 0, toggle: true, height };
  }
  const causes = max - 1;
  return { causes, hidden: count - causes, toggle: true, height: max * BAND_ROW + BAND_PAD };
}

const plural = (n: number) => `${n} element${n === 1 ? '' : 's'}`;
const cells = (n: number) => `${n} cell${n === 1 ? '' : 's'}`;
const marker = (state: StatusView['state']) => (state === 'missing' || state === 'stale' ? '?' : '!');

/** One row of the v4 band (spec 3.4). `text` is the full row text. */
export interface BandRowV4 {
  text: string;
  refId: string;
  count: number;
  severity: StatusView['state'];
}

/**
 * The rows of the v4 band (spec 3.4): one row for each state, text and refId of the cells that are not normal. The
 * row text is `<text> · <refId>: <n> cells`. A status with no value text ("–") gives its reason as the text. The order
 * is worst first, then the most cells first. A v3 status gives no row.
 */
export function bandRowsV4(patches: PatchMap): BandRowV4[] {
  const groups = new Map<string, { label: string; refId: string; severity: StatusView['state']; cellIds: string[] }>();
  for (const { cellId, statusView: status } of patches.values()) {
    if (status?.severity === undefined || status.state === 'normal') {
      continue;
    }
    const label = status.text && status.text !== NO_DATA_TEXT ? status.text : status.reason;
    const refId = status.refId ?? '';
    const key = JSON.stringify([status.state, label, refId]);
    const group = groups.get(key) ?? { label, refId, severity: status.state, cellIds: [] };
    groups.set(key, group);
    if (!group.cellIds.includes(cellId)) {
      group.cellIds.push(cellId);
    }
  }
  return [...groups.values()]
    .sort((a, b) => STATUS_SEVERITY[a.severity] - STATUS_SEVERITY[b.severity] || b.cellIds.length - a.cellIds.length)
    .map(({ label, refId, severity, cellIds }) => ({
      text: `${label} · ${refId}: ${cells(cellIds.length)}`,
      refId,
      count: cellIds.length,
      severity,
    }));
}

const getStyles = (theme: GrafanaTheme2) => ({
  band: css`
    box-sizing: border-box;
    flex: none;
    overflow-y: auto;
    padding: ${BAND_PAD / 2}px ${theme.spacing(1)};
    border-bottom: 1px solid ${theme.colors.border.weak};
    background: ${theme.colors.background.primary};
    font-size: 12px;
    line-height: ${BAND_ROW}px;
  `,
  list: css`
    margin: 0;
    padding: 0;
    list-style: none;
  `,
  row: css`
    display: flex;
    gap: ${theme.spacing(1)};
    height: ${BAND_ROW}px;
    white-space: nowrap;
  `,
  state: css`
    flex: none;
    font-weight: ${theme.typography.fontWeightBold};
  `,
  reason: css`
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: ${theme.colors.text.primary};
  `,
  count: css`
    flex: none;
    color: ${theme.colors.text.secondary};
    font-variant-numeric: tabular-nums;
  `,
  more: css`
    height: ${BAND_ROW}px;
    padding: 0;
    border: none;
    background: none;
    color: ${theme.colors.text.link};
    font: inherit;
    cursor: pointer;
    &:hover,
    &:focus-visible {
      text-decoration: underline;
    }
  `,
});

interface Props {
  summaries: StatusSummary[];
  /** the v4 rows (`bandRowsV4`); when set, the band shows them and not the v3 summaries */
  rowsV4?: BandRowV4[];
  layout: BandLayout;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * One row per cause of the elements that are not normal: state, reason and the number of elements. With `rowsV4`,
 * one row per v4 band row: the marker in the theme colour of its severity and the row text.
 */
export const StatusBand = React.forwardRef<HTMLElement, Props>(function StatusBand(
  { summaries, rowsV4, layout, expanded, onToggle },
  ref
) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  if (!layout.height) {
    return null;
  }
  const unit = rowsV4 ? cells : plural;
  const hiddenCells = rowsV4
    ? rowsV4.slice(layout.causes).reduce((n, r) => n + r.count, 0)
    : summaries.slice(layout.causes).reduce((n, s) => n + s.cellIds.length, 0);
  return (
    <section
      ref={ref}
      className={styles.band}
      style={{ height: layout.height }}
      aria-label="Status summary"
      data-testid="dmap-status-band"
    >
      <ul className={styles.list}>
        {rowsV4
          ? rowsV4.slice(0, layout.causes).map((r) => (
              <li
                key={`${r.severity}\n${r.text}`}
                className={`${styles.row} dmap-status-summary`}
                title={r.text}
                data-dmap-state={r.severity}
                data-dmap-count={r.count}
              >
                <span className={styles.state} style={{ color: statusColor({ state: r.severity }, theme) }}>
                  {marker(r.severity)}
                </span>
                <span className={styles.reason}>{r.text}</span>
              </li>
            ))
          : summaries.slice(0, layout.causes).map((s) => {
              const text = `${s.state}: ${s.reason} (${plural(s.cellIds.length)})`;
              return (
                <li
                  key={`${s.state}\n${s.reason}`}
                  className={`${styles.row} dmap-status-summary`}
                  title={text}
                  data-dmap-state={s.state}
                  data-dmap-count={s.cellIds.length}
                >
                  <span className={styles.state} style={{ color: statusColor(s, theme) }}>
                    {marker(s.state)} {s.state}
                  </span>
                  <span className={styles.reason}>{s.reason}</span>
                  <span className={styles.count}>{plural(s.cellIds.length)}</span>
                </li>
              );
            })}
        {layout.toggle ? (
          <li className={styles.row}>
            <button type="button" className={styles.more} aria-expanded={expanded} onClick={onToggle}>
              {expanded
                ? 'Show less'
                : layout.causes
                  ? `+${layout.hidden} more (${unit(hiddenCells)})`
                  : `${layout.hidden} causes (${unit(hiddenCells)})`}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
});
