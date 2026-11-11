import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Tab, TabsBar, useStyles2 } from '@grafana/ui';
import type { ReportEntry, UsePath } from '../../binding/report';
import type { ConfigV4 } from '../../model/v4';
import { yamlPath } from '../../model/yamlPath';
import {
  classOfPath,
  entryTarget,
  groupReport,
  reportGroupLine,
  reportUse,
  type ReportGroup,
  type ReportPick,
} from '../../stage/reportView';
import type { reportCounts, SeriesCounts } from '../split/reportCounts';

export { classOfPath, entryTarget, type EntryTarget, type ReportPick } from '../../stage/reportView';

const classPath = (cls: string, ...rest: string[]) => yamlPath(['classes', cls, ...rest]);

/**
 * A request to open the tab of a group: a class name, or null for the entries without a class. Each new object opens
 * the tab again, also for the same group: the user can open another tab between two requests.
 */
export interface ReportFollow {
  group: string | null;
}

export interface MatchReportProps {
  /** The `yaml` entries of the code box, then the report of the bind. */
  entries: ReportEntry[];
  counts: ReturnType<typeof reportCounts>;
  config?: ConfigV4 | null;
  onPick: (pick: ReportPick) => void;
  /** The group of the cursor or of the clicked cell. A group with no tab keeps the tab. */
  follow?: ReportFollow;
}

interface Group {
  cls?: string;
  cells?: SeriesCounts & { cells: number };
  uses: Array<[UsePath, SeriesCounts]>;
  entries: ReportGroup[];
}

/** One group per class (in the order of the config), then the classes that only entries name, then the rest. */
function groupsOf({ entries, counts, config }: Pick<MatchReportProps, 'entries' | 'counts' | 'config'>): Group[] {
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
  for (const row of groupReport(entries, config)) {
    groupOf(row.cls).entries.push(row);
  }
  const other = groups.get(undefined);
  groups.delete(undefined);
  return other ? [...groups.values(), other] : [...groups.values()];
}

/** The key of the tab of a group: the class name, or null for the entries without a class. */
const keyOf = (group: Group) => group.cls ?? null;

/**
 * The match report below the code box (spec 4): one tab per class (in the order of the config), then a tab for the
 * entries without a class. A tab shows the number of cells and the cells with 0, 1 and more series of their first use,
 * the same counts per use, and the entries of the class; the label of the tab counts the entries. A click on a row
 * moves the cursor to its YAML place (spec 5.3). The tab follows `follow`; it starts at the first tab with entries.
 */
export function MatchReport({ entries, counts, config, onPick, follow }: MatchReportProps) {
  const styles = useStyles2(getStyles);
  const groups = groupsOf({ entries, counts, config });
  const id = useId();
  // The tab of the user or of the last follow request; undefined: no choice yet.
  const [chosen, setChosen] = useState<string | null | undefined>(follow?.group);
  const [seen, setSeen] = useState(follow);
  // A request for a class that has no tab yet (a class that the user types now): its tab opens when it comes.
  const [pending, setPending] = useState<string | null | undefined>();
  const hasTab = (key: string | null) => groups.some((g) => keyOf(g) === key);
  if (seen !== follow) {
    setSeen(follow);
    if (follow) {
      const now = hasTab(follow.group);
      if (now) {
        setChosen(follow.group);
      }
      setPending(now ? undefined : follow.group);
    }
  } else if (pending !== undefined && hasTab(pending)) {
    setChosen(pending);
    setPending(undefined);
  }
  const choose = (key: string | null) => {
    setChosen(key);
    setPending(undefined);
  };
  const current =
    groups.find((g) => chosen !== undefined && keyOf(g) === chosen) ??
    groups.find((g) => g.entries.length) ??
    groups[0];
  const tabRefs = useRef<Array<HTMLElement | null>>([]);
  const tabsRef = useRef<HTMLDivElement>(null);
  // Grafana Tab overwrites tabIndex props. Update the DOM after each render, including changes to the classes.
  useLayoutEffect(() => {
    for (const el of tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []) {
      el.tabIndex = el.getAttribute('aria-selected') === 'true' ? 0 : -1;
    }
  });
  // The arrow keys, Home and End open the next, the previous, the first and the last tab and focus it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    // A follow request can change the open tab while focus stays on another tab.
    const focused = tabRefs.current.findIndex((el) => !!el && el.contains(e.target as Node));
    const at = focused >= 0 ? focused : current ? groups.indexOf(current) : -1;
    const next =
      e.key === 'ArrowRight'
        ? (at + 1) % groups.length
        : e.key === 'ArrowLeft'
          ? (at - 1 + groups.length) % groups.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? groups.length - 1
              : -1;
    if (next < 0 || !groups.length) {
      return;
    }
    e.preventDefault();
    choose(keyOf(groups[next]));
    tabRefs.current[next]?.focus();
  };
  const nameOf = (group: Group) => (group.cls === undefined ? 'Not in a class' : `Class ${group.cls}`);
  const panelId = `${id}-panel`;
  return (
    <section aria-label="Match report" className={styles.report} data-testid="dmap-match-report">
      {groups.length === 0 ? <p className={styles.empty}>The config has no classes.</p> : null}
      {groups.length ? (
        <div ref={tabsRef} className={styles.tabs} onKeyDown={onKeyDown}>
          <TabsBar>
            {groups.map((group, i) => (
              <Tab
                key={nameOf(group)}
                ref={(el: HTMLElement | null) => {
                  tabRefs.current[i] = el;
                }}
                id={`${id}-tab-${i}`}
                aria-controls={group === current ? panelId : undefined}
                label={group.cls ?? 'Not in a class'}
                counter={group.entries.length || undefined}
                active={group === current}
                onChangeTab={() => choose(keyOf(group))}
              />
            ))}
          </TabsBar>
        </div>
      ) : null}
      {current ? (
        <div
          role="tabpanel"
          id={panelId}
          aria-label={nameOf(current)}
          className={styles.group}
          data-testid="dmap-match-report-panel"
        >
          <GroupBody group={current} config={config} onPick={onPick} />
        </div>
      ) : null}
    </section>
  );
}

