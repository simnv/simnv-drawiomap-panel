import type { DisplayValue, GrafanaTheme2, ThresholdsConfig } from '@grafana/data';
import type { RuleThresholds } from '../types';

export interface ColorResult {
  color: string;
  stepIndex: number;
}

/** Used for percent-of-capacity colouring when the rule sets no thresholds. */
export const DEFAULT_PERCENT_STEPS: Array<[number, string]> = [
  [0, 'green'],
  [60, 'yellow'],
  [85, 'red'],
];

export function noDataColor(theme: GrafanaTheme2): string {
  return theme.colors.text.disabled;
}

/** Index of the last step whose threshold is <= input (steps ascending). */
export function stepIndexOf(input: number, steps: Array<[number, string]>): number {
  let idx = -1;
  for (let i = 0; i < steps.length; i++) {
    if (input >= steps[i][0]) {
      idx = i;
    }
  }
  return Math.max(0, idx);
}

function fieldSteps(t: ThresholdsConfig | undefined): Array<[number, string]> | undefined {
  if (!t?.steps?.length) {
    return undefined;
  }
  return t.steps.map((s) => [s.value === null || s.value === undefined ? -Infinity : s.value, s.color]);
}

/**
 * Precedence:
 * 1. rule thresholds: percent mode applies to `percent` (0..100), absolute mode to `value`;
 * 2. a capacity exists (percent defined): DEFAULT_PERCENT_STEPS on percent;
 * 3. the matched field's display colour (effective field config incl. overrides); the step index
 *    comes from the field thresholds so the overlay can expose it as data-dmap-step.
 */
export function colorFor(
  value: number | undefined,
  percent: number | undefined,
  rule: RuleThresholds | undefined,
  display: DisplayValue | undefined,
  fieldThresholds: ThresholdsConfig | undefined,
  theme: GrafanaTheme2
): ColorResult {
  if (value === undefined || !Number.isFinite(value)) {
    return { color: noDataColor(theme), stepIndex: -1 };
  }
  if (rule) {
    const input = rule.mode === 'percent' && percent !== undefined ? percent : value;
    const idx = stepIndexOf(input, rule.steps);
    return { color: theme.visualization.getColorByName(rule.steps[idx][1]), stepIndex: idx };
  }
  if (percent !== undefined) {
    const idx = stepIndexOf(percent, DEFAULT_PERCENT_STEPS);
    return { color: theme.visualization.getColorByName(DEFAULT_PERCENT_STEPS[idx][1]), stepIndex: idx };
  }
  const steps = fieldSteps(fieldThresholds);
  const idx = steps ? stepIndexOf(value, steps) : 0;
  const color =
    display?.color ??
    (steps ? theme.visualization.getColorByName(steps[idx][1]) : theme.visualization.getColorByName('green'));
  return { color, stepIndex: idx };
}

export function widthFor(percent: number | undefined, w: { min: number; max: number }): number {
  if (percent === undefined || !Number.isFinite(percent)) {
    return w.min;
  }
  const t = Math.min(1, Math.max(0, percent / 100));
  return w.min + (w.max - w.min) * t;
}
