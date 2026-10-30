import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAlias, isCollection, isMap, visit } from 'yaml';

import { boilerPilot, netL2Pilot } from '../fixtures/pilots-v4';
import { localImports, SRC } from '../importGraph';
import { readYaml, writeYaml } from './yamlConfig';

describe('the YAML config writer', () => {
  it('writes arrow after linkLabel and before unknown fields in classes and overrides', () => {
    const text = writeYaml({
      version: 4,
      classes: { link: { future: true, arrow: 'triangle', linkLabel: 'percent' } },
      overrides: { edge: { future: true, arrow: 'none', linkLabel: 'none' } },
    });
    expect(text).toBe(
      'version: 4\nclasses:\n  link:\n    linkLabel: percent\n    arrow: triangle\n    future: true\n' +
        'overrides:\n  edge:\n    linkLabel: none\n    arrow: none\n    future: true\n'
    );
    const read = readYaml(text);
    expect(read.ok && read.value).toEqual({
      version: 4,
      classes: { link: { linkLabel: 'percent', arrow: 'triangle', future: true } },
      overrides: { edge: { linkLabel: 'none', arrow: 'none', future: true } },
    });
  });

  it.each([
    ['demo-network', netL2Pilot],
    ['demo-enclosure', boilerPilot],
  ])('round trips the %s pilot with stable output', (_name, pilot) => {
    const cfg = pilot();
    const before = structuredClone(cfg);
    const text = writeYaml(cfg);
    const result = readYaml(text);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.errors));
    }
    expect(result.value).toEqual(cfg);
    expect(writeYaml(result.value)).toBe(text);
    expect(cfg).toEqual(before);
  });

  it('uses schema order for fields and stored order for names, ids, match keys and rows', () => {
    const cfg = {
      overrides: { z: { url: '/d/z', status: 'up' }, a: { missing: 'down', status: 'up' } },
      classes: {
        z: {
          linkLabel: 'percent',
          capacity: { b2a: 'rx_speed', a2b: 'tx_speed' },
          down: 'rx',
          up: 'tx',
          urlTitle: 'Open',
          url: '/d/z',
          freshness: '5m',
          chart: {
            max: 100,
            min: 0,
            decimals: 1,
            unit: 'percent',
            label: 'CPU',
            match: { key: 'job' },
            query: 'cpu',
            kind: 'history',
          },
          rows: [
            { url: '/d/z', label: 'Open', kind: 'drilldown' },
            {
              decimals: 1,
              unit: 'bps',
              label: 'Traffic',
              reduce: 'sum',
              match: { key: 'job' },
              down: 'rx',
              up: 'tx',
              kind: 'updown',
            },
          ],
          text: {
            decimals: 0,
            unit: 'celsius',
            label: 'Temperature',
            reduce: 'max',
            match: { key: 'job' },
            query: 'temp',
          },
          missing: 'down',
          status: 'up',
          match: { port: 'ifName', key: 'instance' },
          extends: 'a',
        },
        a: {},
        status: { url: '/d/status' },
      },
      freshness: '3x',
      version: 4,
    };
    const result = readYaml(writeYaml(cfg));
    expect(result.ok).toBe(true);
    const keys = (path: string[]) => {
      const node = result.doc.getIn(path, true);
      expect(isMap(node)).toBe(true);
      if (!isMap(node)) {
        throw new Error('Expected a map.');
      }
      return node.items.map((pair) => String(pair.key));
    };
    expect(keys([])).toEqual(['version', 'freshness', 'classes', 'overrides']);
    expect(keys(['classes'])).toEqual(['z', 'a', 'status']);
    expect(keys(['overrides'])).toEqual(['z', 'a']);
    expect(keys(['classes', 'z'])).toEqual([
      'extends',
      'match',
      'status',
      'missing',
      'text',
      'rows',
      'chart',
      'freshness',
      'url',
      'urlTitle',
      'up',
      'down',
      'capacity',
      'linkLabel',
    ]);
    expect(keys(['classes', 'z', 'match'])).toEqual(['port', 'key']);
    expect(keys(['classes', 'z', 'text'])).toEqual(['query', 'match', 'reduce', 'label', 'unit', 'decimals']);
    expect(keys(['classes', 'z', 'chart'])).toEqual([
      'kind',
      'query',
      'match',
      'label',
      'unit',
      'decimals',
      'min',
      'max',
    ]);
    expect(keys(['classes', 'z', 'capacity'])).toEqual(['a2b', 'b2a']);
    expect(keys(['overrides', 'z'])).toEqual(['status', 'url']);
    expect(keys(['classes', 'z', 'rows', '0'])).toEqual(['kind', 'label', 'url']);
    expect(keys(['classes', 'z', 'rows', '1'])).toEqual([
      'kind',
      'up',
      'down',
      'match',
      'reduce',
      'label',
      'unit',
      'decimals',
    ]);
    if (result.ok) {
      expect(result.value).toEqual(cfg);
    }
  });

  it('writes every match block and matcher list in block style', () => {
    const match = { key: ['instance=~"${key}:.*"', 'job=~"node-[1-6]"'] };
    const cfg = {
      version: 4,
      classes: {
        host: {
          match,
          text: { query: 'temp', match },
          rows: [{ kind: 'history', query: 'cpu', match }],
          chart: { kind: 'value', query: 'cpu', match },
        },
      },
      overrides: { a: { match } },
    };
    const result = readYaml(writeYaml(cfg));
    expect(result.ok).toBe(true);
    let count = 0;
    visit(result.doc, {
      Pair(_key, pair) {
        if (String(pair.key) === 'match') {
          count++;
          if (!isMap(pair.value)) {
            throw new Error('Expected a match map.');
          }
          visit(pair.value, {
            Collection(_key, node) {
              expect(node.flow).not.toBe(true);
            },
          });
        }
      },
    });
    expect(count).toBe(5);
    if (result.ok) {
      expect(result.value).toEqual(cfg);
    }
  });

  it('writes no anchor or alias for shared objects', () => {
    const shared = { match: { key: 'job' } };
    const cfg = { version: 4, classes: { a: shared, b: shared } };
    const result = readYaml(writeYaml(cfg));
    expect(result.ok).toBe(true);
    visit(result.doc, (_key, node) => {
      expect(isAlias(node)).toBe(false);
      if (isCollection(node)) {
        expect(node.anchor).toBeUndefined();
      }
    });
    if (result.ok) {
      expect(result.value).toEqual(cfg);
    }
  });

  it('keeps unknown fields for schema validation', () => {
    const cfg = { version: 4, classes: { a: { unknown: 'yes' } }, extra: 'no' };
    const result = readYaml(writeYaml(cfg));
    expect(result.ok && result.value).toEqual(cfg);
  });
});

