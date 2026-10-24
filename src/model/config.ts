import type { DataQuery, DataSourceRef } from '@grafana/schema';
import type { CellSelector, ReducerName, ShapeTarget } from '../types';
import { z } from 'zod';
import { matcherError } from '../binding/select';

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
}

export interface NamedQuery {
  id: string;
  name: string;
  source:
    | { kind: 'panel'; refId: string }
    | { kind: 'datasource'; datasource?: DataSourceRef; target: DataQuery; parameters: Record<string, string> };
}

export interface QueryBinding {
  queryId: string;
  match: Record<string, string>;
  field?: string;
  reducer: ReducerName;
}

export interface FreshnessPolicy {
  expectedIntervalMs: number;
  staleAfterMs: number;
}

export type StatusState = 'normal' | 'warning' | 'critical' | 'down';
export interface StatusCondition {
  state: StatusState;
  reason: string;
}
export type StatusRule = {
  enabled?: boolean;
  binding: QueryBinding;
  default: StatusCondition;
  freshness?: FreshnessPolicy;
} & (
  | { kind: 'mapping'; mappings: Array<StatusCondition & { value: number }> }
  | {
      kind: 'predicates';
      predicates: Array<StatusCondition & { op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; value: number }>;
    }
);

/** Y range of a sparkline: a number, or "auto" for the data min. The default is 0 for a non-negative series. */
export type LowerBound = number | 'auto';
/** A hover row capacity: a number (the unit of the values) or a template string that resolves to bit/s. */
export type RowCapacity = number | string;
/** The capacity of one link half in bit/s: a number or a template. A value that is not positive is skipped. */
export type LinkCapacity = number | string;
/** Half range of a combined up/down row: a number, "auto" (the data, the default) or "capacity". */
export type RangeMax = number | 'auto' | 'capacity';
interface DataRowBase {
  label: string;
  unit?: string;
  url?: string;
  freshness?: FreshnessPolicy;
  min?: LowerBound;
  max?: number;
}
/** One direction of a combined row: up leaves the subject (tx), down enters it (rx). */
export interface DirectionSeries {
  binding: QueryBinding;
  direction: 'up' | 'down';
  /** text before the value; default "↑" or "↓" */
  label?: string;
  /** the capacity of this direction: a number in the unit of the values, or a template in bit/s */
  capacity?: RowCapacity;
}
export type HoverRow =
  | (DataRowBase & { kind: 'value'; binding: QueryBinding })
  | (DataRowBase & { kind: 'history'; binding: QueryBinding; height?: number })
  /** A combined up/down history row: up above the zero line, down mirrored below it. */
  | (Omit<DataRowBase, 'max'> & {
      kind: 'history';
      series: DirectionSeries[];
      /** a number in the unit of the values, or a template in bit/s, for example "${cell.capacity_bps}" */
      capacity?: RowCapacity;
      max?: RangeMax;
      height?: number;
    })
  | { kind: 'metadata'; label: string; path: string }
  | { kind: 'drilldown'; label: string; url: string };
export interface HoverSpec {
  enabled?: boolean;
  /** card title (template); the default is the title of the cell, see adapter/cellTitle */
  title?: string;
  rows: HoverRow[];
}

/** The two halves of a link: a binding for each direction, and the capacity in bit/s (see the precedence in README). */
export interface LinkDisplay {
  enabled?: boolean;
  a2bBinding?: QueryBinding;
  b2aBinding?: QueryBinding;
  /** the capacity of both halves: a series, read through the field unit */
  capacityBinding?: QueryBinding;
  /** the capacity of both halves: a number, a numeric string, or a template like "${cell.capacity}" */
  capacity?: LinkCapacity;
  /** capacity of one half, a number or a template, in bit/s */
  capacityA2b?: LinkCapacity;
  capacityB2a?: LinkCapacity;
  capacityA2bBinding?: QueryBinding;
  capacityB2aBinding?: QueryBinding;
}
/** The state colour and the label text of a node. */
export interface ShapeDisplay {
  enabled?: boolean;
  binding?: QueryBinding;
  /** what the colour changes; without it the colour changes nothing (the value still feeds the card and `text`) */
  target?: ShapeTarget | 'none';
  /** write the value into the node label (the `label` template of the display) */
  text?: boolean;
}
export interface DisplayConfig {
  enabled?: boolean;
  link?: LinkDisplay;
  shape?: ShapeDisplay;
  status?: StatusRule;
  hover?: HoverSpec;
  /** the default reducer of the capacity series; the bindings have their own */
  reducer?: ReducerName;
  /** template of the text that `shape.text` writes into the node label; default "${value}" */
  label?: string;
  /** the footer link of the card (a template); also the default click target of the hover rows */
  url?: string;
  /** title of the url in the card footer (a template) */
  urlTitle?: string;
}

