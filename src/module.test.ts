import { describe, expect, it, vi } from 'vitest';
import { getPanelOptionsWithDefaults } from '@grafana/data';
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

describe('Build id option', () => {
  it('keeps options.build through the defaults and an option change', () => {
    const saved = { build: 'build-1', config: { version: 4, classes: {}, overrides: {} } } as Partial<Options>;
    // the plugin has no migration handler that could drop a key
    expect(plugin.onPanelMigration).toBeUndefined();
    // the defaults step of Grafana; the stub has no option editors, which this test does not need
    const { options } = getPanelOptionsWithDefaults({
      plugin: { defaults: { zoom: { mode: 'fit' } }, fieldConfigDefaults: { defaults: {}, overrides: [] } } as never,
      currentOptions: saved as Record<string, unknown>,
      currentFieldConfig: { defaults: {}, overrides: [] },
      isAfterPluginChange: false,
    });
    // an option editor writes its own path; Grafana gives onOptionsChange the whole object
    const changed = { ...options, zoom: { mode: 'original' } } as unknown as Options;
    expect(changed.build).toBe('build-1');
    expect(changed.config).toEqual(saved.config);
  });
});

describe('Legend options', () => {
  it('shows the legend in the bottom-right corner with at most four blocks by default', () => {
    expect(option('legend.show')).toMatchObject({ kind: 'addBooleanSwitch', defaultValue: true });
    expect(option('legend.corner')).toMatchObject({ kind: 'addRadio', defaultValue: 'bottom-right' });
    expect(option('legend.maxBlocks')).toMatchObject({ kind: 'addNumberInput', defaultValue: 4 });
    expect(option('legend.collapsed')).toMatchObject({ kind: 'addBooleanSwitch', defaultValue: true });
    expect(option('legend.collapsed')?.showIf?.({ legend: { show: false } } as Options)).toBe(false);
    expect(option('legend.corner')?.showIf?.({ legend: { show: false } } as Options)).toBe(false);
  });
});
