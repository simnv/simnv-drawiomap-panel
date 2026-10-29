import type { Labels } from '@grafana/data';
import type { monacoTypes } from '@grafana/ui';

import { classSchema, overrideSchema } from '../../model/v4';
import { parsePath, type PathPart } from '../../model/yamlPath';
import type { CellMeta } from '../../types';

/** What the provider reads (spec 5.6): the loaded frames and the cell index. The provider sends no query. */
export interface CompletionSource {
  /** The path of spec 5.3 at an offset of the text (`pathAt` of the split editor). */
  pathAt(text: string, offset: number): string | null;
  /** The plain value of the last text that parsed as YAML: the class names, `extends` and the refIds of the uses. */
  draft: unknown;
  /** The refIds of the panel targets. */
  refIds: readonly string[];
  /** The cells of the diagram. `bind` names the class of a cell. */
  cells: ReadonlyArray<Pick<CellMeta, 'id' | 'attrs'>>;
  /** The series of a refId in the loaded frames. */
  series(refId: string): ReadonlyArray<{ labels: Labels }>;
}

export type CompletionKind = 'key' | 'class' | 'refId' | 'attr' | 'label' | 'value';

export interface CompletionItem {
  label: string;
  insertText: string;
  /** The columns (from 1, the end not included) on the line of the offset that the item replaces. */
  range: { startColumn: number; endColumn: number };
  kind: CompletionKind;
  /** The text that Monaco compares with the text from the range start to the cursor, when it is not the label. */
  filterText?: string;
}

// ---- the schema keys (spec 5.6: "from classSchema") ----

/** The options of a discriminated union on `kind`, with their keys. */
const keysByKind = (options: ReadonlyArray<{ shape: { kind: { value: string } } }>) =>
  new Map(options.map((option) => [option.shape.kind.value, Object.keys(option.shape)]));

const CLASS_KEYS = Object.keys(classSchema.shape);
const OVERRIDE_KEYS = Object.keys(overrideSchema.shape);
const TEXT_KEYS = Object.keys(classSchema.shape.text.unwrap().shape);
const ROW_KEYS = keysByKind(classSchema.shape.rows.unwrap().element.options);
const CHART_KEYS = keysByKind(classSchema.shape.chart.unwrap().options);

/** The keys of the kind of a row or a chart; all keys when the kind is not known yet. */
function kindKeys(byKind: Map<string, string[]>, kind: unknown): string[] {
  const keys = typeof kind === 'string' ? byKind.get(kind) : undefined;
  return keys ?? [...new Set([...byKind.values()].flat())];
}

// ---- the lexer: the YAML context at the offset ----

type Style = 'plain' | "'" | '"';
/** A flow collection that is open at the offset. `owner`: the key before it, -1 after a list marker, else null. */
interface Flow {
  open: '{' | '[';
  at: number;
  owner: string | -1 | null;
}
interface Lexed {
  comment: boolean;
  flow: Flow[];
  /** In a flow mapping: the key of the entry when the offset is after its `:`. */
  flowKey: string | null;
  /** In block context: the key of the pair on the line of the offset when the offset is after its `:`. */
  lineKey: string | null;
  /** The scalar that holds the offset. `end` is set when a quoted scalar closed before the offset. */
  token: { start: number; style: Style; end?: number } | null;
}

const isBreak = (c: string | undefined) => c === undefined || c === ' ' || c === '\t' || c === '\n' || c === '\r';
const FLOW_CHARS = ',[]{}';

