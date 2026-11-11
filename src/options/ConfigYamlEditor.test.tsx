import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grafanaUpdate, saveOptions } from '../fixtures/grafanaOptions';
import { publishEditedRefIds } from '../query/panelTargets';
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

const { default: ConfigYamlEditor } = await import('./ConfigYamlEditor');
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
/** The markers of the last setModelMarkers call. */
const markers = (): Marker[] => setModelMarkers.mock.calls.at(-1)?.[2] ?? [];

beforeEach(() => setModelMarkers.mockClear());

describe('ConfigYamlEditor', () => {
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
    type(['version: 4', 'classes:', '  node-up:', '    match: { key: job }', '    colour: red', ''].join('\n'));
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
    type(
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
    type(['version: 4', 'classes:', '  a:', '    extends: b', ''].join('\n'));
    expect(markers()).toEqual([expect.objectContaining({ startLineNumber: 4, severity: 4 })]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('marks an envelope error and stores nothing', () => {
    const { onChange } = mount();
    type(['version: 4', 'classes: []', ''].join('\n'));
    expect(markers()).toEqual([expect.objectContaining({ startLineNumber: 2, severity: 8 })]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks an old version on the version line and stores nothing', () => {
    const { onChange } = mount();
    type(['classes: {}', 'version: 3', ''].join('\n'));
    expect(markers()).toEqual([expect.objectContaining({ startLineNumber: 2 })]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks a YAML syntax error and a duplicate key, and stores nothing', () => {
    const { onChange } = mount();
    type(['version: 4', 'classes:', '  a: {', ''].join('\n'));
    expect(markers().length).toBeGreaterThan(0);
    type(['version: 4', 'classes: {}', 'classes: {}', ''].join('\n'));
    expect(markers()).toEqual([expect.objectContaining({ startLineNumber: 3, severity: 8 })]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a text that does not parse in local state', () => {
    const { rerender } = mount();
    const broken = ['version: 4', 'classes:', '  a: {', ''].join('\n');
    type(broken);
    rerender(stored);
    expect(editor().value).toBe(broken);
    expect(screen.getByRole('status').textContent).toMatch(/not saved/i);
  });

  it('does not write its own save back over the text', () => {
    const { onChange, rerender } = mount();
    const text = ['version: 4', 'classes:', '  # a comment', '  b: { match: { key: job } }', ''].join('\n');
    type(text);
    rerender(onChange.mock.lastCall?.[0]);
    expect(editor().value).toBe(text);
  });

  it('stores an empty class map that stays empty through the Grafana options merge', () => {
    const { onChange, rerender } = mount();
    const text = ['version: 4', 'freshness: 7m', 'classes: {}', 'overrides: {}', ''].join('\n');
    type(text);
    const options = grafanaUpdate({ config: stored }, 'config', onChange.mock.lastCall?.[0]);
    rerender(options.config);
    expect(editor().value).toBe(text);
    expect(saveOptions(options).config).toEqual({ version: 4, freshness: '7m', classes: {}, overrides: {} });
  });

  it('does not write the Grafana merge of its own save back over the text', () => {
    const { onChange, rerender } = mount();
    // the merge keeps the old key order, so freshness moves to the end
    const text = ['version: 4', 'freshness: 7m # new', 'classes:', '  b: { match: { key: job } }', ''].join('\n');
    type(text);
    rerender(grafanaUpdate({ config: stored }, 'config', onChange.mock.lastCall?.[0]).config);
    expect(editor().value).toBe(text);
  });

  it('stores a valid value at the keystroke, with no wait, no blur and no Ctrl+S', () => {
    // Grafana reads the options when the user starts to save, with no blur before: the value must be current at once.
    const { onChange } = mount();
    type(['version: 4', 'classes:', '  a: { match: { key: job }, status: up }', ''].join('\n'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.lastCall?.[0].classes).toEqual({ 'node-up': undefined, a: expect.anything() });
    type(['version: 4', 'classes:', '  a: { match: { key: job }, status: down }', ''].join('\n'));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(onChange.mock.lastCall?.[0])).toContain('down');
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

  describe('the starter config', () => {
    const diagram = {
      xml: '<mxGraphModel><root><mxCell id="1"/></root></mxGraphModel>',
      svg: '<svg><g data-cell-id="0"></g></svg>',
    };
    const mountEmpty = (value: unknown, withDiagram = true) => {
      const onChange = vi.fn();
      const props = {
        value,
        onChange,
        context: { data: [{ refId: 'up' }, { refId: 'tx' }], options: withDiagram ? { diagram } : {} },
        item: {},
      } as unknown as EditorProps;
      render(<ConfigYamlEditor {...props} />);
      return onChange;
    };

    it('shows the notice and does not write on its own', () => {
      const onChange = mountEmpty(undefined);
      expect(screen.getByText(/give cells `bind`/)).toBeTruthy();
      expect(editor().value).toBe('');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('inserts the starter and stores it', () => {
      const onChange = mountEmpty({});
      fireEvent.click(screen.getByRole('button', { name: 'Insert a starter config' }));
      expect(editor().value).toContain('version: 4');
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Insert a starter config')).toBeNull();
    });

    it('reads the targets of the panel, also a target with no frame', () => {
      publishEditedRefIds(['up', 'tx', 'rx']);
      try {
        mountEmpty({});
        fireEvent.click(screen.getByRole('button', { name: 'Insert a starter config' }));
        expect(editor().value).toContain('status: up');
      } finally {
        publishEditedRefIds(undefined);
      }
    });

    it('shows the first step in the notice', () => {
      mountEmpty(undefined);
      expect(screen.getByText(/The config is empty\. Select Insert a starter config\. Then give cells/)).toBeTruthy();
    });

    it('shows no notice for a stored config', () => {
      mountEmpty(stored);
      expect(screen.queryByText('Insert a starter config')).toBeNull();
    });

    it('shows no notice without a diagram', () => {
      mountEmpty(undefined, false);
      expect(screen.queryByText('Insert a starter config')).toBeNull();
    });
  });
});
