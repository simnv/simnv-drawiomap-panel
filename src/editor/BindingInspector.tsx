import { Button, Select } from '@grafana/ui';
import React, { useLayoutEffect, useRef } from 'react';
import type { EffectiveCellBinding } from '../binding/patterns';
import type { BindingDraft, DraftAction } from './draft';
import { DisplayFields, newBinding, TextField } from './BindingFields';
import type { DisplayConfig } from '../model/config';
import { ChartFields } from './ChartFields';
import { EditorField, EditorSection } from './EditorLayout';

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
      <EditorSection title="Element details">
        <p>Identity: {String(binding.scope.cell?.key ?? draft.cellId)}</p>
        <p>
          Patterns:{' '}
          {binding.patternIds.map((id) => draft.config.patterns.find((p) => p.id === id)?.name ?? id).join(', ') ||
            'None'}
        </p>
      </EditorSection>
      <p>Element override: {binding.overridden ? 'Yes' : 'No'}</p>
      <EditorField label="Edit scope">
        <Select
          aria-label="Edit scope"
          value={draft.scope}
          onChange={(selection) =>
            dispatch({
              type: 'scope',
              scope: (selection.value ?? '') as 'element' | 'pattern',
              patternId: binding.patternIds.at(-1),
            })
          }
          options={[
            { value: 'element', label: 'This element' },
            { value: 'pattern', label: 'All elements matching this pattern', isDisabled: !binding.patternIds.length },
          ]}
          menuShouldPortal
          maxMenuHeight={240}
        />
      </EditorField>
      {draft.scope === 'pattern' && (
        <EditorField label="Shared pattern">
          <Select
            aria-label="Shared pattern"
            value={draft.patternId ?? ''}
            onChange={(selection) => dispatch({ type: 'scope', scope: 'pattern', patternId: selection.value ?? '' })}
            options={[
              ...binding.patternIds.map((id) => ({
                value: id,
                label: draft.config.patterns.find((p) => p.id === id)?.name,
              })),
            ]}
            menuShouldPortal
            maxMenuHeight={240}
          />
        </EditorField>
      )}
      <p aria-live="polite">Affected elements: {affected.length}</p>
      <EditorSection title="Affected elements">
        <ul>
          {affected.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      </EditorSection>
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
        <Button
          variant="secondary"
          size="sm"
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
        </Button>
      )}
      {pattern && (
        <EditorSection title="Pattern selector" defaultOpen>
          <EditorField label="Pattern kind">
            <Select
              aria-label="Pattern kind"
              value={pattern.select.kind ?? 'any'}
              onChange={(selection) =>
                dispatch({ type: 'selector', select: { ...pattern.select, kind: (selection.value ?? '') as 'any' } })
              }
              options={['any', 'node', 'link', 'port', 'other'].map((kind) => ({ value: kind, label: kind }))}
              menuShouldPortal
              maxMenuHeight={240}
            />
          </EditorField>
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
        </EditorSection>
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
      <EditorSection title="Effective binding preview">
        <pre>{JSON.stringify(binding.display, null, 2)}</pre>
      </EditorSection>
    </section>
  );
}
