import type { PathPart } from './yamlPath';

/**
 * A small validator for the config shapes, in place of zod. A check reads one value at one path, writes its issues and
 * gives the parsed value. The messages, the paths and their order are the ones of zod 3, so the reports and the editor
 * markers do not change.
 *
 * Two states as in zod. A wrong type stops the check of the value and gives `INVALID` (zod: "aborted"). A failed rule
 * on a value of the right type adds an issue and keeps the value (zod: "dirty"). A union takes the first option with no
 * issue, else the first option that kept its value, else it gives "Invalid input". A refinement runs on a kept value.
 */

/** One issue: the parts of the YAML path and the message. */
export interface Issue {
  path: PathPart[];
  message: string;
}
export interface Ctx {
  issues: Issue[];
}
/** The result of a value of the wrong type. */
export const INVALID: unique symbol = Symbol('invalid');
export type Check<T> = (data: unknown, path: PathPart[], ctx: Ctx) => T | typeof INVALID;
/** The output type of a check. */
export type Out<C> = C extends Check<infer T> ? T : never;
/** A rule on a value of the right type: the message of the issue, or nothing. */
type Rule<T> = (value: T) => string | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The type name of a value in a message, as zod names it. */
const received = (data: unknown): string =>
  data === null ? 'null' : Array.isArray(data) ? 'array' : Number.isNaN(data) ? 'nan' : typeof data;

const wrongType = (ctx: Ctx, path: PathPart[], expected: string, data: unknown): typeof INVALID => {
  ctx.issues.push({
    path,
    message: data === undefined ? 'Required' : `Expected ${expected}, received ${received(data)}`,
  });
  return INVALID;
};

const applyRules = <T>(value: T, rules: Array<Rule<T>>, path: PathPart[], ctx: Ctx): T => {
  for (const rule of rules) {
    const message = rule(value);
    if (message !== undefined) {
      ctx.issues.push({ path, message });
    }
  }
  return value;
};

export const string =
  (...rules: Array<Rule<string>>): Check<string> =>
  (data, path, ctx) =>
    typeof data === 'string' ? applyRules(data, rules, path, ctx) : wrongType(ctx, path, 'string', data);

export const number =
  (...rules: Array<Rule<number>>): Check<number> =>
  (data, path, ctx) =>
    typeof data === 'number' && !Number.isNaN(data)
      ? applyRules(data, rules, path, ctx)
      : wrongType(ctx, path, 'number', data);

export const regex =
  (re: RegExp, message: string): Rule<string> =>
  (value) =>
    re.test(value) ? undefined : message;
export const notEmpty: Rule<string> = (value) =>
  value.length > 0 ? undefined : 'String must contain at least 1 character(s)';
export const finite: Rule<number> = (value) => (Number.isFinite(value) ? undefined : 'Number must be finite');
export const int: Rule<number> = (value) => (Number.isInteger(value) ? undefined : 'Expected integer, received float');
export const min =
  (low: number): Rule<number> =>
  (value) =>
    value >= low ? undefined : `Number must be greater than or equal to ${low}`;
export const max =
  (high: number): Rule<number> =>
  (value) =>
    value <= high ? undefined : `Number must be less than or equal to ${high}`;

export const literal =
  <T extends string | number>(expected: T): Check<T> =>
  (data, path, ctx) => {
    if (data === expected) {
      return expected;
    }
    ctx.issues.push({ path, message: `Invalid literal value, expected ${JSON.stringify(expected)}` });
    return INVALID;
  };

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(' | ');

export const oneOf =
  <const T extends string>(values: readonly T[]): Check<T> =>
  (data, path, ctx) => {
    if (typeof data !== 'string') {
      return wrongType(ctx, path, quoted(values), data);
    }
    if (!values.includes(data as T)) {
      ctx.issues.push({ path, message: `Invalid enum value. Expected ${quoted(values)}, received '${data}'` });
      return INVALID;
    }
    return data as T;
  };

export const optional =
  <T>(check: Check<T>): Check<T | undefined> =>
  (data, path, ctx) =>
    data === undefined ? undefined : check(data, path, ctx);

export const withDefault =
  <T>(check: Check<T>, value: T): Check<T> =>
  (data, path, ctx) =>
    check(data === undefined ? value : data, path, ctx);

export const unknown: Check<unknown> = (data) => data;

