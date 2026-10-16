import { type DisplayValue, type GrafanaTheme2, type ThresholdsConfig, ThresholdsMode } from '@grafana/data';
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

/** True for the thresholds that Grafana gives a new panel: base green, red at 80, absolute mode. */
export function isGrafanaDefaultThresholds(t: ThresholdsConfig): boolean {
  const [base, red] = t.steps;
  return (
    t.mode === ThresholdsMode.Absolute &&
    t.steps.length === 2 &&
    (base.value === null || base.value === undefined || base.value === -Infinity) &&
    base.color === 'green' &&
    red.value === 80 &&
    red.color === 'red'
  );
}

/** Field thresholds apply to the utilisation percent in percentage mode or when the user changed them. */
function fieldPercentSteps(t: ThresholdsConfig | undefined): Array<[number, string]> | undefined {
  const steps = fieldSteps(t);
  if (!t || !steps) {
    return undefined;
  }
  return t.mode === ThresholdsMode.Percentage || !isGrafanaDefaultThresholds(t) ? steps : undefined;
}

/**
 * Precedence:
 * 1. rule thresholds: percent mode applies to `percent` (0..100), absolute mode to `value`;
 * 2. a capacity exists (percent defined): the field thresholds on percent when they are in percentage
 *    mode or differ from the Grafana defaults, else DEFAULT_PERCENT_STEPS on percent;
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
    const pSteps = fieldPercentSteps(fieldThresholds) ?? DEFAULT_PERCENT_STEPS;
    const idx = stepIndexOf(percent, pSteps);
    return { color: theme.visualization.getColorByName(pSteps[idx][1]), stepIndex: idx };
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
