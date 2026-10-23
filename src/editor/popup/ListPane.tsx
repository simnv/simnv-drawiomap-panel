import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, Input, useStyles2 } from '@grafana/ui';
import type { DiagramConfigV2 } from '../../model/config';
import type { CellMeta } from '../../types';
import { BindingsList, type BindingsListProps } from '../BindingsList';
import { TextField } from '../BindingFields';
import type { BindingsFilter, BindingsList as BindingsListModel } from '../bindingsModel';
import type { ImportResolution } from '../portable';
import { PatternTransfer } from '../PatternTransfer';

export interface ListPaneProps extends Pick<
  BindingsListProps,
  | 'selectedKey'
  | 'onSelectPattern'
  | 'onSelectCell'
  | 'onSelectQuery'
  | 'onSelectProblem'
  | 'onDeleteOverride'
  | 'onDeleteWidget'
  | 'onHighlight'
> {
  list: BindingsListModel;
  cells: CellMeta[];
  config: DiagramConfigV2;
  filter: BindingsFilter;
  onFilterChange: (filter: BindingsFilter) => void;
  /** The panel has legacy rules and no V2 config. */
  legacyRules?: number;
  onAddQuery: () => void;
  onAddPanelQuery: () => void;
  onDefaultDatasource: (uid: string) => void;
  onImport: (document: unknown, resolution: ImportResolution) => void;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The left pane: the filter, the list of everything the draft binds, and the actions that add to the draft. */
export function ListPane({
  list,
  cells,
  config,
  filter,
  onFilterChange,
  legacyRules = 0,
  onAddQuery,
  onAddPanelQuery,
  onDefaultDatasource,
  onImport,
  ...rows
}: ListPaneProps) {
  const styles = useStyles2(getStyles);
  const total = list.patterns.length + list.overrides.length + list.widgets.length;
  const hasBindings = config.patterns.length || config.overrides.length || config.widgets.length;
  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <Input
          aria-label="Filter bindings"
          value={filter.text}
          placeholder="Filter by name, cell or query"
          onChange={(e) => onFilterChange({ ...filter, text: e.currentTarget.value })}
        />
        <Checkbox
          label="Problems only"
          value={filter.problemsOnly}
          onChange={(e) => onFilterChange({ ...filter, problemsOnly: e.currentTarget.checked })}
          className={styles.check}
        />
      </div>
      <div className={styles.body} role="region" aria-label="All bindings list">
        {legacyRules > 0 && !hasBindings && total === 0 && (
          <p>
            This panel uses {plural(legacyRules, 'legacy rule')}. Edit them in the Rules editor of the panel options.
            Pattern, override and chart bindings appear here after you create them.
          </p>
        )}
        <BindingsList list={list} cells={cells} filter={filter} {...rows} />
      </div>
      <footer className={styles.footer} aria-label="Query library">
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onAddQuery}>
            Add named query
          </Button>
          <Button variant="secondary" size="sm" onClick={onAddPanelQuery}>
            Add eager panel reference
          </Button>
        </div>
        <TextField
          label="Default datasource UID"
          value={config.defaultDatasource?.uid ?? ''}
          onChange={onDefaultDatasource}
        />
        <PatternTransfer config={config} cellIds={cells.map((cell) => cell.id)} onImport={onImport} />
      </footer>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  pane: css({
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    overflowWrap: 'anywhere',
    fontSize: theme.typography.bodySmall.fontSize,
    '& p': { margin: theme.spacing(0, 0, 1), color: theme.colors.text.secondary },
    '& ul': { paddingLeft: theme.spacing(2) },
    '& input': { minWidth: 0, maxWidth: '100%' },
    '& button': { maxWidth: '100%' },
  }),
  header: css({ flex: 'none', padding: theme.spacing(1, 1, 0) }),
  check: css({ margin: theme.spacing(1, 0) }),
  body: css({
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: theme.spacing(0, 1),
  }),
  footer: css({
    flex: 'none',
    maxHeight: '35%',
    overflowY: 'auto',
    padding: theme.spacing(1),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  actions: css({ display: 'flex', flexWrap: 'wrap', gap: theme.spacing(1), marginBottom: theme.spacing(1) }),
});
