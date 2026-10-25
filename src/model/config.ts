import type { DataQuery, DataSourceRef } from '@grafana/schema';
import type { CellSelector } from '../types';
import { z } from 'zod';
import { matcherError } from '../binding/select';

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
}

// ---- shared ----

const nonempty = z.string().refine((value) => value.trim().length > 0, 'Must not be blank.');
/** Exact string or "/re/flags". The regex must compile and must not use the stateful g or y flag. */
export const matcher = z.string().superRefine((m, ctx) => {
  const err = matcherError(m);
  if (err) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
  }
});
export const cellSelector = z
  .object({
    ids: z.array(z.string()).optional(),
    kind: z.enum(['node', 'port', 'link', 'link-label', 'other', 'any']).optional(),
    attrs: z.record(matcher).optional(),
    label: matcher.optional(),
    between: z.tuple([z.string(), z.string()]).optional(),
  })
  .strict();
export const reducer = z.enum(['last', 'mean', 'max', 'min']);
const binding = z.object({ queryId: nonempty, match: z.record(matcher), field: nonempty.optional(), reducer }).strict();
export type QueryBinding = z.infer<typeof binding>;

const condition = z.object({ state: z.enum(['normal', 'warning', 'critical', 'down']), reason: nonempty }).strict();
export type StatusCondition = z.infer<typeof condition>;
export type StatusState = StatusCondition['state'];
const freshness = z
  .object({ expectedIntervalMs: z.number().positive().finite(), staleAfterMs: z.number().positive().finite() })
  .strict();
export type FreshnessPolicy = z.infer<typeof freshness>;
/** A policy that can never be met: the stale window is shorter than one sample interval. The item stays; it is unavailable. */
export const invalidFreshness = (policy: FreshnessPolicy | undefined): boolean =>
  !!policy && policy.staleAfterMs < policy.expectedIntervalMs;
/** A range with nothing in it. The row or widget stays; it is unavailable. */
export const invalidBounds = (min: unknown, max: unknown): boolean =>
  typeof min === 'number' && typeof max === 'number' && min >= max;