function unquote(raw: string): string {
  if (raw.startsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

/** Reads the text up to the offset as YAML does: quotes, comments, flow collections, `:` and list markers. */
function lex(text: string, offset: number): Lexed {
  const flow: Flow[] = [];
  let token: Lexed['token'] = null;
  let quote: "'" | '"' | null = null;
  let nodeStart = true;
  let lineKey: string | null = null;
  let flowKey: string | null = null;
  let lastKey: string | null = null;
  let prev: ':' | '-' | null = null;
  for (let i = 0; i < offset; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') {
        i++;
      } else if (quote === "'" && c === "'" && text[i + 1] === "'") {
        i++;
      } else if (c === quote) {
        quote = null;
        token!.end = i + 1;
      }
      continue;
    }
    if (c === '\n') {
      token = null;
      nodeStart = true;
      if (!flow.length) {
        lineKey = null;
        prev = null;
      }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      continue;
    }
    if (c === '#' && (i === 0 || isBreak(text[i - 1]))) {
      const end = text.indexOf('\n', i);
      if (end === -1 || end >= offset) {
        return { comment: true, flow, flowKey, lineKey, token: null };
      }
      i = end - 1;
      continue;
    }
    const next = text[i + 1];
    if (flow.length && (c === ',' || c === '}' || c === ']')) {
      if (c !== ',') {
        flow.pop();
      }
      token = null;
      nodeStart = c === ',';
      flowKey = null;
      prev = null;
      continue;
    }
    if ((c === '{' || c === '[') && (flow.length || nodeStart)) {
      flow.push({ open: c, at: i, owner: prev === ':' ? lastKey : prev === '-' ? -1 : null });
      token = null;
      nodeStart = true;
      flowKey = null;
      prev = null;
      continue;
    }
    if (c === ':' && token && (isBreak(next) || (flow.length > 0 && FLOW_CHARS.includes(next)))) {
      lastKey = unquote(text.slice(token.start, token.end ?? i).trim());
      if (flow.length) {
        flowKey = lastKey;
      } else {
        lineKey = lastKey;
      }
      token = null;
      nodeStart = true;
      prev = ':';
      continue;
    }
    if (nodeStart && !flow.length && c === '-' && isBreak(next)) {
      prev = '-';
      continue;
    }
    if (nodeStart) {
      token = { start: i, style: c === '"' || c === "'" ? c : 'plain' };
      quote = c === '"' || c === "'" ? c : null;
      nodeStart = false;
      prev = null;
    }
  }
  return { comment: false, flow, flowKey, lineKey, token };
}

// ---- the scalar at the offset ----

/** A scalar on the line of the offset: its bounds in the text and its content, with the text offset of each char. */
interface Scalar {
  start: number;
  end: number;
  style: Style;
  content: string;
  /** `at[k]`: the text offset of content code unit k; `at[content.length]`: the offset after the content. */
  at: number[];
  /** The content index of the offset. */
  cursor: number;
  /** True when a quoted scalar has its closing quote. */
  closed: boolean;
}

const DOUBLE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', '/': '/' };
const HEX_LENGTH: Record<string, number> = { x: 2, u: 4, U: 8 };

/** The content of a scalar from `from` to `to`, the quotes of the style not included. */
function decode(text: string, from: number, to: number, style: Style): Pick<Scalar, 'content' | 'at' | 'closed'> {
  let content = '';
  let closed = false;
  const at: number[] = [];
  const add = (chars: string, offset: number) => {
    content += chars;
    for (let k = 0; k < chars.length; k++) {
      at.push(offset);
    }
  };
  let i = style === 'plain' ? from : from + 1;
  while (i < to) {
    const c = text[i];
    if (style === "'" && c === "'") {
      if (text[i + 1] !== "'" || i + 1 >= to) {
        closed = true;
        break;
      }
      add("'", i);
      i += 2;
    } else if (style === '"' && c === '"') {
      closed = true;
      break;
    } else if (style === '"' && c === '\\') {
      const kind = text[i + 1] ?? '';
      const hex = HEX_LENGTH[kind] ?? 0;
      const digits = text.slice(i + 2, i + 2 + hex);
      const code = hex && digits.length === hex && /^[0-9a-fA-F]+$/.test(digits) ? Number.parseInt(digits, 16) : NaN;
      if (code <= 0x10ffff) {
        add(String.fromCodePoint(code), i);
        i += 2 + hex;
      } else {
        // a malformed escape stands for its letter; the digits that follow are plain chars
        add(DOUBLE_ESCAPES[kind] ?? kind, i);
        i += 2;
      }
    } else {
      add(c, i);
      i++;
    }
  }
  at.push(Math.min(i, to));
  return { content, at, closed };
}

