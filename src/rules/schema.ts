import { z } from 'zod';
import yaml from 'js-yaml';
import { matcherError } from '../binding/select';
import type { Rule } from '../types';

/** Exact string or "/re/flags". The regex must compile and must not use the stateful g or y flag. */
export const matcher = z.string().superRefine((m, ctx) => {
  const err = matcherError(m);
  if (err) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
  }
});
const seriesSelector = z
  .object({ refId: z.string().optional(), name: matcher.optional(), match: z.record(matcher).optional() })
  .strict();
export const cellSelector = z
  .object({
    ids: z.array(z.string()).optional(),
    kind: z.enum(['node', 'port', 'link', 'link-label', 'other', 'any']).optional(),
    attrs: z.record(matcher).optional(),
    label: matcher.optional(),
    between: z.tuple([z.string(), z.string()]).optional(),
  })
  .strict();
const cardRow = seriesSelector
  .extend({
    title: z.string().optional(),
    unit: z.string().optional(),
    decimals: z.number().int().min(0).optional(),
    url: z.string().optional(),
  })
  .strict();
export const reducer = z.enum(['last', 'mean', 'max', 'min']);
const capacitySeries = seriesSelector.extend({ reducer: reducer.optional() }).strict();

export const ruleSchema = z
  .object({
    name: z.string().min(1),
    select: cellSelector,
    link: z
      .object({
        a2b: seriesSelector.optional(),
        b2a: seriesSelector.optional(),
        capacity: z.union([z.string(), z.number(), capacitySeries]).optional(),
        card: z.object({ url: z.string().optional(), title: z.string().optional() }).strict().optional(),
      })
      .strict()
      .optional(),
    shape: z
      .object({
        series: seriesSelector.optional(),
        target: z.enum(['icon', 'shape', 'stroke']).optional(),
        fill: z.boolean().optional(),
        stroke: z.boolean().optional(),
        text: z.boolean().optional(),
        card: z.array(cardRow).optional(),
        // Removed. Accepted so that old dashboards still load; the engine gives a warning.
        sparkline: seriesSelector
          .extend({ position: z.enum(['bottom', 'top', 'inside']).optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    reducer: reducer.optional(),
    label: z.string().optional(),
    // Removed: the field config gives the colours. Accepted so that old dashboards still load.
    thresholds: z.unknown().optional(),
    url: z.string().optional(),
    urlTitle: z.string().optional(),
  })
  .strict();

export const rulesSchema = z.array(ruleSchema);

export interface ParseResult {
  rules?: Rule[];
  errors: string[];
}

export function parseRules(input: unknown): ParseResult {
  const res = rulesSchema.safeParse(input ?? []);
  if (res.success) {
    return { rules: res.data as Rule[], errors: [] };
  }
  const errors = res.error.issues.map((i) => {
    const path = i.path
      .map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`))
      .join('')
      .replace(/^\./, '');
    return `${path || '(root)'}: ${i.message}`;
  });
  return { errors };
}

export function parseRulesYaml(text: string): ParseResult {
  let doc: unknown;
  try {
    // js-yaml 4: load() is the former safeLoad(); it builds plain data only, no custom types.
    doc = yaml.load(text);
  } catch (e) {
    return { errors: [`YAML: ${(e as Error).message}`] };
  }
  if (doc === undefined || doc === null) {
    return { rules: [], errors: [] };
  }
  return parseRules(doc);
}

export function rulesToYaml(rules: Rule[]): string {
  return yaml.dump(rules, { noRefs: true, lineWidth: 120, quotingType: '"' });
}