describe('the YAML config reader', () => {
  it.each(['.inf', '-.inf', '.NaN', '1e999', '!!float .inf'])(
    'rejects the non-finite value %s before it can become JSON null',
    (value) => {
      const result = readYaml(
        `version: 4\nclasses:\n  demo:\n    rows:\n      - kind: value\n        query: A\n        decimals: ${value}\n`
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContainEqual({ line: 7, message: expect.stringMatching(/JSON/i) });
        expect(result.doc.getIn(['classes', 'demo', 'rows', 0, 'decimals'], true)).toBeDefined();
      }
    }
  );

  it.each([
    ['set', 'version: 4\nclasses:\n  demo: !!set {a: null}\n', 3],
    ['ordered map', 'version: 4\nclasses:\n  demo: !!omap [a: 1]\n', 3],
    ['binary', 'version: 4\nclasses:\n  demo: !!binary SGVsbG8=\n', 3],
    ['timestamp', 'version: 4\nclasses:\n  demo: !!timestamp 2026-10-29\n', 3],
    ['YAML 1.1 timestamp', '%YAML 1.1\n---\nversion: 4\nclasses:\n  demo: 2026-10-29\n', 5],
  ])('rejects a non-JSON %s and keeps its source document', (_name, text, line) => {
    const result = readYaml(text);
    expect(result.ok).toBe(false);
    expect(result.doc.contents).not.toBeNull();
    if (!result.ok) {
      expect(result.errors).toContainEqual({ line, message: expect.stringMatching(/JSON/i) });
    }
  });

  it('preserves JSON values, quoted YAML special values and standard scalar tags', () => {
    const result = readYaml(
      'finite: [0, -3, 1.25, 1e3]\nquoted: [".inf", ".NaN", "2026-10-29"]\n' +
        'tagged: [!!str .inf, !!int 42, !!float 1.5, !!bool true, !!null null]\nempty: null\n'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        finite: [0, -3, 1.25, 1000],
        quoted: ['.inf', '.NaN', '2026-10-29'],
        tagged: ['.inf', 42, 1.5, true, null],
        empty: null,
      });
      expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value);
    }
  });

  it.each([
    ['duplicate key', 'version: 4\nclasses: {}\nversion: 4\n', 3, /unique/i],
    ['nested duplicate key', 'classes:\n  node:\n    status: up\n    status: down\n', 4, /unique/i],
    ['scalar anchor', 'version: 4\nstatus: &state up\n', 2, /anchor/i],
    ['block anchor', 'version: 4\nclasses: &nodes\n  node: {}\n', 2, /anchor/i],
    ['root anchor', '&root\nversion: 4\n', 1, /anchor/i],
    ['alias', 'version: 4\nclasses:\n  node: *missing\n', 3, /alias/i],
    ['alias key', 'version: 4\n*missing : {}\n', 2, /alias/i],
    ['syntax error', 'version: 4\nclasses: [\n', 3, /.+/],
  ])('returns the line of a %s and keeps the partial document', (_name, text, line, message) => {
    const result = readYaml(text);
    expect(result.ok).toBe(false);
    expect(result.doc).toBeDefined();
    expect(result.doc.contents).not.toBeNull();
    if (result.ok) {
      throw new Error('Expected a YAML error.');
    }
    expect(result.errors).toContainEqual({ line, message: expect.stringMatching(message) });
  });

  it('reports both the anchor and alias without expansion', () => {
    const result = readYaml('a: &a [*a]\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { line: 1, message: expect.stringMatching(/anchor/i) },
        { line: 1, message: expect.stringMatching(/alias/i) },
      ]);
    }
  });

  it('does not treat comments or scalar text as anchors or aliases', () => {
    const result = readYaml('# &root *root\nlabel: "&root *root"\nnote: |\n  &root *root\n');
    expect(result.ok && result.value).toEqual({ label: '&root *root', note: '&root *root\n' });
  });

  it('keeps schema validation separate and loses comments on write', () => {
    const result = readYaml('# comment\nversion: 3\nclasses: {}\n');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ version: 3, classes: {} });
      expect(writeYaml(result.value)).not.toContain('# comment');
    }
  });
});

it('keeps the YAML config module outside the static view imports', () => {
  const seen = new Set<string>();
  const queue = [join(SRC, 'module.ts')];
  for (let file = queue.shift(); file; file = queue.shift()) {
    if (!seen.has(file)) {
      seen.add(file);
      queue.push(...localImports(file, { types: false, dynamic: false }));
    }
  }
  expect(seen.has(join(SRC, 'options/yamlConfig.ts'))).toBe(false);
});
