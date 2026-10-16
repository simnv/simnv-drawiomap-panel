import { describe, expect, it } from 'vitest';
import { decodeDataUri } from './decode';

describe('decodeDataUri', () => {
  it('decodes base64 UTF-8', () => {
    const b64 = Buffer.from('<svg>é → ok</svg>', 'utf8').toString('base64');
    expect(decodeDataUri(`data:image/svg+xml;base64,${b64}`)).toBe('<svg>é → ok</svg>');
  });
  it('decodes percent-encoded data', () => {
    expect(decodeDataUri('data:image/svg+xml,%3Csvg%2F%3E')).toBe('<svg/>');
  });
  it('returns plain text unchanged', () => {
    expect(decodeDataUri('<svg/>')).toBe('<svg/>');
  });
});
