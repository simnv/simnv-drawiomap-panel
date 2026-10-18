import React, { useLayoutEffect, useRef } from 'react';
import type { EffectiveCellBinding } from '../binding/patterns';
import type { BindingDraft, DraftAction } from './draft';
import { DisplayFields, newBinding, TextField } from './BindingFields';
import type { DisplayConfig } from '../model/config';
import { ChartFields } from './ChartFields';

export interface BindingInspectorProps {
  draft: BindingDraft;
  binding?: EffectiveCellBinding;
  affected: string[];
  selectionVersion: number;
  dispatch: (action: DraftAction) => void;
  fields?: string[];
  chartEligible?: boolean;
}
export function BindingInspector({
  draft,
  binding,
  affected,
  selectionVersion,
  dispatch,
  fields,
  chartEligible,
}: BindingInspectorProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (!draft.cellId) {
      return;
    }
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'nearest' });
  }, [draft.cellId, selectionVersion]);
  if (!draft.cellId || !binding) {
    return <p>Select a diagram element to edit its bindings.</p>;
  }
  const pattern = draft.scope === 'pattern' ? draft.config.patterns.find((p) => p.id === draft.patternId) : undefined;
  const editDisplay = pattern?.display ?? binding.display;
  return (
    <section aria-label="Element bindings">
      <h3 ref={heading} tabIndex={-1}>
        {draft.cellId} bindings
      </h3>
      <p>Identity: {String(binding.scope.cell?.key ?? draft.cellId)}</p>
      <p>
        Patterns:{' '}
        {binding.patternIds.map((id) => draft.config.patterns.find((p) => p.id === id)?.name ?? id).join(', ') ||
          'None'}
      </p>
      <p>Element override: {binding.overridden ? 'Yes' : 'No'}</p>
      <label>
        Edit scope
        <select
          aria-label="Edit scope"
          value={draft.scope}
          onChange={(e) =>
            dispatch({
              type: 'scope',
              scope: e.target.value as 'element' | 'pattern',
              patternId: binding.patternIds.at(-1),
            })
          }
        >
          <option value="element">This element</option>
          <option value="pattern" disabled={!binding.patternIds.length}>
            All elements matching this pattern
          </option>
        </select>
      </label>
      {draft.scope === 'pattern' && (
        <label>
          Shared pattern
          <select
            aria-label="Shared pattern"
            value={draft.patternId ?? ''}
            onChange={(e) => dispatch({ type: 'scope', scope: 'pattern', patternId: e.target.value })}
          >
            {binding.patternIds.map((id) => (
              <option key={id} value={id}>
                {draft.config.patterns.find((p) => p.id === id)?.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p aria-live="polite">Affected elements: {affected.join(', ') || 'None'}</p>
      {draft.config.widgets
        .filter((w) => w.anchorCellId === draft.cellId)
        .map((widget) => (
          <ChartFields
            key={widget.id}
            widget={widget}
            queries={draft.config.queries}
            fields={fields}
            onChange={(widget) => dispatch({ type: 'widget', widget })}
            onRemove={() => dispatch({ type: 'remove-widget', id: widget.id })}
          />
        ))}
      {chartEligible && !draft.config.widgets.some((w) => w.anchorCellId === draft.cellId) && (
        <button
          disabled={!draft.config.queries.length}
          onClick={() => {
            let n = 1;
            while (draft.config.widgets.some((w) => w.id === `chart-${n}`)) {
              n++;
            }
            dispatch({
              type: 'widget',
              widget: {
                id: `chart-${n}`,
                anchorCellId: draft.cellId!,
                kind: 'sparkline',
                label: 'Chart',
                binding: newBinding(draft.config.queries[0].id),
              },
            });
          }}
        >
          Assign chart region
        </button>
      )}
      {pattern && (
        <fieldset>
          <legend>Pattern selector</legend>
          <label>
            Pattern kind
            <select
              aria-label="Pattern kind"
              value={pattern.select.kind ?? 'any'}
              onChange={(e) =>
                dispatch({ type: 'selector', select: { ...pattern.select, kind: e.target.value as 'any' } })
              }
            >
              {['any', 'node', 'link', 'port', 'other'].map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
          <TextField
            label="Pattern element IDs"
            value={pattern.select.ids?.join(',') ?? ''}
            onChange={(v) =>
              dispatch({
                type: 'selector',
                select: { ...pattern.select, ids: v ? v.split(',').map((id) => id.trim()) : undefined },
              })
            }
          />
        </fieldset>
      )}
      <DisplayFields
        value={editDisplay}
        queries={draft.config.queries}
        fields={fields}
        onChange={(display) => {
          const patch: Partial<DisplayConfig> = { ...display };
          // Preserve shared section settings unless the user changed that setting explicitly.
          for (const section of ['shape', 'link'] as const) {
            if (display[section]) {
              const before = editDisplay[section] ?? {};
              const changed = Object.fromEntries(
                Object.entries(display[section]!).filter(
                  ([key, value]) => JSON.stringify(value) !== JSON.stringify((before as Record<string, unknown>)[key])
                )
              );
              patch[section] = changed;
            }
          }
          dispatch({ type: 'display', display: patch });
        }}
      />
      <details>
        <summary>Effective binding preview</summary>
        <pre>{JSON.stringify(binding.display, null, 2)}</pre>
      </details>
    </section>
  );
}