const statusBase = {
  enabled: z.boolean().optional(),
  binding,
  default: condition,
  freshness: freshness.optional(),
};
const status = z.discriminatedUnion('kind', [
  z
    .object({
      ...statusBase,
      kind: z.literal('mapping'),
      mappings: z.array(condition.extend({ value: z.number().finite() })).min(1),
    })
    .strict(),
  z
    .object({
      ...statusBase,
      kind: z.literal('predicates'),
      predicates: z
        .array(condition.extend({ op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']), value: z.number().finite() }))
        .min(1),
    })
    .strict(),
]);
export type StatusRule = z.infer<typeof status>;

const scopePath = z
  .string()
  .regex(/^(cell|from|to)\.[^\s.{}]+$/, 'Use a semantic scope path, for example cell.device or from.node.');
/** Y range of a sparkline: a number, or "auto" for the data min. The default is 0 for a non-negative series. */
const lowerBound = z.union([z.number().finite(), z.literal('auto')]);
export type LowerBound = z.infer<typeof lowerBound>;
/** Half range of a combined up/down row: a number, "auto" (the data, the default) or "capacity". */
const rangeMax = z.union([z.number().finite(), z.literal('auto'), z.literal('capacity')]);
export type RangeMax = z.infer<typeof rangeMax>;

// ---- capacity ----

/** A capacity template needs a ${...} reference to the cell scope. It must resolve to a positive number at run time. */
const capacityTemplate = z.string().regex(/\$\{[^\s{}]+\}/, 'Use a number or a template like ${cell.capacity_bps}.');
/** A capacity value: a positive number or a template. The unit of a number: see README "Capacity". */
const capacityValue = z.union([z.number().positive().finite(), capacityTemplate]);
type CapacityValue = z.infer<typeof capacityValue>;
/** The two sources of one level. The same pair at the link, a direction, a combined row and a series entry. */
const capacitySources = { capacity: capacityValue.optional(), capacityBinding: binding.optional() };
export interface CapacitySources {
  /** a number (bit/s at a link place, the unit of the values at a row place) or a template in bit/s */
  capacity?: CapacityValue;
  /** a series: its latest value, through the unit of its field */
  capacityBinding?: QueryBinding;
}

// ---- link ----

/** `binding` is optional in a saved patch (an override may set only a capacity); a merged direction without one is inert. */
const linkDirection = z.object({ binding: binding.optional(), ...capacitySources }).strict();
export type LinkDirection = z.infer<typeof linkDirection>;
/** The value label beside each link half: the percent of its capacity, the reading, or nothing (the default). */
const linkLabel = z.object({ mode: z.enum(['percent', 'value', 'none']) }).strict();
export type LinkLabelMode = z.infer<typeof linkLabel>['mode'];
/** The two halves of a link: a direction each, the capacity shared by both (see the precedence in README) and the label. */
const link = z
  .object({
    enabled: z.boolean().optional(),
    a2b: linkDirection.optional(),
    b2a: linkDirection.optional(),
    ...capacitySources,
    label: linkLabel.optional(),
  })
  .strict();

// ---- shape ----

/** The state colour and the label text of a node. */
const shape = z
  .object({
    enabled: z.boolean().optional(),
    binding: binding.optional(),
    /** what the colour changes; without it the colour changes nothing (the value still feeds the card and `text`) */
    target: z.enum(['icon', 'shape', 'stroke', 'none']).optional(),
    /** write the value into the node label (the `label` template of the display) */
    text: z.boolean().optional(),
  })
  .strict();
export type ShapeDisplay = z.infer<typeof shape>;

// ---- hover rows ----

/** Allowed chart height of a history row, in px. Tall cards scroll. */
export const ROW_HEIGHT_MIN = 16;
export const ROW_HEIGHT_MAX = 400;
const rowBase = {
  label: nonempty,
  unit: z.string().optional(),
  url: z.string().optional(),
  freshness: freshness.optional(),
};
const bounded = { min: lowerBound.optional(), max: z.number().finite().optional() };
const rowHeight = z.number().finite().min(ROW_HEIGHT_MIN).max(ROW_HEIGHT_MAX).optional();
/** One direction of a combined row: up leaves the subject (tx), down enters it (rx). */
const directionSeries = z
  .object({
    binding,
    direction: z.enum(['up', 'down']),
    /** text before the value; default "↑" or "↓" */
    label: z.string().optional(),
    ...capacitySources,
  })
  .strict();
const hoverRow = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), ...rowBase, ...bounded, binding }).strict(),
  z.object({ kind: z.literal('history'), ...rowBase, ...bounded, binding, height: rowHeight }).strict(),
  /** A combined up/down history row: up above the zero line, down mirrored below it. */
  z
    .object({
      kind: z.literal('combined'),
      ...rowBase,
      // a row with one direction only, as a single history row
      min: lowerBound.optional(),
      series: z.array(directionSeries).min(1).max(2),
      // the default of both directions
      ...capacitySources,
      max: rangeMax.optional(),
      height: rowHeight,
    })
    .strict(),
  z.object({ kind: z.literal('metadata'), label: nonempty, path: scopePath }).strict(),
  z.object({ kind: z.literal('drilldown'), label: nonempty, url: nonempty }).strict(),
]);
export type HoverRow = z.infer<typeof hoverRow>;
export type CombinedRow = Extract<HoverRow, { kind: 'combined' }>;
const hover = z
  .object({
    enabled: z.boolean().optional(),
    /** card title (template); the default is the title of the cell, see adapter/cellTitle */
    title: z.string().optional(),
    // An override may hold only `enabled`: the rows then come from the patterns (`mergeDisplay` fills in an empty list).
    rows: z.array(hoverRow).optional(),
  })
  .strict()
  // zod 3 takes no refined object in a discriminated union: the one check of a combined row lives here
  .superRefine((spec, ctx) => {
    spec.rows?.forEach((row, i) => {
      if (row.kind === 'combined' && new Set(row.series.map((s) => s.direction)).size < row.series.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', i, 'series'],
          message: 'Each direction (up, down) can occur only once.',
        });
      }
    });
  });
