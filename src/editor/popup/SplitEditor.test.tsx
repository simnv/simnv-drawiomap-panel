import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeYaml } from '../../options/yamlConfig';
import { grafanaUpdate } from '../../fixtures/grafanaOptions';
import { CONFIG, editorProps, SVG } from './splitTestKit';
import { DEFER_ABOVE } from '../../stage/useStage';
import type { Options } from '../../types';

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

const { SplitEditor, BindingsPopup, SETTLE_MS } = await import('./SplitEditor');

const editor = () => screen.getByTestId('code-editor') as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(editor(), { target: { value: text } });
/** Waits for the editor to read the text after the last keystroke. */
const settle = () => act(() => vi.advanceTimersByTime(SETTLE_MS));
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
    rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(
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

  const writableProps = () => {
    const props = editorProps();
    return {
      ...props,
      options: {
        ...props.options,
        build: 'demo-build',
        diagram: {
          ...props.options.diagram!,
          xml: '<mxGraphModel><root><object id="a" bind="dev" key="a"><mxCell vertex="1"/></object></root></mxGraphModel>',
        },
      },
    };
  };
  const writeKey = (key: string) => {
    fireEvent.click(cell('a'));
    fireEvent.change(screen.getByTestId('dmap-inspector-key'), { target: { value: key } });
    fireEvent.click(screen.getByRole('button', { name: 'Set bind and key' }));
  };

  it('keeps writes and edits local until Apply, then saves both once and keeps build', async () => {
    const props = writableProps();
    const onOptionsChange = vi.fn();
    render(<SplitEditor {...props} onOptionsChange={onOptionsChange} />);
    await frame();
    writeKey('demo-new');
    type(fake.text.replace('status: up', 'status: down'));
    expect(onOptionsChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onOptionsChange).toHaveBeenCalledTimes(1);
    const saved = onOptionsChange.mock.calls[0][0] as Options;
    expect(saved).toEqual({ ...props.options, config: expect.anything(), diagram: expect.anything() });
    expect(saved.config).toEqual({
      ...CONFIG,
      classes: { ...CONFIG.classes, dev: { ...CONFIG.classes.dev, status: 'down' } },
    });
    expect(saved.diagram!.xml).toContain('key="demo-new"');
    expect(saved.diagram!.svg).toContain('data-meta-key="demo-new"');
    expect(saved.build).toBe('demo-build');
  });

  it('sends explicit undefined for removed configuration keys', () => {
    const onOptionsChange = vi.fn();
    render(<SplitEditor {...editorProps()} onOptionsChange={onOptionsChange} />);
    type('version: 4\nclasses: {}\n');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const config = onOptionsChange.mock.calls[0][0].config;
    expect(config.classes).toEqual({ dev: undefined, sw: undefined });
    expect(Object.hasOwn(config, 'overrides')).toBe(true);
    expect(config.overrides).toBeUndefined();
  });

  it('accepts its Apply after Grafana merges the config in a different key order', () => {
    const props = editorProps();
    const options = { ...props.options, config: { version: 4, classes: {} } };
    const onOptionsChange = vi.fn();
    const view = render(<SplitEditor {...props} options={options} onOptionsChange={onOptionsChange} />);
    const text = 'version: 4\nfreshness: 7m\nclasses: {}\n';
    type(text);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const update = onOptionsChange.mock.calls[0][0] as Options;
    const merged = { ...update, config: grafanaUpdate(options, 'config', update.config).config };
    expect(Object.keys(merged.config!)).toEqual(['version', 'classes', 'freshness']);
    view.rerender(<SplitEditor {...props} options={merged} onOptionsChange={onOptionsChange} />);
    expect(screen.queryByText('The saved panel changed')).toBeNull();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(false);
    expect(editor().value).toBe(text);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onOptionsChange).toHaveBeenCalledTimes(2);
  });

  it('blocks Apply for parse and envelope errors but permits item errors', () => {
    const onOptionsChange = vi.fn();
    render(<SplitEditor {...editorProps()} onOptionsChange={onOptionsChange} />);
    for (const text of ['classes: [', 'version: 3\nclasses: {}', 'version: 4\nclasses: []']) {
      type(text);
      settle();
      const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
      expect(apply.disabled).toBe(true);
      fireEvent.click(apply);
    }
    expect(onOptionsChange).not.toHaveBeenCalled();
    type('version: 4\nclasses: {dev: {status: 5}}');
    settle();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onOptionsChange).toHaveBeenCalledTimes(1);
  });

  it('reloads the changed saved revision and drops the text, diagram and undo stack', async () => {
    const props = writableProps();
    const onOptionsChange = vi.fn();
    const view = render(<SplitEditor {...props} onOptionsChange={onOptionsChange} />);
    await frame();
    writeKey('draft-key');
    type('classes: [');
    const options = {
      ...props.options,
      diagram: { ...props.options.diagram!, hash: 'outside' },
      config: { version: 4, classes: {} },
    };
    view.rerender(<SplitEditor {...props} options={options} onOptionsChange={onOptionsChange} />);
    expect(screen.getByText('The saved panel changed')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(editor().value).toBe(writeYaml(options.config));
    expect(screen.queryByText('The saved panel changed')).toBeNull();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onOptionsChange.mock.calls[0][0].diagram).toBe(options.diagram);
  });

  it('a large diagram after Reload shows its cells in the same render: the editor stage never waits', async () => {
    const large = (cells: string) =>
      SVG.replace('viewBox="0 0 300 100">', `viewBox="0 0 300 100"><desc>${'x'.repeat(DEFER_ABOVE)}</desc>`).replace(
        '<text>A</text>',
        cells
      );
    const props = editorProps();
    props.options = { ...props.options, diagram: { ...props.options.diagram!, svg: large('<text>A-old</text>') } };
    const view = render(<SplitEditor {...props} />);
    await frame();
    expect(cell('a').textContent).toBe('A-old');
    const options = {
      ...props.options,
      diagram: { ...props.options.diagram!, svg: large('<text>A-new</text>'), hash: 'outside' },
    };
    view.rerender(<SplitEditor {...props} options={options} />);
    expect(cell('a').textContent).toBe('A-old');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(cell('a').textContent).toBe('A-new');
    expect(screen.getByTestId('dmap-popup-stage').querySelectorAll('[data-cell-id]')).toHaveLength(3);
  });

  it('keeps the draft on conflict and applies it over the latest saved options', () => {
    const props = editorProps();
    const onOptionsChange = vi.fn();
    const view = render(<SplitEditor {...props} onOptionsChange={onOptionsChange} />);
    type(fake.text.replace('status: up', 'status: down'));
    const options = {
      ...props.options,
      build: 'new-build',
      config: { ...CONFIG, classes: { ...CONFIG.classes, added: {} } },
    };
    view.rerender(<SplitEditor {...props} options={options} onOptionsChange={onOptionsChange} />);
    expect(screen.getByText('The saved panel changed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep my draft' }));
    expect(screen.queryByText('The saved panel changed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onOptionsChange.mock.calls[0][0].build).toBe('new-build');
    expect(onOptionsChange.mock.calls[0][0].config.classes.dev.status).toBe('down');
    expect(onOptionsChange.mock.calls[0][0].config.classes.added).toBeUndefined();
  });

  it.each([
    ['Escape', 'invalid text'],
    ['Close', 'invalid text'],
    ['Escape', 'valid YAML'],
    ['Close', 'valid YAML'],
    ['Escape', 'diagram'],
    ['Close', 'diagram'],
  ])('asks to discard through %s with a %s draft and keeps it on cancel', async (action, draft) => {
    const onClose = vi.fn();
    const onOptionsChange = vi.fn();
    render(<BindingsPopup {...writableProps()} onOptionsChange={onOptionsChange} onClose={onClose} />);
    await frame();
    if (draft === 'diagram') {
      writeKey('draft-key');
    } else {
      type(draft === 'invalid text' ? 'classes: [' : fake.text.replace('status: up', 'status: down'));
    }
    const draftText = editor().value;
    const draftSvg = screen.getByTestId('dmap-popup-stage').querySelector('svg')!.outerHTML;
    const close = () =>
      action === 'Escape'
        ? fireEvent.keyDown(screen.getByTestId('dmap-bindings-popup'), { key: 'Escape' })
        : fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    close();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Discard changes?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(editor().value).toBe(draftText);
    expect(screen.getByTestId('dmap-popup-stage').querySelector('svg')!.outerHTML).toBe(draftSvg);
    close();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOptionsChange).not.toHaveBeenCalled();
  });

  it.each(['Escape', 'Close'])('closes cleanly through %s after undo restores the saved diagram', async (action) => {
    const onClose = vi.fn();
    const onOptionsChange = vi.fn();
    render(<BindingsPopup {...writableProps()} onOptionsChange={onOptionsChange} onClose={onClose} />);
    await frame();
    writeKey('draft-key');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(cell('a').getAttribute('data-meta-key')).toBe('a');
    if (action === 'Escape') {
      fireEvent.keyDown(screen.getByTestId('dmap-bindings-popup'), { key: 'Escape' });
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    }
    expect(screen.queryByText('Discard changes?')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOptionsChange).not.toHaveBeenCalled();
  });

  it('routes Ctrl+Z to Monaco in the code box and to diagram history elsewhere', async () => {
    const onOptionsChange = vi.fn();
    render(<BindingsPopup {...writableProps()} onOptionsChange={onOptionsChange} onClose={vi.fn()} />);
    await frame();
    writeKey('draft-key');
    const root = screen.getByTestId('dmap-bindings-popup');
    expect(fireEvent.keyDown(editor(), { key: 'z', ctrlKey: true })).toBe(true);
    expect(cell('a').getAttribute('data-meta-key')).toBe('draft-key');
    expect(fireEvent.keyDown(root, { key: 'z', ctrlKey: true })).toBe(false);
    expect(cell('a').getAttribute('data-meta-key')).toBe('a');
    fireEvent.keyDown(root, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(cell('a').getAttribute('data-meta-key')).toBe('draft-key');
  });

  it('binds the live diagram with the result per class after an edit', async () => {
    render(<SplitEditor {...editorProps()} />);
    await frame();
    expect(cell('a').getAttribute('data-dmap-status')).not.toBe('unavailable');
    expect(cell('c').getAttribute('data-dmap-status')).not.toBe('unavailable');
    // an item error in class `sw`: its cells are unavailable, the cells of `dev` stay bound
    type(fake.text.replace(/(sw:\n(?:.*\n)*?\s+status:) up/, '$1 5'));
    settle();
    await frame();
    expect(cell('c').getAttribute('data-dmap-status')).toBe('unavailable');
    expect(cell('a').getAttribute('data-dmap-status')).not.toBe('unavailable');
    // the item error is a marker that does not block
    expect(fake.setModelMarkers.mock.lastCall?.[2]).toEqual([expect.objectContaining({ severity: 4 })]);
  });

  it('keeps the last valid draft and shows markers while the YAML does not parse', async () => {
    render(<SplitEditor {...editorProps()} />);
    type(fake.text.replace(/(sw:\n(?:.*\n)*?\s+status:) up/, '$1 5'));
    settle();
    await frame();
    expect(cell('c').getAttribute('data-dmap-status')).toBe('unavailable');
    type('version: 4\nclasses: [\n');
    settle();
    await frame();
    // the diagram keeps the bind of the last text that parsed
    expect(cell('c').getAttribute('data-dmap-status')).toBe('unavailable');
    expect(cell('a').getAttribute('data-dmap-status')).not.toBe('unavailable');
    const markers = fake.setModelMarkers.mock.lastCall?.[2] ?? [];
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((m) => m.severity === 8)).toBe(true);
  });

  describe('the wait after a keystroke', () => {
    /** An item error in class `sw`: the cell `c` becomes unavailable. */
    const broken = () => fake.text.replace(/(sw:\n(?:.*\n)*?\s+status:) up/, '$1 5');
    const markerCalls = () => fake.setModelMarkers.mock.calls.length;
    const unavailable = () => cell('c').getAttribute('data-dmap-status') === 'unavailable';

    it('updates the text at once and reads it after SETTLE_MS', async () => {
      render(<SplitEditor {...editorProps()} />);
      await frame();
      const text = broken();
      const marks = markerCalls();
      type(text);
      expect(editor().value).toBe(text);
      act(() => vi.advanceTimersByTime(SETTLE_MS - 1));
      expect(unavailable()).toBe(false);
      expect(markerCalls()).toBe(marks);
      settle();
      await frame();
      expect(unavailable()).toBe(true);
      expect(fake.setModelMarkers.mock.lastCall?.[2]).toEqual([expect.objectContaining({ severity: 4 })]);
    });

    it('reads a burst of keystrokes once, with the last text', async () => {
      render(<SplitEditor {...editorProps()} />);
      await frame();
      const marks = markerCalls();
      for (const status of ['5', '6', '7', '8']) {
        type(fake.text.replace(/(sw:\n(?:.*\n)*?\s+status:) \S+/, `$1 ${status}`));
        act(() => vi.advanceTimersByTime(SETTLE_MS / 2));
      }
      expect(markerCalls()).toBe(marks);
      settle();
      expect(markerCalls()).toBe(marks + 1);
      expect(fake.text).toContain('status: 8');
      expect(fake.setModelMarkers.mock.lastCall?.[2]?.[0]).toEqual(
        expect.objectContaining({ message: expect.stringContaining('status') })
      );
    });

    it('reads the text at once on blur', async () => {
      render(<SplitEditor {...editorProps()} />);
      await frame();
      type(broken());
      fireEvent.blur(editor());
      await frame();
      expect(unavailable()).toBe(true);
      expect(fake.setModelMarkers.mock.lastCall?.[2]).toHaveLength(1);
    });

    it('reads the text at once on Ctrl+S', async () => {
      render(<SplitEditor {...editorProps()} />);
      await frame();
      type(broken());
      act(() => fake.save());
      await frame();
      expect(unavailable()).toBe(true);
      expect(fake.setModelMarkers.mock.lastCall?.[2]).toHaveLength(1);
    });

    it('saves the last keystroke on Apply with no wait and no blur', () => {
      const onOptionsChange = vi.fn();
      render(<SplitEditor {...editorProps()} onOptionsChange={onOptionsChange} />);
      type(fake.text.replace('status: up', 'status: down'));
      type(fake.text.replace('status: down', 'status: sleep'));
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(onOptionsChange).toHaveBeenCalledTimes(1);
      expect(onOptionsChange.mock.calls[0][0].config.classes.dev.status).toBe('sleep');
      // The saved text is the box text: the editor is not dirty after Apply.
      expect(markerCalls()).toBeGreaterThan(0);
    });

    it('completes from the text in the box, not from the text of the last read', () => {
      render(<SplitEditor {...editorProps()} />);
      const text = fake.text.replace(
        'classes:\n',
        'classes:\n  fresh:\n    match: { key: job }\n  more:\n    extends: \n'
      );
      type(text);
      const [{ provider }] = fake.providers;
      const at = fake.model.getPositionAt(text.indexOf('extends: ') + 'extends: '.length);
      const labels = (provider.provideCompletionItems(fake.model, at).suggestions as Array<{ label: string }>).map(
        (s) => s.label
      );
      expect(labels).toEqual(expect.arrayContaining(['dev', 'sw', 'fresh']));
    });

    it('does not save an invalid last keystroke on Apply', () => {
      const onOptionsChange = vi.fn();
      render(<SplitEditor {...editorProps()} onOptionsChange={onOptionsChange} />);
      type(fake.text.replace('status: up', 'status: down'));
      settle();
      type('classes: [');
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(onOptionsChange).not.toHaveBeenCalled();
      expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it.each(['Escape', 'Close'])('reads the text at once on %s', async (action) => {
      render(<BindingsPopup {...editorProps()} onOptionsChange={vi.fn()} onClose={vi.fn()} />);
      await frame();
      type(broken());
      if (action === 'Escape') {
        fireEvent.keyDown(screen.getByTestId('dmap-bindings-popup'), { key: 'Escape' });
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      }
      await frame();
      expect(screen.getByText('Discard changes?')).toBeTruthy();
      expect(unavailable()).toBe(true);
    });

    it('does not fail when the wait ends after the unmount', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const view = render(<SplitEditor {...editorProps()} />);
      await frame();
      type(broken());
      const marks = markerCalls();
      view.unmount();
      act(() => vi.advanceTimersByTime(SETTLE_MS * 2));
      expect(markerCalls()).toBe(marks);
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it('drops the wait on Reload', async () => {
      const props = writableProps();
      const view = render(<SplitEditor {...props} />);
      await frame();
      type(broken());
      view.rerender(
        <SplitEditor {...props} options={{ ...props.options, config: { ...CONFIG, overrides: { x: {} } } } as never} />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      act(() => vi.advanceTimersByTime(SETTLE_MS * 2));
      await frame();
      expect(editor().value).not.toContain('status: 5');
      expect(unavailable()).toBe(false);
    });
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

  it.each(['path-only', 'no target'])('replaces the previous report highlight for an entry with %s', async (target) => {
    const props = editorProps();
    render(
      <SplitEditor
        {...props}
        options={{
          ...props.options,
          config: { ...CONFIG, classes: { ...CONFIG.classes, sw: { ...CONFIG.classes.sw, status: 'missing' } } },
        }}
      />
    );
    await frame();
    fireEvent.click(screen.getByRole('button', { name: 'classes.dev.status: 1 cells have no series' }));
    expect(lit()).toEqual(['b']);
    // the report shows one class at a time: open the tab of the entry
    if (target === 'path-only') {
      fireEvent.click(screen.getByRole('tab', { name: /^sw/ }));
      fireEvent.click(screen.getByRole('button', { name: 'classes.sw.status: no panel query has refId missing' }));
      expect(fake.editor.setPosition).toHaveBeenLastCalledWith(
        fake.model.getPositionAt(fake.text.indexOf('status: missing'))
      );
    } else {
      fireEvent.click(screen.getByRole('tab', { name: /^Not in a class/ }));
      fireEvent.click(screen.getByRole('button', { name: /up: 1 series select no cell/ }));
    }
    act(() => vi.advanceTimersByTime(150));
    expect(lit()).toEqual(target === 'path-only' ? ['c'] : []);
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

  it('moves the focus into the code box when Monaco loads and the dialog holds the focus (P3.13)', () => {
    render(
      <div role="dialog" tabIndex={-1} ref={(el) => el?.focus()}>
        <SplitEditor {...editorProps()} />
      </div>
    );
    expect(fake.editor.focus).toHaveBeenCalledTimes(1);
  });

  it('keeps a focus that the user moved to another element before Monaco loads', () => {
    render(
      <div role="dialog" tabIndex={-1}>
        <button ref={(el) => el?.focus()}>Close</button>
        <SplitEditor {...editorProps()} />
      </div>
    );
    expect(fake.editor.focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('keeps the draft when the saved options change on a refresh', () => {
    const view = render(<SplitEditor {...editorProps()} />);
    type(fake.text.replace('status: up', 'status: down'));
    const draft = editor().value;
    view.rerender(<SplitEditor {...editorProps({ data: { ...editorProps().data } })} />);
    expect(editor().value).toBe(draft);
  });
});
