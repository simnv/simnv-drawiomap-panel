import React, { useLayoutEffect, useRef } from 'react';
import type { PanelData } from '@grafana/data';
import { Alert } from '@grafana/ui';
import type { NamedQuery } from '../../model/config';
import type { QueryContext, QuerySnapshot } from '../../query/types';
import { QueryEditor } from '../QueryEditor';

export interface QueryPaneProps {
  query: NamedQuery;
  /** A new value remounts the datasource editor: its text must follow a Cancel. */
  epoch: number;
  /** The draft query context: the default datasource of the draft applies. */
  context: QueryContext;
  data: PanelData;
  /** How many patterns, overrides and widgets use the query. */
  uses: number;
  /** The result of the last explicit preview of this query. */
  snapshot: QuerySnapshot;
  /** The field names of the preview result or of the panel data. */
  fields: string[];
  queryError: string;
  onValidity: (message: string) => void;
  onChange: (query: NamedQuery) => void;
  onPreview: () => void;
}

/** The right pane for a query row: the datasource query editor of today, its preview result and its use count. */
export function QueryPane({
  query,
  epoch,
  context,
  data,
  uses,
  snapshot,
  fields,
  queryError,
  onValidity,
  onChange,
  onPreview,
}: QueryPaneProps) {
  const heading = useRef<HTMLHeadingElement>(null);
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
            ? `: ${snapshot.frames.length} frames; fields ${fields.join(', ')}`
            : ''}
      </output>
      {queryError && (
        <Alert title="Query needs attention" severity="error">
          {queryError}
        </Alert>
      )}
    </section>
  );
}
