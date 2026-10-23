import { describe, expect, it } from 'vitest';
import { leafPaths } from './leafPaths';

describe('leafPaths', () => {
  it('lists scalar leaves with dotted paths', () => {
    expect(leafPaths({ label: 'a', link: { enabled: true, a2bBinding: undefined } })).toEqual([
      'label',
      'link.enabled',
      'link.a2bBinding',
    ]);
  });
  it('recurses into nested objects', () => {
    expect(leafPaths({ link: { a2bBinding: { queryId: 'q', match: { id: 'x' } } } as never })).toEqual([
      'link.a2bBinding.queryId',
      'link.a2bBinding.match.id',
    ]);
  });
  it('treats an array as one leaf at the array path', () => {
    expect(leafPaths({ hover: { enabled: true, rows: [{ kind: 'metadata', label: 'a', path: 'p' }] } })).toEqual([
      'hover.enabled',
      'hover.rows',
    ]);
  });
  it('treats an empty object as a leaf and an empty partial as no path', () => {
    expect(leafPaths({})).toEqual([]);
    expect(leafPaths({ shape: {} })).toEqual(['shape']);
  });
});
