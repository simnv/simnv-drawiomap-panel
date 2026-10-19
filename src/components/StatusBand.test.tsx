import { createTheme } from '@grafana/data';
import { describe, expect, it, vi } from 'vitest';
import { BAND_ROW, bandLayout } from './StatusBand';

vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: (theme: ReturnType<typeof createTheme>) => unknown) => fn(createTheme()),
}));

describe('bandLayout', () => {
  it('shows all causes up to the cap, then the most severe causes and a "+k more" row', () => {
    expect(bandLayout(0, 3, false, 600)).toMatchObject({ causes: 0, toggle: false, height: 0 });
    expect(bandLayout(2, 3, false, 600)).toMatchObject({ causes: 2, hidden: 0, toggle: false });
    expect(bandLayout(5, 3, false, 600)).toMatchObject({ causes: 2, hidden: 3, toggle: true });
    expect(bandLayout(5, 0, false, 600).height).toBe(0);
  });
  it('a cap of one row shows only the toggle row', () => {
    const layout = bandLayout(4, 1, false, 600);
    expect(layout).toMatchObject({ causes: 0, hidden: 4, toggle: true });
    expect(layout.height).toBeLessThan(2 * BAND_ROW);
  });
  it('never takes more than half of a short panel', () => {
    for (const height of [40, 60, 100]) {
      for (const count of [1, 3, 9]) {
        for (const expanded of [false, true]) {
          const layout = bandLayout(count, 3, expanded, height);
          expect(layout.height).toBeLessThanOrEqual(Math.max(BAND_ROW + 4, height / 2));
        }
      }
    }
    expect(bandLayout(3, 3, false, 60)).toMatchObject({ causes: 0, hidden: 3, toggle: true });
  });
});
