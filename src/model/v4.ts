import { z } from 'zod';

import type { ReportEntry } from '../binding/report';

export type MatchV4 = Record<string, string | string[]>;

// ---- the schema (spec 2.2) ----

/** zod drops a record key `__proto__` with no issue. This check makes it an error, so no name goes silently. */
const notProto = (key: string) => key !== '__proto__';
const PROTO_MESSAGE = 'The name __proto__ is not allowed.';
/** A class name or a cell attribute name. Portograph allows the same set for meta keys, incl. "-". */
const ident = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, 'Use a letter or _ first, then letters, digits, _ or -.')
  .refine(notProto, PROTO_MESSAGE);
/** A Grafana refId of a panel target. The match report flags a refId that no target has. */
const refId = z.string().min(1);
/** A text with ${attr}, ${from.attr}, ${to.attr}, ${labels.x}, ${value}; in a URL also $var and ${var:format} (3.3). */
const template = z.string();
/**
 * One matcher (section 2.4). The record key is a cell attribute; the value is the series side:
 *   `name`                        bare label: series label `name` === cell attribute <key>
 *   `instance=~"${key}:.*"`       label, operator = != =~ !~, a double-quoted template
 * The envelope check is syntax only. Section 2.4 gives the full contract.
 */
const matcherText = z
  .string()
  .regex(
    /^\s*[A-Za-z_]\w*\s*(?:(?:=|!=|=~|!~)\s*"(?:[^"\\]|\\.)*"\s*)?$/,
    'Use a label name, or a label, an operator (=, !=, =~, !~) and a double-quoted string.'
  );
const matcher = z.union([matcherText, z.array(matcherText).min(1)]); // A6: a list of matchers
const match: z.ZodType<MatchV4> = z
  .record(ident, matcher)
  .refine((m) => Object.keys(m).length > 0, 'match must not be empty');

const show = {
  label: z.string().optional(),
  unit: z.string().optional(),
  decimals: z.number().int().min(0).max(10).optional(),
};
const reduce = z.enum(['sum', 'max', 'mean']);
/** "5m" (a Grafana duration) or "3x" (times the cadence of the target, section 3.5). */
const freshness = z
  .string()
  .regex(/^(?:\d+(?:ms|s|m|h)|\d+(?:\.\d+)?x)$/, 'Use a duration such as 5m, or a cadence factor such as 3x.');

/** The low end of a Y range: a number, or "auto" for the data minimum, as in v3. */
const lowerBound = z.union([z.number().finite(), z.literal('auto')]);
const history = z
  .object({
    kind: z.literal('history'),
    query: refId,
    match: match.optional(),
    ...show,
    min: lowerBound.optional(),
    max: z.number().finite().optional(),
  })
  .strict();
const value = z
  .object({ kind: z.literal('value'), query: refId, match: match.optional(), reduce: reduce.optional(), ...show })
  .strict();
const updown = z
  .object({
    kind: z.literal('updown'),
    up: refId,
    down: refId,
    match: match.optional(),
    reduce: reduce.optional(),
    ...show,
  })
  .strict();
const row = z.discriminatedUnion('kind', [
  history,
  value,
  updown,
  z.object({ kind: z.literal('metadata'), label: z.string(), text: template }).strict(),
  z.object({ kind: z.literal('drilldown'), label: z.string().optional(), url: template }).strict(),
]);
/** A9: a chart region fills the box of the cell. `value` draws a bar gauge. Same rules as the rows. */
const chart = z.discriminatedUnion('kind', [history, value, updown]);
/** A4: one refId for both directions, or one refId for each geometric direction. */
const capacity = z.union([refId, z.object({ a2b: refId, b2a: refId }).strict()]);

