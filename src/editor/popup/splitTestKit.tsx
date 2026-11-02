import React from 'react';
import { vi } from 'vitest';
import {
  CoreApp,
  dateTime,
  FieldType,
  LoadingState,
  ThresholdsMode,
  toDataFrame,
  type PanelData,
} from '@grafana/data';
import type { Options } from '../../types';
import type { SplitEditorProps } from './SplitEditor';

/** Three cells: `a` and `b` bind the class `dev`, `c` binds `sw`. */
export const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">' +
  '<g data-cell-id="a" data-meta-bind="dev" data-meta-key="a"><rect width="40" height="30"/><text>A</text></g>' +
  '<g data-cell-id="b" data-meta-bind="dev" data-meta-key="b"><rect x="50" width="40" height="30"/><text>B</text></g>' +
  '<g data-cell-id="c" data-meta-bind="sw" data-meta-key="c"><rect x="100" width="40" height="30"/><text>C</text></g>' +
  '</svg>';

export const CONFIG = {
  version: 4,
  classes: {
    dev: { match: { key: 'job' }, status: 'up' },
    sw: { match: { key: 'job' }, status: 'up' },
  },
  overrides: {},
};

/** One sample now: the series of `a` and of `c`. `b` has no series. */
export function demoData(): PanelData {
  const now = Date.now();
  const range = { from: dateTime(now - 300_000), to: dateTime(now), raw: { from: 'now-5m', to: 'now' } };
  const frame = (job: string) =>
    toDataFrame({
      refId: 'up',
      fields: [
        { name: 'Time', type: FieldType.time, values: [now] },
        { name: 'Value', type: FieldType.number, values: [1], labels: { job } },
      ],
    });
  return {
    state: LoadingState.Done,
    series: [frame('a'), frame('c')],
    timeRange: range,
    request: {
      requestId: 'split',
      app: CoreApp.PanelEditor,
      startTime: now,
      range,
      timezone: 'utc',
      scopedVars: {},
      interval: '1m',
      intervalMs: 60_000,
      targets: [{ refId: 'up' }],
    },
  };
}

export function editorProps(over: Partial<SplitEditorProps> = {}): SplitEditorProps {
  const options = {
    config: CONFIG,
    diagram: { xml: '<mxfile/>', svg: SVG, hash: 'split-1', updatedAt: '' },
  } as unknown as Options;
  return {
    options,
    data: demoData(),
    timeZone: 'utc',
    fieldConfig: {
      defaults: {
        thresholds: { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'green' }] },
      },
      overrides: [],
    },
    replaceVariables: (s: string) => s,
    ...over,
  };
}

/** A position of Monaco: line and column from 1. */
export interface Position {
  lineNumber: number;
  column: number;
}

interface CursorEvent {
  position: Position;
  source: string;
}

interface Provider {
  provideCompletionItems: (model: unknown, position: Position) => { suggestions: unknown[] };
}

interface HoverProvider {
  provideHover: (model: unknown, position: Position) => unknown;
}

/**
 * A fake Monaco for the split editor tests. The Grafana `CodeEditor` loads Monaco; the fake is a text area with the
 * same props, a model that follows the text, cursor events, markers and Monaco providers.
 */
export function createFakeMonaco() {
  const fake = {
    text: '',
    /** The text area of the code box: the DOM node of the editor. */
    dom: null as HTMLTextAreaElement | null,
    cursor: new Set<(event: CursorEvent) => void>(),
    providers: [] as Array<{ language: string; provider: Provider; dispose: ReturnType<typeof vi.fn> }>,
    hovers: [] as Array<{ language: string; provider: HoverProvider; dispose: ReturnType<typeof vi.fn> }>,
    setModelMarkers: vi.fn<(model: unknown, owner: string, markers: Array<{ severity: number; message: string }>) => void>(),
    model: {
      id: 'split-model-1',
      getValue: () => fake.text,
      getOffsetAt({ lineNumber, column }: Position) {
        const lines = fake.text.split('\n');
        return lines.slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + column - 1;
      },
      getPositionAt(offset: number): Position {
        const before = fake.text.slice(0, offset).split('\n');
        return { lineNumber: before.length, column: before[before.length - 1].length + 1 };
      },
    },
    editor: {
      getModel: () => fake.model,
      getDomNode: () => fake.dom,
      onDidChangeCursorPosition(listener: (event: CursorEvent) => void) {
        fake.cursor.add(listener);
        return { dispose: () => fake.cursor.delete(listener) };
      },
      setPosition: vi.fn((position: Position, source = 'api') => fake.fire(position, source)),
      revealLineInCenter: vi.fn(),
      focus: vi.fn(),
    },
    monaco: {
      editor: { setModelMarkers: (...args: unknown[]) => fake.setModelMarkers(...(args as [never, never, never])) },
      MarkerSeverity: { Error: 8, Warning: 4 },
      languages: {
        CompletionItemKind: { Property: 9, Class: 5, Value: 13, Field: 3, Variable: 4, Constant: 14 },
        registerCompletionItemProvider: (language: string, provider: Provider) => {
          const dispose = vi.fn();
          fake.providers.push({ language, provider, dispose });
          return { dispose };
        },
        registerHoverProvider: (language: string, provider: HoverProvider) => {
          const dispose = vi.fn();
          fake.hovers.push({ language, provider, dispose });
          return { dispose };
        },
      },
    },
    /** Ctrl+S in the code box. */
    save: () => {},
    /** Sends a cursor event, as a click or a key in the code box does. */
    fire(position: Position, source = 'mouse') {
      for (const listener of [...fake.cursor]) {
        listener({ position, source });
      }
    },
    /** Moves the cursor of the user to an offset of the text. */
    moveTo(offset: number) {
      fake.fire(fake.model.getPositionAt(offset));
    },
    reset() {
      fake.text = '';
      fake.cursor.clear();
      fake.providers.length = 0;
      fake.hovers.length = 0;
      fake.setModelMarkers.mockClear();
      fake.editor.setPosition.mockClear();
      fake.editor.revealLineInCenter.mockClear();
      fake.editor.focus.mockClear();
    },
  };

  function CodeEditor(props: {
    value: string;
    language: string;
    onChange?: (text: string) => void;
    onBlur?: (text: string) => void;
    onSave?: (text: string) => void;
    onEditorDidMount?: (editor: unknown, monaco: unknown) => void;
  }) {
    fake.text = props.value;
    const { onEditorDidMount } = props;
    // Ctrl+S in Grafana calls `onSave` with the text of the editor.
    fake.save = () => props.onSave?.(fake.text);
    // Grafana calls the mount callback once, after Monaco loads.
    const mounted = React.useRef(false);
    React.useEffect(() => {
      if (!mounted.current) {
        mounted.current = true;
        onEditorDidMount?.(fake.editor, fake.monaco);
      }
    }, [onEditorDidMount]);
    return (
      <textarea
        ref={(el) => {
          fake.dom = el;
        }}
        data-testid="code-editor"
        data-language={props.language}
        value={props.value}
        onChange={(e) => {
          fake.text = e.target.value;
          props.onChange?.(e.target.value);
        }}
        onBlur={() => props.onBlur?.(fake.text)}
      />
    );
  }
  return { fake, CodeEditor };
}
