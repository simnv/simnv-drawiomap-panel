import type { Labels } from '@grafana/data';
import type { MatchV4 } from '../model/v4';

type Operator = '=' | '!=' | '=~' | '!~';
type Part = string | { attr: string };

export interface ParsedMatcher {
  label: string;
  op: Operator;
  parts: Part[];
}

export interface ParsedBlock {
  matchers: ParsedMatcher[];
  requiredAttrs: string[];
}

type CompiledRegex = { ok: true; regex: RegExp } | { ok: false; message: string };
export type RegexCache = Map<string, CompiledRegex>;

export type ParseResult =
  { ok: true; block: ParsedBlock } | { ok: false; errors: Array<{ path: string; message: string }> };
export type ResolvedMatcher = { label: string; op: Operator; value: string };
export type ResolveResult =
  | {
      ok: true;
      test: (labels: Labels) => boolean;
      /** A label-tuple prefilter only; always run test after lookup. */
      equality?: Map<string, string>;
      resolved: ResolvedMatcher[];
    }
  | { ok: false; kind: 'missing-attr'; attr: string }
  | { ok: false; kind: 'matcher-error'; text: string; message: string };

const MATCHER = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:(=~|!~|!=|=)\s*"((?:\\[^\r\n]|[^"\\\r\n])*)"\s*)?$/;
const ATTRIBUTE = /^(?:from\.|to\.)?[A-Za-z_][A-Za-z0-9_-]*$/;
const ESCAPES: Record<string, string> = { '\\': '\\', '"': '"', n: '\n', t: '\t' };

function unescapeString(text: string): string | undefined {
  let value = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\\') {
      value += text[i];
      continue;
    }
    const next = text[++i];
    if (!Object.hasOwn(ESCAPES, next)) {
      return undefined;
    }
    value += ESCAPES[next];
  }
  return value;
}

function templateParts(value: string): Part[] | undefined {
  const parts: Part[] = [];
  let offset = 0;
  for (;;) {
    const start = value.indexOf('${', offset);
    if (start < 0) {
      parts.push(value.slice(offset));
      return parts;
    }
    parts.push(value.slice(offset, start));
    const end = value.indexOf('}', start + 2);
    const attr = value.slice(start + 2, end);
    if (end < 0 || !ATTRIBUTE.test(attr) || attr === 'value') {
      return undefined;
    }
    parts.push({ attr });
    offset = end + 1;
  }
}

/** Parse the template before any cell value can change its syntax. */
export function parseMatchBlock(block: MatchV4 | Record<string, string | string[]>, path: string): ParseResult {
  const matchers: ParsedMatcher[] = [];
  const requiredAttrs = new Set<string>();
  const errors: Array<{ path: string; message: string }> = [];
  let readsCell = false;

  for (const [attr, value] of Object.entries(block)) {
    requiredAttrs.add(attr);
    const values = Array.isArray(value) ? value : [value];
    for (const [index, text] of values.entries()) {
      const itemPath = `${path}.${attr}${Array.isArray(value) ? `.${index}` : ''}`;
      const parsed = typeof text === 'string' ? MATCHER.exec(text) : null;
      if (!parsed) {
        errors.push({ path: itemPath, message: 'write a label or a double-quoted label matcher' });
        continue;
      }
      const label = parsed[1];
      if (!parsed[2]) {
        matchers.push({ label, op: '=', parts: [{ attr }] });
        readsCell = true;
        continue;
      }
      const decoded = unescapeString(parsed[3]);
      const parts = decoded === undefined ? undefined : templateParts(decoded);
      if (!parts) {
        errors.push({ path: itemPath, message: 'use PromQL string escapes and cell attribute placeholders only' });
        continue;
      }
      for (const part of parts) {
        if (typeof part !== 'string') {
          requiredAttrs.add(part.attr);
          readsCell = true;
        }
      }
      matchers.push({ label, op: parsed[2] as Operator, parts });
    }
  }
  if (errors.length) {
    return { ok: false, errors };
  }
  if (!readsCell) {
    return { ok: false, errors: [{ path, message: 'match must read a cell attribute' }] };
  }
  return { ok: true, block: { matchers, requiredAttrs: [...requiredAttrs] } };
}

export function createRegexCache(): RegexCache {
  return new Map();
}

