import type { DataQuery, DataSourceRef } from '@grafana/schema';
import type { CellSelector, LinkRule, ReducerName, ShapeRule } from '../types';
import { z } from 'zod';
import { cellSelector, matcher, reducer, ruleSchema } from '../rules/schema';

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

export type HoverRow =
  | {
      kind: 'value' | 'history';
      label: string;
      binding: QueryBinding;
      unit?: string;
      url?: string;
      freshness?: FreshnessPolicy;
    }
  | { kind: 'metadata'; label: string; path: string }
  | { kind: 'drilldown'; label: string; url: string };
export interface HoverSpec {
  enabled?: boolean;
  rows: HoverRow[];
}

export interface DisplayConfig {
  enabled?: boolean;
  link?: LinkRule & {
    enabled?: boolean;
    a2bBinding?: QueryBinding;
    b2aBinding?: QueryBinding;
    capacityBinding?: QueryBinding;
  };
  shape?: ShapeRule & { enabled?: boolean; binding?: QueryBinding };
  status?: StatusRule;
  hover?: HoverSpec;
  reducer?: ReducerName;
  label?: string;
  url?: string;
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
  min?: number;
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
const hoverSchema = z
  .object({
    enabled: z.boolean().optional(),
    rows: z.array(
      z.discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('value'),
            freshness: freshnessSchema.optional(),
            label: nonempty,
            binding: bindingSchema,
            unit: z.string().optional(),
            url: z.string().optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal('history'),
            freshness: freshnessSchema.optional(),
            label: nonempty,
            binding: bindingSchema,
            unit: z.string().optional(),
            url: z.string().optional(),
          })
          .strict(),
        z.object({ kind: z.literal('metadata'), label: nonempty, path: scopePath }).strict(),
        z.object({ kind: z.literal('drilldown'), label: nonempty, url: nonempty }).strict(),
      ])
    ),
  })
  .strict();
const displaySchema = z
  .object({
    enabled: z.boolean().optional(),
    link: ruleSchema.shape.link
      .unwrap()
      .extend({
        enabled: z.boolean().optional(),
        a2bBinding: bindingSchema.optional(),
        b2aBinding: bindingSchema.optional(),
        capacityBinding: bindingSchema.optional(),
      })
      .optional(),
    shape: ruleSchema.shape.shape
      .unwrap()
      .extend({ enabled: z.boolean().optional(), binding: bindingSchema.optional() })
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
          min: z.number().finite().optional(),
          max: z.number().finite().optional(),
          url: z.string().optional(),
        })
        .strict()
    ),
  })
  .strict();

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
  add(display.shape?.binding, 'shape.binding');
  add(display.status?.binding, 'status.binding');
  display.hover?.rows.forEach((row, i) => {
    if (row.kind === 'value' || row.kind === 'history') {
      add(row.binding, `hover.rows[${i}].binding`);
    }
  });
  return found;
}

export function validateConfig(input: unknown): { config?: DiagramConfigV2; diagnostics: Diagnostic[] } {
  if (input && typeof input === 'object' && !('version' in input) && ('rules' in input || 'diagram' in input)) {
    return {
      diagnostics: [
        {
          code: 'legacy-config',
          path: '(root)',
          message:
            'Legacy panel options detected. Explicitly recreate or import V2 configuration; existing options have been preserved.',
        },
      ],
    };
  }
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    return {
      diagnostics: parsed.error.issues.map((issue) => ({
        code: 'invalid-config',
        path: formatPath(issue.path),
        message: issue.message,
      })),
    };
  }
  const config: DiagramConfigV2 = parsed.data;
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
      entry.display.hover?.rows.forEach((row, j) => {
        if (row.kind === 'value' || row.kind === 'history') {
          checkFreshness(row.freshness, `${key}[${i}].display.hover.rows[${j}].freshness`);
        }
      });
      const freshness = entry.display.status?.freshness;
      if (freshness && freshness.staleAfterMs < freshness.expectedIntervalMs) {
        diagnostics.push({
          code: 'invalid-freshness',
          path: `${key}[${i}].display.status.freshness.staleAfterMs`,
          message: 'Stale detection must allow at least one expected sample interval.',
        });
      }
    });
  }
  config.widgets.forEach((widget, i) => {
    reference(widget.binding, `widgets[${i}].binding`);
    checkFreshness(widget.freshness, `widgets[${i}].freshness`);
    if (widget.min !== undefined && widget.max !== undefined && widget.min >= widget.max) {
      diagnostics.push({
        code: 'invalid-widget-bounds',
        path: `widgets[${i}].max`,
        message: 'Widget maximum must be greater than its minimum.',
      });
    }
  });
  return { config: diagnostics.length ? undefined : JSON.parse(JSON.stringify(config)), diagnostics };
}
