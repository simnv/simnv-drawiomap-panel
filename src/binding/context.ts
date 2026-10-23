import { getDisplayProcessor, type GrafanaTheme2, type ScopedVars, type ThresholdsConfig } from '@grafana/data';
import type { CardContext, DisplayOverride } from '../interact/cardModel';
import type { BindContext, SeriesInfo } from '../types';

export interface ContextInputs {
  theme: GrafanaTheme2;
  /** The panel default thresholds. They apply when a field has none. */
  fieldThresholds?: ThresholdsConfig;
  replaceVariables: (text: string, scopedVars?: ScopedVars) => string;
  timeZone: string;
  linkWidth: { min: number; max: number };
}

/** Grafana attaches `field.display` (effective config with overrides) to panel data. Fall back for other data. */
function displayOf({ theme, timeZone }: Pick<ContextInputs, 'theme' | 'timeZone'>) {
  return (s: SeriesInfo, v: number) => (s.field.display ?? getDisplayProcessor({ field: s.field, theme, timeZone }))(v);
}

/** The inputs of `bindPlan` for the panel and for the bindings popup. */
export function bindContextFor(inputs: ContextInputs): BindContext {
  return {
    theme: inputs.theme,
    fieldThresholds: inputs.fieldThresholds,
    replaceVariables: inputs.replaceVariables,
    display: displayOf(inputs),
    linkWidth: { min: inputs.linkWidth.min, max: inputs.linkWidth.max },
  };
}

/** The inputs of the hover card. A rule or a binding can replace the unit and the decimals of one row. */
export function cardContextFor(inputs: Omit<ContextInputs, 'linkWidth'> & { series: SeriesInfo[] }): CardContext {
  const { theme, timeZone } = inputs;
  const display = displayOf(inputs);
  const displayFor = (s: SeriesInfo, v: number, o?: DisplayOverride) => {
    if (!o) {
      return display(s, v);
    }
    const config = { ...s.field.config };
    if (o.unit !== undefined) {
      config.unit = o.unit;
    }
    if (o.decimals !== undefined) {
      config.decimals = o.decimals;
    }
    return getDisplayProcessor({ field: { ...s.field, config }, theme, timeZone })(v);
  };
  return {
    series: inputs.series,
    theme,
    display: displayFor,
    replaceVariables: inputs.replaceVariables,
    fieldThresholds: inputs.fieldThresholds,
  };
}