/** The hover card of a cell. The merged form always has a rows list. */
export type HoverSpec = Omit<z.infer<typeof hover>, 'rows'> & { rows: HoverRow[] };

// ---- display, items, envelope ----

const display = z
  .object({
    enabled: z.boolean().optional(),
    link: link.optional(),
    shape: shape.optional(),
    status: status.optional(),
    hover: hover.optional(),
    /** the default reducer of the capacity series; the bindings have their own */
    reducer: reducer.optional(),
    /** template of the text that `shape.text` writes into the node label; default "${value}" */
    label: z.string().optional(),
    /** the footer link of the card (a template); also the default click target of the hover rows */
    url: z.string().optional(),
    /** title of the url in the card footer (a template) */
    urlTitle: z.string().optional(),
  })
  .strict();
export type DisplayConfig = z.infer<typeof display>;
const datasource = z.object({ uid: nonempty, type: nonempty.optional() }).strict();
/** The datasource reference of a native query. */
export type QueryDatasourceRef = z.infer<typeof datasource>;
const query = z
  .object({
    id: nonempty,
    name: nonempty,
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('panel'), refId: nonempty }).strict(),
      z
        .object({
          kind: z.literal('datasource'),
          datasource: datasource.optional(),
          target: z.custom<DataQuery>(
            (value) =>
              !!value &&
              typeof value === 'object' &&
              !Array.isArray(value) &&
              typeof value.refId === 'string' &&
              value.refId.trim().length > 0,
            'Native target must be an object with a nonempty refId.'
          ),
          parameters: z.record(scopePath),
        })
        .strict(),
    ]),
  })
  .strict();
export type NamedQuery = z.infer<typeof query>;
const pattern = z.object({ id: nonempty, name: nonempty, select: cellSelector, display }).strict();
export type Pattern = z.infer<typeof pattern>;
const override = z.object({ cellId: nonempty, display }).strict();
export type ElementOverride = z.infer<typeof override>;
const widget = z
  .object({
    id: nonempty,
    anchorCellId: nonempty,
    kind: z.enum(['sparkline', 'bar']),
    freshness: freshness.optional(),
    binding,
    label: nonempty,
    unit: z.string().optional(),
    min: lowerBound.optional(),
    max: z.number().finite().optional(),
    url: z.string().optional(),
  })
  .strict();
export type Widget = z.infer<typeof widget>;
/** The envelope: parsed first, the items as unknown. `validateConfig` parses each item on its own. */
const envelope = z
  .object({
    version: z.literal(3),
    defaultDatasource: datasource.optional(),
    queries: z.array(z.unknown()),
    patterns: z.array(z.unknown()),
    overrides: z.array(z.unknown()),
    widgets: z.array(z.unknown()),
  })
  .strict();
export interface DiagramConfig extends Omit<z.infer<typeof envelope>, Section | 'defaultDatasource'> {
  defaultDatasource?: DataSourceRef;
  queries: NamedQuery[];
  patterns: Pattern[];
  overrides: ElementOverride[];
  widgets: Widget[];
}
/** The version of the config shape that this panel reads and writes. */
export const EMPTY_CONFIG: DiagramConfig = { version: 3, queries: [], patterns: [], overrides: [], widgets: [] };

// ---- validation ----

export type Section = 'queries' | 'patterns' | 'overrides' | 'widgets';
const SECTIONS: Section[] = ['queries', 'patterns', 'overrides', 'widgets'];
const ITEM_SCHEMAS = { queries: query, patterns: pattern, overrides: override, widgets: widget } as const;

