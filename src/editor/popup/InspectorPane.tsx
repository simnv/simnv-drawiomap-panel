import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, useStyles2 } from '@grafana/ui';
import type { EffectiveCellBinding, BindingPlan } from '../../binding/patterns';
import type { buildConfiguredCard } from '../../interact/cardModel';
import type { Diagnostic } from '../../model/config';
import type { CellIndex } from '../../types';
import { BindingInspector } from '../BindingInspector';
import { freshId, type BindingDraft, type DraftAction } from '../draft';
import { EditorSection, getEditorStyles } from '../EditorLayout';
import { CardPreview, type CardPreviewProps } from './CardPreview';
import { MultiSelectionPane, type MultiSelectionProps } from './MultiSelectionPane';
import { QueryPane, type QueryPaneProps } from './QueryPane';

export type InspectorSelection =
  | { kind: 'none' }
  | { kind: 'cell' }
  /** Two or more cells; the last one is the primary cell of the draft. */
  | { kind: 'many'; cellIds: string[] }
  | { kind: 'query'; queryId: string };

/** Everything the cell body shows. The editor computes it; the pane only renders it. */
export interface CellBodyProps {
  draft: BindingDraft;
  dispatch: (action: DraftAction) => void;
  cells: CellIndex;
  plan: BindingPlan;
  inspected?: EffectiveCellBinding;
  affected: string[];
  selectionVersion: number;
  fields: string[];
  chartEligible: boolean;
  geometryError: string;
  /** The binding diagnostics of the draft. */
  diagnostics: Diagnostic[];
  /** The metric resolution of the affected elements. Undefined while the panel has no data. */
  metric?: {
    matches: Array<{ cellId: string; state: string; failures: string[]; unvalidated: boolean }>;
    diagnostics: Diagnostic[];
    incomplete: boolean;
    hover?: ReturnType<typeof buildConfiguredCard>;
  };
  patternPreview: {
    enabled: boolean;
    onRun: () => void;
    /** Set after a run: the checked and the total query scopes. */
    progress?: { done: number; total: number };
  };
}

export interface InspectorPaneProps {
  selection: InspectorSelection;
  cell: CellBodyProps;
  /** The live hover card of the selected element. It shows first for a cell selection. */
  card?: CardPreviewProps;
  /** The props of the query pane for the selected query. */
  query?: QueryPaneProps;
  /** The props of the pane for a selection of several cells. */
  many?: MultiSelectionProps;
}

/** The right pane. It shows the selected cell, the selected query or a hint. */
export function InspectorPane({ selection, cell, card, query, many }: InspectorPaneProps) {
  const editor = useStyles2(getEditorStyles);
  const styles = useStyles2(getStyles);
  return (
    <aside aria-label="Diagram binding inspector" className={editor.inspector} style={{ width: '100%' }}>
      <div className={editor.body} role="region" aria-label="Binding editor fields">
        {selection.kind === 'query' && query ? (
          <QueryPane {...query} />
        ) : (
          <>
            {selection.kind === 'cell' && card && <CardPreview {...card} />}
            {cell.geometryError && (
              <Alert title="Geometry could not be saved" severity="error">
                {cell.geometryError}
              </Alert>
            )}
            {selection.kind === 'many' && many && <MultiSelectionPane {...many} />}
            {selection.kind === 'none' && (
              <p className={styles.hint}>Select an element in the diagram or a row in the list.</p>
            )}
            <CellBody {...cell} selected={selection.kind === 'cell'} />
          </>
        )}
      </div>
    </aside>
  );
}

function CellBody({
  selected,
  draft,
  dispatch,
  cells,
  plan,
  inspected,
  affected,
  selectionVersion,
  fields,
  chartEligible,
  diagnostics,
  metric,
  patternPreview,
}: CellBodyProps & { selected: boolean }) {
  return (
    <>
      {selected && (
        <BindingInspector
          draft={draft}
          binding={inspected}
          affected={affected}
          selectionVersion={selectionVersion}
          dispatch={dispatch}
          fields={fields}
          chartEligible={chartEligible}
          meta={draft.cellId ? cells.get(draft.cellId)?.meta : undefined}
          diagnostics={diagnostics}
        />
      )}
      {draft.config.widgets
        .filter((w) => !cells.has(w.anchorCellId))
        .map((widget) => (
          <p key={widget.id}>
            Chart {widget.label} has missing anchor {widget.anchorCellId}.
            <Button variant="secondary" size="sm" onClick={() => dispatch({ type: 'remove-widget', id: widget.id })}>
              Remove chart {widget.label}
            </Button>
          </p>
        ))}
      {selected && draft.cellId && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const { id, n } = freshId(draft.config.patterns, 'pattern');
            dispatch({
              type: 'pattern',
              pattern: { id, name: `Pattern ${n}`, select: { ids: [draft.cellId!] }, display: {} },
            });
            dispatch({ type: 'scope', scope: 'pattern', patternId: id });
          }}
        >
          Create shared pattern
        </Button>
      )}
      {selected && draft.scope === 'pattern' && (
        <section aria-label="Full pattern preview">
          <Button variant="secondary" size="sm" disabled={!patternPreview.enabled} onClick={patternPreview.onRun}>
            Preview all pattern matches
          </Button>
          {patternPreview.progress && (
            <output aria-label="Pattern preview progress" aria-live="polite">
              {patternPreview.progress.done} / {patternPreview.progress.total} query scopes checked
            </output>
          )}
        </section>
      )}
      {selected && draft.scope === 'pattern' && (
        <EditorSection title="Pattern match details">
          <ul aria-label="Affected binding preview">
            {affected.map((id) => (
              <li key={id}>
                {id}: {JSON.stringify(plan.cells[id]?.display)}
              </li>
            ))}
          </ul>
        </EditorSection>
      )}
      {diagnostics.length > 0 && (
        <Alert title="Binding diagnostics" severity="error">
          <ul>
            {diagnostics.map((d, i) => (
              <li key={i}>
                {d.path}: {d.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {selected && metric && (
        <EditorSection title="Metric preview" defaultOpen>
          <section aria-label="Metric resolution preview">
            <ul aria-label="Affected metric resolution">
              {metric.matches.map((match) => (
                <li key={match.cellId}>
                  {cells.get(match.cellId)?.meta.handle ?? match.cellId}: {match.state}
                  {match.failures.length > 0 && `: ${match.failures.join(' ')}`}
                  {match.unvalidated && ' (unvalidated bindings require explicit Preview for this element)'}
                </li>
              ))}
            </ul>
            {metric.diagnostics.length ? (
              <ul>
                {metric.diagnostics.map((d, i) => (
                  <li key={i}>
                    {d.path}: {d.message}
                  </li>
                ))}
              </ul>
            ) : !metric.incomplete && affected.length > 0 ? (
              <p>No resolution failures in available preview data.</p>
            ) : (
              <p>Select an element and use Preview query to validate its native query bindings.</p>
            )}
            {metric.hover && (
              <ul aria-label="Hover row preview">
                {metric.hover.rows.map((row) => (
                  <li key={row.key}>
                    {row.title}: {row.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </EditorSection>
      )}
    </>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  hint: css({ color: theme.colors.text.secondary }),
});
