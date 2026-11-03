import { describe, expect, it } from 'vitest';

import {
  array,
  INVALID,
  literal,
  notEmpty,
  number,
  object,
  oneOf,
  optional,
  record,
  refine,
  regex,
  run,
  string,
  union,
  type Ctx,
} from './check';

const letters = string(regex(/^[a-z]+$/, 'letters only'));
const check = <T>(c: Parameters<typeof run<T>>[0], data: unknown) => run(c, data, ['at']);

describe('the states of a check', () => {
  it('a wrong type stops the check and gives INVALID with one issue', () => {
    const ctx: Ctx = { issues: [] };
    expect(letters(5, ['x'], ctx)).toBe(INVALID);
    expect(ctx.issues).toEqual([{ path: ['x'], message: 'Expected string, received number' }]);
    expect(check(letters, undefined)).toEqual({ issues: [{ path: ['at'], message: 'Required' }] });
  });

  it('a failed rule keeps the value and adds an issue; the rules run in order', () => {
    const ctx: Ctx = { issues: [] };
    expect(string(notEmpty, regex(/x/, 'needs x'))('', ['x'], ctx)).toBe('');
    expect(ctx.issues.map((i) => i.message)).toEqual(['String must contain at least 1 character(s)', 'needs x']);
  });

  it('names the type of a value as zod does', () => {
    const at = (data: unknown) => (check(letters, data) as { issues: Array<{ message: string }> }).issues[0].message;
    expect(at(null)).toBe('Expected string, received null');
    expect(at([])).toBe('Expected string, received array');
    expect(at({})).toBe('Expected string, received object');
    expect(at(NaN)).toBe('Expected string, received nan');
    expect(at(true)).toBe('Expected string, received boolean');
    expect(check(number(), NaN)).toEqual({ issues: [{ path: ['at'], message: 'Expected number, received nan' }] });
  });
});

describe('array', () => {
  it('checks each index up to the length: a hole reads as undefined and gives "Required"', () => {
    const c = array(letters);
    expect(check(c, Object.assign(new Array(2), { 0: 'ab' }))).toEqual({
      issues: [{ path: ['at', 1], message: 'Required' }],
    });
    expect(check(c, Object.assign(new Array(2), { 1: 'ab' }))).toEqual({
      issues: [{ path: ['at', 0], message: 'Required' }],
    });
    expect(check(c, new Array(1))).toEqual({ issues: [{ path: ['at', 0], message: 'Required' }] });
    expect(check(c, ['ab', 'cd'])).toEqual({ value: ['ab', 'cd'] });
  });
});

describe('union', () => {
  const c = union<string | string[]>(letters, array(letters, true));

  it('takes the first option with no issue', () => {
    expect(check(c, 'ab')).toEqual({ value: 'ab' });
    expect(check(c, ['ab'])).toEqual({ value: ['ab'] });
  });

  it('gives the issues of the first option that kept its value', () => {
    expect(check(c, 'A')).toEqual({ issues: [{ path: ['at'], message: 'letters only' }] });
    expect(check(c, ['ab', 'A'])).toEqual({ issues: [{ path: ['at', 1], message: 'letters only' }] });
    expect(check(c, [])).toEqual({ issues: [{ path: ['at'], message: 'Array must contain at least 1 element(s)' }] });
  });

  it('gives "Invalid input" when no option keeps its value, and drops the issues of the options', () => {
    expect(check(c, 5)).toEqual({ issues: [{ path: ['at'], message: 'Invalid input' }] });
    expect(check(c, ['A', 5])).toEqual({ issues: [{ path: ['at'], message: 'Invalid input' }] });
  });
});

describe('refine', () => {
  const c = refine(record(letters, letters), (m) => Object.keys(m).length > 0, 'empty');

  it('runs on a kept value with issues, not on an INVALID value', () => {
    expect(check(c, {})).toEqual({ issues: [{ path: ['at'], message: 'empty' }] });
    expect(check(c, { A: 'b' })).toEqual({ issues: [{ path: ['at', 'A'], message: 'letters only' }] });
    expect(check(c, { a: 5 })).toEqual({
      issues: [{ path: ['at', 'a'], message: 'Expected string, received number' }],
    });
    expect(check(c, 'x')).toEqual({ issues: [{ path: ['at'], message: 'Expected object, received string' }] });
  });
});

describe('record', () => {
  it('gives the issues of a key before the issues of its value', () => {
    expect(check(record(letters, letters), { A: 'B' })).toEqual({
      issues: [
        { path: ['at', 'A'], message: 'letters only' },
        { path: ['at', 'A'], message: 'letters only' },
      ],
    });
  });

  it('drops a key __proto__ from the output and makes a record with a plain prototype', () => {
    const parsed = check(record(string(), string()), JSON.parse('{"__proto__": "x", "a": "b"}'));
    expect(parsed).toEqual({ value: { a: 'b' } });
    expect(Object.getPrototypeOf((parsed as { value: object }).value)).toBe(Object.prototype);
  });
});

describe('object', () => {
  const c = object({ kind: literal('k'), name: optional(letters), size: optional(number()) });

  it('gives the field issues in the order of the shape, then one issue per unknown key in the input order', () => {
    expect(check(c, { zeta: 1, size: 'big', alpha: 2, name: 5 })).toEqual({
      issues: [
        { path: ['at', 'kind'], message: 'Invalid literal value, expected "k"' },
        { path: ['at', 'name'], message: 'Expected string, received number' },
        { path: ['at', 'size'], message: 'Expected number, received string' },
        { path: ['at', 'zeta'], message: 'Unknown key "zeta".' },
        { path: ['at', 'alpha'], message: 'Unknown key "alpha".' },
      ],
    });
  });

  it('keeps an absent optional field absent', () => {
    expect(check(c, { kind: 'k' })).toEqual({ value: { kind: 'k' } });
    expect((check(c, { kind: 'k' }) as { value: object }).value).not.toHaveProperty('name');
  });

  it('is INVALID when a field has the wrong type, so a union does not keep it', () => {
    const u = union<string | { kind: 'k'; name?: string; size?: number }>(string(), c);
    expect(check(u, { kind: 'k', name: 5 })).toEqual({ issues: [{ path: ['at'], message: 'Invalid input' }] });
    expect(check(u, { kind: 'k', name: 'A' })).toEqual({ issues: [{ path: ['at', 'name'], message: 'letters only' }] });
  });
});

describe('oneOf', () => {
  const c = oneOf(['a', 'b']);

  it('gives the zod messages for a wrong type and a wrong value', () => {
    expect(check(c, 'a')).toEqual({ value: 'a' });
    expect(check(c, 1)).toEqual({ issues: [{ path: ['at'], message: "Expected 'a' | 'b', received number" }] });
    expect(check(c, 'c')).toEqual({
      issues: [{ path: ['at'], message: "Invalid enum value. Expected 'a' | 'b', received 'c'" }],
    });
  });
});