/** The counts and the entries of one group. */
function GroupBody({
  group,
  config,
  onPick,
}: {
  group: Group;
  config?: ConfigV4 | null;
  onPick: (pick: ReportPick) => void;
}) {
  const styles = useStyles2(getStyles);
  return (
    <>
      {group.cells || group.uses.length ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Use</th>
              <th scope="col">Cells</th>
              <th scope="col" title="Cells with no series">
                No series
              </th>
              <th scope="col" title="Cells with one series">
                One series
              </th>
              <th scope="col" title="Cells with more than one series">
                Several
              </th>
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
              <CountRow
                key={use}
                label={reportUse(use, config)}
                counts={of}
                onClick={() => onPick({ kind: 'path', path: use })}
              />
            ))}
          </tbody>
        </table>
      ) : null}
      {group.entries.length ? (
        <ul className={styles.entries}>
          {group.entries.map((row, i) => (
            <li key={i}>
              <button
                type="button"
                className={styles.link}
                onClick={() => onPick({ kind: 'entry', ...entryTarget(row.entries[0]) })}
              >
                {reportGroupLine(row)}
                <EntryDetails entry={row.entries[0]} />
              </button>
              {row.uses.length ? (
                <div className={styles.uses}>
                  Used by{' '}
                  {row.uses.map((use, j) => (
                    <React.Fragment key={use.target.path}>
                      {j ? ', ' : null}
                      <button
                        type="button"
                        className={styles.link}
                        onClick={() => onPick({ kind: 'entry', ...use.target })}
                      >
                        {use.label}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** The diagnostic details that the compact panel notice omits (spec 4). */
function EntryDetails({ entry }: { entry: ReportEntry }) {
  const styles = useStyles2(getStyles);
  if (entry.kind === 'orphan-series') {
    return (
      <span className={styles.details}>
        {entry.labels.map((labels, i) => (
          <span key={i}>{`{${Object.entries(labels)
            .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
            .join(', ')}}`}</span>
        ))}
        {entry.more > 0 ? <span>+{entry.more} more</span> : null}
      </span>
    );
  }
  if (entry.kind === 'many-series') {
    return (
      <span className={styles.details}>
        {entry.cells.map(({ id, count }) => (
          <span key={id}>{`${id}: ${count} series`}</span>
        ))}
      </span>
    );
  }
  return null;
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
  report: css({ padding: theme.spacing(0, 1, 1), fontSize: theme.typography.bodySmall.fontSize }),
  empty: css({ color: theme.colors.text.secondary }),
  // The tabs stay at the top while the panel scrolls.
  tabs: css({
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: theme.colors.background.primary,
    marginBottom: theme.spacing(0.5),
  }),
  group: css({ marginBottom: theme.spacing(1.5) }),
  table: css({
    borderCollapse: 'collapse',
    '& th, & td': { padding: theme.spacing(0.25, 1), textAlign: 'left', fontWeight: 'normal' },
    '& thead th': { color: theme.colors.text.secondary },
    '& td': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  }),
  // a count of 0 is a problem: the cells have no series
  zero: css({ color: theme.colors.error.text }),
  entries: css({ listStyle: 'none', margin: theme.spacing(0.5, 0, 0), padding: 0 }),
  uses: css({ color: theme.colors.text.secondary, marginBottom: theme.spacing(0.5), overflowWrap: 'anywhere' }),
  details: css({
    display: 'block',
    paddingLeft: theme.spacing(1),
    overflowWrap: 'anywhere',
    '& > span': { display: 'block' },
  }),
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
