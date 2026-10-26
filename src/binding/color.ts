import {
  colorManipulator,
  type DisplayValue,
  type Field,
  getActiveThreshold,
  getFieldColorModeForField,
  type GrafanaTheme2,
  type ThresholdsConfig,
  ThresholdsMode,
} from '@grafana/data';
import type { StatusView } from './status';
import type { HalfState } from '../types';

export interface ColorResult {
  color: string;
  stepIndex: number;
}

export function noDataColor(theme: GrafanaTheme2): string {
  return theme.colors.text.disabled;
}

/**
 * The colour of a status state, from the theme: the palette red for down and critical, the palette orange for
 * warning and stale, the no-data grey for missing. The elements, the status band and the legend share it.
 */
export function statusColor(status: Pick<StatusView, 'state'>, theme: GrafanaTheme2): string {
  return status.state === 'critical' || status.state === 'down'
    ? theme.visualization.getColorByName('red')
    : status.state === 'warning' || status.state === 'stale'
      ? theme.visualization.getColorByName('orange')
      : noDataColor(theme);
}

/** The colour a status paints its element with: a state that is not normal. A normal status paints nothing. */
export function statusPaint(status: Pick<StatusView, 'state'> | undefined, theme: GrafanaTheme2): string | undefined {
  return status && status.state !== 'normal' ? statusColor(status, theme) : undefined;
}

/**
 * The status colour of a link's stroke. A status that is not normal wins over the binding colour of the halves. One
 * exception: a missing status on a link with halves paints nothing, because each half shows its own state already
 * (the half with no data is grey; the other keeps the colour of its value). A link without halves takes the grey.
 */
export function linkStatusPaint(
  patch: { link?: { a2b?: HalfState; b2a?: HalfState }; statusView?: Pick<StatusView, 'state'> },
  theme: GrafanaTheme2
): string | undefined {
  const halves = !!(patch.link?.a2b || patch.link?.b2a);
  if (halves && patch.statusView?.state === 'missing') {
    return undefined;
  }
  return statusPaint(patch.statusView, theme);
}

/** The share of the status colour in the tinted fill of a device. */
export const STATUS_TINT = 0.2;

/** The channels of a CSS colour: red, green, blue (0 to 255) and alpha (0 to 1); undefined when it does not parse. */
function channels(value: string): [number, number, number, number] | undefined {
  try {
    const c = colorManipulator.decomposeColor(value.trim());
    const rgb = c.type.startsWith('hsl') ? colorManipulator.decomposeColor(colorManipulator.hslToRgb(c)) : c;
    if (!rgb.type.startsWith('rgb')) {
      return undefined;
    }
    const [r, g, b, a = 1] = rgb.values;
    return [r, g, b, a].every((n) => Number.isFinite(n)) ? [r, g, b, a] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The fill of a device with a status: `fill` mixed with the status colour at `STATUS_TINT` (times the alpha of the
 * status colour). Undefined when the fill is not an opaque colour (none, a url, an alpha, a value that does not
 * parse) or the status colour does not parse: the border alone shows the status then.
 */
export function tintFill(fill: string, status: string): string | undefined {
  const base = channels(fill);
  const over = channels(status);
  if (!base || !over || base[3] < 1) {
    return undefined;
  }
  const t = STATUS_TINT * over[3];
  const mix = (i: number) => Math.round(base[i] + (over[i] - base[i]) * t);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

/**
 * The colour of a value from the Grafana field config of its field (effective config, incl. overrides):
 * the Color scheme and the Thresholds. The panel thresholds apply when the field has none.
 *
 * - With a capacity (`percent` is set): the colour input is the utilisation percent. The threshold steps
 *   are percent, in absolute and in percentage mode. A continuous scheme gets percent / 100 (0..1).
 * - Without a capacity: the display colour of the raw value, as in any Grafana panel.
 *
 * The step index is the active threshold step. The overlay shows it as data-dmap-step.
 */
export function colorFor(
  value: number | undefined,
  percent: number | undefined,
  field: Field | undefined,
  display: DisplayValue | undefined,
  panelThresholds: ThresholdsConfig | undefined,
  theme: GrafanaTheme2
): ColorResult {
  if (value === undefined || !Number.isFinite(value)) {
    return { color: noDataColor(theme), stepIndex: -1 };
  }
  const thresholds = field?.config?.thresholds ?? panelThresholds;
  const steps = thresholds?.steps ?? [];
  if (percent !== undefined) {
    const active = getActiveThreshold(percent, steps);
    const f = { ...field, config: { ...field?.config, thresholds } } as Field;
    const t = Math.min(1, Math.max(0, percent / 100));
    const color = getFieldColorModeForField(f).getCalculator(f, theme)(value, t, active);
    return { color, stepIndex: Math.max(0, steps.indexOf(active)) };
  }
  const input =
    thresholds?.mode === ThresholdsMode.Percentage && display?.percent !== undefined ? display.percent * 100 : value;
  const active = getActiveThreshold(input, steps);
  const color = display?.color ?? theme.visualization.getColorByName(active.color);
  return { color, stepIndex: Math.max(0, steps.indexOf(active)) };
}

export function widthFor(percent: number | undefined, w: { min: number; max: number }): number {
  if (percent === undefined || !Number.isFinite(percent)) {
    return w.min;
  }
  const t = Math.min(1, Math.max(0, percent / 100));
  return w.min + (w.max - w.min) * t;
}
