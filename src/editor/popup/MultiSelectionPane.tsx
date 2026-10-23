import React, { useLayoutEffect, useRef } from 'react';
import type { BindingPlan } from '../../binding/patterns';
import type { DiagramConfigV2 } from '../../model/config';
import type { CellMeta, CellSelector } from '../../types';
import type { DraftAction } from '../draft';
import { BulkPane } from './BulkPane';
import { PatternFromSelection } from './PatternFromSelection';

export interface MultiSelectionProps {
  /** The selected cells; the last one is the primary cell. */
  cellIds: string[];
  /** Every cell of the diagram. */
  cells: CellMeta[];
  /** Changes when the user picks cells; the heading takes the focus then, as the heading of one cell does. */
  selectionVersion: number;
  /** The stage marks the extra and the missed cells of the shown selector. */
  onMarks: (extra: string[], missed: string[]) => void;
  /** Create a pattern with this selector. */
  onCreatePattern: (select: CellSelector) => void;
  plan: BindingPlan;
  config: DiagramConfigV2;
  fields: string[];
  dispatch: (action: DraftAction) => void;
}

/** The inspector body for two or more selected cells. */
export function MultiSelectionPane({
  cellIds,
  cells,
  selectionVersion,
  onMarks,
  onCreatePattern,
  plan,
  config,
  fields,
  dispatch,
}: MultiSelectionProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectionVersion]);
  return (
    <>
      <section aria-label="Selected elements">
        <h3 ref={heading} tabIndex={-1}>
          {cellIds.length} elements
        </h3>
        <ul aria-label="Selected element ids">
          {cellIds.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      </section>
      <PatternFromSelection cells={cells} selectedIds={cellIds} onMarks={onMarks} onCreate={onCreatePattern} />
      <BulkPane cellIds={cellIds} plan={plan} config={config} fields={fields} dispatch={dispatch} />
    </>
  );
}
