import React from 'react';
import { FieldColorModeId, FieldType, type Field, type FieldConfig, type TimeRange } from '@grafana/data';
import { Sparkline, useTheme2 } from '@grafana/ui';
import type { HistoryModel } from '../query/frames';
import { NO_DATA_ROW } from './hoverSample';

/** One line of a history chart (spec 3.7 "N lines"). A line with no finite value keeps its slot and draws nothing. */
export interface ChartLine {
  label: string;
  color: string;
  times: number[];
  values: Array<number | null>;
  noData: boolean;
}

/** The chart of a history: up to 8 lines in one Y range, or the text that tells why there is no chart. */
export type HistoryChart = { lines: ChartLine[]; domain: [number, number] } | { message: string };

interface ViewProps {
  width: number;
  height: number;
  timeRange: TimeRange;
  label: string;
  /** Supplied by a configured cadence policy, never inferred from query resolution. */
  stale?: boolean;
  showValue?: boolean;
}

/** N lines with one shared Y range (`yDomain` over the values of all lines, spec 3.7), or why there is no chart. */
export interface SparklineLinesProps extends ViewProps {
  chart: HistoryChart;
  /** the value text after the label, when `showValue` is on */
  value?: string;
  /** the field config of the first series, with the row unit and decimals: the Grafana sparkline reads them */
  config?: FieldConfig;
}

const finiteCount = (values: ReadonlyArray<number | null>) =>
  values.reduce<number>((n, v) => (v !== null && Number.isFinite(v) ? n + 1 : n), 0);

/**
 * Prepared history only. This adapter never starts queries. N lines are N Grafana sparklines stacked in one box with
 * one Y range: a card row with 8 lines has 8 uPlot canvases. They draw as one chart. Memoised: the uPlot canvases
 * draw again only for new props (a new row, a new box), not for a commit of the panel around them.
 */
export const SparklineView = React.memo(function SparklineView(props: SparklineLinesProps) {
  const theme = useTheme2();
  const { width, height, timeRange, label, stale, showValue = true, chart, value } = props;
  const config = props.config ?? {};
  if ('message' in chart) {
    return (
      <div role="status" aria-label={label}>
        {chart.message}
      </div>
    );
  }
  const [min, max] = chart.domain;
  const drawn = chart.lines.filter((line) => finiteCount(line.values) >= 2);
  const anyValue = chart.lines.some((line) => !line.noData);
  return (
    <div aria-label={label} data-state={stale ? 'stale' : 'ready'} style={{ width, height, overflow: 'hidden' }}>
      <div>
        {showValue ? (
          <>
            {label} <span style={!anyValue ? { color: theme.colors.text.secondary } : undefined}>{value}</span>
          </>
        ) : null}
      </div>
      {stale ? <span role="status">Stale data</span> : null}
      {drawn.length ? (
        <div style={{ position: 'relative', width, height: Math.max(1, height - (showValue ? 22 : 0)) }}>
          {drawn.map((line, i) => (
            <div key={i} style={{ position: 'absolute', inset: 0 }}>
              <Sparkline
                width={width}
                height={Math.max(1, height - (showValue ? 22 : 0))}
                theme={theme}
                config={{
                  ...config,
                  // the Grafana sparkline widens its range to min and max: give it the shared range of the lines
                  min,
                  max,
                  noValue: undefined,
                  color: { mode: FieldColorModeId.Fixed, fixedColor: line.color },
                  // a fill under N lines would hide the lines below it
                  custom: { lineWidth: 2, fillOpacity: chart.lines.length > 1 ? 0 : 15, spanNulls: false },
                }}
                sparkline={{ x: timeFieldOf(line), y: valueFieldOf(line, config, min, max), timeRange }}
              />
            </div>
          ))}
        </div>
      ) : (
        <span role="status" style={!anyValue ? { color: theme.colors.text.secondary } : undefined}>
          {anyValue ? 'One sample' : NO_DATA_ROW}
        </span>
      )}
    </div>
  );
});

function timeFieldOf(line: ChartLine): Field<number> {
  return { name: 'Time', type: FieldType.time, config: {}, values: line.times };
}

/** The field of a line. The sparkline reads the values of the line and writes nothing. */
function valueFieldOf(line: ChartLine, config: FieldConfig, min: number, max: number): Field<number | null> {
  return {
    name: line.label,
    type: FieldType.number,
    config,
    values: line.values,
    state: { range: { min, max, delta: max - min } },
  };
}

/** A prepared line as the history read by the shared chart tooltip. */
export function lineHistory(line: ChartLine): HistoryModel {
  return {
    state: 'ready',
    field: { name: line.label, type: FieldType.number, config: {}, values: line.values },
    timeField: { name: 'Time', type: FieldType.time, config: {}, values: line.times },
    timestamps: line.times,
    values: line.values,
    fetchedAt: 0,
    fromCache: false,
  };
}
