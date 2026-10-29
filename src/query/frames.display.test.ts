import { describe, expect, it } from 'vitest';
import { createTheme, FieldType, getDisplayProcessor, toDataFrame } from '@grafana/data';
import { fieldDisplay } from './frames';
import { shownField } from '../binding/rowData';

describe('fieldDisplay', () => {
  it('uses the display processor of the field, else builds one from the config', () => {
    const field = { name: 'v', type: FieldType.number, config: { unit: 'bps' }, values: [1] };
    expect(fieldDisplay(field)(1000).suffix).toBe(' kb/s');
    const own = getDisplayProcessor({ field: { ...field, config: { unit: 'percent' } }, theme: createTheme() });
    expect(fieldDisplay({ ...field, display: own })(5).suffix).toBe('%');
  });
  it('drops the old display processor when the unit is overridden', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'time', type: FieldType.time, values: [0, 1] },
        { name: 'v', type: FieldType.number, values: [1000, 2000], config: { unit: 'percent' } },
      ],
    });
    frame.fields[1].display = getDisplayProcessor({ field: frame.fields[1], theme: createTheme() });
    const shown = shownField(frame.fields[1], { unit: 'bps' });
    expect(shown.display).toBeUndefined();
    expect(fieldDisplay(shown)(2000).suffix).toBe(' kb/s');
  });
});
