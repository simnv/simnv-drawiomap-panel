import { type DisplayValue, type Field, formattedValueToString } from '@grafana/data';
import type { BindContext, CapacitySource, HalfState, SeriesInfo } from '../types';
import { colorFor, noDataColor, widthFor } from './color';
import { bitsWithNote, inFieldUnit } from './capacity';
import type { HistoryModel } from '../query/frames';

/*
 * The state of a link half and of a card direction (spec 3.8): the colour, the width and the text of one direction
 * from its history and its capacity. The v4 bind (`bindV4`) and the card (`buildCardV4`) share it.
 */

const seriesOf = new WeakMap<HistoryModel, Map<string, SeriesInfo>>();

/** The series of a model without its gaps, built once per model and refId. */
function historySeries(model: Extract<HistoryModel, { state: 'ready' }>, refId: string): SeriesInfo {
  let cache = seriesOf.get(model);
  if (!cache) {
    cache = new Map();
    seriesOf.set(model, cache);
  }
  const seen = cache.get(refId);
  if (seen) {
    return seen;
  }
  const values: number[] = [];
  const times: number[] = [];
  for (let i = 0; i < model.values.length; i++) {
    const value = model.values[i];
    if (value !== null) {
      values.push(value);
      times.push(model.timestamps[i]);
    }
  }
  const series: SeriesInfo = {
    refId,
    name: model.field.name,
    labels: model.field.labels ?? {},
    field: model.field,
    values,
    times,
    frame: { length: model.values.length, fields: [model.timeField, model.field] },
  };
  cache.set(refId, series);
  return series;
}

const NO_DATA_LABEL = 'no data';

/** "4.10" reads "4.1", "100.00" reads "100": a capacity is a round figure, its text carries no filler zeros. */
const withoutTrailingZeros = (shown: DisplayValue): DisplayValue =>
  /^-?\d+\.\d*0$/.test(shown.text) ? { ...shown, text: shown.text.replace(/\.?0+$/, '') } : shown;
/** The field a capacity is formatted with: the unit of the values, automatic decimals, no cached processor. */
const capacityField = (field: Field): Field => ({
  ...field,
  display: undefined,
  config: { ...field.config, decimals: undefined },
});

/** A value in the unit of its field, in bit/s. */
function bitsOf(value: number, s: SeriesInfo, notes: string[]): number {
  const rate = bitsWithNote(value, s.field.config?.unit);
  if (rate.note) {
    notes.push(rate.note);
  }
  return rate.bits;
}

/** The context that `halfState` needs: the bind has all of it, the card builds its own `display`. */
export type HalfContext = Pick<BindContext, 'theme' | 'fieldThresholds' | 'display' | 'linkWidth'>;

/**
 * The state of one direction from its history and its resolved capacity: the colour, the width and the card text.
 * A link half and a card direction both come from here. The capacity never produces a value on its own: without a
 * value the direction is grey "no data"; without a capacity it has no percent and the colour of the raw value.
 */
export function halfState(
  model: HistoryModel,
  refId: string,
  cap: { amount?: number; source: CapacitySource },
  ctx: HalfContext
): { state: HalfState; notes: string[] } {
  if (model.state !== 'ready' || model.latestValue === undefined) {
    return {
      state: {
        status: 'nodata',
        color: noDataColor(ctx.theme),
        width: ctx.linkWidth.min,
        label: NO_DATA_LABEL,
        stepIndex: -1,
        capacity: cap.amount,
        capacitySource: cap.source,
      },
      notes: [],
    };
  }
  const series = historySeries(model, refId);
  const value = model.latestValue;
  const notes: string[] = [];
  const capacity = cap.amount;
  // the capacity is in the canonical unit; the field unit tells how to read the value
  const percent = capacity === undefined ? undefined : (bitsOf(value, series, notes) / capacity) * 100;
  const display = model.latestDisplayValue ?? ctx.display(series, value);
  // the capacity, once, in the unit of the field with automatic decimals: the card and the labels show this text
  const capacityDisplay =
    capacity === undefined
      ? undefined
      : withoutTrailingZeros(
          ctx.display({ ...series, field: capacityField(series.field) }, inFieldUnit(capacity, series.field))
        );
  const { color, stepIndex } = colorFor(value, percent, series.field, display, ctx.fieldThresholds, ctx.theme);
  const text = formattedValueToString(display);
  const percentDisplay = percent === undefined ? undefined : percentText(percent);
  const label =
    percentDisplay === undefined || capacityDisplay === undefined
      ? text
      : `${text} · ${percentDisplay} of ${formattedValueToString(capacityDisplay)}`;
  return {
    state: {
      status: 'ok',
      color,
      width: widthFor(percent, ctx.linkWidth),
      label,
      stepIndex,
      value,
      percent,
      percentDisplay,
      capacity,
      capacitySource: capacity === undefined ? 'none' : cap.source,
      capacityDisplay,
      display,
      series,
    },
    notes,
  };
}

/**
 * The text of a load percent, the one for the card and the link labels: a real 0 is "0%", a load above 0 and under
 * 0.5 is "<1%" (never a good-looking "0%"), above 999 is ">999%", else the rounded whole percent.
 */
export function percentText(percent: number): string {
  if (percent > 0 && percent < 0.5) {
    return '<1%';
  }
  if (percent > 999) {
    return '>999%';
  }
  return `${Math.round(percent)}%`;
}
