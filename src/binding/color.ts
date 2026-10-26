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

/**
 * The colour of a status word as text: the semantic text colours of the theme, which keep their contrast in both
 * themes (the palette orange is too light for text on a white card). The paint, the band and the legend use
 * `statusColor`.
 */
export function statusTextColor(status: Pick<StatusView, 'state'>, theme: GrafanaTheme2): string {
  return status.state === 'critical' || status.state === 'down'
    ? theme.colors.error.text
    : status.state === 'warning' || status.state === 'stale'
      ? theme.colors.warning.text
      : theme.colors.text.secondary;
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
/** The border of a device with a status: at least this wide, in the user units of its shape ... */
const STATUS_BORDER_MIN = 2;
/** ... and this many times the width the shape was drawn with. */
const STATUS_BORDER_SCALE = 1.5;

/** The width of the status border of a device whose shape was drawn `width` wide (0 for a shape with no stroke). */
export function statusBorderWidth(width: number): number {
  return Math.max(STATUS_BORDER_MIN, STATUS_BORDER_SCALE * width);
}

/** A stroke binding draws the shape with its original stroke plus this much. */
export const STROKE_TARGET_EXTRA = 1;

/** The widest stroke that a shape drawn `width` wide can ever show: a stroke binding or the status border. */
export function maxBodyWidth(width: number): number {
  return Math.max(width + STROKE_TARGET_EXTRA, statusBorderWidth(width));
}

/** The status colours of a theme as one string: a palette with other colours must paint every element again. */
export function statusPalette(theme: GrafanaTheme2): string {
  return (['down', 'warning', 'missing'] as const).map((state) => statusColor({ state }, theme)).join('|');
}

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
