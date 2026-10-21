import React from 'react';
import { formattedValueToString, type TimeRange } from '@grafana/data';
import { Sparkline, useTheme2 } from '@grafana/ui';
import type { FreshnessPolicy } from '../model/config';
import { useSampleStale } from './useSampleStale';
import type { HistoryModel } from '../query/frames';
import { yDomain, type LowerBound } from './domain';

export interface SparklineViewProps {
  model: HistoryModel;
  width: number;
  height: number;
  timeRange: TimeRange;
  label: string;
  /** Supplied by a configured cadence policy, never inferred from query resolution. */
  stale?: boolean;
  freshness?: FreshnessPolicy;
  showValue?: boolean;
  /** Y range, see yDomain: a number, or "auto" for the data min. The default is 0 for a non-negative series. */
  min?: LowerBound;
  max?: number;
  /** the top of the default Y range, in the unit of the values */
  capacity?: number;
}

/** Prepared history only. This adapter never starts queries. */
export function SparklineView({
  model,
  width,
  height,
  timeRange,
  label,
  stale,
  freshness,
  showValue = true,
  min: minimum,
  max: maximum,
  capacity,
}: SparklineViewProps) {
  const theme = useTheme2();
  const expired = useSampleStale(model.state === 'ready' ? model.sampleAt : undefined, freshness);
  stale = stale || expired;
  if (model.state !== 'ready') {
    const text =
      model.state === 'idle' || model.state === 'loading'
        ? 'Loading…'
        : model.state === 'empty'
          ? 'No data'
          : 'message' in model
            ? model.message
            : 'Loading…';
    return (
      <div role="status" aria-label={label}>
        {text}
      </div>
    );
  }
  const numeric = model.values.filter((value): value is number => value !== null);
  const config = model.field.config;
  const [min, max] = yDomain(model.values, {
    min: minimum,
    max: maximum,
    fieldMin: config.min,
    fieldMax: config.max,
    unit: config.unit,
    capacity,
  });
  const field = {
    ...model.field,
    values: model.values,
    state: { ...model.field.state, range: { min, max, delta: max - min } },
  };
  return (
    <div aria-label={label} data-state={stale ? 'stale' : 'ready'} style={{ width, height, overflow: 'hidden' }}>
      <div>
        {showValue ? (
          <>
            {label}{' '}
            <span>
              {model.latestDisplayValue ? formattedValueToString(model.latestDisplayValue) : model.latestValue}
            </span>
          </>
        ) : null}
      </div>
      {stale ? <span role="status">Stale data</span> : null}
      {numeric.length < 2 ? (
        <span role="status">One sample</span>
      ) : (
        <Sparkline
          width={width}
          height={Math.max(1, height - (showValue ? 22 : 0))}
          theme={theme}
          config={{
            ...config,
            // the Grafana sparkline widens its range to min and max: give it the same range as the state
            min,
            max,
            noValue: undefined,
            custom: { lineWidth: 2, fillOpacity: 15, spanNulls: false },
          }}
          sparkline={{ x: model.timeField, y: field, timeRange }}
        />
      )}
    </div>
  );
}
