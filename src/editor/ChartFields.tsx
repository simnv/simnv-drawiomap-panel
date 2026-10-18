import { Button, Select } from '@grafana/ui';
import React from 'react';
import type { NamedQuery, Widget } from '../model/config';
import { BindingFields, FreshnessFields, newBinding, TextField } from './BindingFields';
import { EditorField, EditorSection } from './EditorLayout';

export function ChartFields({
  widget,
  queries,
  fields,
  onChange,
  onRemove,
}: {
  widget: Widget;
  queries: NamedQuery[];
  fields?: string[];
  onChange: (widget: Widget) => void;
  onRemove: () => void;
}) {
  return (
    <EditorSection title="Chart region" defaultOpen>
      <p>Anchor: {widget.anchorCellId}</p>
      <EditorField label="Chart kind">
        <Select
          aria-label="Chart kind"
          value={widget.kind}
          onChange={(selection) => onChange({ ...widget, kind: (selection.value ?? '') as Widget['kind'] })}
          options={[
            { value: 'sparkline', label: 'Sparkline' },
            { value: 'bar', label: 'Bar gauge' },
          ]}
          menuShouldPortal
          maxMenuHeight={240}
        />
      </EditorField>
      <BindingFields
        label="Chart"
        value={widget.binding}
        queries={queries}
        fields={fields}
        onChange={(binding) => onChange({ ...widget, binding: binding ?? newBinding() })}
      />
      <TextField label="Chart label" value={widget.label} onChange={(label) => onChange({ ...widget, label })} />
      <TextField label="Chart unit" value={widget.unit ?? ''} onChange={(unit) => onChange({ ...widget, unit })} />
      <TextField
        label="Chart minimum"
        type="number"
        value={widget.min ?? ''}
        onChange={(v) => onChange({ ...widget, min: v === '' ? undefined : Number(v) })}
      />
      <TextField
        label="Chart maximum"
        type="number"
        value={widget.max ?? ''}
        onChange={(v) => onChange({ ...widget, max: v === '' ? undefined : Number(v) })}
      />
      <TextField
        label="Chart drilldown URL"
        value={widget.url ?? ''}
        onChange={(url) => onChange({ ...widget, url })}
      />
      <FreshnessFields
        label="Chart"
        value={widget.freshness}
        onChange={(freshness) => onChange({ ...widget, freshness })}
      />
      <Button variant="secondary" size="sm" onClick={onRemove}>
        Remove chart {widget.label}
      </Button>
    </EditorSection>
  );
}
