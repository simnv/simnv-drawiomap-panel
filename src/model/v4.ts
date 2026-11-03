import type { ReportEntry } from '../binding/report';
import {
  array,
  discriminated,
  finite,
  int,
  literal,
  max,
  min,
  notEmpty,
  number,
  object,
  oneOf,
  optional,
  record,
  refine,
  regex,
  run,
  string,
  union,
  unknown,
  withDefault,
  type Check,
  type Infer,
  type Issue,
  type Out,
} from './check';
import { yamlPath } from './yamlPath';

export type MatchV4 = Record<string, string | string[]>;

// ---- the schema (spec 2.2) ----

/** A record check drops a key `__proto__` with no issue. This rule makes it an error, so no name goes silently. */
const notProto = (key: string) => (key === '__proto__' ? 'The name __proto__ is not allowed.' : undefined);
/** A class name or a cell attribute name. Portograph allows the same set for meta keys, incl. "-". */
const ident = string(
  regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, 'Use a letter or _ first, then letters, digits, _ or -.'),
  notProto
);
/** A Grafana refId of a panel target. The match report flags a refId that no target has. */
const refId = string(notEmpty);
/** A text with ${attr}, ${from.attr}, ${to.attr}, ${labels.x}, ${value}; in a URL also $var and ${var:format} (3.3). */
const template = string();
/**
 * One matcher (section 2.4). The record key is a cell attribute; the value is the series side:
 *   `name`                        bare label: series label `name` === cell attribute <key>
 *   `instance=~"${key}:.*"`       label, operator = != =~ !~, a double-quoted template
 * The envelope check is syntax only. Section 2.4 gives the full contract.
 */
const matcherText = string(
  regex(
    /^\s*[A-Za-z_]\w*\s*(?:(?:=|!=|=~|!~)\s*"(?:[^"\\]|\\.)*"\s*)?$/,
    'Use a label name, or a label, an operator (=, !=, =~, !~) and a double-quoted string.'
  )
);
const matcher = union<string | string[]>(matcherText, array(matcherText, true)); // A6: a list of matchers
const match: Check<MatchV4> = refine(
  record(ident, matcher),
  (m) => Object.keys(m).length > 0,
  'match must not be empty'
);

const show = {
  label: optional(string()),
  unit: optional(string()),
  decimals: optional(number(int, min(0), max(10))),
};
const reduce = oneOf(['sum', 'max', 'mean']);
/** "5m" (a Grafana duration) or "3x" (times the cadence of the target, section 3.5). */
const freshness = string(
  regex(/^(?:\d+(?:ms|s|m|h)|\d+(?:\.\d+)?x)$/, 'Use a duration such as 5m, or a cadence factor such as 3x.')
);

/** The low end of a Y range: a number, or "auto" for the data minimum, as in v3. */
const lowerBound = union<number | 'auto'>(number(finite), literal('auto'));
const historyShape = {
  kind: literal('history'),
  query: refId,
  match: optional(match),
  ...show,
  min: optional(lowerBound),
  max: optional(number(finite)),
};
const valueShape = { kind: literal('value'), query: refId, match: optional(match), reduce: optional(reduce), ...show };
const updownShape = {
  kind: literal('updown'),
  up: refId,
  down: refId,
  match: optional(match),
  reduce: optional(reduce),
  ...show,
};
const metadataShape = { kind: literal('metadata'), label: string(), text: template };
const drilldownShape = { kind: literal('drilldown'), label: optional(string()), url: template };
const history = object(historyShape);
const value = object(valueShape);
const updown = object(updownShape);
export type ChartV4 = Out<typeof history> | Out<typeof value> | Out<typeof updown>;
export type RowV4 = ChartV4 | Infer<typeof metadataShape> | Infer<typeof drilldownShape>;
const row = discriminated<RowV4>({
  history,
  value,
  updown,
  metadata: object(metadataShape),
  drilldown: object(drilldownShape),
});
/** A9: a chart region fills the box of the cell. `value` draws a bar gauge. Same rules as the rows. */
const chart = discriminated<ChartV4>({ history, value, updown });
/** A4: one refId for both directions, or one refId for each geometric direction. */
const capacity = union<string | { a2b: string; b2a: string }>(refId, object({ a2b: refId, b2a: refId }));
/** The head style of each link half. */
export const ARROW_STYLES = ['point', 'triangle', 'none'] as const;

