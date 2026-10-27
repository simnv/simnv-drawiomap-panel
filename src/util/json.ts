/**
 * A deep copy with JSON semantics: an `undefined` value and a function go, a `Date` becomes its string. The persisted
 * config depends on this, so do not use `structuredClone` here.
 */
export const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