/** The end of the text that a plain scalar can hold, from `from` on: not past the line, a comment, `: ` or flow chars. */
function plainEnd(text: string, from: number, inFlow: boolean): number {
  let j = from;
  for (; j < text.length; j++) {
    const c = text[j];
    const next = text[j + 1];
    if (c === '\n' || c === '\r' || (c === '#' && isBreak(text[j - 1]))) {
      break;
    }
    if ((c === ':' && (isBreak(next) || (inFlow && FLOW_CHARS.includes(next)))) || (inFlow && FLOW_CHARS.includes(c))) {
      break;
    }
  }
  while (j > from && (text[j - 1] === ' ' || text[j - 1] === '\t')) {
    j--;
  }
  return j;
}

/** The end of a quoted scalar that is open at `from`: after its closing quote, else the end of the line. */
function quotedEnd(text: string, from: number, style: "'" | '"'): number {
  for (let j = from; j < text.length && text[j] !== '\n'; j++) {
    if (style === '"' && text[j] === '\\') {
      j++;
    } else if (text[j] === style) {
      if (style === "'" && text[j + 1] === "'") {
        j++;
      } else {
        return j + 1;
      }
    }
  }
  const eol = text.indexOf('\n', from);
  return eol === -1 ? text.length : eol;
}

function scalarAt(text: string, offset: number, lexed: Lexed): Scalar {
  const inFlow = lexed.flow.length > 0;
  const token = lexed.token;
  let start = offset;
  let style: Style = 'plain';
  let end: number;
  if (token) {
    start = token.start;
    style = token.style;
  }
  if (style !== 'plain') {
    end = token?.end ?? quotedEnd(text, offset, style);
  } else if (token || !`'"`.includes(text[offset] ?? '')) {
    end = Math.max(plainEnd(text, offset, inFlow), offset);
  } else {
    end = offset;
  }
  const { content, at, closed } = decode(text, start, end, style);
  const cursor = at.findIndex((o) => o >= offset);
  return { start, end, style, content, at, closed, cursor: cursor === -1 ? content.length : cursor };
}

// ---- the place of the offset: a key of a map, or a value, with its path ----

/** One level of the path from the text: a map key, or a list item (`fresh`: on the line of the offset). */
type Level = { key: string } | { index: 'path' | 'fresh' };

/** The indent and the list markers at the start of a line. */
const LEAD = /^([ \t]*)((?:-(?:[ \t]+|$))*)/;
/** The key of a pair at the start of a text: a quoted key, or plain text before `: `. */
const PAIR = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"{[,\]}][^#]*?)[ \t]*:(?:[ \t]|$)/;

/**
 * The levels of the map or the list that a node at `column` of line `line` is in, from the indent of the lines above
 * (block context). A list can stand at the indent of its key (the compact form). `ownItem`: the level of a list
 * marker on the line itself; 'fresh' for a key that can start a new item.
 */
