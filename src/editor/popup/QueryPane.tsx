import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import {
  formattedValueToString,
  getDisplayProcessor,
  type DataFrame,
  type DisplayProcessor,
  type GrafanaTheme2,
  type PanelData,
} from '@grafana/data';
import { Alert, Button, ConfirmModal, useStyles2, useTheme2 } from '@grafana/ui';
import type { NamedQuery } from '../../model/config';
import type { QueryContext, QuerySnapshot } from '../../query/types';
import { QueryEditor } from '../QueryEditor';
import { useOverlay } from './overlayStack';

/** The most rows that the preview table shows. */
export const PREVIEW_ROWS = 20;
const CONFIRM_ID = 'bindings-popup-delete-query';

/** One pattern, override or chart that uses the query. */
export interface QueryUser {
  key: string;
  label: string;
  /** Select the user in the editor. */
  open: () => void;
}

export interface QueryPaneProps {
  query: NamedQuery;
  /** A new value remounts the datasource editor: its text must follow a Revert to saved. */
  epoch: number;
  /** The draft query context: the default datasource of the draft applies. */
  context: QueryContext;
  data: PanelData;
  timeZone: string;
  /** How many patterns, overrides and widgets use the query. */
  uses: number;
  /** The patterns, overrides and charts that use the query. */
  usedBy: QueryUser[];
  /** The result of the last explicit preview of this query. */
  snapshot: QuerySnapshot;
  /** The field names of the preview result or of the panel data. */
  fields: string[];
  queryError: string;
  onValidity: (message: string) => void;
  onChange: (query: NamedQuery) => void;
  onPreview: () => void;
  /** Remove the query from the draft. */
  onDelete: () => void;
}

/** The right pane for a query row: the datasource query editor, its preview result table, the users and the deletion. */
export function QueryPane({
  query,
  epoch,
  context,
  data,
  timeZone,
  uses,
  usedBy,
  snapshot,
  fields,
  queryError,
  onValidity,
  onChange,
  onPreview,
  onDelete,
}: QueryPaneProps) {
  const styles = useStyles2(getStyles);
  const heading = useRef<HTMLHeadingElement>(null);
  const [confirming, setConfirming] = useState(false);
  useLayoutEffect(() => {
    heading.current?.focus();
  }, [query.id]);
  return (
    <section aria-label="Query bindings">
      <h3 ref={heading} tabIndex={-1}>
        {query.name} query
      </h3>
      <p aria-label="Query use count">
        {uses === 0 ? 'No binding uses this query.' : `Used by ${uses} ${uses === 1 ? 'binding' : 'bindings'}.`}
      </p>
      {usedBy.length > 0 && (
        <ul aria-label="Used by" className={styles.users}>
          {usedBy.map((user) => (
            <li key={user.key}>
              <Button variant="secondary" fill="text" size="sm" onClick={user.open}>
                {user.label}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <QueryEditor
        key={`${query.id}:${query.source.kind}:${epoch}`}
        query={query}
        context={context}
        data={data}
        onValidity={onValidity}
        onChange={onChange}
        onPreview={onPreview}
      />
      <output aria-label="Query preview result">
        {snapshot.state}
        {snapshot.state === 'error' || snapshot.state === 'unsupported'
          ? `: ${snapshot.message}`
          : snapshot.state === 'ready'
            ? `: ${snapshot.frames.length} ${snapshot.frames.length === 1 ? 'frame' : 'frames'}, ${snapshot.frames.reduce(
                (sum, frame) => sum + frame.length,
                0
              )} rows, fields: ${fields.join(', ')}`
            : ''}
      </output>
      {(snapshot.state === 'error' || snapshot.state === 'unsupported') && (
        <Alert title={snapshot.state === 'error' ? 'Query failed' : 'Query not supported'} severity="error">
          {snapshot.message}
        </Alert>
      )}
      {snapshot.state === 'ready' && snapshot.frames[0] && (
        <PreviewTable frame={snapshot.frames[0]} timeZone={timeZone} />
      )}
      {queryError && (
        <Alert title="Query needs attention" severity="error">
          {queryError}
        </Alert>
      )}
      <Button
        variant="destructive"
        fill="outline"
        size="sm"
        icon="trash-alt"
        onClick={() => (uses > 0 ? setConfirming(true) : onDelete())}
      >
        Delete query
      </Button>
      {confirming && (
        <DeleteConfirm
          name={query.name}
          uses={uses}
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
          onDismiss={() => setConfirming(false)}
        />
      )}
    </section>
  );
}

function DeleteConfirm({
  name,
  uses,
  onConfirm,
  onDismiss,
}: {
  name: string;
  uses: number;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  // The popup must leave Esc to the confirmation while it is open.
  useOverlay(CONFIRM_ID);
  return (
    <ConfirmModal
      isOpen
      title="Delete query?"
      body={`${name} is used by ${uses} ${uses === 1 ? 'binding' : 'bindings'}. They keep pointing at it and report an unknown query until you pick another. You can undo the deletion.`}
      confirmText="Delete"
      dismissText="Keep query"
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />
  );
}

/** A value as the field display shows it. A value that the display cannot format shows as plain text. */
function cellText(value: unknown, display: DisplayProcessor): string {
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return formattedValueToString(display(value));
  } catch {
    return String(value);
  }
}

/** The first frame of a preview: one column per field, the first rows, values as the field display shows them. */
function PreviewTable({ frame, timeZone }: { frame: DataFrame; timeZone: string }) {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const columns = useMemo(
    () => frame.fields.map((field) => ({ field, display: getDisplayProcessor({ field, theme, timeZone }) })),
    [frame, theme, timeZone]
  );
  const count = Math.min(frame.length, PREVIEW_ROWS);
  return (
    <div className={styles.tableWrap}>
      <table aria-label="Query preview table" className={styles.table}>
        <thead>
          <tr>
            {columns.map(({ field }, i) => (
              <th key={i} scope="col">
                {field.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: count }, (_, row) => (
            <tr key={row}>
              {columns.map(({ field, display }, i) => {
                return <td key={i}>{cellText(field.values[row], display)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {frame.length > count && (
        <p className={styles.more}>
          Showing the first {count} of {frame.length} rows.
        </p>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  users: css({ listStyle: 'none', paddingLeft: 0, display: 'flex', flexWrap: 'wrap', gap: theme.spacing(0.5) }),
  tableWrap: css({ maxWidth: '100%', overflowX: 'auto', margin: theme.spacing(1, 0) }),
  table: css({
    borderCollapse: 'collapse',
    fontVariantNumeric: 'tabular-nums',
    '& th, & td': {
      padding: theme.spacing(0.25, 1),
      border: `1px solid ${theme.colors.border.weak}`,
      textAlign: 'left',
      whiteSpace: 'nowrap',
    },
    '& th': { background: theme.colors.background.secondary, fontWeight: theme.typography.fontWeightMedium },
  }),
  more: css({ margin: theme.spacing(0.5, 0, 0) }),
});
