import React from 'react';
import type { NamedQuery, Widget } from '../model/config';
import { BindingFields, FreshnessFields, newBinding, TextField } from './BindingFields';

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
    <fieldset>
      <legend>Chart region</legend>
      <p>Anchor: {widget.anchorCellId}</p>
      <label>
        Chart kind
        <select
          aria-label="Chart kind"
          value={widget.kind}
          onChange={(e) => onChange({ ...widget, kind: e.target.value as Widget['kind'] })}
        >
          <option value="sparkline">Sparkline</option>
          <option value="bar">Bar gauge</option>
        </select>
      </label>
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
      <button onClick={onRemove}>Remove chart {widget.label}</button>
    </fieldset>
  );
}
