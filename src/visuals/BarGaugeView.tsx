import React from 'react';
import { formattedValueToString, VizOrientation, type DisplayValue, type FieldConfig } from '@grafana/data';
import { BarGaugeDisplayMode } from '@grafana/schema';
import type { FreshnessPolicy } from '../model/config';
import { useSampleStale } from './useSampleStale';
import { BarGauge, useTheme2 } from '@grafana/ui';

export function BarGaugeView({
  value,
  field,
  width,
  height,
  sampleAt,
  freshness,
  stale,
}: {
  value: DisplayValue;
  field: FieldConfig;
  width: number;
  height: number;
  /** v3: the sample time and the freshness policy give the stale state */
  sampleAt?: number;
  freshness?: FreshnessPolicy;
  /** v4: the stale state of the chart (spec 3.5 step 6) */
  stale?: boolean;
}) {
  const theme = useTheme2();
  const expired = useSampleStale(sampleAt, freshness);
  const hint = stale || expired ? <span role="status">Stale data</span> : null;
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
        height={height}
        theme={theme}
        orientation={VizOrientation.Horizontal}
        displayMode={BarGaugeDisplayMode.Basic}
        isOverflow={false}
      />
    </div>
  );
}
