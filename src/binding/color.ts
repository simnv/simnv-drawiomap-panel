import {
  type DisplayValue,
  type Field,
  getActiveThreshold,
  getFieldColorModeForField,
  type GrafanaTheme2,
  type ThresholdsConfig,
  ThresholdsMode,
} from '@grafana/data';

export interface ColorResult {
  color: string;
  stepIndex: number;
}

export function noDataColor(theme: GrafanaTheme2): string {
  return theme.colors.text.disabled;
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
