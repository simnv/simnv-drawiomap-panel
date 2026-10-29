import type { Labels } from '@grafana/data';

/** A mark that no variable syntax of replaceVariables reads: no `\w`, no `{`, no `[`. */
const BREAK = '\uE001';
/**
 * The v4 `encode` of a value that goes through replaceVariables afterwards: a BREAK after each "$" and "[" of the
 * value, so that no `$name`, `${name}` or `[[name]]` starts in it, and a BREAK at each end, so that the text around
 * the placeholder cannot join the value into one (`$si${key}`, `[[${key}]]`). See unshieldV4.
 */
export const shieldV4 = (v: string): string => `${BREAK}${v.replace(/[$[]/g, (c) => c + BREAK)}${BREAK}`;
/** Removes the marks of shieldV4, after replaceVariables. A U+E001 that the text has of its own goes too. */
export const unshieldV4 = (v: string): string => v.replaceAll(BREAK, '');

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
/** `${<name>:<format>}`: a dashboard variable with a Grafana variable format (A17). The panel does not check the id. */
const VARIABLE_PLACEHOLDER = /^[A-Za-z_]\w*:.+$/;
/**
 * A dashboard variable with no format, as replaceVariables reads it: `$<name>` or the old form `[[<name>]]`. The first
 * branch takes a complete `${…}`, so that a `$` in its format (`${__from:date:YYYY[$USD]MM}`) is not read.
 */
const BARE_VARIABLE = /\$\{[^}]*\}|\$(\w+)|\[\[(\w+?)\]\]/g;

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
 * scope has no single status series: the `template-unresolved` entries. The function keeps a placeholder that it
 * does not replace, a dashboard variable (`$var`, `$__name`, `${var:format}`) and a bad `${` as they are.
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
        // a label that the series does not have is "", also a name of the prototype (constructor, toString)
        return encode(Object.hasOwn(scope.labels, p.name) ? scope.labels[p.name] : '');
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
 * `${<name>:percentencode}`, so that its value cannot change the query structure. The old form `[[<name>]]` gets the
 * same change. A `$__<name>` stays raw (`$__url_time_range` gives `from=…&to=…`), and a `${<name>:<format>}` keeps
 * its format.
 */
export function formatBareVariables(url: string): string {
  return url.replace(BARE_VARIABLE, (whole, bare: string | undefined, old: string | undefined) => {
    const name = bare ?? old;
    return name === undefined || name.startsWith('__') ? whole : `\${${name}:percentencode}`;
  });
}
