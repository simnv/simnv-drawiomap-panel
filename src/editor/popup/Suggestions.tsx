import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, useStyles2 } from '@grafana/ui';
import type { Candidate } from '../../binding/candidates';

export interface SuggestionsProps {
  candidates: readonly Candidate[];
  /** The id of the selected cell. */
  cellId: string;
  /** The readable name of the cell that a candidate writes to. */
  nameOf: (id: string) => string;
  /** The use has a regex matcher and no candidate: say why there is none. */
  regex: boolean;
  /** The generator made the panel: the next build writes the attributes again. */
  generated: boolean;
  onApply: (candidate: Candidate) => void;
}

const labelSet = (labels: Candidate['labels']) =>
  `{${Object.entries(labels)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(', ')}}`;

/**
 * The key candidates of one use with no series: one row for each, with a button that writes the attribute. When
 * the write goes to another cell (the measured end of a link), the row and the button name that cell.
 */
export function Suggestions({ candidates, cellId, nameOf, regex, generated, onApply }: SuggestionsProps) {
  const styles = useStyles2(getStyles);
  if (!candidates.length) {
    return regex ? (
      <p className={styles.note} data-testid="dmap-inspector-no-suggestion">
        No suggestion for a regex match.
      </p>
    ) : null;
  }
  return (
    <div data-testid="dmap-inspector-suggestions">
      <h5 className={styles.title}>Suggestions</h5>
      <ul className={styles.list}>
        {candidates.map((candidate) => {
          const elsewhere = candidate.target !== cellId;
          const target = nameOf(candidate.target);
          return (
            <li
              key={`${candidate.target}\n${candidate.attr}\n${candidate.value}`}
              className={styles.row}
              data-testid="dmap-inspector-suggestion"
            >
              <span>
                Set <code>{candidate.attr}</code> = <code>{candidate.value}</code> on {target}
                {candidate.via === 'orphan' ? <span className={styles.badge}>unused series</span> : null}
              </span>
              <span className={styles.labels}>{labelSet(candidate.labels)}</span>
              <Button size="sm" variant="secondary" onClick={() => onApply(candidate)}>
                {elsewhere ? `Set on ${target}` : 'Set it'}
              </Button>
            </li>
          );
        })}
      </ul>
      {generated ? (
        <p className={styles.note} data-testid="dmap-inspector-suggestions-generated">
          This panel is generated. The next build writes these attributes again. To keep a change, change the source of
          the panel.
        </p>
      ) : null}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  title: css({ fontSize: theme.typography.bodySmall.fontSize, fontWeight: 500, margin: theme.spacing(1, 0, 0.5) }),
  list: css({
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  row: css({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: theme.spacing(0.25) }),
  labels: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  badge: css({
    marginLeft: theme.spacing(1),
    padding: theme.spacing(0, 0.5),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.warning.transparent,
    color: theme.colors.warning.text,
  }),
  note: css({ color: theme.colors.text.secondary, margin: theme.spacing(0.5, 0) }),
});
