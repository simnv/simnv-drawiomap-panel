import type { Labels } from '@grafana/data';
import type { TemplateScope } from '../types';

const PLACEHOLDER = /\$\{([a-zA-Z_][\w]*)(?:\.([^}:]+))?\}/g;
const SCOPE_ROOTS = new Set(['cell', 'from', 'to', 'labels', 'value', 'percent', 'cellTitle']);

/** Stands for "$" in a substituted value, so that a later replaceVariables does not read a "${name}" in it. */
const DOLLAR = '\uE000';
/** The `encode` of a text that goes through replaceVariables afterwards (a url title): see unshield. */
export const shield = (v: string): string => v.replaceAll('$', DOLLAR);
/** Puts the "$" of the substituted values back, after replaceVariables. */
export const unshield = (v: string): string => v.replaceAll(DOLLAR, '$');

export interface ResolveResult {
  text: string;
  unresolved: string[];
}

/**
 * Replaces ${cell.x}, ${from.x}, ${to.x}, ${labels.x}, ${value}, ${percent}, ${cellTitle}.
 * Unknown roots (dashboard variables such as ${__url_time_range}) stay as they are and are not reported.
 * `encode` applies to each substituted value only (for example encodeURIComponent in URLs).
 */
export function resolveTemplate(
  tpl: string,
  scope: TemplateScope,
  encode: (v: string) => string = (v) => v
): ResolveResult {
  const unresolved: string[] = [];
  const text = tpl.replace(PLACEHOLDER, (whole, root: string, path: string | undefined) => {
    if (!SCOPE_ROOTS.has(root)) {
      return whole;
    }
    if (root === 'value' || root === 'percent' || root === 'cellTitle') {
      const v = scope[root];
      if (v === undefined) {
        unresolved.push(root);
        return whole;
      }
      return encode(v);
    }
    const obj = scope[root as 'cell' | 'from' | 'to' | 'labels'];
    const key = path ?? '';
    const v = obj?.[key];
    if (v === undefined) {
      unresolved.push(`${root}.${key}`);
      return whole;
    }
    return encode(v);
  });
  return { text, unresolved };
}

/**
 * The scope of a v4 template (spec 3.3). `attr` reads a cell attribute; `${id}` reads the attribute `id`, the
 * draw.io cell id. `from` and `to` read the cells at the edge ends. `labels` and `value` are set only when the
 * status use of the cell selects exactly one series.
 */
export interface TemplateScopeV4 {
  attr: (n: string) => string | undefined;
  from?: (n: string) => string | undefined;
  to?: (n: string) => string | undefined;
  labels?: Labels;
  value?: string;
}

/** A `${` and the text up to the next `}`. Group 2 is empty when no `}` closes it. */
const DOLLAR_BRACE = /\$\{([^}]*)(\})?/g;
/** A cell attribute name, with "-" (spec 3.3). A dot reads as part of the name, so `${cell.key}` is one attribute. */
const NAME = '[A-Za-z_][A-Za-z0-9_-]*(?:\\.[A-Za-z_][A-Za-z0-9_-]*)*';
const SCOPE_PLACEHOLDER = new RegExp(`^(?:(from|to|labels)\\.(${NAME})|(${NAME}))$`);
/** `${<name>:<format>}`: a dashboard variable with a Grafana variable format (A17). The format id is not checked. */
const VARIABLE_PLACEHOLDER = /^[A-Za-z_]\w*:.+$/;
/** A bare dashboard variable `$<name>`, as replaceVariables reads it. */
const BARE_VARIABLE = /\$([A-Za-z_]\w*)/g;

export const BAD_PLACEHOLDER_MESSAGE =
  'write ${attr} for a cell attribute, $var or ${var:format} for a dashboard variable';
export const METADATA_VARIABLE_MESSAGE = 'a metadata text reads no dashboard variable';
export const GRAFANA_VARIABLE_HINT = 'write $__name for a Grafana variable';

type Placeholder = { kind: 'attr' | 'from' | 'to' | 'labels'; name: string } | { kind: 'value' | 'variable' | 'bad' };

