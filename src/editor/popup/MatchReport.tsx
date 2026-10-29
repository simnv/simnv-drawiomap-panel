import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { ReportEntry, UsePath } from '../../binding/report';
import { parsePath, yamlPath } from '../../model/yamlPath';
import { reportLine } from '../../stage/useBoundDiagram';
import type { reportCounts, SeriesCounts } from '../split/reportCounts';

/** The YAML place of a report entry (a path or a line) and its cells (spec 4). */
export interface EntryTarget {
  path?: string;
  line?: number;
  cells: string[];
}

/**
 * A click in the report. A count row gives a path: the editor lights the cells of the path, as a cursor move does
 * (spec 5.3). An entry gives its own cells: the editor lights them; an entry with no cells moves the cursor only.
 */
export type ReportPick = { kind: 'path'; path: string } | ({ kind: 'entry' } & EntryTarget);

const classPath = (cls: string, ...rest: string[]) => yamlPath(['classes', cls, ...rest]);

/** The YAML place and the cells of a report entry. */
export function entryTarget(entry: ReportEntry): EntryTarget {
  switch (entry.kind) {
    case 'yaml':
      return { line: entry.line, cells: [] };
    case 'schema':
    case 'unknown-ref':
      return { path: entry.path, cells: [] };
    case 'outdated-config':
      return { path: 'version', cells: [] };
    case 'class-cycle':
    case 'class-unknown-parent':
    case 'class-invalid-parent':
      return { path: classPath(entry.cls, 'extends'), cells: [] };
    case 'class-no-cells':
      return { path: classPath(entry.cls), cells: [] };
    case 'class-no-match':
      return { path: classPath(entry.cls), cells: entry.cellIds };
    case 'unknown-override':
      return { path: yamlPath(['overrides', entry.cellId]), cells: [] };
    case 'missing-attr':
    case 'matcher-error':
    case 'template-unresolved':
      return { path: entry.path, cells: entry.cellIds };
    case 'no-series':
    case 'unit-mismatch':
      return { path: entry.use, cells: entry.cellIds };
    case 'many-series':
      return { path: entry.use, cells: entry.cells.map((c) => c.id) };
    case 'capacity-fallback':
      return { path: classPath(entry.cls, 'capacity'), cells: entry.cellIds };
    case 'unused-field':
      return { path: classPath(entry.cls, entry.field), cells: entry.cellIds };
    case 'unknown-class':
    case 'bad-cap':
    case 'no-edge-ends':
      return { cells: entry.cellIds };
    case 'query-unavailable':
    case 'orphan-series':
    case 'many-fields':
    case 'invalid-series':
    case 'duplicate-series':
      return { cells: [] };
  }
}

/** The class of a path: `classes.<c>…` gives `c`. */
function classOfPath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const [root, name] = parsePath(path);
  return root === 'classes' && typeof name === 'string' ? name : undefined;
}

/** The class of an entry: its `cls`, else the class of its path. */
const classOf = (entry: ReportEntry) => ('cls' in entry ? entry.cls : classOfPath(entryTarget(entry).path));

export interface MatchReportProps {
  /** The `yaml` entries of the code box, then the report of the bind. */
  entries: ReportEntry[];
  counts: ReturnType<typeof reportCounts>;
  onPick: (pick: ReportPick) => void;
}

interface Group {
  cls?: string;
  cells?: SeriesCounts & { cells: number };
  uses: Array<[UsePath, SeriesCounts]>;
  entries: ReportEntry[];
}