/** What a skipped item still tells: a title for messages, the `select` of a pattern, the `cellId` of an override. */
export interface SkippedItem {
  section: Section;
  /** the index in the saved list */
  index: number;
  /** "Pattern Core routers", "Override of cell-7", "patterns[3]" when the item has no readable name */
  title: string;
  /** the raw `id`, when it is a string: the popup selects the item by it */
  id?: string;
  /** a skipped pattern: its selector, when that parses on its own; else the match set is unknown */
  select?: CellSelector;
  /** a skipped override: its cell, when `cellId` is a string */
  cellId?: string;
}

/** The one wording for a binding whose query is not in the config: it does not exist, or it is a skipped item. */
export function unknownQueryMessage(queryId: string, skippedAt: number | undefined): string {
  return skippedAt === undefined
    ? `Query ${queryId} does not exist. Choose a named query or restore its definition.`
    : `Query ${queryId} has errors (see queries[${skippedAt}]).`;
}

/**
 * The lists of a config without the entries that are not objects (null, a number, a string, an array). Such an entry
 * carries no data. The editor drops them when it loads a draft or reads an import, and reports them once; after that
 * every item of a list is an object, also one that does not parse.
 */
export function withoutEmptyEntries<T extends Record<Section, unknown[]>>(config: T): { config: T; removed: number } {
  let removed = 0;
  const lists = Object.fromEntries(
    SECTIONS.map((section) => {
      const kept = config[section].filter(isRecord);
      removed += config[section].length - kept.length;
      return [section, kept];
    })
  );
  return removed ? { config: { ...config, ...lists }, removed } : { config, removed };
}
/** The one note on the entries that withoutEmptyEntries dropped. */
export const emptyEntriesNote = (removed: number): Diagnostic => ({
  code: 'empty-entries',
  path: '(root)',
  message: `${removed} empty ${removed === 1 ? 'entry' : 'entries'} removed: null or non-object items of the lists carry no data. Apply saves the config without them.`,
});

export interface ValidatedConfig {
  /** undefined only when the envelope failed or the version is not 3 */
  config?: DiagramConfig;
  /** saved index of each item of the dense lists: indices.patterns[j] is the saved index of config.patterns[j] */
  indices: Record<Section, number[]>;
  skippedItems: SkippedItem[];
  /** the saved index of each skipped query whose id is readable: a reference to it names the item to fix */
  skippedQueries: Map<string, number>;
  /** queries that parse but cannot run (missing datasource, bad parameter name, non-persistable target), by id */
  unusableQueries: Map<string, string>;
  diagnostics: Diagnostic[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * A copy of a parsed item in the key order of the saved JSON. zod orders keys by the schema; a form that writes the
 * item back must give the saved bytes. Plain objects and arrays are copied, other values (a native target that cannot
 * persist, kept for its diagnostic) stay by reference.
 */
function orderedCopy<T>(value: T, ancestors = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || ancestors.has(value)) {
    // a cycle (a native target that cannot persist) stays by reference, so the copy ends
    return value;
  }
  const copyOf = (child: unknown) => orderedCopy(child, ancestors);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(copyOf) as T;
    }
    if (Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyOf(child)])) as T;
    }
    return value;
  } finally {
    ancestors.delete(value);
  }
}

function formatPath(path: Array<string | number>): string {
  return (
    path.map((part, i) => (typeof part === 'number' ? `[${part}]` : `${i ? '.' : ''}${part}`)).join('') || '(root)'
  );
}

/** JSON.stringify alone would silently drop functions, undefined, nonfinite numbers and object prototypes. */
function isPersistable(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    return false;
  }
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    return false;
  }
  ancestors.add(value);
  const valid =
    Object.getOwnPropertySymbols(value).length === 0 &&
    (Array.isArray(value)
      ? Array.from(value).every((item) => isPersistable(item, ancestors))
      : Object.values(value).every((item) => isPersistable(item, ancestors)));
  ancestors.delete(value);
  return valid;
}