const fields = {
  match: match.optional(), // D4, A7: required only for a class that has cells
  status: refId.optional(), // D7, A1
  missing: z.enum(['nodata', 'down']).optional(), // D7. Default: nodata (grey). Zero series only (3.6).
  text: z
    .object({ query: refId, match: match.optional(), reduce: reduce.optional(), ...show })
    .strict()
    .optional(), // D10
  rows: z.array(row).optional(), // D9
  chart: chart.optional(), // A9
  freshness: freshness.optional(), // D11, A10
  url: template.optional(), // D6
  urlTitle: z.string().optional(),
  up: refId.optional(), // D14, links only
  down: refId.optional(),
  capacity: capacity.optional(), // D15, A4
  linkLabel: z.enum(['none', 'value', 'percent']).optional(), // A13 (Q8). Default: none.
};
const klass = z.object({ extends: ident.optional(), ...fields }).strict();
const override = z.object(fields).strict(); // D6

/** The envelope. Each class and each override is parsed on its own (section 2.5). */
export const envelopeSchema = z
  .object({
    version: z.literal(4),
    freshness: freshness.default('3x'), // D11, the panel default
    classes: z.record(ident, z.unknown()),
    overrides: z.record(z.string().min(1).refine(notProto, PROTO_MESSAGE), z.unknown()).default({}), // key: the draw.io cell id
  })
  .strict();
export const classSchema = klass;
export const overrideSchema = override;
export type ClassV4 = z.infer<typeof klass>;
export type OverrideV4 = z.infer<typeof override>;
export type RowV4 = z.infer<typeof row>;
export type ChartV4 = z.infer<typeof chart>;
export type ConfigV4 = Omit<z.infer<typeof envelopeSchema>, 'classes' | 'overrides'> & {
  classes: Record<string, ClassV4>;
  overrides: Record<string, OverrideV4>;
};

/** The low end of a Y range: a number, or "auto" for the data minimum. */
export type LowerBound = z.infer<typeof lowerBound>;
/** The half range of an up/down chart: a number, "auto" (the data) or "capacity". The same shape as in v3. */
export type RangeMax = number | 'auto' | 'capacity';
/** The freshness of one value in milliseconds, after "5m" or "3x" resolves (3.5). The same shape as in v3. */
export interface FreshnessPolicy {
  expectedIntervalMs: number;
  staleAfterMs: number;
}
/** The value label beside each link half (A13). */
export type LinkLabelMode = NonNullable<ClassV4['linkLabel']>;

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

/** A YAML path from its parts: `classes.lan.rows[2].query`. */
const yamlPath = (parts: ReadonlyArray<string | number>): string =>
  parts.reduce<string>(
    (path, part) => (typeof part === 'number' ? `${path}[${part}]` : path ? `${path}.${part}` : part),
    ''
  );

/** One `schema` entry per zod issue; an unknown key gives the path of that key. */
function schemaEntries(error: z.ZodError, prefix: ReadonlyArray<string | number>): ReportEntry[] {
  return error.issues.flatMap((issue): ReportEntry[] => {
    const path = [...prefix, ...issue.path];
    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      return issue.keys.map((key) => ({
        kind: 'schema',
        path: yamlPath([...path, key]),
        message: `Unknown key "${key}".`,
      }));
    }
    return [{ kind: 'schema', path: yamlPath(path), message: issue.message }];
  });
}

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
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    result.report.push(...schemaEntries(envelope.error, []));
    return result;
  }
  // no prototype: a cell with bind="constructor" or the id "toString" finds nothing
  const config: ConfigV4 = { ...envelope.data, classes: Object.create(null), overrides: Object.create(null) };
  const invalid = (target: Map<string, ReportEntry[]>, name: string, entries: ReportEntry[]) => {
    target.set(name, entries);
    result.report.push(...entries);
  };
  for (const [name, item] of Object.entries(envelope.data.classes)) {
    const parsed = classSchema.safeParse(item);
    if (parsed.success) {
      config.classes[name] = parsed.data;
    } else {
      invalid(result.invalidClasses, name, schemaEntries(parsed.error, ['classes', name]));
    }
  }
  for (const [cellId, item] of Object.entries(envelope.data.overrides)) {
    const parsed = overrideSchema.safeParse(item);
    if (parsed.success) {
      config.overrides[cellId] = parsed.data;
    } else {
      invalid(result.invalidOverrides, cellId, schemaEntries(parsed.error, ['overrides', cellId]));
    }
  }
  result.config = config;
  checkChains(result);
  return result;
}