const textShape = { query: refId, match: optional(match), reduce: optional(reduce), ...show };
const fields = {
  match: optional(match), // D4, A7: required only for a class that has cells
  status: optional(refId), // D7, A1
  missing: optional(oneOf(['nodata', 'down'])), // D7. Default: nodata (grey). Zero series only (3.6).
  text: optional(object(textShape)), // D10
  rows: optional(array(row)), // D9
  chart: optional(chart), // A9
  freshness: optional(freshness), // D11, A10
  url: optional(template), // D6
  urlTitle: optional(string()),
  up: optional(refId), // D14, links only
  down: optional(refId),
  capacity: optional(capacity), // D15, A4
  linkLabel: optional(oneOf(['none', 'value', 'percent'])), // A13 (Q8). Default: none.
  arrow: optional(oneOf(ARROW_STYLES)), // Links only. Rendering default: point.
};
const classShape = { extends: optional(ident), ...fields };
const klass = object(classShape);
const override = object(fields); // D6

const keysOf = (shapes: Record<string, object>) =>
  new Map(Object.entries(shapes).map(([kind, shape]) => [kind, Object.keys(shape)]));
/** The keys of each config shape, for the completion of the split editor (spec 5.6). */
export const schemaKeys = {
  class: Object.keys(classShape),
  override: Object.keys(fields),
  text: Object.keys(textShape),
  /** The keys of each row kind. */
  row: keysOf({
    history: historyShape,
    value: valueShape,
    updown: updownShape,
    metadata: metadataShape,
    drilldown: drilldownShape,
  }),
  /** The keys of each chart kind. */
  chart: keysOf({ history: historyShape, value: valueShape, updown: updownShape }),
};

/** The envelope. Each class and each override is parsed on its own (section 2.5). */
const envelope = object({
  version: literal(4),
  freshness: withDefault(freshness, '3x'), // D11, the panel default
  classes: record(ident, unknown),
  overrides: withDefault(record(string(notEmpty, notProto), unknown), {}), // key: the draw.io cell id
});
export type ClassV4 = Out<typeof klass>;
export type OverrideV4 = Out<typeof override>;
export type ConfigV4 = Omit<Out<typeof envelope>, 'classes' | 'overrides'> & {
  classes: Record<string, ClassV4>;
  overrides: Record<string, OverrideV4>;
};

/** The low end of a Y range: a number, or "auto" for the data minimum. */
export type LowerBound = Out<typeof lowerBound>;
/** The half range of an up/down chart: a number, "auto" (the data) or "capacity". The same shape as in v3. */
export type RangeMax = number | 'auto' | 'capacity';
/** The value label beside each link half (A13). */
export type LinkLabelMode = NonNullable<ClassV4['linkLabel']>;
/** The head style of each link half. */
export type ArrowStyle = (typeof ARROW_STYLES)[number];

// ---- the parse (spec 2.5) ----

export interface ParsedConfig {
  /**
   * The envelope and the items that passed their schema. `classes` holds a class with a chain error too: read
   * `invalidClasses` for the valid state. Both records have no prototype. null when the envelope did not parse or
   * the version is old.
   */
  config: ConfigV4 | null;
  /** Each invalid class with its entries: its `schema` entries, or the chain entry of step 3. */
  invalidClasses: Map<string, ReportEntry[]>;
  /** Each invalid override, by cell id, with its `schema` entries. */
  invalidOverrides: Map<string, ReportEntry[]>;
  /** All entries of the parse, in the order of the steps. */
  report: ReportEntry[];
}

type ChainKind = 'class-cycle' | 'class-unknown-parent' | 'class-invalid-parent';
const CHAIN_KINDS: readonly string[] = ['class-cycle', 'class-unknown-parent', 'class-invalid-parent'];
const isChainEntry = (entry: ReportEntry): entry is Extract<ReportEntry, { kind: ChainKind }> =>
  CHAIN_KINDS.includes(entry.kind);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A copy of the value with no map key that has the value `undefined`, as in the dashboard JSON. A live options update
 * of Grafana removes a key with an explicit `undefined` (see `configUpdate`).
 */
