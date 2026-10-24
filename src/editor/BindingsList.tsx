import React, { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, ConfirmModal, Icon, IconButton, useStyles2 } from '@grafana/ui';
import { useOverlay } from './popup/overlayStack';
import { displayName, idAndName } from '../adapter/cellTitle';
import type { CellMeta } from '../types';
import {
  cellRows,
  filterBindings,
  problemsOf,
  type BindingRow,
  type BindingsFilter,
  type BindingsList as BindingsListModel,
  type OverrideRow,
  type PatternRow,
  type ProblemEntry,
  type QueryRow,
  type RowProblem,
  type WidgetRow,
} from './bindingsModel';
import { EditorSection } from './EditorLayout';

/** The Cells group shows this many rows, then "Show more" adds as many again. */
export const CELLS_PAGE = 20;

export interface BindingsListProps {
  list: BindingsListModel;
  /** The cells of the diagram. The Cells group lists the ones that the filter text finds. */
  cells: CellMeta[];
  filter: BindingsFilter;
  /** The key of the selected row (`BindingRow.key`, or `cell:<id>`). The row gets aria-current. */
  selectedKey?: string;
  onSelectPattern: (row: PatternRow) => void;
  onSelectCell: (cellId: string) => void;
  onSelectQuery: (queryId: string) => void;
  onSelectProblem: (entry: ProblemEntry) => void;
  onDeleteOverride: (cellId: string) => void;
  onDeleteWidget: (id: string) => void;
  /** The cells to mark on the diagram while a pattern row is hovered or focused. */
  onHighlight?: (cellIds: string[]) => void;
}

/** The visible name of a row. */
export const rowName = (row: BindingRow): string =>
  row.kind === 'pattern'
    ? row.name
    : row.kind === 'override'
      ? row.title
        ? `${row.handle} (${row.title})`
        : row.handle
      : row.kind === 'widget'
        ? row.label
        : row.name;
