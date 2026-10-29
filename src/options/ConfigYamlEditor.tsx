import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { CodeEditor, type Monaco, type MonacoEditor } from '@grafana/ui';
import { isMap, isNode, isScalar, isSeq, type Document } from 'yaml';
import type { ReportEntry } from '../binding/report';
import { validateConfig } from '../model/validate';
import { parsePath, yamlPath } from '../model/yamlPath';
import type { Options } from '../types';
import { configUpdate } from './storedConfig';
import { readYaml, writeYaml } from './yamlConfig';

type Props = StandardEditorProps<unknown, Record<string, never>, Options>;

/** A marker with no Monaco types: `blocks` is true when the error stops the save. */
export interface Mark {
  blocks: boolean;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** The markers of a text, and the JSON to store when the YAML parses and the envelope is valid. */
interface Check {
  marks: Mark[];
  json?: unknown;
}

const OWNER = 'drawiomap-config';

export const toYaml = (value: unknown): string => (value === undefined || value === null ? '' : writeYaml(value));

/** The JSON of a value with its map keys sorted. A key with the value `undefined` is not in the JSON. */
const sortedJson = (value: unknown): string | undefined =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item
  );

/** The start offset of each line. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }
  return starts;
}

/**
 * A marker on the line of `from`, up to `to` or to the end of that line. An empty range marks the whole line. Lines
 * and columns start at 1.
 */
function mark(text: string, starts: number[], from: number, to: number, blocks: boolean, message: string): Mark {
  let line = starts.length;
  while (line > 1 && starts[line - 1] > from) {
    line--;
  }
  const lineStart = starts[line - 1];
  const lineEnd = line < starts.length ? starts[line] - 1 : text.length;
  const whole = to <= from;
  return {
    blocks,
    message,
    startLineNumber: line,
    startColumn: whole ? 1 : from - lineStart + 1,
    endLineNumber: line,
    endColumn: (whole ? lineEnd : Math.min(to, lineEnd)) - lineStart + 1,
  };
}

/**
 * The text range of a report path (`classes.lan.rows[2].query`, `overrides["sw.1"].match.key[1]`, see `yamlPath`).
 * When a part of the path is not in the document, the range of the last part that is in it is the result: a missing
 * field marks its parent key.
 */
export function rangeOf(doc: Document, path: string): [number, number] {
  let node: unknown = doc.contents;
  let range: [number, number] = isNode(node) && node.range ? [node.range[0], node.range[1]] : [0, 0];
  for (const part of parsePath(path)) {
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === String(part));
      if (!pair || !isNode(pair.key) || !pair.key.range) {
        break;
      }
      range = [pair.key.range[0], pair.key.range[1]];
      node = pair.value;
    } else if (isSeq(node) && typeof part === 'number') {
      const item: unknown = node.items[part];
      if (!isNode(item) || !item.range) {
        break;
      }
      range = [item.range[0], item.range[1]];
      node = item;
    } else {
      break;
    }
  }
  return range;
}

/** The YAML path of an entry of `validateConfig`. A chain error marks the `extends` of its class. */
function entryPath(entry: ReportEntry): string {
  switch (entry.kind) {
    case 'schema':
      return entry.path;
    case 'outdated-config':
      return 'version';
    case 'class-cycle':
    case 'class-unknown-parent':
    case 'class-invalid-parent':
      return yamlPath(['classes', entry.cls, 'extends']);
    default:
      return '';
  }
}

function entryMessage(entry: ReportEntry): string {
  switch (entry.kind) {
    case 'schema':
      return `${entry.path}: ${entry.message}`;
    case 'outdated-config':
      return `This is a version ${String(entry.version)} config. The panel reads only version 4.`;
    case 'class-cycle':
      return `Class "${entry.cls}" extends itself through its parents.`;
    case 'class-unknown-parent':
      return `Class "${entry.cls}" extends a class that does not exist.`;
    case 'class-invalid-parent':
      return `Class "${entry.cls}" extends a class that is not valid.`;
    default:
      return entry.kind;
  }
}

/** Parse and validate the text (spec 2.5). An item error is a marker that does not stop the save (spec 5.0). */
export function check(text: string): Check {
  const starts = lineStarts(text);
  const read = readYaml(text);
  if (!read.ok) {
    return {
      marks: read.errors.map((e) => {
        const from = starts[Math.min(Math.max(e.line, 1), starts.length) - 1];
        return mark(text, starts, from, from, true, e.message);
      }),
    };
  }
  const { parsed, report } = validateConfig(read.value);
  const blocks = parsed.config === null;
  const marks = report.map((entry) => {
    const [from, to] = rangeOf(read.doc, entryPath(entry));
    return mark(text, starts, from, to, blocks, entryMessage(entry));
  });
  return blocks ? { marks } : { marks, json: read.value };
}

/**
 * The `config` option as YAML (spec 5.0). The box shows the stored JSON as YAML. Each edit parses the YAML and
 * validates it. The errors show as Monaco markers. When the YAML parses and the envelope is valid, the editor stores
 * the JSON, with `undefined` for each removed key (see `configUpdate`). Else the text stays in the box and nothing is
 * stored.
 */
export default function ConfigYamlEditor({ value, onChange }: Props) {
  const [text, setText] = useState(() => toYaml(value));
  const [result, setResult] = useState(() => check(text));
  /** True after an edit that was not stored. */
  const [unsaved, setUnsaved] = useState(false);
  const [instance, setInstance] = useState<{ editor: MonacoEditor; monaco: Monaco }>();
  /** The text in the box: the editor sends a change event for the text that this component sets. */
  const textRef = useRef(text);
  /**
   * The stored value that the text gives. A new value from outside writes the text again. The Grafana options merge
   * can change the key order of the stored value, so the compare ignores the key order.
   */
  const savedRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (sortedJson(value) === sortedJson(savedRef.current)) {
      return;
    }
    savedRef.current = value;
    textRef.current = toYaml(value);
    setText(textRef.current);
    setResult(check(textRef.current));
    setUnsaved(false);
  }, [value]);

  useEffect(() => {
    const model = instance?.editor.getModel();
    if (!instance || !model) {
      return;
    }
    const severity = instance.monaco.MarkerSeverity;
    instance.monaco.editor.setModelMarkers(
      model,
      OWNER,
      result.marks.map(({ blocks, ...mark }) => ({ ...mark, severity: blocks ? severity.Error : severity.Warning }))
    );
  }, [instance, result]);

  const onEdit = useCallback((next: string) => {
    if (next === textRef.current) {
      return;
    }
    textRef.current = next;
    setText(next);
    const checked = check(next);
    setResult(checked);
    setUnsaved(!('json' in checked));
    if ('json' in checked) {
      const update = configUpdate(savedRef.current, checked.json);
      savedRef.current = checked.json;
      onChangeRef.current(update);
    }
  }, []);

  const onEditorDidMount = useCallback((editor: MonacoEditor, monaco: Monaco) => setInstance({ editor, monaco }), []);

  return (
    <div>
      <CodeEditor
        value={text}
        language="yaml"
        height={400}
        showLineNumbers
        showMiniMap={false}
        onChange={onEdit}
        onEditorDidMount={onEditorDidMount}
      />
      {unsaved && (
        <div role="status">Not saved. Correct the marked errors. The panel uses the last saved configuration.</div>
      )}
    </div>
  );
}