function dialectError(form: string): CompiledRegex {
  return { ok: false, message: `not in the PromQL regex dialect: ${form}` };
}

function compileRegex(value: string): CompiledRegex {
  const insensitive = value.startsWith('(?i)');
  const body = insensitive ? value.slice(4) : value;
  let rewritten = '';
  let inClass = false;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '\\') {
      const escaped = body[++i];
      if (escaped === undefined) {
        rewritten += '\\';
        break;
      }
      if (/[AzQECpPuc1-9]/.test(escaped) || (inClass && escaped === 'b') || (escaped === 'k' && body[i + 1] === '<')) {
        return dialectError(`\\${escaped}`);
      }
      // Keep RE2 whitespace and dot semantics: https://github.com/google/re2/wiki/Syntax.
      if (escaped === 's') {
        rewritten += inClass ? '\\t\\n\\f\\r ' : '[\\t\\n\\f\\r ]';
      } else if (escaped === 'S') {
        if (inClass) {
          return dialectError('\\S in a character class');
        }
        rewritten += '[^\\t\\n\\f\\r ]';
      } else {
        const code = escaped.charCodeAt(0);
        const punctuation =
          (code >= 33 && code <= 47) ||
          (code >= 58 && code <= 64) ||
          (code >= 91 && code <= 96) ||
          (code >= 123 && code <= 126);
        if (punctuation && !'^$\\.*+?()[]{}|/'.includes(escaped)) {
          rewritten += `\\x${code.toString(16).padStart(2, '0')}`;
        } else {
          rewritten += `\\${escaped}`;
        }
      }
      if (
        inClass &&
        'sdDwW'.includes(escaped) &&
        body[i + 1] === '-' &&
        body[i + 2] !== ']' &&
        body[i + 2] !== undefined
      ) {
        // RE2 treats a hyphen after a class escape as a literal.
        rewritten += '\\x2d';
        i++;
      }
      continue;
    }
    if (char === '[' && !inClass) {
      if (body[i + 1] === ']' || (body[i + 1] === '^' && body[i + 2] === ']')) {
        return dialectError('[]');
      }
      inClass = true;
    } else if (char === ']') {
      inClass = false;
    }
    if (!inClass && char === '(' && body[i + 1] === '?' && body[i + 2] !== ':') {
      return dialectError(body.slice(i, i + 4));
    }
    rewritten += !inClass && char === '.' ? '[^\\n]' : char;
  }
  try {
    return { ok: true, regex: new RegExp('^(?:' + rewritten + ')$', insensitive ? 'ui' : 'u') };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Resolve one cell with a cache that belongs to the current bind. */
export function resolveBlock(
  block: ParsedBlock,
  attrs: (name: string) => string | undefined,
  cache: RegexCache
): ResolveResult {
  const values = new Map<string, string>();
  for (const attr of block.requiredAttrs) {
    const value = attrs(attr);
    if (value === undefined) {
      return { ok: false, kind: 'missing-attr', attr };
    }
    values.set(attr, value);
  }
  const resolved: ResolvedMatcher[] = [];
  const equality = new Map<string, string>();
  const tests: Array<(labels: Labels) => boolean> = [];
  for (const { label, op, parts } of block.matchers) {
    const isRegex = op === '=~' || op === '!~';
    const value = parts
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        const value = values.get(part.attr)!;
        return isRegex ? value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : value;
      })
      .join('');
    resolved.push({ label, op, value });
    if (isRegex) {
      let compiled = cache.get(value);
      if (!compiled) {
        compiled = compileRegex(value);
        cache.set(value, compiled);
      }
      if (!compiled.ok) {
        return {
          ok: false,
          kind: 'matcher-error',
          text: `${label}${op}${JSON.stringify(value)}`,
          message: compiled.message,
        };
      }
      const regex = compiled.regex;
      tests.push((labels) => regex.test(labelValue(labels, label)) === (op === '=~'));
    } else {
      if (op === '=') {
        equality.set(label, value);
      }
      tests.push((labels) => (labelValue(labels, label) === value) === (op === '='));
    }
  }
  return {
    ok: true,
    test: (labels) => tests.every((test) => test(labels)),
    equality: equality.size ? equality : undefined,
    resolved,
  };
}

function labelValue(labels: Labels, label: string): string {
  return Object.hasOwn(labels, label) ? labels[label] : '';
}