const problemText = (problem: RowProblem, nameOf: (cellId: string) => string) =>
  `${problem.cellId ? `${nameOf(problem.cellId)}: ` : ''}${problem.message} (${problem.path})`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function BindingsList({
  list,
  cells,
  filter,
  selectedKey,
  onSelectPattern,
  onSelectCell,
  onSelectQuery,
  onSelectProblem,
  onDeleteOverride,
  onDeleteWidget,
  onHighlight,
}: BindingsListProps) {
  const styles = useStyles2(getStyles);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<BindingRow>();
  const [hot, setHot] = useState<string>();
  const { text, problemsOnly } = filter;
  const filtered = useMemo(() => filterBindings(list, { text, problemsOnly }), [list, text, problemsOnly]);
  const problems = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return problemsOf(list).filter(
      ({ row, problem }) =>
        !needle ||
        !row ||
        [rowName(row), problem.message, problem.path, problem.cellId ?? ''].some((part) =>
          part.toLowerCase().includes(needle)
        )
    );
  }, [list, text]);
  const nameOf = useMemo(() => {
    const byId = new Map(cells.map((c) => [c.id, c]));
    return (cellId: string) => idAndName(byId.get(cellId), cellId);
  }, [cells]);
  const [cellLimit, setCellLimit] = useState(CELLS_PAGE);
  const found = useMemo(() => cellRows(text, cells), [text, cells]);
  // A new filter text starts at the first page again (state adjustment during render).
  const [cellsText, setCellsText] = useState(text);
  if (cellsText !== text) {
    setCellsText(text);
    setCellLimit(CELLS_PAGE);
  }
  // The marks on the diagram follow the hovered pattern row. They end with the row: a filter, a refresh or an unmount.
  const hotRow = filtered.patterns.find((row) => row.key === hot);
  const hotCells = hotRow?.matched.join('\n');
  useEffect(() => {
    onHighlight?.(hotCells ? hotCells.split('\n') : []);
  }, [hotCells, onHighlight]);
  useEffect(() => () => onHighlight?.([]), [onHighlight]);
  const toggle = (key: string) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });

  const renderRow = (row: BindingRow, name: string, summary: string, onOpen: () => void, onRemove?: () => void) => {
    const open = expanded.has(row.key);
    const problems = row.problems.length;
    return (
      <li key={row.key} className={styles.item}>
        <div className={styles.row}>
          {problems > 0 ? (
            <IconButton
              name={open ? 'angle-down' : 'angle-right'}
              aria-expanded={open}
              aria-label={`${open ? 'Hide' : 'Show'} problems of ${name}`}
              size="sm"
              onClick={() => toggle(row.key)}
            />
          ) : (
            <span className={styles.spacer} aria-hidden />
          )}
          <button
            type="button"
            className={styles.main}
            aria-label={`Edit ${row.kind} ${name}`}
            aria-current={row.key === selectedKey ? 'true' : undefined}
            onClick={onOpen}
            onMouseEnter={() => row.kind === 'pattern' && setHot(row.key)}
            onMouseLeave={() => setHot(undefined)}
            onFocus={() => row.kind === 'pattern' && setHot(row.key)}
            onBlur={() => setHot(undefined)}
          >
            <span className={styles.title}>
              {problems > 0 && <Icon name="exclamation-triangle" className={styles.warn} title="Has problems" />}
              {name}
            </span>
            <span className={styles.summary}>{summary}</span>
          </button>
          {onRemove && (
            <IconButton
              name="trash-alt"
              size="sm"
              tooltip={`Delete ${row.kind} ${name}`}
              aria-label={`Delete ${row.kind} ${name}`}
              onClick={() => setPending(row)}
            />
          )}
        </div>
        {open && problems > 0 && (
          <ul aria-label={`Problems of ${name}`} className={styles.problems}>
            {row.problems.map((problem, i) => (
              <li key={i}>{problemText(problem, nameOf)}</li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  const patternRow = (row: PatternRow) =>
    renderRow(
      row,
      row.name,
      [
        row.selector,
        row.queryIds.length ? `queries ${row.queryIds.join(', ')}` : 'no queries',
        plural(row.matched.length, 'cell'),
        plural(row.problems.length, 'problem'),
      ].join(' · '),
      () => onSelectPattern(row)
    );
  const overrideRow = (row: OverrideRow) =>
    renderRow(
      row,
      rowName(row),
      [row.keys.length ? `sets ${row.keys.join(', ')}` : 'sets nothing', plural(row.problems.length, 'problem')].join(
        ' · '
      ),
      () => (row.exists ? onSelectCell(row.cellId) : toggle(row.key)),
      () => onDeleteOverride(row.cellId)
    );
  const widgetRow = (row: WidgetRow) =>
    renderRow(
      row,
      row.label,
      [
        row.widgetKind,
        `anchor ${nameOf(row.anchorCellId)}`,
        `query ${row.queryId}`,
        plural(row.problems.length, 'problem'),
      ].join(' · '),
      () => (row.exists ? onSelectCell(row.anchorCellId) : toggle(row.key)),
      () => onDeleteWidget(row.widgetId)
    );
  const queryRow = (row: QueryRow) =>
    renderRow(
      row,
      row.name,
      [
        row.queryId,
        row.sourceKind,
        row.uses ? `used by ${plural(row.uses, 'binding')}` : 'unused',
        plural(row.problems.length, 'problem'),
      ].join(' · '),
      () => onSelectQuery(row.queryId)
    );
  const heading = (title: string, shown: number, all: number) =>
    `${title} (${shown === all ? all : `${shown} of ${all}`})`;

  return (
    <section aria-label="All bindings" className={styles.root}>
      <EditorSection title={`Problems (${problems.length})`} defaultOpen>
        {problems.length ? (
          <ul className={styles.list} aria-label="Problems">
            {problems.map((entry) => (
              <li key={entry.key} className={styles.item}>
                <button
                  type="button"
                  className={styles.main}
                  aria-label={`Show problem ${entry.row ? `of ${rowName(entry.row)}` : 'without an owner'}: ${entry.problem.message}`}
                  onClick={() => onSelectProblem(entry)}
                >
                  <span className={styles.title}>
                    <Icon name="exclamation-triangle" className={styles.warn} />
                    {entry.row ? rowName(entry.row) : 'General'}
                  </span>
                  <span className={styles.summary}>{problemText(entry.problem, nameOf)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No problems.</p>
        )}
      </EditorSection>
      <EditorSection title={heading('Patterns', filtered.patterns.length, list.patterns.length)} defaultOpen>
        {filtered.patterns.length ? (
          <ul className={styles.list} aria-label="Patterns">
            {filtered.patterns.map(patternRow)}
          </ul>
        ) : (
          <p>{list.patterns.length ? 'No pattern matches the filter.' : 'No patterns.'}</p>
        )}
      </EditorSection>
      <EditorSection title={heading('Overrides', filtered.overrides.length, list.overrides.length)} defaultOpen>
        {filtered.overrides.length ? (
          <ul className={styles.list} aria-label="Overrides">
            {filtered.overrides.map(overrideRow)}
          </ul>
        ) : (
          <p>{list.overrides.length ? 'No override matches the filter.' : 'No overrides.'}</p>
        )}
      </EditorSection>
      <EditorSection title={heading('Widgets', filtered.widgets.length, list.widgets.length)} defaultOpen>
        {filtered.widgets.length ? (
          <ul className={styles.list} aria-label="Widgets">
            {filtered.widgets.map(widgetRow)}
          </ul>
        ) : (
          <p>{list.widgets.length ? 'No widget matches the filter.' : 'No widgets.'}</p>
        )}
      </EditorSection>
      <EditorSection title={heading('Queries', filtered.queries.length, list.queries.length)} defaultOpen>
        {filtered.queries.length ? (
          <ul className={styles.list} aria-label="Queries">
            {filtered.queries.map(queryRow)}
          </ul>
        ) : (
          <p>{list.queries.length ? 'No query matches the filter.' : 'No queries.'}</p>
        )}
      </EditorSection>
      {text.trim() !== '' && (
        <EditorSection title={`Cells (${found.length})`} defaultOpen>
          {found.length ? (
            <>
              <ul className={styles.list} aria-label="Cells">
                {found.slice(0, cellLimit).map((cell) => (
                  <li key={cell.id} className={styles.item}>
                    <button
                      type="button"
                      className={styles.main}
                      aria-label={`Select cell ${cell.handle ?? cell.id}`}
                      aria-current={`cell:${cell.id}` === selectedKey ? 'true' : undefined}
                      onClick={() => onSelectCell(cell.id)}
                    >
                      <span className={styles.title}>{cell.handle ?? cell.id}</span>
                      {displayName(cell, cell.id) !== (cell.handle ?? cell.id) ? (
                        <span className={styles.summary}>{displayName(cell, cell.id)}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
              {found.length > cellLimit && (
                <Button variant="secondary" size="sm" onClick={() => setCellLimit((limit) => limit + CELLS_PAGE)}>
                  Show more
                </Button>
              )}
            </>
          ) : (
            <p>No cell matches the filter.</p>
          )}
        </EditorSection>
      )}
      {pending && (
        <DeleteConfirm
          pending={pending}
          onConfirm={() => {
            if (pending.kind === 'override') {
              onDeleteOverride(pending.cellId);
            } else if (pending.kind === 'widget') {
              onDeleteWidget(pending.widgetId);
            }
            setPending(undefined);
          }}
          onDismiss={() => setPending(undefined)}
        />
      )}
    </section>
  );
}

export const DELETE_CONFIRM_ID = 'bindings-delete-confirm';

/** The delete question. It is on the overlay stack while it is open, so that Esc closes it before the popup. */
function DeleteConfirm({
  pending,
  onConfirm,
  onDismiss,
}: {
  pending: BindingRow;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  useOverlay(DELETE_CONFIRM_ID);
  return (
    <ConfirmModal
      isOpen
      title={pending.kind === 'widget' ? 'Delete widget' : 'Delete override'}
      body={
        pending.kind === 'widget'
          ? `Delete widget ${pending.label}? You can undo this with Undo or Revert to saved before you apply.`
          : pending.kind === 'override'
            ? `Delete the override of ${rowName(pending)}? You can undo this with Undo or Revert to saved before you apply.`
            : ''
      }
      confirmText="Delete"
      dismissText={pending.kind === 'widget' ? 'Keep widget' : 'Keep override'}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({ minWidth: 0 }),
  label: css({ display: 'block', marginBottom: theme.spacing(0.5), color: theme.colors.text.secondary }),
  check: css({ margin: theme.spacing(1, 0) }),
  list: css({ listStyle: 'none', padding: 0, margin: 0, minWidth: 0 }),
  item: css({ minWidth: 0, borderBottom: `1px solid ${theme.colors.border.weak}`, '&:last-child': { border: 0 } }),
  row: css({ display: 'flex', alignItems: 'flex-start', gap: theme.spacing(0.5), minWidth: 0 }),
  spacer: css({ flex: `0 0 ${theme.spacing(2)}`, width: theme.spacing(2) }),
  main: css({
    flex: '1 1 0',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    textAlign: 'left',
    background: 'transparent',
    border: 0,
    padding: theme.spacing(0.5),
    color: theme.colors.text.primary,
    cursor: 'pointer',
    borderRadius: theme.shape.radius.default,
    '&:hover': { background: theme.colors.action.hover },
  }),
  title: css({ fontWeight: theme.typography.fontWeightMedium, overflowWrap: 'anywhere' }),
  warn: css({ color: theme.colors.warning.text, marginRight: theme.spacing(0.5) }),
  summary: css({ color: theme.colors.text.secondary, overflowWrap: 'anywhere' }),
  general: css({
    margin: theme.spacing(0, 0, 1),
    padding: theme.spacing(1),
    border: `1px solid ${theme.colors.warning.border}`,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.warning.text,
  }),
  problems: css({ margin: theme.spacing(0, 0, 1, 3), color: theme.colors.warning.text }),
});