function classify(inner: string, closed: boolean): Placeholder {
  if (!closed) {
    return { kind: 'bad' };
  }
  const m = SCOPE_PLACEHOLDER.exec(inner);
  if (m) {
    if (m[3] !== undefined) {
      return m[3] === 'value' ? { kind: 'value' } : { kind: 'attr', name: m[3] };
    }
    return { kind: m[1] as 'from' | 'to' | 'labels', name: m[2] };
  }
  return VARIABLE_PLACEHOLDER.test(inner) ? { kind: 'variable' } : { kind: 'bad' };
}

/**
 * The `schema` messages of a template (spec 3.3): a `${` that starts no known form, and a dashboard variable
 * `${<name>:<format>}` in a metadata text, which does not go through replaceVariables.
 */
export function checkTemplate(text: string, place: 'url' | 'title' | 'metadata'): Array<{ message: string }> {
  const out: Array<{ message: string }> = [];
  for (const m of text.matchAll(DOLLAR_BRACE)) {
    const p = classify(m[1], m[2] !== undefined);
    if (p.kind === 'bad') {
      out.push({ message: BAD_PLACEHOLDER_MESSAGE });
    } else if (p.kind === 'variable' && place === 'metadata') {
      out.push({ message: METADATA_VARIABLE_MESSAGE });
    }
  }
  return out;
}

/**
 * Replaces the placeholders of the v4 scope (spec 3.3). `missing` holds the attributes that the cell or an edge end
 * does not have (`port`, `from.key`): the `missing-attr` entries. `unresolved` holds `labels.x` and `value` when the
 * scope has no single status series: the `template-unresolved` entries. A placeholder that is not replaced stays as
 * it is. A dashboard variable (`$var`, `$__name`, `${var:format}`) and a bad `${` stay as they are.
 * `encode` applies to each substituted value only. A label that the one status series does not have gives "", as in
 * PromQL.
 */
export function resolveTemplateV4(
  text: string,
  scope: TemplateScopeV4,
  encode: (v: string) => string = (v) => v
): { text: string; missing: string[]; unresolved: string[] } {
  const missing = new Set<string>();
  const unresolved = new Set<string>();
  const out = text.replace(DOLLAR_BRACE, (whole, inner: string, close: string | undefined) => {
    const p = classify(inner, close !== undefined);
    switch (p.kind) {
      case 'variable':
      case 'bad':
        return whole;
      case 'value':
        if (scope.value === undefined) {
          unresolved.add('value');
          return whole;
        }
        return encode(scope.value);
      case 'labels':
        if (scope.labels === undefined) {
          unresolved.add(`labels.${p.name}`);
          return whole;
        }
        return encode(scope.labels[p.name] ?? '');
      default: {
        const v = p.kind === 'attr' ? scope.attr(p.name) : scope[p.kind]?.(p.name);
        if (v === undefined) {
          missing.add(p.kind === 'attr' ? p.name : `${p.kind}.${p.name}`);
          return whole;
        }
        return encode(v);
      }
    }
  });
  return { text: out, missing: [...missing], unresolved: [...unresolved] };
}

/**
 * The hint of a `missing-attr` entry. A `${__name}` is a cell attribute (A5), so the user who wants the Grafana
 * global variable must write `$__name`.
 */
export function missingAttrHint(attr: string): string | undefined {
  return attr.startsWith('__') ? GRAFANA_VARIABLE_HINT : undefined;
}

/**
 * Step 2 of the URL order (spec 3.3): writes each bare ordinary dashboard variable `$<name>` as
 * `${<name>:percentencode}`, so that its value cannot change the query structure. A `$__<name>` stays raw
 * (`$__url_time_range` gives `from=…&to=…`), and a `${<name>:<format>}` keeps its format.
 */
export function formatBareVariables(url: string): string {
  return url.replace(BARE_VARIABLE, (whole, name: string) =>
    name.startsWith('__') ? whole : `\${${name}:percentencode}`
  );
}
