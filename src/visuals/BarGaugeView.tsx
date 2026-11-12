import React from 'react';
import { formattedValueToString, VizOrientation, type DisplayValue, type FieldConfig } from '@grafana/data';
import { BarGaugeDisplayMode } from '@grafana/schema';
import { BarGauge, useTheme2 } from '@grafana/ui';
import { LINE_HEIGHT, StaleHint } from './StaleHint';

export function BarGaugeView({
  value,
  field,
  width,
  height,
  stale,
}: {
  value: DisplayValue;
  field: FieldConfig;
  width: number;
  height: number;
  /** the stale state of the chart (spec 3.5 step 6) */
  stale?: boolean;
}) {
  const theme = useTheme2();
  const hint = stale ? <StaleHint /> : null;
  const bounded = Number.isFinite(field.min) && Number.isFinite(field.max) && field.max! > field.min!;
  if (!bounded) {
    return (
      <div>
        {hint}
        <span>{formattedValueToString(value)}</span>
        <small role="status">Set a meaningful minimum and maximum to show a bar.</small>
      </div>
    );
  }
  return (
    <div>
      {hint}
      <BarGauge
        value={value}
        field={field}
        width={width}
        height={Math.max(1, height - (stale ? LINE_HEIGHT : 0))}
        theme={theme}
        orientation={VizOrientation.Horizontal}
        displayMode={BarGaugeDisplayMode.Basic}
        isOverflow={false}
      />
    </div>
  );
}
