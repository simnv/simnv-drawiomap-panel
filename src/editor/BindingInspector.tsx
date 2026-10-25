import { Button, Select } from '@grafana/ui';
import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { displayProvenance, type DisplayOwner, type EffectiveCellBinding } from '../binding/patterns';
import { displayName, identityOf } from '../adapter/cellTitle';
import type { CellMeta } from '../types';
import { fieldSourceOf } from './fieldSource';
import { draftPatternIndex, type BindingDraft, type DraftAction } from './draft';
import { DisplayFields, newBinding, TextField } from './BindingFields';
import { validateConfig, type Diagnostic, type DisplayConfig } from '../model/config';
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
  /** The identity of the selected cell: the sources of its fields come from the merge of the draft. */
  meta?: CellMeta;
  /** The diagnostics of the draft, for the problems of a skipped pattern. */
  diagnostics?: Diagnostic[];
}
export function BindingInspector({
  draft,
  binding,
  affected,
  selectionVersion,
  dispatch,
  fields,
  chartEligible,
  meta,
  diagnostics = [],
}: BindingInspectorProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The items that parse, dense: the merge, the provenance and the field sources read these, never a skipped item.
  const validated = useMemo(() => validateConfig(draft.config), [draft.config]);
  const config = validated.config;
  const provenance = useMemo(() => (meta && config ? displayProvenance(config, meta) : undefined), [config, meta]);
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
  const name = displayName(meta, draft.cellId);
  const savedIndex = draft.scope === 'pattern' ? draftPatternIndex(draft) : -1;
  const skippedPattern =
    savedIndex >= 0
      ? validated.skippedItems.find((i) => i.section === 'patterns' && i.index === savedIndex)
      : undefined;
  if (skippedPattern) {
    // A pattern that does not parse has no form: its problems with their paths, and the delete button.
    const prefix = `patterns[${savedIndex}]`;
    // the editor collects the same diagnostic from the validation and from the plan: each one once
    const seen = new Set<string>();
    const problems = diagnostics.filter((d) => {
      const key = `${d.code}|${d.path}|${d.message}`;
      const own = d.path === prefix || d.path.startsWith(`${prefix}.`);
      return own && !seen.has(key) && !!seen.add(key);
    });
    return (
      <section aria-label="Element bindings">
        <h3 ref={heading} tabIndex={-1}>
          {skippedPattern.title}
        </h3>
        <p>
          {skippedPattern.title} is not applied until its errors are fixed. The panel shows its cells as unavailable.
        </p>
        <ul aria-label="Pattern problems">
          {problems.map((d, i) => (
            <li key={i}>
              {d.path}: {d.message}
            </li>
          ))}
        </ul>
        <Button variant="destructive" size="sm" onClick={() => dispatch({ type: 'remove-pattern', index: savedIndex })}>
          Delete pattern
        </Button>
      </section>
    );
  }
  const pattern = draft.scope === 'pattern' ? draft.config.patterns[savedIndex] : undefined;
  const editDisplay = pattern?.display ?? binding.display;
  // a provenance owner holds the dense index of a pattern (the index in the validated config)
  const editing: DisplayOwner = pattern
    ? { kind: 'pattern', index: validated.indices.patterns.indexOf(savedIndex) }
    : { kind: 'override', cellId: draft.cellId };
  const sourceOf =
    provenance && config
      ? (path: string) => ({ ...fieldSourceOf(provenance, path, editing, config), scope: draft.scope })
      : undefined;
  const patternName = (id: string) => draft.config.patterns.find((p) => p.id === id)?.name;
  return (
    <section aria-label="Element bindings">
      <h3 ref={heading} tabIndex={-1}>
        {meta?.handle ?? draft.cellId} bindings
      </h3>
      <EditorSection title="Element details">
        <p>Name: {name}</p>
        <p>Identity: {identityOf(meta, draft.cellId)}</p>
        <p>Patterns: {binding.patternIds.map((id) => patternName(id) ?? id).join(', ') || 'None'}</p>
        {binding.unavailable && <p role="status">Unavailable: {binding.unavailable}</p>}
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
              ...Array.from(new Set([...binding.patternIds, ...(draft.patternId ? [draft.patternId] : [])])).map(
                (id) => ({ value: id, label: patternName(id) })
              ),
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
        sourceOf={sourceOf}
        onReset={(path) => dispatch({ type: 'unset', path })}
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
