import {
  type DisplayProcessor,
  type Field,
  getDisplayProcessor,
  type GrafanaTheme2,
  type ScopedVars,
  type ThresholdsConfig,
} from '@grafana/data';
import type { BindContext, CardContext, LinkWidthOptions, SeriesInfo } from '../types';

export interface ContextInputs {
  theme: GrafanaTheme2;
  /** The panel default thresholds. They apply when a field has none. */
  fieldThresholds?: ThresholdsConfig;
  replaceVariables: (text: string, scopedVars?: ScopedVars) => string;
  timeZone: string;
  linkWidth: LinkWidthOptions;
}

/**
 * Grafana attaches `field.display` (effective config with overrides) to panel data. Fall back for other data. The
 * fallback processor is built once for each field object: the theme and the time zone belong to this context, so the
 * cache dies with it and a theme change (a new context) builds new processors. It helps mainly the shared capacity
 * fields: panel data fields carry their own display.
 */
function displayOf({ theme, timeZone }: Pick<ContextInputs, 'theme' | 'timeZone'>) {
  const built = new WeakMap<Field, DisplayProcessor>();
  return (s: SeriesInfo, v: number) => {
    if (s.field.display) {
      return s.field.display(v);
    }
    let processor = built.get(s.field);
    if (!processor) {
      processor = getDisplayProcessor({ field: s.field, theme, timeZone });
      built.set(s.field, processor);
    }
    return processor(v);
  };
}

/** The inputs of `bindPlan` for the panel and for the bindings popup. */
export function bindContextFor(inputs: ContextInputs): BindContext {
  return {
    theme: inputs.theme,
    fieldThresholds: inputs.fieldThresholds,
    replaceVariables: inputs.replaceVariables,
    display: displayOf(inputs),
    linkWidth: { ...inputs.linkWidth },
  };
}

/** The inputs of the hover card. */
export function cardContextFor(
  inputs: Pick<ContextInputs, 'theme' | 'replaceVariables' | 'fieldThresholds'>
): CardContext {
  return { theme: inputs.theme, replaceVariables: inputs.replaceVariables, fieldThresholds: inputs.fieldThresholds };
}
