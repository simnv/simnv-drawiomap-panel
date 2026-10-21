import React, { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { LegendCorner } from '../types';
import type { LegendBlock, LegendEntry } from './model';

const getStyles = (theme: GrafanaTheme2) => ({
  legend: css`
    box-sizing: border-box;
    max-width: min(280px, calc(100% - 8px));
    max-height: 50%;
    overflow-y: auto;
    padding: 2px ${theme.spacing(0.75)} 4px;
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.primary};
    box-shadow: ${theme.shadows.z1};
    font-size: 11px;
    line-height: 16px;
    color: ${theme.colors.text.secondary};
  `,
  chip: css`
    display: block;
    min-height: 20px;
    padding: 0;
    border: none;
    background: none;
    color: ${theme.colors.text.primary};
    font: inherit;
    font-weight: ${theme.typography.fontWeightMedium};
    cursor: pointer;
    &:focus-visible {
      outline: 2px solid ${theme.colors.primary.main};
    }
  `,
  block: css`
    margin-top: 2px;
  `,
  title: css`
    color: ${theme.colors.text.primary};
  `,
  entries: css`
    display: flex;
    flex-wrap: wrap;
    gap: 0 ${theme.spacing(1)};
    margin: 0;
    padding: 0;
    list-style: none;
  `,
  entry: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    border-radius: 2px;
    font-variant-numeric: tabular-nums;
    &:hover,
    &:focus-visible {
      color: ${theme.colors.text.primary};
      outline: 1px solid ${theme.colors.border.strong};
    }
  `,
  swatch: css`
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 2px;
  `,
  gradient: css`
    flex: none;
    width: 96px;
    height: 8px;
    border-radius: 2px;
  `,
});

interface Props {
  blocks: LegendBlock[];
  maxBlocks: number;
  /** A narrow panel (a phone) starts with the legend closed: only the "Legend" chip shows. */
  narrow: boolean;
  /** The cells of the entry under the pointer or the focus; null when no entry is active. */
  onHighlight: (cellIds: string[] | null) => void;
  className?: string;
  style?: React.CSSProperties;
  corner?: LegendCorner;
}

const plural = (n: number) => `${n} element${n === 1 ? '' : 's'}`;

/** The colour legend: one block for each colour scale of the bound cells. */
export const Legend = React.forwardRef<HTMLElement, Props>(function Legend(
  { blocks, maxBlocks, narrow, onHighlight, className, style, corner },
  ref
) {
  const styles = useStyles2(getStyles);
  const [open, setOpen] = useState(!narrow);
  // A change of the panel width between narrow and wide resets the legend (state adjustment during render).
  const [wasNarrow, setWasNarrow] = useState(narrow);
  if (wasNarrow !== narrow) {
    setWasNarrow(narrow);
    setOpen(!narrow);
  }
  // The active entry: "<block key>\n<entry key>", or "<block key>\n" for a gradient bar.
  const [active, setActive] = useState<string | null>(null);
  // The cells of the active entry now: a data refresh changes them, a closed legend has none.
  const activeIds = useMemo(() => {
    if (!open || active === null) {
      return null;
    }
    const [blockKey, entryKey] = active.split('\n');
    const block = blocks.find((b) => b.key === blockKey);
    return (entryKey ? block?.entries.find((e) => e.key === entryKey)?.cellIds : block?.cellIds) ?? null;
  }, [open, active, blocks]);
  useEffect(() => onHighlight(activeIds), [activeIds, onHighlight]);
  if (!blocks.length) {
    return null;
  }
  const shown = blocks.slice(0, Math.max(1, Math.floor(maxBlocks)));
  const hidden = blocks.length - shown.length;
  const activate = (key: string) => ({
    tabIndex: 0,
    onMouseEnter: () => setActive(key),
    onMouseLeave: () => setActive(null),
    onFocus: () => setActive(key),
    onBlur: () => setActive(null),
  });
  const entry = (blockKey: string, e: LegendEntry) => (
    <li
      key={e.key}
      className={styles.entry}
      data-testid="dmap-legend-entry"
      aria-label={`${e.label}: ${plural(e.cellIds.length)}`}
      {...activate(`${blockKey}\n${e.key}`)}
    >
      <span className={styles.swatch} style={{ background: e.color }} data-dmap-swatch="" />
      {e.label}
    </li>
  );
  return (
    <section
      ref={ref}
      className={`${styles.legend} ${className ?? ''}`}
      style={style}
      aria-label="Colour legend"
      data-testid="dmap-legend"
      data-dmap-corner={corner}
    >
      <button
        type="button"
        className={styles.chip}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setActive(null);
        }}
      >
        Legend
      </button>
      {open
        ? shown.map((b) => (
            <div
              key={b.key}
              className={styles.block}
              role="group"
              data-testid="dmap-legend-block"
              aria-label={b.title ?? 'No data'}
            >
              {b.title ? <div className={styles.title}>{b.title}</div> : null}
              <ul className={styles.entries}>
                {b.gradient ? (
                  <li
                    className={styles.entry}
                    data-testid="dmap-legend-entry"
                    aria-label={`${b.gradient.min} to ${b.gradient.max}: ${plural(b.cellIds.length)}`}
                    {...activate(`${b.key}\n`)}
                  >
                    <span>{b.gradient.min}</span>
                    <span
                      className={styles.gradient}
                      style={{ background: `linear-gradient(to right, ${b.gradient.colors.join(', ')})` }}
                      data-dmap-gradient=""
                    />
                    <span>{b.gradient.max}</span>
                  </li>
                ) : null}
                {b.entries.map((e) => entry(b.key, e))}
              </ul>
            </div>
          ))
        : null}
      {open && hidden > 0 ? <div className={styles.block}>+{hidden} more</div> : null}
    </section>
  );
});
