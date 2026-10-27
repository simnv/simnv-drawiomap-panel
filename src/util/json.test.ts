import { describe, expect, it } from 'vitest';
import { jsonCopy } from './json';

describe('jsonCopy', () => {
  it('gives a deep copy that shares no object with the input', () => {
    const value = { a: { b: [1, { c: 2 }] } };
    const copy = jsonCopy(value);
    expect(copy).toEqual(value);
    expect(copy.a).not.toBe(value.a);
    expect(copy.a.b[1]).not.toBe(value.a.b[1]);
  });
  it('keeps JSON semantics: an undefined key and a function go, a Date becomes its string', () => {
    const value = { gone: undefined, fn: () => 1, at: new Date(0), list: [undefined] };
    expect(jsonCopy(value)).toEqual({ at: '1970-01-01T00:00:00.000Z', list: [null] });
    expect('gone' in jsonCopy(value)).toBe(false);
  });
});
