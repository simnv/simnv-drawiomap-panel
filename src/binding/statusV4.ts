import { formattedValueToString, type GrafanaTheme2 } from '@grafana/data';
import { fieldDisplay } from '../query/frames';
import { reduceValues } from '../query/reduce';
import type { QuerySnapshot, Series } from '../query/snapshot';
import type { StatusV4Fields } from '../types';
import { severityOf } from './severity';
import { STATUS_SEVERITY, type StatusView } from './status';

/** The text of a cell with no data (spec 3.6). */
export const NO_DATA_TEXT = '–';

/**
 * The status of a use (spec 3.4). For a value state, `state` and `severity` are the severity of the display, and
 * `color` and `text` are the exact display of the value. A status with no value is `missing` (or `down` for
 * `missing: down`), with the text "–" and no colour: the painter takes the theme colour.
 */
export interface StatusV4 extends StatusV4Fields {
  state: StatusView['state'];
  severity: StatusView['state'];
  reason?: string;
}

export interface StatusOptions {
  /** the refId of the status use; the band and the legend group by it */
  refId: string;
  /** `down`: zero series of a ready query is a proven outage */
  missing: 'nodata' | 'down';
  theme: GrafanaTheme2;
  /** the dashboard time zone, for a field with no display processor of Grafana */
  timeZone?: string;
}

/** The status of one series from its last finite value; undefined when it has no finite value. */
function valueStatus(series: Series, { refId, theme, timeZone }: StatusOptions): StatusV4 | undefined {
  const value = reduceValues(series.values, 'last');
  if (value === undefined) {
    return undefined;
  }
  const display = fieldDisplay(series.field, theme, timeZone)(value);
  const severity = severityOf({ text: display.text, color: display.color ?? '' }, theme);
  return { state: severity, severity, color: display.color, text: formattedValueToString(display), refId, value };
}

/**
 * The status of a use from the snapshot of its refId and the series that the cell selects (spec 3.6), in the order
 * of spec 3.7. A failed query, a first load and a series with no finite value are `missing` and never `down`:
 * `missing: down` applies only to zero series of a ready query. With N series the worst state wins; between two of
 * one rank, the first in the order wins. When a series with no value is the worst, the reason gives the coverage.
 * The caller handles a refId that no target has ("Unknown query", `unknown-ref`) before this: the snapshot of such a
 * refId is `empty`, and `missing: down` must not apply to it.
 */
export function statusOfUse(snapshot: QuerySnapshot, series: Series[], opts: StatusOptions): StatusV4 {
  const noValue = (reason: string, state: 'missing' | 'down' = 'missing'): StatusV4 => ({
    state,
    severity: state,
    text: NO_DATA_TEXT,
    refId: opts.refId,
    reason,
  });
  switch (snapshot.state) {
    case 'error':
      return noValue('Query failed');
    case 'unsupported':
      return noValue('Unsupported data');
    case 'idle':
    case 'loading':
      return noValue('Loading data');
  }
  if (!series.length) {
    return noValue('No data', opts.missing === 'down' ? 'down' : 'missing');
  }
  let worst: StatusV4 | undefined;
  let empty = 0;
  for (const item of series) {
    let status = valueStatus(item, opts);
    if (!status) {
      empty++;
      status = noValue('No value');
    }
    if (!worst || STATUS_SEVERITY[status.state] < STATUS_SEVERITY[worst.state]) {
      worst = status;
    }
  }
  return worst!.state === 'missing' && empty < series.length
    ? noValue(`${empty} of ${series.length} series have no value`)
    : worst!;
}
