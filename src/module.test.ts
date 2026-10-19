import { describe, expect, it, vi } from 'vitest';
import type { Options } from './types';

// @grafana/ui reads matchMedia (uPlot) and localStorage (logger) when it loads.
vi.hoisted(() => {
  if (!window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  }
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});

const { plugin } = await import('./module');

interface Item {
  kind: string;
  path: string;
  name: string;
  description?: string;
  defaultValue?: unknown;
  showIf?: (options: Options) => boolean;
}

/** Record the add* calls of the options builder: the real builder needs the Grafana editor registry. */
function option(path: string) {
  const items: Item[] = [];
  const builder: object = new Proxy(
    {},
    { get: (_, kind: string) => (config: Omit<Item, 'kind'>) => (items.push({ kind, ...config }), builder) }
  );
  plugin.getPanelOptionsSupplier()(builder as never, { data: [] });
  return items.find((item) => item.path === path);
}

describe('Minimum scale option', () => {
  it('is a number input that is off by default', () => {
    const item = option('zoom.minScale');
    expect(item?.name).toBe('Minimum scale');
    expect(item?.kind).toBe('addNumberInput');
    expect(item?.defaultValue).toBe(0);
    expect(item?.description).toBe('Do not shrink below this scale in Fit modes; the panel scrolls instead. 1 = 100%.');
  });
  it('shows for Fit and Fit width only', () => {
    const showIf = option('zoom.minScale')!.showIf!;
    const zoom = (mode: Options['zoom']['mode']) => ({ zoom: { mode } }) as Options;
    expect(showIf(zoom('fit'))).toBe(true);
    expect(showIf(zoom('fit-width'))).toBe(true);
    expect(showIf(zoom('original'))).toBe(false);
    expect(showIf(zoom('custom'))).toBe(false);
  });
});