function levelsAbove(lines: string[], line: number, column: number, ownItem: 'path' | 'fresh' = 'path'): Level[] {
  const levels: Level[] = [];
  const own = LEAD.exec(lines[line].slice(0, column))!;
  for (let n = own[2].split('-').length - 1; n > 0; n--) {
    levels.push({ index: ownItem });
  }
  let limit = own[2] ? own[1].length : column;
  let seq = own[2] !== '';
  for (let l = line - 1; l >= 0 && (limit > 0 || seq); l--) {
    const text = lines[l];
    if (/^\s*(?:#|$)/.test(text)) {
      continue;
    }
    const lead = LEAD.exec(text)!;
    const indent = lead[1].length;
    const dashed = lead[2] !== '';
    if (indent > limit || (indent === limit && (dashed || !seq))) {
      continue;
    }
    const keyColumn = lead[0].length;
    const key = PAIR.exec(text.slice(keyColumn));
    if (dashed) {
      if (keyColumn < limit && key) {
        levels.push({ key: unquote(key[1]) });
      }
      let column = indent;
      for (const dash of lead[2].match(/-[ \t]*/g) ?? []) {
        if (column < limit) {
          levels.push({ index: 'path' });
        }
        column += dash.length;
      }
    } else {
      levels.push({ key: key ? unquote(key[1]) : '' });
    }
    seq = dashed;
    limit = indent;
  }
  return levels.reverse();
}

/**
 * The path of the levels. The keys come from the text. A list index comes from the path of spec 5.3 while that path
 * agrees with the keys above it; else it is -1 (not known, for example a new list item).
 */
function fill(parts: PathPart[], levels: Level[]): PathPart[] {
  let agree = true;
  return levels.map((level, i) => {
    const part = parts[i];
    if ('key' in level) {
      agree &&= part === level.key;
      return level.key;
    }
    const index = agree && level.index === 'path' && typeof part === 'number' ? part : -1;
    agree &&= index !== -1;
    return index;
  });
}

interface Place {
  side: 'key' | 'value';
  /** For a key: the path of its map. For a value: the path of the value. */
  path: PathPart[];
}

function lineOf(text: string, offset: number): { line: number; start: number } {
  const before = text.slice(0, offset);
  return { line: before.split('\n').length - 1, start: before.lastIndexOf('\n') + 1 };
}

function flowPlace(parts: PathPart[], text: string, lines: string[], lexed: Lexed): Place {
  const [outer, ...inner] = lexed.flow;
  const { line, start } = lineOf(text, outer.at);
  const levels =
    typeof outer.owner === 'string'
      ? [...levelsAbove(lines, line, LEAD.exec(lines[line])![0].length), { key: outer.owner }]
      : levelsAbove(lines, line, outer.at - start);
  inner.forEach((flow, i) => {
    if (typeof flow.owner === 'string') {
      levels.push({ key: flow.owner });
    } else if (lexed.flow[i].open === '[') {
      levels.push({ index: 'fresh' });
    }
  });
  const top = lexed.flow[lexed.flow.length - 1];
  if (top.open === '[') {
    return { side: 'value', path: fill(parts, [...levels, { index: 'fresh' }]) };
  }
  if (lexed.flowKey !== null) {
    return { side: 'value', path: fill(parts, [...levels, { key: lexed.flowKey }]) };
  }
  return { side: 'key', path: fill(parts, levels) };
}

function placeAt(path: string, text: string, offset: number, lexed: Lexed, scalar: Scalar): Place {
  const parts = parsePath(path);
  const lines = text.split('\n');
  if (lexed.flow.length) {
    return flowPlace(parts, text, lines, lexed);
  }
  const { line, start } = lineOf(text, offset);
  const lineText = lines[line];
  if (lexed.lineKey !== null) {
    const levels = levelsAbove(lines, line, LEAD.exec(lineText)![0].length);
    return { side: 'value', path: fill(parts, [...levels, { key: lexed.lineKey }]) };
  }
  const column = Math.max(scalar.start, start) - start;
  const own = fill(parts, levelsAbove(lines, line, column, 'fresh'));
  // a list item on this line: a row of `rows` is a map (keys), the other lists hold values (matchers)
  if (/-/.test(lineText.slice(0, column)) && !isRowsItem(own)) {
    return { side: 'value', path: own };
  }
  return { side: 'key', path: own };
}

// ---- the owner of a path: a class or an override, and the row, text or chart below it ----

interface Owner {
  root: 'classes' | 'overrides';
  name: string;
  /** [] for the class or override, ['rows', i], ['text'] or ['chart'] for the part with its own query. */
  sub: PathPart[];
}

function ownerOf(parts: PathPart[]): { owner: Owner; rest: PathPart[] } | null {
  const [root, name, ...rest] = parts;
  if ((root !== 'classes' && root !== 'overrides') || typeof name !== 'string') {
    return null;
  }
  const owner: Owner = { root, name, sub: [] };
  if (rest[0] === 'rows' && typeof rest[1] === 'number' && rest.length > 2) {
    return { owner: { ...owner, sub: rest.slice(0, 2) }, rest: rest.slice(2) };
  }
  if ((rest[0] === 'text' || rest[0] === 'chart') && rest.length > 1) {
    return { owner: { ...owner, sub: rest.slice(0, 1) }, rest: rest.slice(1) };
  }
  return { owner, rest };
}

function isRowsItem(parts: PathPart[]): boolean {
  const found = ownerOf(parts);
  return !!found && found.owner.sub.length === 0 && found.rest.length === 2 && found.rest[0] === 'rows';
}

// ---- the draft ----

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function valueAt(value: unknown, parts: PathPart[]): unknown {
  let current = value;
  for (const part of parts) {
    if (typeof part === 'number') {
      current = Array.isArray(current) ? current[part] : undefined;
    } else {
      const map = record(current);
      current = Object.hasOwn(map, part) ? map[part] : undefined;
    }
  }
  return current;
}

const classesOf = (draft: unknown) => record(valueAt(draft, ['classes']));

/** The class names of the draft, in the order of the text. */
export function classNamesOf(draft: unknown): string[] {
  return Object.keys(classesOf(draft));
}

/** The chain of a class in the draft, from the root to the class (spec 2.3). A cycle or an unknown parent stops it. */
function chainOf(classes: Record<string, unknown>, name: string): string[] {
  const chain: string[] = [];
  for (let n: unknown = name; typeof n === 'string' && Object.hasOwn(classes, n) && !chain.includes(n);) {
    chain.unshift(n);
    n = record(classes[n]).extends;
  }
  return chain;
}

const strings = (values: unknown[]) => values.filter((value): value is string => typeof value === 'string');

/** The refIds of a row or a chart: `query`, or `up` and `down` for `updown`. */
function queryRefs(item: unknown): string[] {
  const map = record(item);
  return strings(map.kind === 'updown' ? [map.up, map.down] : [map.query]);
}

/**
 * The refIds of the uses that read the class match: the fields after the layers of the chain (a later layer replaces
 * a field, rows append), and only the text, rows and chart with no match of their own.
 */
function classRefs(layers: unknown[]): string[] {
  const fields: Record<string, unknown> = {};
  const rows: unknown[] = [];
  for (const layer of layers) {
    for (const [key, value] of Object.entries(record(layer))) {
      if (key === 'rows') {
        rows.push(...(Array.isArray(value) ? value : []));
      } else if (value !== undefined && value !== null) {
        fields[key] = value;
      }
    }
  }
  const own = (item: unknown) => !Object.hasOwn(record(item), 'match');
  const capacity = record(fields.capacity);
  return strings([
    fields.status,
    fields.up,
    fields.down,
    fields.capacity,
    capacity.a2b,
    capacity.b2a,
    ...(fields.text && own(fields.text) ? [record(fields.text).query] : []),
    ...[fields.chart, ...rows].filter((item) => item && own(item)).flatMap(queryRefs),
  ]);
}

/** The names of the classes that extend the class, at any depth. */
function childClasses(classes: Record<string, unknown>, name: string): string[] {
  return Object.keys(classes).filter((other) => other !== name && chainOf(classes, other).includes(name));
}

function cellsOf(owner: Owner, source: CompletionSource): CompletionSource['cells'] {
  if (owner.root === 'overrides') {
    return source.cells.filter((cell) => cell.id === owner.name);
  }
  const names = new Set([owner.name, ...childClasses(classesOf(source.draft), owner.name)]);
  return source.cells.filter((cell) => names.has(cell.attrs.bind));
}

/** The attribute names of the cells of the class (and of the classes that extend it), or of the override cell. */
function attrNames(owner: Owner, source: CompletionSource): string[] {
  return [...new Set(cellsOf(owner, source).flatMap((cell) => Object.keys(cell.attrs)))].sort();
}

/** The refIds of the uses that a match at the owner selects for. */
function refIdsOfUse(owner: Owner, source: CompletionSource): string[] {
  const draft = source.draft;
  if (owner.sub.length) {
    return queryRefs(valueAt(draft, [owner.root, owner.name, ...owner.sub]));
  }
  const classes = classesOf(draft);
  const layersOf = (name: string) => chainOf(classes, name).map((link) => classes[link]);
  if (owner.root === 'overrides') {
    const bind = source.cells.find((cell) => cell.id === owner.name)?.attrs.bind;
    return classRefs([...(bind ? layersOf(bind) : []), valueAt(draft, ['overrides', owner.name])]);
  }
  // a child class reads this match when no class between them sets its own
  const readers = [owner.name, ...childClasses(classes, owner.name)].filter((name) => {
    const chain = chainOf(classes, name);
    return chain.slice(chain.indexOf(owner.name) + 1).every((link) => !Object.hasOwn(record(classes[link]), 'match'));
  });
  return [...new Set(readers.flatMap((name) => classRefs(layersOf(name))))];
}

function labelNames(refIds: string[], source: CompletionSource): string[] {
  const names = refIds.flatMap((refId) => source.series(refId).flatMap((series) => Object.keys(series.labels)));
  return [...new Set(names)].sort();
}

function labelValues(refIds: string[], label: string, source: CompletionSource): string[] {
  const values = refIds.flatMap((refId) =>
    source.series(refId).flatMap((series) => (Object.hasOwn(series.labels, label) ? [series.labels[label]] : []))
  );
  // a matcher string has no escape for `${` (a placeholder) or for a carriage return (spec 2.4)
  return [...new Set(values)].filter((value) => !value.includes('${') && !value.includes('\r')).sort();
}

// ---- quoting ----

/** YAML 1.2 core values that a plain scalar would not read as a string. */
const NOT_A_STRING =
  /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN)|0x[0-9a-fA-F]+|0o[0-7]+)$/;