/** A list; `atLeastOne` rejects an empty list. An element of the wrong type makes the list INVALID. */
export const array =
  <T>(item: Check<T>, atLeastOne = false): Check<T[]> =>
  (data, path, ctx) => {
    if (!Array.isArray(data)) {
      return wrongType(ctx, path, 'array', data);
    }
    if (atLeastOne && data.length === 0) {
      ctx.issues.push({ path, message: 'Array must contain at least 1 element(s)' });
    }
    const out: T[] = [];
    let invalid = false;
    data.forEach((element, index) => {
      const value = item(element, [...path, index], ctx);
      if (value === INVALID) {
        invalid = true;
      } else {
        out.push(value);
      }
    });
    return invalid ? INVALID : out;
  };

/** The first option with no issue; else the issues of the first option that kept its value; else "Invalid input". */
export const union =
  <T>(...options: Array<Check<T>>): Check<T> =>
  (data, path, ctx) => {
    let kept: { value: T; issues: Issue[] } | undefined;
    for (const option of options) {
      const child: Ctx = { issues: [] };
      const value = option(data, path, child);
      if (value === INVALID) {
        continue;
      }
      if (child.issues.length === 0) {
        return value;
      }
      kept ??= { value, issues: child.issues };
    }
    if (kept) {
      ctx.issues.push(...kept.issues);
      return kept.value;
    }
    ctx.issues.push({ path, message: 'Invalid input' });
    return INVALID;
  };

/** A rule on the parsed value. It runs on a kept value, with issues too, as a zod refinement does. */
export const refine =
  <T>(check: Check<T>, test: (value: T) => boolean, message: string): Check<T> =>
  (data, path, ctx) => {
    const value = check(data, path, ctx);
    if (value !== INVALID && !test(value)) {
      ctx.issues.push({ path, message });
    }
    return value;
  };

/**
 * A map with checked keys. The issues of a key come before the issues of its value. The output has no `__proto__` key:
 * the key check gives the issue, so no name goes silently.
 */
export const record =
  <T>(key: Check<string>, value: Check<T>): Check<Record<string, T>> =>
  (data, path, ctx) => {
    if (!isRecord(data)) {
      return wrongType(ctx, path, 'object', data);
    }
    const out: Record<string, T> = {};
    let invalid = false;
    for (const name of Object.keys(data)) {
      const at = [...path, name];
      const checkedName = key(name, at, ctx);
      const item = value(data[name], at, ctx);
      if (checkedName === INVALID || item === INVALID) {
        invalid = true;
      } else if (name !== '__proto__') {
        out[name] = item;
      }
    }
    return invalid ? INVALID : out;
  };

type Shape = Record<string, Check<unknown>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends Out<S[K]> ? K : never }[keyof S];
/** The output of a strict object: a key whose check accepts `undefined` is optional. */
export type Infer<S extends Shape> = { [K in Exclude<keyof S, OptionalKeys<S>>]: Out<S[K]> } & {
  [K in OptionalKeys<S>]?: Exclude<Out<S[K]>, undefined>;
};

/**
 * A strict object: the issues of the fields in the order of the shape, then one issue per unknown key, in the order
 * of the input. An absent optional field stays absent in the output.
 */
export const object = <S extends Shape>(shape: S): Check<Infer<S>> => {
  const keys = Object.keys(shape);
  return (data, path, ctx) => {
    if (!isRecord(data)) {
      return wrongType(ctx, path, 'object', data);
    }
    const out: Record<string, unknown> = {};
    let invalid = false;
    for (const key of keys) {
      const value = shape[key](data[key], [...path, key], ctx);
      if (value === INVALID) {
        invalid = true;
      } else if (value !== undefined) {
        out[key] = value;
      }
    }
    for (const key of Object.keys(data)) {
      if (!keys.includes(key)) {
        ctx.issues.push({ path: [...path, key], message: `Unknown key "${key}".` });
      }
    }
    return invalid ? INVALID : (out as Infer<S>);
  };
};

/** An object whose `kind` selects the option. A `kind` that no option has gives one issue at the `kind` key. */
export const discriminated =
  <T extends { kind: string }>(options: Record<string, Check<T>>): Check<T> =>
  (data, path, ctx) => {
    if (!isRecord(data)) {
      return wrongType(ctx, path, 'object', data);
    }
    const kind = data.kind;
    if (typeof kind !== 'string' || !Object.hasOwn(options, kind)) {
      ctx.issues.push({
        path: [...path, 'kind'],
        message: `Invalid discriminator value. Expected ${quoted(Object.keys(options))}`,
      });
      return INVALID;
    }
    return options[kind](data, path, ctx);
  };

/** Run a check from a path prefix: the value, or the issues. */
export function run<T>(check: Check<T>, data: unknown, prefix: PathPart[]): { value: T } | { issues: Issue[] } {
  const ctx: Ctx = { issues: [] };
  const value = check(data, prefix, ctx);
  return value === INVALID || ctx.issues.length > 0 ? { issues: ctx.issues } : { value };
}