export interface Pattern {
  id: string;
  name: string;
  select: CellSelector;
  display: DisplayConfig;
}
export interface ElementOverride {
  cellId: string;
  display: Partial<DisplayConfig>;
}
export interface Widget {
  id: string;
  anchorCellId: string;
  kind: 'sparkline' | 'bar';
  freshness?: FreshnessPolicy;
  binding: QueryBinding;
  label: string;
  unit?: string;
  min?: LowerBound;
  max?: number;
  url?: string;
}
export interface DiagramConfigV2 {
  version: 2;
  queries: NamedQuery[];
  patterns: Pattern[];
  overrides: ElementOverride[];
  widgets: Widget[];
  defaultDatasource?: DataSourceRef;
}

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
const bindingSchema = z
  .object({ queryId: nonempty, match: z.record(matcher), field: nonempty.optional(), reducer })
  .strict();
const condition = z.object({ state: z.enum(['normal', 'warning', 'critical', 'down']), reason: nonempty }).strict();
const freshnessSchema = z
  .object({ expectedIntervalMs: z.number().positive().finite(), staleAfterMs: z.number().positive().finite() })
  .strict();
const statusBase = {
  enabled: z.boolean().optional(),
  binding: bindingSchema,
  default: condition,
  freshness: freshnessSchema.optional(),
};
const statusSchema = z.discriminatedUnion('kind', [
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
const scopePath = z
  .string()
  .regex(/^(cell|from|to)\.[^\s.{}]+$/, 'Use a semantic scope path, for example cell.device or from.node.');
const lowerBound = z.union([z.number().finite(), z.literal('auto')]);
const dataRow = {
  freshness: freshnessSchema.optional(),
  label: nonempty,
  unit: z.string().optional(),
  url: z.string().optional(),
  min: lowerBound.optional(),
  max: z.number().finite().optional(),
};
/** Allowed chart height of a history row, in px. Tall cards scroll. */
export const ROW_HEIGHT_MIN = 16;
export const ROW_HEIGHT_MAX = 400;
/** A capacity template needs a ${...} reference to the cell scope. It must resolve to a positive number at run time. */
const capacityTemplate = z.string().regex(/\$\{[^\s{}]+\}/, 'Use a number or a template like ${cell.capacity_bps}.');
const rowCapacity = z.union([z.number().positive().finite(), capacityTemplate]);
// a number that is not positive is skipped at run time, as a missing value
const linkCapacity = z.union([z.number().finite(), capacityTemplate]);
const directionSeries = z
  .object({
    binding: bindingSchema,
    direction: z.enum(['up', 'down']),
    label: z.string().optional(),
    capacity: rowCapacity.optional(),
  })
  .strict();
const hoverSchema = z
  .object({
    enabled: z.boolean().optional(),
    title: z.string().optional(),
    // An override may hold only `enabled`: the rows then come from the patterns (`mergeDisplay` fills in an empty list).
    rows: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('value'), ...dataRow, binding: bindingSchema }).strict(),
          // A history row has one binding, or a series list (a combined up/down row). Refined below.
          z
            .object({
              kind: z.literal('history'),
              ...dataRow,
              binding: bindingSchema.optional(),
              series: z.array(directionSeries).min(1).max(2).optional(),
              capacity: rowCapacity.optional(),
              height: z.number().finite().min(ROW_HEIGHT_MIN).max(ROW_HEIGHT_MAX).optional(),
              // a combined row (series) also takes "auto" and "capacity"; refined below
              max: z.union([z.number().finite(), z.literal('auto'), z.literal('capacity')]).optional(),
            })
            .strict(),
          z.object({ kind: z.literal('metadata'), label: nonempty, path: scopePath }).strict(),
          z.object({ kind: z.literal('drilldown'), label: nonempty, url: nonempty }).strict(),
        ])
      )
      .optional(),
  })
  .strict()
  .superRefine((hover, ctx) => {
    (hover.rows ?? []).forEach((row, i) => {
      if (row.kind !== 'history') {
        return;
      }
      const issue = (path: Array<string | number>, message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rows', i, ...path], message });
      if ((row.binding === undefined) === (row.series === undefined)) {
        issue([], 'A history row has a binding or a series list, not both.');
      }
      if (row.series && new Set(row.series.map((s) => s.direction)).size < row.series.length) {
        issue(['series'], 'Each direction (up, down) can occur only once.');
      }
      if (row.capacity !== undefined && !row.series) {
        issue(['capacity'], 'Capacity applies only to a combined row with a series list.');
      }
      if (typeof row.max === 'string' && !row.series) {
        issue(['max'], 'The maximum "auto" or "capacity" applies only to a combined row with a series list.');
      }
    });
  });
const displaySchema = z
  .object({
    enabled: z.boolean().optional(),
    link: z
      .object({
        enabled: z.boolean().optional(),
        a2bBinding: bindingSchema.optional(),
        b2aBinding: bindingSchema.optional(),
        capacityBinding: bindingSchema.optional(),
        // any string, as the saved configs have it: a numeric string or a template; the engine reports the rest
        capacity: z.union([z.number().finite(), z.string()]).optional(),
        capacityA2b: linkCapacity.optional(),
        capacityB2a: linkCapacity.optional(),
        capacityA2bBinding: bindingSchema.optional(),
        capacityB2aBinding: bindingSchema.optional(),
      })
      .strict()
      .optional(),
    shape: z
      .object({
        enabled: z.boolean().optional(),
        binding: bindingSchema.optional(),
        target: z.enum(['icon', 'shape', 'stroke', 'none']).optional(),
        text: z.boolean().optional(),
      })
      .strict()
      .optional(),
    status: statusSchema.optional(),
    hover: hoverSchema.optional(),
    reducer: reducer.optional(),
    label: z.string().optional(),
    url: z.string().optional(),
    urlTitle: z.string().optional(),
  })
  .strict();
const datasourceSchema = z.object({ uid: nonempty, type: nonempty.optional() }).strict();
const configSchema = z
  .object({
    version: z.literal(2),
    defaultDatasource: datasourceSchema.optional(),
    queries: z.array(
      z
        .object({
          id: nonempty,
          name: nonempty,
          source: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('panel'), refId: nonempty }).strict(),
            z
              .object({
                kind: z.literal('datasource'),
                datasource: datasourceSchema.optional(),
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
        .strict()
    ),
    patterns: z.array(
      z.object({ id: nonempty, name: nonempty, select: cellSelector, display: displaySchema }).strict()
    ),
    overrides: z.array(z.object({ cellId: nonempty, display: displaySchema }).strict()),
    widgets: z.array(
      z
        .object({
          id: nonempty,
          anchorCellId: nonempty,
          kind: z.enum(['sparkline', 'bar']),
          freshness: freshnessSchema.optional(),
          binding: bindingSchema,
          label: nonempty,
          unit: z.string().optional(),
          min: lowerBound.optional(),
          max: z.number().finite().optional(),
          url: z.string().optional(),
        })
        .strict()
    ),
  })
  .strict();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const SERIES_SELECTOR_KEYS = new Set(['refId', 'name', 'match', 'reducer']);
const isBoolean = (value: unknown) => typeof value === 'boolean';
/** The dropped keys with the type the old schema gave them. A value of another type is still an error. */
const DROPPED_LINK_KEYS = { a2b: isRecord, b2a: isRecord, card: isRecord };
const DROPPED_SHAPE_KEYS = {
  series: isRecord,
  fill: isBoolean,
  stroke: isBoolean,
  card: Array.isArray,
  sparkline: isRecord,
};
function dropKeys(source: Record<string, unknown>, keys: Record<string, (value: unknown) => boolean>) {
  const out = { ...source };
  for (const [key, accepts] of Object.entries(keys)) {
    if (key in out && accepts(out[key])) {
      delete out[key];
    }
  }
  return out;
}

/**
 * A capacity series of a config saved before 2026-10-24: `{ refId, match, reducer }` on the panel data.
 * It becomes a `capacityBinding` on the panel query with that refId. A `name` matcher has no equivalent.
 */
function legacyCapacityBinding(selector: Record<string, unknown>, queries: unknown, reducer: unknown) {
  if (typeof selector.refId !== 'string' || selector.name !== undefined || !Array.isArray(queries)) {
    return undefined;
  }
  const query = queries.find(
    (q) => isRecord(q) && isRecord(q.source) && q.source.kind === 'panel' && q.source.refId === selector.refId
  );
  return isRecord(query)
    ? { queryId: query.id, match: selector.match ?? {}, reducer: selector.reducer ?? reducer ?? 'last' }
    : undefined;
}

/**
 * Version 2 configs saved before 2026-10-24 can carry the fields of the rules of version 1 in `link` and `shape`
 * (the schema shared those objects). The schema is strict: one such field would reject the whole config and the
 * panel would lose every binding. Drop them before the parse. Two of them the panel read: `link.card.title`
 * becomes the hover title when the hover has none, and a capacity series becomes `capacityBinding`.
 */
function upgradeDisplay(display: unknown, queries: unknown): unknown {
  if (!isRecord(display)) {
    return display;
  }
  let out = display;
  if (isRecord(display.link)) {
    const card = display.link.card;
    const link = dropKeys(display.link, DROPPED_LINK_KEYS);
    const capacity = link.capacity;
    if (isRecord(capacity) && Object.keys(capacity).every((key) => SERIES_SELECTOR_KEYS.has(key))) {
      delete link.capacity;
      const binding = legacyCapacityBinding(capacity, queries, display.reducer);
      if (binding && link.capacityBinding === undefined) {
        link.capacityBinding = binding;
      }
    }
    out = { ...out, link };
    if (isRecord(card) && typeof card.title === 'string' && isRecord(out.hover) && out.hover.title === undefined) {
      out = { ...out, hover: { title: card.title, ...out.hover } };
    }
  }
  if (isRecord(display.shape)) {
    out = { ...out, shape: dropKeys(display.shape, DROPPED_SHAPE_KEYS) };
  }
  return out;
}

function upgradeConfig(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }
  const out = { ...input };
  for (const key of ['patterns', 'overrides']) {
    const list = input[key];
    if (Array.isArray(list)) {
      out[key] = list.map((entry: unknown) =>
        isRecord(entry) ? { ...entry, display: upgradeDisplay(entry.display, input.queries) } : entry
      );
    }
  }
  return out;
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
  add(display.link?.a2bBinding, 'link.a2bBinding');
  add(display.link?.b2aBinding, 'link.b2aBinding');
  add(display.link?.capacityBinding, 'link.capacityBinding');
  add(display.link?.capacityA2bBinding, 'link.capacityA2bBinding');
  add(display.link?.capacityB2aBinding, 'link.capacityB2aBinding');
  add(display.shape?.binding, 'shape.binding');
  add(display.status?.binding, 'status.binding');
  display.hover?.rows?.forEach((row, i) => {
    rowBindings(row).forEach(({ binding, path }) => add(binding, `hover.rows[${i}].${path}`));
  });
  return found;
}

/** The bindings of one hover row, with their paths in the row: one, two for a combined row, none for the others. */
export function rowBindings(row: HoverRow): Array<{ binding: QueryBinding; path: string }> {
  if ('series' in row) {
    return row.series.map((s, j) => ({ binding: s.binding, path: `series[${j}].binding` }));
  }
  return 'binding' in row ? [{ binding: row.binding, path: 'binding' }] : [];
}

/** The warning of a panel that still has `rules` of version 1. The panel does not read them. */
export function legacyRulesWarning(count: number): string {
  return `The panel ignores ${count} rule${count === 1 ? '' : 's'} of version 1. Create the bindings again in Edit bindings.`;
}

export function validateConfig(input: unknown): { config?: DiagramConfigV2; diagnostics: Diagnostic[] } {
  if (input && typeof input === 'object' && !('version' in input) && ('rules' in input || 'diagram' in input)) {
    return {
      diagnostics: [
        {
          code: 'legacy-config',
          path: '(root)',
          message:
            'This is a panel options document, not a version 2 config. The rules of version 1 are not supported: create the bindings again in the editor, or import a version 2 config.',
        },
      ],
    };
  }
  const parsed = configSchema.safeParse(upgradeConfig(input));
  if (!parsed.success) {
    return {
      diagnostics: parsed.error.issues.map((issue) => ({
        code: 'invalid-config',
        path: formatPath(issue.path),
        message: issue.message,
      })),
    };
  }
  // The schema allows binding and series together; its refinement rejects that, so the data is a HoverRow.
  const config = parsed.data as DiagramConfigV2;
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  config.queries.forEach((q, i) => {
    if (seen.has(q.id)) {
      diagnostics.push({
        code: 'duplicate-query-id',
        path: `queries[${i}].id`,
        message: `Query ID ${q.id} must be unique.`,
      });
    }
    seen.add(q.id);
    if (q.source.kind === 'datasource') {
      const path = `queries[${i}].source`;
      if (!isPersistable(q.source.target)) {
        diagnostics.push({
          code: 'invalid-native-target',
          path: `${path}.target`,
          message: 'Native target must contain only losslessly persistable JSON values, without cycles.',
        });
      }
      if (!q.source.datasource && !config.defaultDatasource) {
        diagnostics.push({
          code: 'missing-datasource',
          path: `${path}.datasource`,
          message: 'Choose a datasource for this query or set defaultDatasource.',
        });
      }
      for (const name of Object.keys(q.source.parameters)) {
        if (!/^dm_[a-zA-Z_][\w]*$/.test(name)) {
          diagnostics.push({
            code: 'invalid-parameter-name',
            path: `${path}.parameters.${name}`,
            message: 'Parameter names must use the reserved dm_ prefix followed by an identifier.',
          });
        }
      }
    }
  });
  const unique = (ids: string[], prefix: string, key: string, code: string) => {
    const used = new Set<string>();
    ids.forEach((id, i) => {
      if (used.has(id)) {
        diagnostics.push({
          code,
          path: `${prefix}[${i}].${key}`,
          message: `${key} ${id} must be unique within ${prefix}.`,
        });
      }
      used.add(id);
    });
  };
  unique(
    config.patterns.map((p) => p.id),
    'patterns',
    'id',
    'duplicate-pattern-id'
  );
  unique(
    config.widgets.map((w) => w.id),
    'widgets',
    'id',
    'duplicate-widget-id'
  );
  unique(
    config.overrides.map((o) => o.cellId),
    'overrides',
    'cellId',
    'duplicate-override'
  );
  const reference = (binding: QueryBinding, path: string) => {
    if (!seen.has(binding.queryId)) {
      diagnostics.push({
        code: 'unknown-query',
        path: `${path}.queryId`,
        message: `Query ${binding.queryId} does not exist. Choose a named query or restore its definition.`,
      });
    }
  };
  const checkFreshness = (freshness: FreshnessPolicy | undefined, path: string) => {
    if (freshness && freshness.staleAfterMs < freshness.expectedIntervalMs) {
      diagnostics.push({
        code: 'invalid-freshness',
        path: `${path}.staleAfterMs`,
        message: 'Stale detection must allow at least one expected sample interval.',
      });
    }
  };
  for (const [key, entries] of [
    ['patterns', config.patterns],
    ['overrides', config.overrides],
  ] as const) {
    entries.forEach((entry, i) => {
      displayBindings(entry.display).forEach(({ binding, path }) => reference(binding, `${key}[${i}].display.${path}`));
      entry.display.hover?.rows?.forEach((row, j) => {
        if (row.kind === 'value' || row.kind === 'history') {
          checkFreshness(row.freshness, `${key}[${i}].display.hover.rows[${j}].freshness`);
          if (typeof row.min === 'number' && typeof row.max === 'number' && row.min >= row.max) {
            diagnostics.push({
              code: 'invalid-row-bounds',
              path: `${key}[${i}].display.hover.rows[${j}].max`,
              message: 'Row maximum must be greater than its minimum.',
            });
          }
        }
      });
      checkFreshness(entry.display.status?.freshness, `${key}[${i}].display.status.freshness`);
    });
  }
  config.widgets.forEach((widget, i) => {
    reference(widget.binding, `widgets[${i}].binding`);
    checkFreshness(widget.freshness, `widgets[${i}].freshness`);
    if (typeof widget.min === 'number' && widget.max !== undefined && widget.min >= widget.max) {
      diagnostics.push({
        code: 'invalid-widget-bounds',
        path: `widgets[${i}].max`,
        message: 'Widget maximum must be greater than its minimum.',
      });
    }
  });
  return { config: diagnostics.length ? undefined : JSON.parse(JSON.stringify(config)), diagnostics };
}