function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutUndefined);
  }
  if (!isRecord(value)) {
    return value;
  }
  // fromEntries makes own keys: a `__proto__` key stays a key
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, withoutUndefined(item)])
  );
}

/** One `schema` entry per issue. */
const schemaEntries = (issues: Issue[]): ReportEntry[] =>
  issues.map(({ path, message }) => ({ kind: 'schema', path: yamlPath(path), message }));

/**
 * The chain of one class from the root to the class (spec 2.3), or the error of the first problem up the chain
 * (2.5 step 3): a cycle, a parent that no class has, or an invalid parent. Below a parent with a chain error, the
 * class gets the same error.
 */
export function classChain(
  name: string,
  classes: Readonly<Record<string, ClassV4>>,
  invalidClasses: ReadonlyMap<string, ReportEntry[]>
): { chain: string[] } | { error: ChainKind } {
  const chain = [name];
  for (let parent = classes[name].extends; parent !== undefined; parent = classes[parent].extends) {
    if (chain.includes(parent)) {
      return { error: 'class-cycle' };
    }
    const entries = invalidClasses.get(parent);
    if (entries) {
      return { error: entries.find(isChainEntry)?.kind ?? 'class-invalid-parent' };
    }
    if (!Object.hasOwn(classes, parent)) {
      return { error: 'class-unknown-parent' };
    }
    chain.unshift(parent);
  }
  return { chain };
}

/**
 * Spec 2.5 step 3: add a chain entry for each valid class whose chain has an error. parseConfig runs it. Run it again
 * after a later check makes more classes invalid (the matchers of 2.4); a class that is invalid already stays as it is.
 */
export function checkChains(parsed: ParsedConfig): void {
  const classes = parsed.config?.classes ?? {};
  for (const name of Object.keys(classes)) {
    if (parsed.invalidClasses.has(name)) {
      continue;
    }
    const chain = classChain(name, classes, parsed.invalidClasses);
    if ('error' in chain) {
      const entry: ReportEntry = { kind: chain.error, cls: name };
      parsed.invalidClasses.set(name, [entry]);
      parsed.report.push(entry);
    }
  }
}

/**
 * Parse a v4 config (spec 2.5): the envelope first, then each class and each override on its own, then the class
 * chains. An item that fails is invalid; the other items apply. The input does not change.
 */
export function parseConfig(input: unknown): ParsedConfig {
  const raw = withoutUndefined(input);
  const result: ParsedConfig = { config: null, invalidClasses: new Map(), invalidOverrides: new Map(), report: [] };
  if (isRecord(raw) && typeof raw.version === 'number' && raw.version < 4) {
    result.report.push({ kind: 'outdated-config', version: raw.version }); // D22
    return result;
  }
  const parsedEnvelope = run(envelope, raw, []);
  if ('issues' in parsedEnvelope) {
    result.report.push(...schemaEntries(parsedEnvelope.issues));
    return result;
  }
  // no prototype: a cell with bind="constructor" or the id "toString" finds nothing
  const config: ConfigV4 = { ...parsedEnvelope.value, classes: Object.create(null), overrides: Object.create(null) };
  const invalid = (target: Map<string, ReportEntry[]>, name: string, entries: ReportEntry[]) => {
    target.set(name, entries);
    result.report.push(...entries);
  };
  for (const [name, item] of Object.entries(parsedEnvelope.value.classes)) {
    const parsed = run(klass, item, ['classes', name]);
    if ('value' in parsed) {
      config.classes[name] = parsed.value;
    } else {
      invalid(result.invalidClasses, name, schemaEntries(parsed.issues));
    }
  }
  for (const [cellId, item] of Object.entries(parsedEnvelope.value.overrides)) {
    const parsed = run(override, item, ['overrides', cellId]);
    if ('value' in parsed) {
      config.overrides[cellId] = parsed.value;
    } else {
      invalid(result.invalidOverrides, cellId, schemaEntries(parsed.issues));
    }
  }
  result.config = config;
  checkChains(result);
  return result;
}
