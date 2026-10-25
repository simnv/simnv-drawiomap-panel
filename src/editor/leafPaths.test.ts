import { describe, expect, it } from 'vitest';
import { diffLeaves, getLeaf, leafPaths, setLeaf, unsetPath } from './leafPaths';

describe('leafPaths', () => {
  it('lists scalar leaves with dotted paths', () => {
    expect(leafPaths({ label: 'a', link: { enabled: true, a2b: { binding: undefined } } })).toEqual([
      'label',
      'link.enabled',
      'link.a2b.binding',
    ]);
  });
  it('recurses into nested objects', () => {
    expect(leafPaths({ link: { a2b: { binding: { queryId: 'q', match: { id: 'x' } } } } as never })).toEqual([
      'link.a2b.binding.queryId',
      'link.a2b.binding.match.id',
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

describe('leafPaths with units', () => {
  it('stops at a unit path', () => {
    const display = { status: { kind: 'mapping', default: { state: 'normal' } }, label: 'x' } as never;
    expect(leafPaths(display, ['status'])).toEqual(['status', 'label']);
    expect(leafPaths(display)).toEqual(['status.kind', 'status.default.state', 'label']);
  });
});

describe('setLeaf and getLeaf', () => {
  it('sets one leaf, creates the parents and keeps every other leaf', () => {
    const before = { label: 'a', shape: { text: true, binding: { queryId: 'q' } } } as never;
    const next = setLeaf(before, 'shape.binding.queryId', 'r');
    expect(next).toEqual({ label: 'a', shape: { text: true, binding: { queryId: 'r' } } });
    expect(before).toEqual({ label: 'a', shape: { text: true, binding: { queryId: 'q' } } });
    expect(setLeaf({}, 'link.capacity', 5)).toEqual({ link: { capacity: 5 } });
    expect(getLeaf(next, 'shape.binding.queryId')).toBe('r');
  });
  it('sets an array leaf whole and removes a leaf with undefined', () => {
    const rows = [{ kind: 'metadata', label: 'a', path: 'p' }];
    expect(setLeaf({}, 'hover.rows', rows)).toEqual({ hover: { rows } });
    expect(setLeaf({ label: 'a', url: 'u' }, 'url', undefined)).toEqual({ label: 'a' });
    expect(setLeaf({ shape: { text: true } } as never, 'shape.text', undefined)).toEqual({});
    expect(unsetPath({ label: 'a' }, 'missing')).toEqual({ label: 'a' });
  });
});

describe('diffLeaves', () => {
  it('lists the leaves that differ, with their new value', () => {
    const before = { label: 'a', shape: { text: true } } as never;
    const after = { label: 'b', shape: { text: true }, url: 'u' } as never;
    expect(diffLeaves(before, after)).toEqual([
      { path: 'label', value: 'b' },
      { path: 'url', value: 'u' },
    ]);
  });
  it('reports a leaf that only the old display has with the value undefined', () => {
    expect(diffLeaves({ label: 'a', url: 'u' }, { label: 'a' })).toEqual([{ path: 'url', value: undefined }]);
  });
  it('treats an array and a health rule as one leaf', () => {
    const before = { hover: { enabled: true, rows: [{ kind: 'metadata', label: 'a', path: 'p' }] } } as never;
    const after = { hover: { enabled: true, rows: [{ kind: 'metadata', label: 'b', path: 'p' }] } } as never;
    expect(diffLeaves(before, after).map((op) => op.path)).toEqual(['hover.rows']);
    const status = (reason: string) => ({ status: { kind: 'mapping', default: { state: 'normal', reason } } }) as never;
    expect(diffLeaves(status('a'), status('b')).map((op) => op.path)).toEqual(['status']);
  });
});
