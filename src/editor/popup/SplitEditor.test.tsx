import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeYaml } from '../../options/yamlConfig';
import { CONFIG, editorProps } from './splitTestKit';

// @grafana/ui reads matchMedia (uPlot) and localStorage (logger) when it loads. Set them before the imports run.
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

const kit = await vi.hoisted(async () => (await import('./splitTestKit')).createFakeMonaco());
const { fake } = kit;
vi.mock('@grafana/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@grafana/ui')>()),
  CodeEditor: kit.CodeEditor,
}));
const zoom = vi.hoisted(() => ({ fitCells: vi.fn() }));
vi.mock('../../render/zoom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../render/zoom')>();
  zoom.fitCells.mockImplementation(actual.fitCells);
  return { ...actual, fitCells: zoom.fitCells };
});

const { SplitEditor } = await import('./SplitEditor');

const editor = () => screen.getByTestId('code-editor') as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(editor(), { target: { value: text } });
const cell = (id: string) => screen.getByTestId('dmap-popup-stage').querySelector(`[data-cell-id="${id}"]`)!;
const lit = () =>
  Array.from(screen.getByTestId('dmap-popup-stage').querySelectorAll('[data-dmap-highlight="true"]')).map((el) =>
    el.getAttribute('data-cell-id')
  );
const frame = async () => {
  await act(async () => {
    await new Promise((done) => requestAnimationFrame(() => done(undefined)));
  });
};
/** Moves the cursor to the first `needle` of the text and waits `ms`. */
const cursorAt = (needle: string, ms = 150) => {
  act(() => fake.moveTo(fake.text.indexOf(needle)));
  act(() => vi.advanceTimersByTime(ms));
};

describe('SplitEditor', () => {
  let rect: { mockRestore(): void };
  beforeEach(() => {
    fake.reset();
    zoom.fitCells.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    rect.mockRestore();
  });

  it('shows the stored JSON as YAML', () => {
    render(<SplitEditor {...editorProps()} />);
    expect(editor().value).toBe(writeYaml(CONFIG));
    expect(editor().dataset.language).toBe('yaml');
    expect(fake.setModelMarkers).toHaveBeenLastCalledWith(fake.model, expect.any(String), []);
  });

  it('binds the live diagram with the result per class after an edit', async () => {
    render(<SplitEditor {...editorProps()} />);
    await frame();
    expect(cell('a').getAttribute('data-dmap-status')).not.toBe('unavailable');
    expect(cell('c').getAttribute('data-dmap-status')).not.toBe('unavailable');
    // an item error in class `sw`: its cells are unavailable, the cells of `dev` stay bound
    type(fake.text.replace(/(sw:\n(?:.*\n)*?\s+status:) up/, '$1 5'));
    await frame();
    expect(cell('c').getAttribute('data-dmap-status')).toBe('unavailable');
    expect(cell('a').getAttribute('data-dmap-status')).not.toBe('unavailable');
    // the item error is a marker that does not block
    expect(fake.setModelMarkers.mock.lastCall?.[2]).toEqual([expect.objectContaining({ severity: 4 })]);
  });

  it('keeps the last valid draft and shows markers while the YAML does not parse', async () => {
    render(<SplitEditor {...editorProps()} />);
    type(fake.text.replace(/(sw:\n(?:.*\n)*?\s+status:) up/, '$1 5'));
    await frame();
    expect(cell('c').getAttribute('data-dmap-status')).toBe('unavailable');
    type('version: 4\nclasses: [\n');
    await frame();
    // the diagram keeps the bind of the last text that parsed
    expect(cell('c').getAttribute('data-dmap-status')).toBe('unavailable');
    expect(cell('a').getAttribute('data-dmap-status')).not.toBe('unavailable');
    const markers = fake.setModelMarkers.mock.lastCall?.[2] ?? [];
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((m) => m.severity === 8)).toBe(true);
  });

  it('waits 150 ms after a cursor move, then highlights the cells of the path and zooms to them', async () => {
    render(<SplitEditor {...editorProps()} />);
    await frame();
    const root = screen.getByTestId('dmap-popup-stage').querySelector('svg')!;
    cursorAt('dev:', 149);
    expect(lit()).toEqual([]);
    expect(zoom.fitCells).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(lit()).toEqual(['a', 'b']);
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
    const [index, ids, base] = zoom.fitCells.mock.calls[0];
    expect(ids).toEqual(['a', 'b']);
    expect(index.size).toBe(3);
    expect(base).toEqual({ x: 0, y: 0, w: 300, h: 100 });
    const view = zoom.fitCells.mock.results[0].value;
    await frame();
    expect(root.getAttribute('viewBox')).toBe(`${view.x} ${view.y} ${view.w} ${view.h}`);
    // the other cells dim
    expect(cell('c').classList.contains('dmap-legend-member')).toBe(true);
    expect(cell('c').classList.contains('dmap-legend-hit')).toBe(false);
    expect(cell('a').classList.contains('dmap-legend-hit')).toBe(true);
  });

  it('shows the count of series of the path on each cell, red for 0', async () => {
    render(<SplitEditor {...editorProps()} />);
    await frame();
    cursorAt('status: up');
    await frame();
    const badges = Object.fromEntries(
      screen.getAllByTestId('dmap-cell-badge').map((el) => [el.dataset.dmapBadge, [el.textContent, el.dataset.dmapRed]])
    );
    expect(badges).toEqual({ a: ['1', 'false'], b: ['0', 'true'] });
  });

  it('does not zoom again when the cell set stays the same', () => {
    render(<SplitEditor {...editorProps()} />);
    cursorAt('dev:');
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
    // `classes.dev.match` lights the same cells
    cursorAt('key: job');
    expect(lit()).toEqual(['a', 'b']);
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
    cursorAt('sw:');
    expect(lit()).toEqual(['c']);
    expect(zoom.fitCells).toHaveBeenCalledTimes(2);
  });

  it('takes only the last cursor move of a fast series', () => {
    render(<SplitEditor {...editorProps()} />);
    cursorAt('dev:', 100);
    cursorAt('sw:', 150);
    expect(lit()).toEqual(['c']);
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
  });

  it('registers the completion provider for its model id and disposes it on unmount', () => {
    const view = render(<SplitEditor {...editorProps()} />);
    expect(fake.providers).toHaveLength(1);
    const [{ language, provider, dispose }] = fake.providers;
    expect(language).toBe('yaml');
    const at = fake.model.getPositionAt(fake.text.indexOf('status: up') + 'status: '.length);
    expect(provider.provideCompletionItems({ ...fake.model, id: 'other-model' }, at).suggestions).toEqual([]);
    const own = provider.provideCompletionItems(fake.model, at).suggestions as Array<{ label: string }>;
    expect(own.map((s) => s.label)).toContain('up');
    expect(fake.cursor.size).toBe(1);
    view.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(fake.cursor.size).toBe(0);
  });

  it('keeps the draft when the saved options change on a refresh', () => {
    const view = render(<SplitEditor {...editorProps()} />);
    type(fake.text.replace('status: up', 'status: down'));
    const draft = editor().value;
    view.rerender(<SplitEditor {...editorProps({ data: { ...editorProps().data } })} />);
    expect(editor().value).toBe(draft);
  });
});