/** True when YAML reads the text as the same string with no quotes, in block or in flow context. */
function plainOk(value: string, inFlow: boolean): boolean {
  return (
    value !== '' &&
    value.trim() === value &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !/:(?:\s|$)|\s#|[\n\r]/.test(value) &&
    !(inFlow && /[,[\]{}]/.test(value)) &&
    !NOT_A_STRING.test(value)
  );
}

const singleQuoted = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** The text of a value inside a scalar of the style. */
function encode(value: string, style: Style): string {
  if (style === "'") {
    return value.replace(/'/g, "''");
  }
  if (style === '"') {
    return value.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  }
  return value;
}

const PROMQL_ESCAPES: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t' };
/** A label value in a PromQL double-quoted string, with the escapes of the matcher (spec 2.4). */
const promqlString = (value: string) => value.replace(/[\\"\n\t]/g, (c) => PROMQL_ESCAPES[c]);

// ---- the items ----

interface Context {
  text: string;
  offset: number;
  lineStart: number;
  lineEnd: number;
  inFlow: boolean;
  scalar: Scalar;
  source: CompletionSource;
}

/** The columns on the line of the offset of a text range. */
function columns(ctx: Context, from: number, to: number): CompletionItem['range'] {
  const clamp = (o: number) => Math.min(Math.max(o, ctx.lineStart), ctx.lineEnd) - ctx.lineStart + 1;
  return { startColumn: clamp(from), endColumn: clamp(to) };
}

/** Items that each replace the whole scalar: class names and refIds. */
function scalarItems(values: readonly string[], kind: CompletionKind, ctx: Context): CompletionItem[] {
  const { scalar } = ctx;
  const range = columns(ctx, scalar.at[0], scalar.at[scalar.content.length]);
  return values.map((value) => {
    if (scalar.style !== 'plain') {
      // an open quoted scalar gets its closing quote, so the draft stays valid YAML
      const close = scalar.closed ? '' : scalar.style;
      return { label: value, insertText: encode(value, scalar.style) + close, range, kind };
    }
    return plainOk(value, ctx.inFlow)
      ? { label: value, insertText: value, range, kind }
      : { label: value, insertText: singleQuoted(value), range, kind, filterText: value };
  });
}

/** Items for a word of the content from `from` to `to`: names that need no quotes. */
function wordItems(names: readonly string[], kind: CompletionKind, ctx: Context, from: number, to: number) {
  const range = columns(ctx, ctx.scalar.at[from], ctx.scalar.at[to]);
  return names.map((name): CompletionItem => ({ label: name, insertText: name, range, kind }));
}

/** Inside `${`: the attribute names of the cells, then `from.` and `to.` (spec 5.6). */
function templateItems(owner: Owner, ctx: Context): CompletionItem[] | null {
  const { content, cursor } = ctx.scalar;
  const before = content.slice(0, cursor);
  const open = before.lastIndexOf('${');
  if (open === -1 || before.includes('}', open)) {
    return null;
  }
  let end = cursor;
  while (end < content.length && /[\w.-]/.test(content[end])) {
    end++;
  }
  return [
    ...wordItems(attrNames(owner, ctx.source), 'attr', ctx, open + 2, end),
    ...wordItems(['from.', 'to.'], 'value', ctx, open + 2, end),
  ];
}

/** The index of the `"` that closes a PromQL string that starts at `from`, else -1. */
function closingQuote(content: string, from: number): number {
  for (let i = from; i < content.length; i++) {
    if (content[i] === '\\') {
      i++;
    } else if (content[i] === '"') {
      return i;
    }
  }
  return -1;
}

/**
 * The right side of a matcher (spec 2.4): on the label, the label names of the series of the refIds of the use;
 * after `="`, the values of that label in a PromQL string. When a value makes the plain scalar invalid YAML (a `,` in
 * a flow mapping), the item writes the whole matcher in single quotes.
 */
function matcherItems(owner: Owner, ctx: Context): CompletionItem[] {
  const { scalar, source } = ctx;
  const { content, cursor } = scalar;
  const refIds = refIdsOfUse(owner, source);
  const lead = /^\s*/.exec(content)![0].length;
  const label = /^[A-Za-z_]\w*/.exec(content.slice(lead))?.[0] ?? '';
  const labelEnd = lead + label.length;
  if (cursor >= lead && cursor <= labelEnd) {
    return wordItems(labelNames(refIds, source), 'label', ctx, lead, labelEnd);
  }
  const op = /^\s*(=~|!~|!=|=)\s*"/.exec(content.slice(labelEnd));
  const valueStart = labelEnd + (op?.[0].length ?? 0);
  if (!op || (op[1] !== '=' && op[1] !== '!=') || cursor < valueStart) {
    return [];
  }
  const close = closingQuote(content, valueStart);
  if (close !== -1 && cursor > close) {
    return [];
  }
  const valueEnd = close === -1 ? content.length : close;
  const range = columns(ctx, scalar.at[valueStart], scalar.at[valueEnd]);
  return labelValues(refIds, label, source).map((value): CompletionItem => {
    const escaped = promqlString(value) + (close === -1 ? '"' : '');
    const matcher = content.slice(0, valueStart) + escaped + content.slice(valueEnd);
    if (scalar.style === 'plain' && !plainOk(matcher, ctx.inFlow)) {
      return {
        label: value,
        insertText: singleQuoted(matcher),
        range: columns(ctx, scalar.start, scalar.end),
        kind: 'value',
        filterText: content.slice(0, valueStart) + escaped,
      };
    }
    const insertText = encode(escaped, scalar.style);
    return { label: value, insertText, range, kind: 'value', filterText: insertText };
  });
}

const REF_FIELDS = ['status', 'up', 'down', 'capacity'];
const QUERY_FIELDS = ['query', 'up', 'down'];

/** True when the value at the path is a refId: `status`, `query`, `up`, `down`, `capacity`, `text.query`. */
function isRefField(owner: Owner, rest: PathPart[]): boolean {
  const [field, sub] = rest;
  if (owner.sub.length === 0) {
    return rest.length === 1
      ? REF_FIELDS.includes(field as string)
      : rest.length === 2 && field === 'capacity' && (sub === 'a2b' || sub === 'b2a');
  }
  return rest.length === 1 && (owner.sub[0] === 'text' ? field === 'query' : QUERY_FIELDS.includes(field as string));
}

function valueItems(path: PathPart[], ctx: Context): CompletionItem[] {
  let end = path.length;
  while (end > 0 && typeof path[end - 1] === 'number') {
    end--;
  }
  const found = ownerOf(path.slice(0, end));
  if (!found) {
    return [];
  }
  const { owner, rest } = found;
  const template = templateItems(owner, ctx);
  if (template) {
    return template;
  }
  if (rest.length === 2 && rest[0] === 'match') {
    return matcherItems(owner, ctx);
  }
  if (owner.root === 'classes' && owner.sub.length === 0 && rest.length === 1 && rest[0] === 'extends') {
    return scalarItems(
      classNamesOf(ctx.source.draft).filter((name) => name !== owner.name),
      'class',
      ctx
    );
  }
  return isRefField(owner, rest) ? scalarItems(ctx.source.refIds, 'refId', ctx) : [];
}

function keyItems(path: PathPart[], ctx: Context): CompletionItem[] {
  const found = ownerOf(path);
  if (!found) {
    return [];
  }
  const { owner, rest } = found;
  const { scalar, text } = ctx;
  const [field, index] = rest;
  let names: string[] = [];
  let kind: CompletionKind = 'key';
  if (rest.length === 1 && field === 'match') {
    names = attrNames(owner, ctx.source);
    kind = 'attr';
  } else if (owner.sub.length === 0 && rest.length === 0) {
    names = owner.root === 'classes' ? CLASS_KEYS : OVERRIDE_KEYS;
  } else if (owner.sub.length === 0 && rest.length === 2 && field === 'rows' && typeof index === 'number') {
    names = kindKeys(ROW_KEYS, record(valueAt(ctx.source.draft, path)).kind);
  } else if (owner.sub.length === 0 && rest.length === 1 && field === 'text') {
    names = TEXT_KEYS;
  } else if (owner.sub.length === 0 && rest.length === 1 && field === 'chart') {
    names = kindKeys(CHART_KEYS, record(valueAt(ctx.source.draft, path)).kind);
  }
  const colon = /^[ \t]*:/.test(text.slice(scalar.end));
  const range = columns(ctx, scalar.start, scalar.end);
  return names.map((name) => ({ label: name, insertText: colon ? name : `${name}: `, range, kind }));
}

/**
 * The completion items at an offset of the YAML text (spec 5.6). `path` is the path of spec 5.3 at the offset; the
 * text gives the place (a key or a value, block or flow) and the word that an item replaces.
 */
export function itemsAt(path: string, text: string, offset: number, source: CompletionSource): CompletionItem[] {
  const lexed = lex(text, offset);
  if (lexed.comment) {
    return [];
  }
  const scalar = scalarAt(text, offset, lexed);
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const eol = text.indexOf('\n', offset);
  const ctx: Context = {
    text,
    offset,
    lineStart,
    lineEnd: eol === -1 ? text.length : eol,
    inFlow: lexed.flow.length > 0,
    scalar,
    source,
  };
  const place = placeAt(path, text, offset, lexed, scalar);
  if (place.side === 'key') {
    return keyItems(place.path, ctx);
  }
  const items = valueItems(place.path, ctx);
  // `key:|` with no space: the value needs one
  return text[scalar.start - 1] === ':' && scalar.start === offset
    ? items.map((item) => ({ ...item, insertText: ` ${item.insertText}` }))
    : items;
}

/**
 * Registers the completion provider of one code box. A provider is global to the language (spec 5.2): it answers only
 * for the model `modelId`, so two popups in two panels do not mix. Dispose it on unmount.
 */
export function registerCompletion(
  monaco: typeof monacoTypes,
  modelId: string,
  source: () => CompletionSource
): monacoTypes.IDisposable {
  const kinds = monaco.languages.CompletionItemKind;
  const kindOf: Record<CompletionKind, monacoTypes.languages.CompletionItemKind> = {
    key: kinds.Property,
    class: kinds.Class,
    refId: kinds.Value,
    attr: kinds.Field,
    label: kinds.Variable,
    value: kinds.Constant,
  };
  return monaco.languages.registerCompletionItemProvider('yaml', {
    triggerCharacters: [' ', '"', '{'],
    provideCompletionItems(model, position) {
      if (model.id !== modelId) {
        return { suggestions: [] };
      }
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const current = source();
      const items = itemsAt(current.pathAt(text, offset) ?? '', text, offset, current);
      return {
        suggestions: items.map((item) => ({
          label: item.label,
          kind: kindOf[item.kind],
          insertText: item.insertText,
          filterText: item.filterText,
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: item.range.startColumn,
            endColumn: item.range.endColumn,
          },
        })),
      };
    },
  });
}
