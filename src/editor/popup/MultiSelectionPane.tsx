import React, { useLayoutEffect, useRef } from 'react';

export interface MultiSelectionProps {
  /** The selected cells; the last one is the primary cell. */
  cellIds: string[];
  /** Changes when the user picks cells; the heading takes the focus then, as the heading of one cell does. */
  selectionVersion: number;
}

/** The inspector body for two or more selected cells. */
export function MultiSelectionPane({ cellIds, selectionVersion }: MultiSelectionProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectionVersion]);
  return (
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
  );
}
