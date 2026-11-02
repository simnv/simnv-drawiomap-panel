import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grafanaUpdate, saveOptions } from '../fixtures/grafanaOptions';
import { writeYaml } from './yamlConfig';

interface Marker {
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

const setModelMarkers = vi.fn<(model: unknown, owner: string, markers: Marker[]) => void>();
const model = { id: 'model-1' };

/** The Grafana CodeEditor loads Monaco. The mock is a text area with the same props and a fake Monaco instance. */
vi.mock('@grafana/ui', () => ({
  CodeEditor: (props: {
    value: string;
    language: string;
    onChange?: (text: string) => void;
    onBlur?: (text: string) => void;
    onSave?: (text: string) => void;
    onEditorDidMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    const { onEditorDidMount } = props;
    React.useEffect(() => {
      onEditorDidMount?.(
        { getModel: () => model },
        { editor: { setModelMarkers }, MarkerSeverity: { Error: 8, Warning: 4 } }
      );
    }, [onEditorDidMount]);
    return (
      <textarea
        data-testid="code-editor"
        data-language={props.language}
        value={props.value}
        onChange={(e) => props.onChange?.(e.target.value)}
        onBlur={(e) => props.onBlur?.(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl+S in Grafana calls `onSave` with the text of the editor.
          if (e.key === 's' && e.ctrlKey) {
            props.onSave?.((e.target as HTMLTextAreaElement).value);
          }
        }}
      />
    );
  },
  Alert: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div role="alert">
      {title}
      {children}
    </div>
  ),
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Spinner: () => <span />,
  useTheme2: () => ({ spacing: () => '8px' }),
}));
// The button has its own tests (LazyConfigYamlEditor.test.tsx); its bus loads @grafana/runtime.
vi.mock('./EditBindingsButton', () => ({ EditBindingsButton: () => null }));

const { default: ConfigYamlEditor, SETTLE_MS } = await import('./ConfigYamlEditor');
const { LazyConfigYamlEditor } = await import('./LazyConfigYamlEditor');

const stored = {
  version: 4,
  classes: { 'node-up': { match: { key: 'job' }, status: 'up' } },
  overrides: {},
};

type EditorProps = React.ComponentProps<typeof ConfigYamlEditor>;
const editorProps = (value: unknown, onChange: (value: unknown) => void) =>
  ({ value, onChange, context: { data: [] }, item: {} }) as unknown as EditorProps;

function mount(...args: [] | [unknown]) {
  const value = args.length ? args[0] : stored;
  const onChange = vi.fn();
  const view = render(<ConfigYamlEditor {...editorProps(value, onChange)} />);
  const rerender = (next: unknown) => view.rerender(<ConfigYamlEditor {...editorProps(next, onChange)} />);
  return { onChange, rerender };
}

const editor = () => screen.getByTestId('code-editor') as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(editor(), { target: { value: text } });
/** Waits for the editor to read the text after the last keystroke. */
const settle = () => act(() => vi.advanceTimersByTime(SETTLE_MS));
/** A keystroke, then the wait. */
const edit = (text: string) => {
  type(text);
  settle();
};
/** The markers of the last setModelMarkers call. */
const markers = (): Marker[] => setModelMarkers.mock.calls.at(-1)?.[2] ?? [];

beforeEach(() => setModelMarkers.mockClear());

describe('ConfigYamlEditor', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('shows the stored JSON as YAML on mount, with no markers', () => {
    mount();
    expect(editor().value).toBe(writeYaml(stored));
    expect(editor().dataset.language).toBe('yaml');
    expect(setModelMarkers).toHaveBeenCalledWith(model, expect.any(String), []);
  });

  it('shows an empty box when no config is stored', () => {
    mount(undefined);
    expect(editor().value).toBe('');
  });

  it('marks an item error on its line and still stores the JSON', () => {
    const { onChange } = mount();
    edit(['version: 4', 'classes:', '  node-up:', '    match: { key: job }', '    colour: red', ''].join('\n'));
    expect(markers()).toEqual([
      expect.objectContaining({
        severity: 4,
        startLineNumber: 5,
        startColumn: 5,
        endLineNumber: 5,
        endColumn: 11,
        message: expect.stringContaining('colour'),
      }),
    ]);
    expect(onChange).toHaveBeenLastCalledWith({
      version: 4,
      classes: { 'node-up': { match: { key: 'job' }, colour: 'red' } },
    });
  });

  it('marks the error of an override on its own key when another override id has a dot', () => {
    mount();
    edit(
      [
        'version: 4',
        'classes:',
        '  node-up:',
        '    match: { key: job }',
        'overrides:',
        '  x:',
        '    status: 5',
        '  x.status:',
        '    match:',
        '      key: [job, "name=\\"\\\\d\\""]',
        '',
      ].join('\n')
    );
    expect(markers().map((m) => [m.startLineNumber, m.message])).toEqual([
      [7, expect.stringMatching(/^overrides\.x\.status: /)],
      [10, expect.stringMatching(/^overrides\["x\.status"\]\.match\.key\[1\]: /)],
    ]);
  });

  it('marks a chain error on the extends line of the class', () => {
    const { onChange } = mount();
    edit(['version: 4', 'classes:', '  a:', '    extends: b', ''].join('\n'));
    expect(markers()).toEqual([expect.objectContaining({ startLineNumber: 4, severity: 4 })]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('marks an envelope error and stores nothing', () => {
    const { onChange } = mount();
    edit(['version: 4', 'classes: []', ''].join('\n'));
    expect(markers()).toEqual([expect.objectContaining({ startLineNumber: 2, severity: 8 })]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks an old version on the version line and stores nothing', () => {
    const { onChange } = mount();
    edit(['classes: {}', 'version: 3', ''].join('\n'));
    expect(markers()).toEqual([expect.objectContaining({ startLineNumber: 2 })]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks a YAML syntax error and a duplicate key, and stores nothing', () => {
    const { onChange } = mount();
    edit(['version: 4', 'classes:', '  a: {', ''].join('\n'));
    expect(markers().length).toBeGreaterThan(0);
    edit(['version: 4', 'classes: {}', 'classes: {}', ''].join('\n'));
    expect(markers()).toEqual([expect.objectContaining({ startLineNumber: 3, severity: 8 })]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a text that does not parse in local state', () => {
    const { rerender } = mount();
    const broken = ['version: 4', 'classes:', '  a: {', ''].join('\n');
    edit(broken);
    rerender(stored);
    expect(editor().value).toBe(broken);
    expect(screen.getByRole('status').textContent).toMatch(/not saved/i);
  });

  it('does not write its own save back over the text', () => {
    const { onChange, rerender } = mount();
    const text = ['version: 4', 'classes:', '  # a comment', '  b: { match: { key: job } }', ''].join('\n');
    edit(text);
    rerender(onChange.mock.lastCall?.[0]);
    expect(editor().value).toBe(text);
  });

  it('stores an empty class map that stays empty through the Grafana options merge', () => {
    const { onChange, rerender } = mount();
    const text = ['version: 4', 'freshness: 7m', 'classes: {}', 'overrides: {}', ''].join('\n');
    edit(text);
    const options = grafanaUpdate({ config: stored }, 'config', onChange.mock.lastCall?.[0]);
    rerender(options.config);
    expect(editor().value).toBe(text);
    expect(saveOptions(options).config).toEqual({ version: 4, freshness: '7m', classes: {}, overrides: {} });
  });

  it('does not write the Grafana merge of its own save back over the text', () => {
    const { onChange, rerender } = mount();
    // the merge keeps the old key order, so freshness moves to the end
    const text = ['version: 4', 'freshness: 7m # new', 'classes:', '  b: { match: { key: job } }', ''].join('\n');
    edit(text);
    rerender(grafanaUpdate({ config: stored }, 'config', onChange.mock.lastCall?.[0]).config);
    expect(editor().value).toBe(text);
  });

  describe('the wait after a keystroke', () => {
    const ITEM_ERROR = ['version: 4', 'classes:', '  a: { match: { key: job }, status: 5 }', ''].join('\n');
    const GOOD = ['version: 4', 'classes:', '  a: { match: { key: job }, status: up }', ''].join('\n');
    const markerCalls = () => setModelMarkers.mock.calls.length;
    const lastStored = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.lastCall?.[0] as { classes: object };

    it('updates the box at once and stores the value after SETTLE_MS', () => {
      const { onChange } = mount();
      const marks = markerCalls();
      type(GOOD);
      expect(editor().value).toBe(GOOD);
      act(() => vi.advanceTimersByTime(SETTLE_MS - 1));
      expect(onChange).not.toHaveBeenCalled();
      expect(markerCalls()).toBe(marks);
      act(() => vi.advanceTimersByTime(1));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastStored(onChange).classes).toEqual({ 'node-up': undefined, a: expect.anything() });
    });

    it('reads a burst of keystrokes once, with the last text', () => {
      const { onChange } = mount();
      const marks = markerCalls();
      for (const status of ['dow', 'down', 'downn']) {
        type(GOOD.replace('up', status));
        act(() => vi.advanceTimersByTime(SETTLE_MS / 2));
      }
      expect(onChange).not.toHaveBeenCalled();
      settle();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(markerCalls()).toBe(marks + 1);
      expect(JSON.stringify(lastStored(onChange))).toContain('downn');
    });

    it('stores at once on blur', () => {
      const { onChange } = mount();
      type(GOOD);
      fireEvent.blur(editor());
      expect(onChange).toHaveBeenCalledTimes(1);
      // The timer that waited does not store the value a second time.
      settle();
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('stores at once on Ctrl+S', () => {
      const { onChange } = mount();
      type(GOOD);
      fireEvent.keyDown(editor(), { key: 's', ctrlKey: true });
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('stores the last keystroke when the editor unmounts before the wait ends', () => {
      const onChange = vi.fn();
      const view = render(<ConfigYamlEditor {...editorProps(stored, onChange)} />);
      type(GOOD);
      expect(onChange).not.toHaveBeenCalled();
      view.unmount();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastStored(onChange).classes).toEqual({ 'node-up': undefined, a: expect.anything() });
      act(() => vi.advanceTimersByTime(SETTLE_MS * 2));
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('stores nothing at the unmount when the last text is not valid', () => {
      const onChange = vi.fn();
      const view = render(<ConfigYamlEditor {...editorProps(stored, onChange)} />);
      type('classes: [');
      view.unmount();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('stores nothing at the unmount when no keystroke waits', () => {
      const onChange = vi.fn();
      const view = render(<ConfigYamlEditor {...editorProps(stored, onChange)} />);
      edit(GOOD);
      expect(onChange).toHaveBeenCalledTimes(1);
      view.unmount();
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('shows the marker and the notice of the final text', () => {
      mount();
      type(ITEM_ERROR);
      type('classes: [');
      settle();
      expect(setModelMarkers.mock.lastCall?.[2].every((m) => m.severity === 8)).toBe(true);
      expect(screen.getByRole('status').textContent).toMatch(/not saved/i);
    });

    it('drops the waiting keystrokes when a new value comes from outside', () => {
      const { onChange, rerender } = mount();
      type(GOOD);
      const next = { version: 4, classes: {}, overrides: { 'cell-1': { status: 'up' } } };
      rerender(next);
      settle();
      expect(onChange).not.toHaveBeenCalled();
      expect(editor().value).toBe(writeYaml(next));
    });
  });

  it('writes a new stored value from outside as YAML', () => {
    const { rerender } = mount();
    const next = { version: 4, classes: {}, overrides: { 'cell-1': { status: 'up' } } };
    rerender(next);
    expect(editor().value).toBe(writeYaml(next));
  });
});

describe('LazyConfigYamlEditor', () => {
  it('loads the editor body', async () => {
    await act(async () => {
      render(<LazyConfigYamlEditor {...editorProps(stored, vi.fn())} />);
    });
    expect((await screen.findByTestId('code-editor')).getAttribute('data-language')).toBe('yaml');
  });
});
