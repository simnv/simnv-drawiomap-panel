import type { monacoTypes } from '@grafana/ui';
import { describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';

import { classSchema, overrideSchema } from '../../model/v4';
import { itemsAt, registerCompletion, type CompletionSource } from './completion';

const BASE = `version: 4
classes:
  device:
    match:
      instance: key
    status: up
    rows:
      - kind: value
        query: cpu
  host:
    extends: device
    text:
      query: load
  link:
    match:
      instance: key
    up: rx
    down: tx
overrides:
  n-sw1:
    status: up
`;

const CELLS: CompletionSource['cells'] = [
  { id: 'n-host1', attrs: { bind: 'host', key: 'host1', role: 'server' } },
  { id: 'n-dev1', attrs: { bind: 'device', key: 'dev1', port: 'p1' } },
  { id: 'n-sw1', attrs: { bind: 'device', key: 'sw1', site: 'demo-a' } },
  { id: 'e-1', attrs: { bind: 'link', key: 'e1', at: 'target' } },
];

const SERIES: Record<string, Array<{ labels: Record<string, string> }>> = {
  up: [{ labels: { instance: 'host1', job: 'node' } }, { labels: { instance: 'dev1', job: 'a"b\\c' } }],
  cpu: [{ labels: { instance: 'host1', cpu: '0' } }],
  load: [{ labels: { instance: 'host1', mode: 'short' } }],
  rx: [{ labels: { ifname: 'eth0' } }],
  tx: [{ labels: { ifname: 'eth1' } }],
  'x,y': [],
};

function sourceFor(text: string, extra: Partial<CompletionSource> = {}): CompletionSource {
  return {
    pathAt: () => null,
    draft: parseDocument(text).toJS(),
    refIds: Object.keys(SERIES),
    cells: CELLS,
    series: (refId) => SERIES[refId] ?? [],
    ...extra,
  };
}

/** The text without the `|` cursor mark and the offset of the mark. */
function mark(marked: string): { text: string; offset: number } {
  const offset = marked.indexOf('|');
  return { text: marked.slice(0, offset) + marked.slice(offset + 1), offset };
}

function complete(marked: string, path: string, extra: Partial<CompletionSource> = {}) {
  const { text, offset } = mark(marked);
  return itemsAt(path, text, offset, sourceFor(text, extra));
}

const labels = (items: ReturnType<typeof itemsAt>) => items.map((item) => item.label);
const keysOf = (shape: object) => Object.keys(shape);

describe('itemsAt: schema keys', () => {
  it('gives the keys of a class on a blank line in the class', () => {
    const items = complete(`${BASE.split('  link:')[0]}    |\n`, 'classes.host.text');
    expect(labels(items)).toEqual(keysOf(classSchema.shape));
    expect(items[0].range).toEqual({ startColumn: 5, endColumn: 5 });
    expect(items[0].insertText).toBe('extends: ');
  });

  it('covers the partial word under the cursor', () => {
    const items = complete('classes:\n  host:\n    sta|\n', 'classes.host.sta');
    expect(labels(items)).toContain('status');
    const status = items.find((item) => item.label === 'status');
    expect(status?.range).toEqual({ startColumn: 5, endColumn: 8 });
    expect(status?.insertText).toBe('status: ');
  });

  it('covers the whole word around the cursor and adds no second colon', () => {
    const items = complete('classes:\n  host:\n    sta|tus: up\n', 'classes.host.status');
    const status = items.find((item) => item.label === 'status');
    expect(status?.range).toEqual({ startColumn: 5, endColumn: 11 });
    expect(status?.insertText).toBe('status');
  });

  it('gives the keys of an override, with no extends', () => {
    const items = complete('overrides:\n  n-sw1:\n    status: up\n    |\n', 'overrides.n-sw1.status');
    expect(labels(items)).toEqual(keysOf(overrideSchema.shape));
    expect(labels(items)).not.toContain('extends');
  });

  it('gives the keys of the row kind in a row', () => {
    const text = 'classes:\n  device:\n    rows:\n      - kind: value\n        query: cpu\n        |\n';
    const items = complete(text, 'classes.device.rows[0].query');
    expect(labels(items)).toEqual(['kind', 'query', 'match', 'reduce', 'label', 'unit', 'decimals']);
  });

  it('gives the keys of all row kinds on a new list item', () => {
    const text = 'classes:\n  device:\n    rows:\n      - kind: value\n        query: cpu\n      - |\n';
    const items = complete(text, 'classes.device.rows[0].query');
    expect(labels(items)).toEqual(
      expect.arrayContaining(['kind', 'query', 'up', 'down', 'min', 'max', 'text', 'url', 'reduce'])
    );
    expect(items[0].range).toEqual({ startColumn: 9, endColumn: 9 });
  });

  it('reads a list at the indent of its key (compact form)', () => {
    const text = 'classes:\n  device:\n    rows:\n    - kind: history\n      |\n';
    const items = complete(text, 'classes.device.rows[0].kind');
    expect(labels(items)).toEqual(['kind', 'query', 'match', 'label', 'unit', 'decimals', 'min', 'max']);
  });

  it('gives the keys of text and of chart', () => {
    expect(labels(complete('classes:\n  host:\n    text:\n      |\n', 'classes.host.text'))).toEqual([
      'query',
      'match',
      'reduce',
      'label',
      'unit',
      'decimals',
    ]);
    const chart = labels(complete('classes:\n  host:\n    chart:\n      |\n', 'classes.host.chart'));
    expect(chart).toEqual(expect.arrayContaining(['kind', 'query', 'up', 'down', 'min', 'max', 'reduce']));
  });

  it('gives the keys in a flow mapping', () => {
    const items = complete('classes:\n  host: {status: up, |}\n', 'classes.host');
    expect(labels(items)).toEqual(keysOf(classSchema.shape));
  });

  it('gives nothing in a comment or at an unknown place', () => {
    expect(complete('classes:\n  host:\n    # sta|\n', 'classes.host')).toEqual([]);
    expect(complete('version: |\n', 'version')).toEqual([]);
  });
});

describe('itemsAt: class names and refIds', () => {
  it('gives the class names after extends, but not the class itself', () => {
    const items = complete(`${BASE}`.replace('extends: device', 'extends: |'), 'classes.host.extends');
    expect(labels(items)).toEqual(['device', 'link']);
  });

  it.each([
    ['status', 'classes:\n  host:\n    status: |\n', 'classes.host.status'],
    [
      'row query',
      'classes:\n  host:\n    rows:\n      - kind: value\n        query: |\n',
      'classes.host.rows[0].query',
    ],
    ['row up', 'classes:\n  host:\n    rows:\n      - kind: updown\n        up: |\n', 'classes.host.rows[0].up'],
    ['text.query', 'classes:\n  host:\n    text:\n      query: |\n', 'classes.host.text.query'],
    ['chart query', 'classes:\n  host:\n    chart:\n      query: |\n', 'classes.host.chart.query'],
    ['up', 'classes:\n  link:\n    up: |\n', 'classes.link.up'],
    ['down', 'classes:\n  link:\n    down: |\n', 'classes.link.down'],
    ['capacity', 'classes:\n  link:\n    capacity: |\n', 'classes.link.capacity'],
    ['capacity.a2b', 'classes:\n  link:\n    capacity:\n      a2b: |\n', 'classes.link.capacity.a2b'],
    ['an override status', 'overrides:\n  n-sw1:\n    status: |\n', 'overrides.n-sw1.status'],
  ])('gives the refIds of the panel targets for %s', (_name, text, path) => {
    expect(labels(complete(text, path))).toEqual(Object.keys(SERIES));
  });

  it('covers the value under the cursor', () => {
    const items = complete('classes:\n  host:\n    status: u|p  # comment\n', 'classes.host.status');
    expect(items[0].range).toEqual({ startColumn: 13, endColumn: 15 });
  });

  it('puts a refId with a flow indicator in single quotes in a flow mapping only', () => {
    const flow = complete('classes:\n  host: {status: |}\n', 'classes.host.status');
    expect(flow.find((item) => item.label === 'x,y')?.insertText).toBe("'x,y'");
    expect(flow.find((item) => item.label === 'up')?.insertText).toBe('up');
    const block = complete('classes:\n  host:\n    status: |\n', 'classes.host.status');
    expect(block.find((item) => item.label === 'x,y')?.insertText).toBe('x,y');
  });

  it('escapes a refId inside a quoted value', () => {
    const items = complete("classes:\n  host:\n    status: 'u|'\n", 'classes.host.status', {
      refIds: ["it's"],
    });
    expect(items).toEqual([
      expect.objectContaining({ insertText: "it''s", range: { startColumn: 14, endColumn: 15 } }),
    ]);
  });

  it.each([
    ['a malformed 32-bit escape', '"\\UFFFFFFFF|"'],
    ['a surrogate escape', '"\\ud800|"'],
    ['an escape with no hex digit', '"\\u12|"'],
  ])('does not throw on %s in a double-quoted value', (_name, value) => {
    const items = complete(`classes:\n  host:\n    status: ${value}\n`, 'classes.host.status', { refIds: ['up'] });
    expect(items).toHaveLength(1);
    expect(Number.isFinite(items[0].range.startColumn)).toBe(true);
    expect(Number.isFinite(items[0].range.endColumn)).toBe(true);
  });

  it('maps every code unit of an astral escape to the source offset', () => {
    const items = complete('classes:\n  host:\n    status: "a\\U0001F600|b"\n', 'classes.host.status', {
      refIds: ['up'],
    });
    expect(items).toEqual([expect.objectContaining({ insertText: 'up', range: { startColumn: 14, endColumn: 26 } })]);
  });

  it.each([
    ['double', '"', '"u|', 'up"'],
    ['single', "'", "'u|", "up'"],
  ])('adds the missing closing %s quote to an open quoted value', (_name, _quote, value, insertText) => {
    const items = complete(`classes:\n  host:\n    status: ${value}\n`, 'classes.host.status', { refIds: ['up'] });
    expect(items).toEqual([expect.objectContaining({ insertText, range: { startColumn: 14, endColumn: 15 } })]);
  });

  it.each(['"u|"', "'u|'", 'u|'])('adds no quote when the value %s is closed or plain', (value) => {
    const items = complete(`classes:\n  host:\n    status: ${value}\n`, 'classes.host.status', { refIds: ['up'] });
    expect(items[0].insertText).toBe('up');
  });
});

describe('itemsAt: matchers', () => {
  it('gives the attribute names of the cells of the class and its child classes on the left side', () => {
    const items = complete(
      'classes:\n  device:\n    match:\n      |\n  host:\n    extends: device\n',
      'classes.device.match'
    );
    expect(labels(items)).toEqual(['bind', 'key', 'port', 'role', 'site']);
    expect(items[0].insertText).toBe('bind: ');
  });

  it('gives the attribute names of the one cell of an override', () => {
    const items = complete('overrides:\n  n-sw1:\n    match:\n      |\n', 'overrides.n-sw1.match');
    expect(labels(items)).toEqual(['bind', 'key', 'site']);
  });

  it('gives the label names of the series of the uses of the class on the right side', () => {
    const text = BASE.replace('instance: key', 'instance: |');
    expect(labels(complete(text, 'classes.device.match.instance'))).toEqual(['cpu', 'instance', 'job', 'mode']);
  });

  it('gives the label names of the refId of the row for a row match', () => {
    const text =
      'classes:\n  device:\n    rows:\n      - kind: value\n        query: cpu\n        match:\n          key: |\n';
    expect(labels(complete(text, 'classes.device.rows[0].match.key'))).toEqual(['cpu', 'instance']);
  });

  it('gives the label names in a list of matchers and covers the label word', () => {
    const text = 'classes:\n  link:\n    up: rx\n    match:\n      key:\n        - ifn|ame="eth0"\n';
    const items = complete(text, 'classes.link.match.key[0]');
    expect(labels(items)).toEqual(['ifname']);
    expect(items[0].range).toEqual({ startColumn: 11, endColumn: 17 });
  });

  it('gives the label values after =" escaped for a PromQL string', () => {
    const text = 'classes:\n  device:\n    status: up\n    match:\n      key: job="|"\n';
    const items = complete(text, 'classes.device.match.key');
    expect(labels(items)).toEqual(['a"b\\c', 'node']);
    expect(items[0].insertText).toBe('a\\"b\\\\c');
    expect(items[0].range).toEqual({ startColumn: 17, endColumn: 17 });
  });

  it('gives the label values after !=" and closes an open string', () => {
    const text = 'classes:\n  device:\n    status: up\n    match:\n      key: job!="no|\n';
    const items = complete(text, 'classes.device.match.key');
    expect(items.find((item) => item.label === 'node')).toMatchObject({
      insertText: 'node"',
      range: { startColumn: 18, endColumn: 20 },
    });
  });

  it('gives no label values after a regex operator', () => {
    const text = 'classes:\n  device:\n    status: up\n    match:\n      key: job=~"|"\n';
    expect(complete(text, 'classes.device.match.key')).toEqual([]);
  });

  it('puts the whole matcher in single quotes when a value with a comma goes into a flow mapping', () => {
    const text = 'classes:\n  device:\n    status: up\n    match: {key: job="|"}\n';
    const items = complete(text, 'classes.device.match.key', {
      series: () => [{ labels: { job: 'a,b' } }],
    });
    expect(items).toEqual([
      expect.objectContaining({
        label: 'a,b',
        insertText: `'job="a,b"'`,
        range: { startColumn: 18, endColumn: 24 },
      }),
    ]);
  });

  it("doubles a ' of a value in a single-quoted matcher", () => {
    const text = 'classes:\n  device:\n    status: up\n    match: {key: \'job="|"\'}\n';
    const items = complete(text, 'classes.device.match.key', {
      series: () => [{ labels: { job: "it's" } }],
    });
    expect(items[0]).toMatchObject({ insertText: "it''s", range: { startColumn: 24, endColumn: 24 } });
  });
});

describe('itemsAt: more quoting and places', () => {
  it('escapes a value twice in a double-quoted matcher: for PromQL, then for YAML', () => {
    const text = 'classes:\n  device:\n    status: up\n    match:\n      key: "job=\\"|\\""\n';
    const items = complete(text, 'classes.device.match.key', {
      series: () => [{ labels: { job: 'x"y' } }],
    });
    expect(items[0].insertText).toBe('x\\\\\\"y');
    expect(parseDocument(`k: "job=\\"${items[0].insertText}\\""`).toJS()).toEqual({ k: 'job="x\\"y"' });
  });

  it('adds a space after a colon with no space', () => {
    const items = complete('classes:\n  host:\n    status:|\n', 'classes.host.status', { refIds: ['A'] });
    expect(items[0].insertText).toBe(' A');
  });

  it('reads the row of a list marker line for a row match', () => {
    const text = 'classes:\n  device:\n    rows:\n      - match: {key: |}\n        kind: value\n        query: cpu\n';
    expect(labels(complete(text, 'classes.device.rows[0].match.key'))).toEqual(['cpu', 'instance']);
  });

  it('quotes a refId that YAML reads as a number or a boolean', () => {
    const items = complete('classes:\n  host:\n    status: |\n', 'classes.host.status', { refIds: ['1', 'true'] });
    expect(items.map((item) => item.insertText)).toEqual(["'1'", "'true'"]);
  });
});

describe('itemsAt: templates', () => {
  it('gives the attribute names, then from. and to., inside ${', () => {
    const items = complete('classes:\n  link:\n    url: /d/x?var-key=${k|}\n', 'classes.link.url');
    expect(labels(items)).toEqual(['at', 'bind', 'key', 'from.', 'to.']);
    expect(items[0].range).toEqual({ startColumn: 25, endColumn: 26 });
  });

  it('works inside a matcher value', () => {
    const text = 'classes:\n  link:\n    match:\n      key: instance=~"${|}:.*"\n';
    expect(labels(complete(text, 'classes.link.match.key'))).toEqual(['at', 'bind', 'key', 'from.', 'to.']);
  });

  it('gives nothing after a closed placeholder', () => {
    expect(complete('classes:\n  link:\n    url: ${key}/x|\n', 'classes.link.url')).toEqual([]);
  });
});

describe('registerCompletion', () => {
  type Provider = monacoTypes.languages.CompletionItemProvider;

  function fakeMonaco() {
    const providers: Provider[] = [];
    const monaco = {
      languages: {
        CompletionItemKind: { Property: 9, Value: 13, Field: 3, Class: 5, Variable: 4, Constant: 14 },
        registerCompletionItemProvider: vi.fn((_language: string, provider: Provider) => {
          providers.push(provider);
          return { dispose: () => providers.splice(providers.indexOf(provider), 1) };
        }),
      },
    };
    return { monaco: monaco as unknown as typeof monacoTypes, providers };
  }

  function modelOf(id: string, marked: string) {
    const { text, offset } = mark(marked);
    const before = text.slice(0, offset).split('\n');
    const position = { lineNumber: before.length, column: before[before.length - 1].length + 1 };
    const model = { id, getValue: () => text, getOffsetAt: () => offset };
    return { model: model as unknown as monacoTypes.editor.ITextModel, position: position as monacoTypes.Position };
  }

  async function ask(provider: Provider, id: string, marked: string) {
    const { model, position } = modelOf(id, marked);
    const result = await provider.provideCompletionItems(
      model,
      position,
      {} as monacoTypes.languages.CompletionContext,
      {} as monacoTypes.CancellationToken
    );
    return result?.suggestions ?? [];
  }

  it('registers one yaml provider that answers only for its model', async () => {
    const { monaco, providers } = fakeMonaco();
    const text = 'classes:\n  host:\n    status: |\n';
    const pathAt = vi.fn(() => 'classes.host.status');
    registerCompletion(monaco, 'model-a', () => sourceFor(mark(text).text, { pathAt, refIds: ['A'] }));
    registerCompletion(monaco, 'model-b', () => sourceFor(mark(text).text, { pathAt, refIds: ['B'] }));
    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledWith('yaml', expect.anything());

    const [a, b] = providers;
    expect((await ask(a, 'model-a', text)).map((item) => item.label)).toEqual(['A']);
    expect(await ask(a, 'model-b', text)).toEqual([]);
    expect((await ask(b, 'model-b', text)).map((item) => item.label)).toEqual(['B']);
    expect(await ask(b, 'model-a', text)).toEqual([]);
    expect(pathAt).toHaveBeenCalledWith(mark(text).text, mark(text).offset);

    const [suggestion] = await ask(a, 'model-a', text);
    expect(suggestion).toMatchObject({
      insertText: 'A',
      range: { startLineNumber: 3, endLineNumber: 3, startColumn: 13, endColumn: 13 },
    });
  });

  it('removes the provider on dispose', () => {
    const { monaco, providers } = fakeMonaco();
    const first = registerCompletion(monaco, 'model-a', () => sourceFor(''));
    registerCompletion(monaco, 'model-b', () => sourceFor(''));
    first.dispose();
    expect(providers).toHaveLength(1);
  });
});
