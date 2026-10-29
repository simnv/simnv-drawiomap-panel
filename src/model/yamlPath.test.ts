import { describe, expect, it } from 'vitest';
import { parsePath, yamlPath } from './yamlPath';

describe('yamlPath', () => {
  it.each<[Array<string | number>, string]>([
    [['classes', 'lan', 'rows', 2, 'query'], 'classes.lan.rows[2].query'],
    [['classes', 'x', 'match', 'key', 1], 'classes.x.match.key[1]'],
    [['overrides', 'sw.1', 'status'], 'overrides["sw.1"].status'],
    [['overrides', 'pg-node~rtr-a', 'url'], 'overrides.pg-node~rtr-a.url'],
    [['overrides', 'a[0]"b', 'url'], 'overrides["a[0]\\"b"].url'],
    [['overrides', '', 'url'], 'overrides[""].url'],
    [['overrides', '7'], 'overrides.7'],
  ])('writes %j as %s and reads it back', (parts, path) => {
    expect(yamlPath(parts)).toBe(path);
    expect(parsePath(path)).toEqual(parts);
  });

  it('continues a base path', () => {
    expect(yamlPath(['key', 0], 'overrides["a.b"].match')).toBe('overrides["a.b"].match.key[0]');
  });

  it('reads the parts up to the first part that is not in the format', () => {
    expect(parsePath('classes.a..b')).toEqual(['classes', 'a']);
    expect(parsePath('')).toEqual([]);
  });
});