/** One group per class (in the order of the config), then the classes that only entries name, then the rest. */
function groupsOf({ entries, counts }: Pick<MatchReportProps, 'entries' | 'counts'>): Group[] {
  const groups = new Map<string | undefined, Group>();
  const groupOf = (cls: string | undefined) => {
    let group = groups.get(cls);
    if (!group) {
      group = { cls, uses: [], entries: [] };
      groups.set(cls, group);
    }
    return group;
  };
  for (const [cls, cells] of counts.perClass) {
    groupOf(cls).cells = cells;
  }
  for (const [use, of] of counts.perUse) {
    groupOf(classOfPath(use)).uses.push([use, of]);
  }
  for (const entry of entries) {
    groupOf(classOf(entry)).entries.push(entry);
  }
  const other = groups.get(undefined);
  groups.delete(undefined);
  return other ? [...groups.values(), other] : [...groups.values()];
}

/**
 * The match report below the code box (spec 4): per class, the number of cells and the cells with 0, 1 and more
 * series of their first use, the same counts per use, and the entries of the class. A click on a row moves the cursor
 * to its YAML place (spec 5.3).
 */
export function MatchReport({ entries, counts, onPick }: MatchReportProps) {
  const styles = useStyles2(getStyles);
  const groups = groupsOf({ entries, counts });
  return (
    <section aria-label="Match report" className={styles.report} data-testid="dmap-match-report">
      {groups.length === 0 ? <p className={styles.empty}>The config has no classes.</p> : null}
      {groups.map((group) => {
        const name = group.cls === undefined ? 'Not in a class' : `Class ${group.cls}`;
        return (
          <section key={name} aria-label={name} className={styles.group}>
            <h3 className={styles.title}>{name}</h3>
            {group.cells || group.uses.length ? (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Path</th>
                    <th scope="col">Cells</th>
                    <th scope="col">0 series</th>
                    <th scope="col">1 series</th>
                    <th scope="col">More</th>
                  </tr>
                </thead>
                <tbody>
                  {group.cells && group.cls !== undefined ? (
                    <CountRow
                      label={`${group.cls}, first use`}
                      cells={group.cells.cells}
                      counts={group.cells}
                      onClick={() => onPick({ kind: 'path', path: classPath(group.cls!) })}
                    />
                  ) : null}
                  {group.uses.map(([use, of]) => (
                    <CountRow key={use} label={use} counts={of} onClick={() => onPick({ kind: 'path', path: use })} />
                  ))}
                </tbody>
              </table>
            ) : null}
            {group.entries.length ? (
              <ul className={styles.entries}>
                {group.entries.map((entry, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() => onPick({ kind: 'entry', ...entryTarget(entry) })}
                    >
                      {reportLine(entry)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}

function CountRow(props: { label: string; cells?: number; counts: SeriesCounts; onClick: () => void }) {
  const styles = useStyles2(getStyles);
  const { zero, one, many } = props.counts;
  return (
    <tr>
      <th scope="row">
        <button type="button" className={styles.link} onClick={props.onClick}>
          {props.label}
        </button>
      </th>
      <td>{props.cells ?? ''}</td>
      <td className={zero ? styles.zero : undefined}>{zero}</td>
      <td>{one}</td>
      <td>{many}</td>
    </tr>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  report: css({ padding: theme.spacing(1), fontSize: theme.typography.bodySmall.fontSize }),
  empty: css({ color: theme.colors.text.secondary }),
  group: css({ marginBottom: theme.spacing(1.5) }),
  title: css({ fontSize: theme.typography.h6.fontSize, margin: theme.spacing(0, 0, 0.5) }),
  table: css({
    borderCollapse: 'collapse',
    '& th, & td': { padding: theme.spacing(0.25, 1), textAlign: 'left', fontWeight: 'normal' },
    '& thead th': { color: theme.colors.text.secondary },
    '& td': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  }),
  // a count of 0 is a problem: the cells have no series
  zero: css({ color: theme.colors.error.text }),
  entries: css({ listStyle: 'none', margin: theme.spacing(0.5, 0, 0), padding: 0 }),
  link: css({
    border: 0,
    padding: 0,
    background: 'none',
    font: 'inherit',
    color: theme.colors.text.link,
    textAlign: 'left',
    cursor: 'pointer',
    '&:hover': { textDecoration: 'underline' },
  }),
});
