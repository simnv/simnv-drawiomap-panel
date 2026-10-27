import { describe, expect, it } from 'vitest';
import { createTheme, FieldType, getDisplayProcessor, toDataFrame } from '@grafana/data';
import { fieldDisplay, historyOf } from './frames';

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
    const model = historyOf(
      { state: 'ready', frames: [frame], fetchedAt: 0, fromCache: false } as any,
      { queryId: 'q', match: {}, reducer: 'last' } as any,
      { unit: 'bps' }
    );
    if (model.state !== 'ready') {
      throw new Error('ready');
    }
    expect(model.field.display).toBeUndefined();
    expect(fieldDisplay(model.field)(2000).suffix).toBe(' kb/s');
    expect(model.latestDisplayValue?.suffix).toBe(' kb/s');
  });
});
