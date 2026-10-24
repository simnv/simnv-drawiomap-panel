import { createTheme, FieldType, ThresholdsMode, toDataFrame, type Field } from '@grafana/data';
import { describe, expect, it, vi } from 'vitest';
import { bindContextFor, cardContextFor } from './context';
import type { SeriesInfo } from '../types';

const theme = createTheme();
const inputs = {
  theme,
  timeZone: 'utc',
  replaceVariables: (text: string) => text,
  linkWidth: { min: 2, max: 10 },
};
const seriesOf = (field: Partial<Field> = {}): SeriesInfo => {
  const frame = toDataFrame({
    fields: [{ name: 'v', type: FieldType.number, values: [1500], config: { unit: 'bps' } }],
  });
  return {
    name: 'v',
    labels: {},
    values: [1500],
    field: { ...frame.fields[0], ...field },
    frame,
  };
};

describe('bindContextFor', () => {
  it('uses the display processor that Grafana attached to the field', () => {
    const display = vi.fn(() => ({ text: 'attached', numeric: 1 }));
    const context = bindContextFor(inputs);
    expect(context.display(seriesOf({ display }), 1).text).toBe('attached');
    expect(display).toHaveBeenCalledWith(1);
  });

  it('builds a processor from the field config when Grafana attached none', () => {
    const context = bindContextFor(inputs);
    expect(context.display(seriesOf(), 1500)).toMatchObject({ text: '1.50' });
  });

  it('copies the link width and passes the theme, thresholds and variables through', () => {
    const thresholds = { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'green' }] };
    const linkWidth = { min: 1, max: 4 };
    const context = bindContextFor({ ...inputs, linkWidth, fieldThresholds: thresholds });
    expect(context.linkWidth).toEqual(linkWidth);
    expect(context.linkWidth).not.toBe(linkWidth);
    expect(context.theme).toBe(theme);
    expect(context.fieldThresholds).toBe(thresholds);
    expect(context.replaceVariables).toBe(inputs.replaceVariables);
  });
});

describe('cardContextFor', () => {
  it('passes the theme, the variables and the panel thresholds through', () => {
    const thresholds = { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'green' }] };
    const card = cardContextFor({ ...inputs, fieldThresholds: thresholds });
    expect(card.theme).toBe(theme);
    expect(card.replaceVariables).toBe(inputs.replaceVariables);
    expect(card.fieldThresholds).toBe(thresholds);
  });
});
