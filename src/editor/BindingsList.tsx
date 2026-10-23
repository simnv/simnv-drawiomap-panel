import React, { useEffect, useId, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Checkbox, ConfirmModal, Icon, IconButton, Input, useStyles2 } from '@grafana/ui';
import {
  filterBindings,
  type BindingRow,
  type BindingsList as BindingsListModel,
  type OverrideRow,
  type PatternRow,
  type RowProblem,
  type WidgetRow,
} from './bindingsModel';
import { EditorSection } from './EditorLayout';

export interface BindingsListProps {
  list: BindingsListModel;
  /** The panel has legacy rules and no V2 config. */
  legacyRules?: number;
  onSelectPattern: (row: PatternRow) => void;
  onSelectCell: (cellId: string) => void;
  onDeleteOverride: (cellId: string) => void;
  onDeleteWidget: (id: string) => void;
  /** The cells to mark on the diagram while a pattern row is hovered or focused. */
  onHighlight?: (cellIds: string[]) => void;
}

const problemText = (problem: RowProblem) =>
  `${problem.cellId ? `${problem.cellId}: ` : ''}${problem.message} (${problem.path})`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function BindingsList({
  list,
  legacyRules = 0,
  onSelectPattern,
  onSelectCell,
  onDeleteOverride,
  onDeleteWidget,
  onHighlight,
}: BindingsListProps) {
  const styles = useStyles2(getStyles);
  const [text, setText] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<BindingRow>();
  const [hot, setHot] = useState<string>();
  const filtered = useMemo(() => filterBindings(list, { text, problemsOnly }), [list, text, problemsOnly]);
  // The marks on the diagram follow the hovered pattern row. They end with the row: a filter, a refresh or an unmount.
  const hotRow = filtered.patterns.find((row) => row.key === hot);
  const hotCells = hotRow?.matched.join('\n');
  useEffect(() => {
    onHighlight?.(hotCells ? hotCells.split('\n') : []);
  }, [hotCells, onHighlight]);
  useEffect(() => () => onHighlight?.([]), [onHighlight]);
  const total = list.patterns.length + list.overrides.length + list.widgets.length;
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
              <li key={i}>{problemText(problem)}</li>
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
      row.label ? `${row.cellId} (${row.label})` : row.cellId,
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
        `anchor ${row.anchorCellId}`,
        `query ${row.queryId}`,
        plural(row.problems.length, 'problem'),
      ].join(' · '),
      () => (row.exists ? onSelectCell(row.anchorCellId) : toggle(row.key)),
      () => onDeleteWidget(row.widgetId)
    );
  const heading = (title: string, shown: number, all: number) =>
    `${title} (${shown === all ? all : `${shown} of ${all}`})`;
  const inputId = useId();

  return (
    <section aria-label="All bindings" className={styles.root}>
      {legacyRules > 0 && total === 0 && (
        <p>
          This panel uses {plural(legacyRules, 'legacy rule')}. Edit them in the Rules editor of the panel options.
          Pattern, override and chart bindings appear here after you create them.
        </p>
      )}
      {list.general.length > 0 && (
        <div role="alert" aria-label="General problems" className={styles.general}>
          <strong>General problems ({list.general.length})</strong>
          <ul>
            {list.general.map((problem, i) => (
              <li key={i}>{problemText(problem)}</li>
            ))}
          </ul>
        </div>
      )}
      <label htmlFor={inputId} className={styles.label}>
        Filter bindings
      </label>
      <Input
        id={inputId}
        value={text}
        placeholder="Name, cell or query"
        onChange={(e) => setText(e.currentTarget.value)}
      />
      <Checkbox
        label="Problems only"
        value={problemsOnly}
        onChange={(e) => setProblemsOnly(e.currentTarget.checked)}
        className={styles.check}
      />
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
      <ConfirmModal
        isOpen={!!pending}
        title={pending?.kind === 'widget' ? 'Delete widget' : 'Delete override'}
        body={
          pending?.kind === 'widget'
            ? `Delete widget ${pending.label}? You can undo this with Cancel before you apply.`
            : pending?.kind === 'override'
              ? `Delete the override of ${pending.cellId}? You can undo this with Cancel before you apply.`
              : ''
        }
        confirmText="Delete"
        onConfirm={() => {
          if (pending?.kind === 'override') {
            onDeleteOverride(pending.cellId);
          } else if (pending?.kind === 'widget') {
            onDeleteWidget(pending.widgetId);
          }
          setPending(undefined);
        }}
        onDismiss={() => setPending(undefined)}
      />
    </section>
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