/** Enumerate references in a stable order. Validation includes disabled definitions. */
export function displayBindings(display: DisplayConfig): Array<{ binding: QueryBinding; path: string }> {
  const found: Array<{ binding: QueryBinding; path: string }> = [];
  const add = (binding: QueryBinding | undefined, path: string) => {
    if (binding) {
      found.push({ binding, path });
    }
  };
  for (const direction of ['a2b', 'b2a'] as const) {
    add(display.link?.[direction]?.binding, `link.${direction}.binding`);
    add(display.link?.[direction]?.capacityBinding, `link.${direction}.capacityBinding`);
  }
  add(display.link?.capacityBinding, 'link.capacityBinding');
  add(display.shape?.binding, 'shape.binding');
  add(display.status?.binding, 'status.binding');
  display.hover?.rows?.forEach((row, i) => {
    [...rowBindings(row), ...rowCapacityBindings(row)].forEach(({ binding, path }) =>
      add(binding, `hover.rows[${i}].${path}`)
    );
  });
  return found;
}

/** The value bindings of one hover row, with their paths in the row: one, two for a combined row, none for the others. */
export function rowBindings(row: HoverRow): Array<{ binding: QueryBinding; path: string }> {
  if (row.kind === 'combined') {
    return row.series.map((s, j) => ({ binding: s.binding, path: `series[${j}].binding` }));
  }
  return 'binding' in row ? [{ binding: row.binding, path: 'binding' }] : [];
}

/** The capacity bindings of a combined row: the row's own and one for each series entry. */
export function rowCapacityBindings(row: HoverRow): Array<{ binding: QueryBinding; path: string }> {
  if (row.kind !== 'combined') {
    return [];
  }
  const found: Array<{ binding: QueryBinding; path: string }> = [];
  if (row.capacityBinding) {
    found.push({ binding: row.capacityBinding, path: 'capacityBinding' });
  }
  row.series.forEach((s, j) => {
    if (s.capacityBinding) {
      found.push({ binding: s.capacityBinding, path: `series[${j}].capacityBinding` });
    }
  });
  return found;
}

/** The warning of a panel that still has `rules` of version 1. The panel does not read them. */
export function legacyRulesWarning(count: number): string {
  return `The panel ignores ${count} rule${count === 1 ? '' : 's'} of version 1. Create the bindings again in Edit bindings.`;
}

/** The note of a config of version 2, the shape before 1.0.0. The panel binds nothing from it. */
const OUTDATED_CONFIG_MESSAGE =
  'This configuration has version 2, the shape before 1.0.0 (2026-10-25). Create the bindings again in Edit bindings, or regenerate the config with version 3.';

const emptySections = <T>(make: () => T): Record<Section, T> =>
  Object.fromEntries(SECTIONS.map((section) => [section, make()])) as Record<Section, T>;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);

/** "Pattern Core routers", "Override of cell-7", "Widget w1", "Query traffic"; the saved path when the item has no name. */
function itemTitle(section: Section, raw: unknown, index: number): string {
  const item = isRecord(raw) ? raw : {};
  const fallback = `${section}[${index}]`;
  switch (section) {
    case 'patterns':
      return `Pattern ${text(item.name) ?? text(item.id) ?? fallback}`;
    case 'overrides':
      return `Override of ${text(item.cellId) ?? fallback}`;
    case 'widgets':
      return `Widget ${text(item.id) ?? text(item.label) ?? fallback}`;
    default:
      return `Query ${text(item.id) ?? text(item.name) ?? fallback}`;
  }
}

