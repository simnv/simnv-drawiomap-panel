import { describe, expect, it } from 'vitest';
import { isWritableCellAttr } from './cellAttrNames';

describe('isWritableCellAttr', () => {
  it.each(['\u212A', '\u212Aey', 'a\u212A', '\u0130', '\u0130d', 'a\u0130'])(
    'refuses the non-ASCII name %j before case folding',
    (name) => {
      expect(isWritableCellAttr(name)).toBe(false);
    }
  );

  it('keeps uppercase ASCII writable', () => {
    expect(isWritableCellAttr('Key')).toBe(true);
  });
});
