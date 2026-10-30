import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
  category?: string[];
  description?: string;
  defaultValue?: unknown;
  showIf?: (options: Options) => boolean;
  editor?: React.ComponentType<{ value: unknown; onChange: (v: unknown) => void; context: object; item: object }>;
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
  const saved = {
    build: 'build-1',
    config: { version: 4, classes: {}, overrides: {} },
    diagram: { xml: '<mxfile/>', svg: '<svg/>', hash: 'h', updatedAt: '2026-10-29T00:00:00Z' },
  } as Partial<Options>;
  it('keeps options.build through the defaults', () => {
    // the plugin has no migration handler that could drop a key
    expect(plugin.onPanelMigration).toBeUndefined();
    // the defaults step of Grafana; the stub has no option editors, which this test does not need
    const { options } = getPanelOptionsWithDefaults({
      plugin: { defaults: { zoom: { mode: 'fit' } }, fieldConfigDefaults: { defaults: {}, overrides: [] } } as never,
      currentOptions: saved as Record<string, unknown>,
      currentFieldConfig: { defaults: {}, overrides: [] },
      isAfterPluginChange: false,
    });
    expect(options).toMatchObject(saved);
  });
  it('keeps options.build when the custom editor of the plugin changes an option: it gives only its own value', () => {
    const onOptionsChange = vi.fn();
    const item = option('diagram')!;
    const Editor = item.editor!;
    // as Grafana: the editor gives the value of its path, the panel editor sets that path on a copy of the options
    // and gives onOptionsChange the whole object
    const onChange = (value: unknown) => onOptionsChange({ ...saved, [item.path]: value });
    render(
      React.createElement(Editor, { value: saved.diagram, onChange, context: { data: [], options: saved }, item })
    );
    fireEvent.click(screen.getByText('Clear'));
    expect(onOptionsChange).toHaveBeenCalledTimes(1);
    expect(onOptionsChange.mock.calls[0][0]).toEqual({ build: 'build-1', config: saved.config, diagram: undefined });
  });
});

describe('Legend options', () => {
  it('shows the legend in the bottom-right corner by default, with no limit on the blocks', () => {
    expect(option('legend.show')).toMatchObject({ kind: 'addBooleanSwitch', defaultValue: true });
    expect(option('legend.corner')).toMatchObject({ kind: 'addCustomEditor', defaultValue: 'bottom-right' });
    // 1.3.0 removed "Maximum scales": the legend shows all blocks and scrolls
    expect(option('legend.maxBlocks')).toBeUndefined();
    expect(option('legend.collapsed')).toMatchObject({ kind: 'addBooleanSwitch', defaultValue: true });
    expect(option('legend.collapsed')?.showIf?.({ legend: { show: false } } as Options)).toBe(false);
    expect(option('legend.corner')?.showIf?.({ legend: { show: false } } as Options)).toBe(false);
  });
});

describe('Last data timestamp option', () => {
  it('is a Legend switch that is on by default and shows also without the legend', () => {
    expect(option('legend.timestamp')).toMatchObject({
      kind: 'addBooleanSwitch',
      name: 'Show last data timestamp',
      category: ['Legend'],
      defaultValue: true,
    });
    expect(option('legend.timestamp')?.showIf).toBeUndefined();
  });
});

describe('Compact icon options', () => {
  /** Renders the editor of an option and gives its radio buttons. */
  function radios(path: string, value: string) {
    const item = option(path)!;
    const onChange = vi.fn();
    const view = render(
      React.createElement(item.editor!, { value, onChange, context: {}, item: item as unknown as object })
    );
    return { item, onChange, view, radios: screen.getAllByRole('radio') };
  }
  const settings = (path: string) =>
    (option(path) as Item & { settings: { options: Array<{ value: string; description: string }> } }).settings;

  it('Zoom is a row of icons with a tooltip and a label each; the saved values do not change', () => {
    expect(option('zoom.mode')).toMatchObject({ kind: 'addCustomEditor', defaultValue: 'fit', category: ['View'] });
    const { radios: buttons, onChange, view } = radios('zoom.mode', 'fit');
    expect(screen.getByRole('radiogroup', { name: 'Zoom' })).toBeTruthy();
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Fit', 'Fit width', 'Original', 'Custom']);
    expect(settings('zoom.mode').options.map((o) => o.value)).toEqual(['fit', 'fit-width', 'original', 'custom']);
    // the tooltip is the description; the native title of the label shows it too
    expect(settings('zoom.mode').options.every((o) => /^\w[\w ]*: /.test(o.description))).toBe(true);
    expect(view.container.querySelector('label')!.title).toBe('Fit: the whole diagram fits in the panel');
    // icons, no text
    expect(view.container.textContent!.trim()).toBe('');
    fireEvent.click(screen.getByRole('radio', { name: 'Fit width' }));
    expect(onChange).toHaveBeenCalledWith('fit-width');
  });

  it('Align is a row of icons with a tooltip and a label each; the saved values do not change', () => {
    expect(option('zoom.align')).toMatchObject({ kind: 'addCustomEditor', defaultValue: 'top' });
    expect(option('zoom.align')?.showIf?.({ zoom: { mode: 'fit-width' } } as Options)).toBe(false);
    const { radios: buttons, onChange } = radios('zoom.align', 'top');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Top', 'Center']);
    expect(settings('zoom.align').options.map((o) => o.value)).toEqual(['top', 'center']);
    fireEvent.click(screen.getByRole('radio', { name: 'Center' }));
    expect(onChange).toHaveBeenCalledWith('center');
  });

  it('Corner is a picker of the four corners that saves the same values', () => {
    const { radios: buttons, onChange } = radios('legend.corner', 'bottom-right');
    expect(screen.getByRole('radiogroup', { name: 'Legend corner' })).toBeTruthy();
    expect(buttons.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Top left',
      'Top right',
      'Bottom left',
      'Bottom right',
    ]);
    expect(screen.getByRole('radio', { name: 'Bottom right' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: 'Top left' }));
    expect(onChange).toHaveBeenCalledWith('top-left');
  });
});
