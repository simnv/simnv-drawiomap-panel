import React, { useLayoutEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { BAR_WIDTH, barTicks, TICK_FONT } from './bar';
import { barPercent, type LegendBar, type LegendEntry, plural } from './model';

const getStyles = (theme: GrafanaTheme2) => ({
  // A bar of threshold steps with the step values under it. It shrinks in a narrow panel; the tick texts follow its
  // width.
  bar: css`
    position: relative;
    width: ${BAR_WIDTH}px;
    max-width: 100%;
    padding-bottom: ${TICK_FONT + 2}px;
    font-variant-numeric: tabular-nums;
  `,
  segments: css`
    display: flex;
    margin: 0;
    padding: 0;
    list-style: none;
  `,
  // The segment is as high as a text line, so the pointer and a finger find it; its colour is 8 px high.
  segment: css`
    flex: none;
    padding: 4px 0;
    border-radius: 2px;
    &:first-child > span {
      border-radius: 2px 0 0 2px;
    }
    &:last-child > span {
      border-radius: 0 2px 2px 0;
    }
    &:hover,
    &:focus-visible {
      position: relative;
      z-index: 1;
      outline: 1px solid ${theme.colors.border.strong};
    }
  `,
  fill: css`
    display: block;
    height: 8px;
  `,
  tick: css`
    position: absolute;
    bottom: 0;
    transform: translateX(-50%);
    font-size: ${TICK_FONT}px;
    line-height: ${TICK_FONT + 2}px;
    white-space: nowrap;
  `,
});

interface BarRowProps {
  bar: LegendBar;
  /** one for each segment of the bar, in the same order */
  entries: LegendEntry[];
  /** the props that make an entry active on hover, focus and tap */
  activate: (e: LegendEntry) => React.HTMLAttributes<HTMLElement>;
}

/**
 * A bar of threshold steps: one segment for each entry, so each step keeps its highlight, focus and tap. The tick
 * texts that fit the width of the bar show under it, at the stops between the segments.
 */
export function BarRow({ bar, entries, activate }: BarRowProps) {
  const styles = useStyles2(getStyles);
  const [width, setWidth] = useState(BAR_WIDTH);
  const [node, setNode] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!node) {
      return;
    }
    // no layout (a test DOM) gives 0: keep the nominal width
    const read = () => setWidth(node.clientWidth || BAR_WIDTH);
    read();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return (
    <div ref={setNode} className={styles.bar} data-dmap-bar="">
      <ul className={styles.segments}>
        {bar.segments.map((s, i) =>
          entries[i] ? (
            <li
              key={entries[i].key}
              className={styles.segment}
              style={{ width: barPercent(s.to - s.from) }}
              data-testid="dmap-legend-entry"
              aria-label={`${s.range}: ${plural(entries[i].cellIds.length)}`}
              {...activate(entries[i])}
            >
              <span className={styles.fill} style={{ background: entries[i].color }} data-dmap-swatch="" />
            </li>
          ) : null
        )}
      </ul>
      {barTicks(bar.segments, width).map((t) => (
        <span key={t.text} className={styles.tick} style={{ left: barPercent(t.at) }} aria-hidden data-dmap-tick="">
          {t.text}
        </span>
      ))}
    </div>
  );
}