/**
 * The envelope first, then each item on its own. A type-level failure (zod) skips the item. A semantic problem keeps
 * the item, unchanged, and makes its consumer unavailable with the reason. A parsed item is deep-equal to its saved
 * JSON: nothing is stripped, nothing is added.
 */
export function validateConfig(input: unknown): ValidatedConfig {
  const result: ValidatedConfig = {
    indices: emptySections(() => []),
    skippedItems: [],
    skippedQueries: new Map(),
    unusableQueries: new Map(),
    diagnostics: [],
  };
  const root = (code: string, message: string) => {
    result.diagnostics.push({ code, path: '(root)', message });
    return result;
  };
  if (!isRecord(input)) {
    return root('invalid-config', 'Expected a config object with version 3.');
  }
  if (!('version' in input) && ('rules' in input || 'diagram' in input)) {
    return root(
      'legacy-config',
      'This is a panel options document, not a version 3 config. The rules of version 1 are not supported: create the bindings again in the editor, or import a version 3 config.'
    );
  }
  if (input.version === 2) {
    return root('outdated-config', OUTDATED_CONFIG_MESSAGE);
  }
  const parsed = envelope.safeParse(input);
  if (!parsed.success) {
    result.diagnostics.push(
      ...parsed.error.issues.map((issue) => ({
        code: 'invalid-config',
        path: formatPath(issue.path),
        message: issue.message,
      }))
    );
    return result;
  }
  const config: DiagramConfig = { ...parsed.data, queries: [], patterns: [], overrides: [], widgets: [] };
  if (isRecord(input) && input.defaultDatasource !== undefined) {
    // the saved object, key order included: the panel and its query context read the same reference
    config.defaultDatasource = orderedCopy(input.defaultDatasource) as DiagramConfig['defaultDatasource'];
  }
  const { diagnostics } = result;
  for (const section of SECTIONS) {
    parsed.data[section].forEach((raw, index) => {
      const item = ITEM_SCHEMAS[section].safeParse(raw);
      if (item.success) {
        (config[section] as unknown[]).push(orderedCopy(raw));
        result.indices[section].push(index);
        return;
      }
      const prefix = `${section}[${index}]`;
      diagnostics.push(
        ...item.error.issues.map((issue) => ({
          code: 'invalid-config',
          path: `${prefix}${issue.path.length ? `.${formatPath(issue.path)}` : ''}`,
          message: issue.message,
        }))
      );
      const title = itemTitle(section, raw, index);
      diagnostics.push({
        code: 'skipped-item',
        path: prefix,
        message: `${title} is not applied until its errors are fixed.`,
      });
      const skipped: SkippedItem = { section, index, title };
      if (isRecord(raw) && text(raw.id)) {
        skipped.id = raw.id as string;
      }
      if (section === 'patterns' && isRecord(raw)) {
        const select = cellSelector.safeParse(raw.select);
        if (select.success) {
          skipped.select = select.data;
        }
      } else if (section === 'overrides' && isRecord(raw) && text(raw.cellId)) {
        skipped.cellId = raw.cellId as string;
      } else if (
        section === 'queries' &&
        isRecord(raw) &&
        text(raw.id) &&
        !result.skippedQueries.has(raw.id as string)
      ) {
        result.skippedQueries.set(raw.id as string, index);
      }
      result.skippedItems.push(skipped);
    });
  }
  result.config = config;

  const queryIds = new Set<string>();
  const unusable = (id: string, reason: string) => {
    if (!result.unusableQueries.has(id)) {
      result.unusableQueries.set(id, reason);
    }
  };
  config.queries.forEach((q, j) => {
    const i = result.indices.queries[j];
    if (queryIds.has(q.id)) {
      diagnostics.push({
        code: 'duplicate-query-id',
        path: `queries[${i}].id`,
        message: `Query ID ${q.id} must be unique.`,
      });
      // the first stays usable; this one is only reported, so a reference finds the first
      return;
    }
    queryIds.add(q.id);
    if (q.source.kind === 'datasource') {
      const path = `queries[${i}].source`;
      if (!isPersistable(q.source.target)) {
        diagnostics.push({
          code: 'invalid-native-target',
          path: `${path}.target`,
          message: 'Native target must contain only losslessly persistable JSON values, without cycles.',
        });
        unusable(q.id, 'its native target is not persistable');
      }
      if (!q.source.datasource && !config.defaultDatasource) {
        diagnostics.push({
          code: 'missing-datasource',
          path: `${path}.datasource`,
          message: 'Choose a datasource for this query or set defaultDatasource.',
        });
        unusable(q.id, 'choose a datasource');
      }
      for (const name of Object.keys(q.source.parameters)) {
        if (!/^dm_[a-zA-Z_][\w]*$/.test(name)) {
          diagnostics.push({
            code: 'invalid-parameter-name',
            path: `${path}.parameters.${name}`,
            message: 'Parameter names must use the reserved dm_ prefix followed by an identifier.',
          });
          unusable(q.id, `parameter ${name} needs the dm_ prefix`);
        }
      }
    }
  });
  const unique = (section: Section, ids: string[], key: string, code: string) => {
    const used = new Set<string>();
    ids.forEach((id, j) => {
      if (used.has(id)) {
        diagnostics.push({
          code,
          path: `${section}[${result.indices[section][j]}].${key}`,
          message: `${key} ${id} must be unique within ${section}.`,
        });
      }
      used.add(id);
    });
  };
  unique(
    'patterns',
    config.patterns.map((p) => p.id),
    'id',
    'duplicate-pattern-id'
  );
  unique(
    'widgets',
    config.widgets.map((w) => w.id),
    'id',
    'duplicate-widget-id'
  );
  unique(
    'overrides',
    config.overrides.map((o) => o.cellId),
    'cellId',
    'duplicate-override'
  );
  const reference = (binding: QueryBinding, path: string) => {
    if (queryIds.has(binding.queryId)) {
      return;
    }
    diagnostics.push({
      code: 'unknown-query',
      path: `${path}.queryId`,
      message: unknownQueryMessage(binding.queryId, result.skippedQueries.get(binding.queryId)),
    });
  };
  const checkFreshness = (policy: FreshnessPolicy | undefined, path: string) => {
    if (invalidFreshness(policy)) {
      diagnostics.push({
        code: 'invalid-freshness',
        path: `${path}.staleAfterMs`,
        message: 'Stale detection must allow at least one expected sample interval.',
      });
    }
  };
  for (const section of ['patterns', 'overrides'] as const) {
    config[section].forEach((entry, j) => {
      const prefix = `${section}[${result.indices[section][j]}].display`;
      displayBindings(entry.display).forEach(({ binding, path }) => reference(binding, `${prefix}.${path}`));
      entry.display.hover?.rows?.forEach((row, k) => {
        if (row.kind === 'value' || row.kind === 'history' || row.kind === 'combined') {
          checkFreshness(row.freshness, `${prefix}.hover.rows[${k}].freshness`);
          if (invalidBounds(row.min, row.max)) {
            diagnostics.push({
              code: 'invalid-row-bounds',
              path: `${prefix}.hover.rows[${k}].max`,
              message: 'Row maximum must be greater than its minimum.',
            });
          }
        }
      });
      checkFreshness(entry.display.status?.freshness, `${prefix}.status.freshness`);
    });
  }
  config.widgets.forEach((w, j) => {
    const prefix = `widgets[${result.indices.widgets[j]}]`;
    reference(w.binding, `${prefix}.binding`);
    checkFreshness(w.freshness, `${prefix}.freshness`);
    if (invalidBounds(w.min, w.max)) {
      diagnostics.push({
        code: 'invalid-widget-bounds',
        path: `${prefix}.max`,
        message: 'Widget maximum must be greater than its minimum.',
      });
    }
  });
  return result;
}
