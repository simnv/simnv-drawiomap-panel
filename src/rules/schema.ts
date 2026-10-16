import { z } from 'zod';
import yaml from 'js-yaml';
import type { Rule } from '../types';

const matcher = z.string();
const seriesSelector = z
  .object({ refId: z.string().optional(), name: matcher.optional(), match: z.record(matcher).optional() })
  .strict();
const cellSelector = z
  .object({
    ids: z.array(z.string()).optional(),
    kind: z.enum(['node', 'port', 'link', 'link-label', 'other', 'any']).optional(),
    attrs: z.record(matcher).optional(),
    label: matcher.optional(),
    between: z.tuple([z.string(), z.string()]).optional(),
  })
  .strict();
const thresholds = z
  .object({ mode: z.enum(['percent', 'absolute']), steps: z.array(z.tuple([z.number(), z.string()])).min(1) })
  .strict();

export const ruleSchema = z
  .object({
    name: z.string().min(1),
    select: cellSelector,
    link: z
      .object({
        a2b: seriesSelector.optional(),
        b2a: seriesSelector.optional(),
        capacity: z.union([z.string(), z.number()]).optional(),
      })
      .strict()
      .optional(),
    shape: z
      .object({
        series: seriesSelector.optional(),
        fill: z.boolean().optional(),
        stroke: z.boolean().optional(),
        text: z.boolean().optional(),
        sparkline: seriesSelector
          .extend({ position: z.enum(['bottom', 'top', 'inside']).optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    reducer: z.enum(['last', 'mean', 'max', 'min']).optional(),
    label: z.string().optional(),
    thresholds: thresholds.optional(),
    url: z.string().optional(),
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
