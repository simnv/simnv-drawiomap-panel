import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { IconButton, useStyles2 } from '@grafana/ui';

/** A warning text: the first line is the short line, the lines after it are the details. */
export function splitWarning(text: string): { summary: string; details: string[] } {
  const [summary, ...details] = text.split('\n');
  return { summary, details };
}

const getStyles = (theme: GrafanaTheme2) => ({
  head: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${theme.spacing(1)};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  list: css`
    margin: 0;
    padding: 0;
    list-style: none;
  `,
  item: css`
    overflow-wrap: anywhere;
    & + & {
      margin-top: ${theme.spacing(0.75)};
      padding-top: ${theme.spacing(0.75)};
      border-top: 1px solid ${theme.colors.border.medium};
    }
  `,
  toggle: css`
    display: flex;
    gap: ${theme.spacing(0.5)};
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    &:focus-visible {
      outline: 2px solid ${theme.colors.primary.main};
    }
  `,
  marker: css`
    flex: none;
    width: 1em;
  `,
  details: css`
    margin: ${theme.spacing(0.5, 0, 0, 2)};
    white-space: pre-line;
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
});

/**
 * The pinned list of the warning badge: one short line for each warning. A line with details is a disclosure button:
 * it opens the details below it (for a failed query: each query with its expression, and the error text).
 */
export function WarningList({
  warnings,
  headingId,
  onClose,
}: {
  warnings: readonly string[];
  /** The id of the heading: the dialog that holds the list takes its name from it. */
  headingId?: string;
  onClose: () => void;
}) {
  const styles = useStyles2(getStyles);
  // the open warnings by their short line: a refresh that adds or removes a warning keeps each one open or closed
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (summary: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(summary)) {
        next.add(summary);
      }
      return next;
    });
  return (
    <>
      <div className={styles.head}>
        <span id={headingId}>
          {warnings.length} warning{warnings.length === 1 ? '' : 's'}
        </span>
        <IconButton name="times" size="sm" aria-label="Close" onClick={onClose} data-testid="dmap-warning-close" />
      </div>
      <ul className={styles.list}>
        {warnings.map((text, i) => {
          const { summary, details } = splitWarning(text);
          const key = `${summary}\n${i}`;
          if (!details.length) {
            return (
              <li key={key} className={styles.item} data-testid="dmap-warning-item">
                {summary}
              </li>
            );
          }
          const shown = open.has(summary);
          return (
            <li key={key} className={styles.item} data-testid="dmap-warning-item">
              <button type="button" className={styles.toggle} aria-expanded={shown} onClick={() => toggle(summary)}>
                <span className={styles.marker} aria-hidden="true">
                  {shown ? '▾' : '▸'}
                </span>
                <span>{summary}</span>
              </button>
              {shown ? (
                <div className={styles.details} data-testid="dmap-warning-details">
                  {details.join('\n')}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
