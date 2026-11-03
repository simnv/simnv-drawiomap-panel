import type { monacoTypes } from '@grafana/ui';
import { describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';

import { schemaKeys } from '../../model/v4';
import { itemsAt, registerCompletion, registerHover, type CompletionSource } from './completion';
import { pathAt, readDraft } from './yamlPath';

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

describe('itemsAt: schema keys', () => {
  it.each(['classes', 'overrides'])('offers arrow next to linkLabel in %s', (root) => {
    const items = complete(`${root}:\n  link:\n    arr|\n`, `${root}.link.arr`);
    const names = labels(items);
    expect(names[names.indexOf('linkLabel') + 1]).toBe('arrow');
    expect(items.find((item) => item.label === 'arrow')).toMatchObject({ insertText: 'arrow: ', kind: 'key' });
  });

  it('gives the keys of a class on a blank line in the class', () => {
    const items = complete(`${BASE.split('  link:')[0]}    |\n`, 'classes.host.text');
    expect(labels(items)).toEqual(schemaKeys.class);
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
    expect(labels(items)).toEqual(schemaKeys.override);
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
    expect(labels(items)).toEqual(schemaKeys.class);
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

describe('Monaco completion and hover providers', () => {
  type Provider = monacoTypes.languages.CompletionItemProvider;

  function fakeMonaco() {
    const providers: Provider[] = [];
    const hovers: monacoTypes.languages.HoverProvider[] = [];
    const monaco = {
      languages: {
        CompletionItemKind: { Property: 9, Value: 13, Field: 3, Class: 5, Variable: 4, Constant: 14 },
        registerCompletionItemProvider: vi.fn((_language: string, provider: Provider) => {
          providers.push(provider);
          return { dispose: () => providers.splice(providers.indexOf(provider), 1) };
        }),
        registerHoverProvider: vi.fn((_language: string, provider: monacoTypes.languages.HoverProvider) => {
          hovers.push(provider);
          return { dispose: () => hovers.splice(hovers.indexOf(provider), 1) };
        }),
      },
    };
    return { monaco: monaco as unknown as typeof monacoTypes, providers, hovers };
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

  async function hover(provider: monacoTypes.languages.HoverProvider, id: string, marked: string) {
    const { model, position } = modelOf(id, marked);
    return provider.provideHover(model, position, {} as monacoTypes.CancellationToken);
  }

  it.each([
    ['classes', '    ar|row: point', 3, 5, 10],
    ['overrides', '    arrow: tri|angle', 3, 12, 20],
    ['classes', '    arrow: "no|ne"', 3, 12, 18],
    ['overrides', '    arrow: po|int', 3, 12, 17],
  ])('shows arrow docs in %s at %s', async (root, line, lineNumber, startColumn, endColumn) => {
    const { monaco, providers, hovers } = fakeMonaco();
    const source = () =>
      sourceFor('', {
        pathAt: (value, at) => pathAt(readDraft(value).doc, value, at),
      });
    registerCompletion(monaco, 'model-a', source);
    registerHover(monaco, 'model-a', source);
    expect(monaco.languages.registerHoverProvider).toHaveBeenCalledWith('yaml', expect.anything());
    const [key] = (await ask(providers[0], 'model-a', `${root}:\n  "link.part":\n    arr|\n`)).filter(
      (item) => item.label === 'arrow'
    );
    const result = await hover(hovers[0], 'model-a', `${root}:\n  "link.part":\n${line}\n`);
    expect(result).toEqual({
      contents: [key.documentation],
      range: { startLineNumber: lineNumber, endLineNumber: lineNumber, startColumn, endColumn },
    });
  });

  it('scopes hover to its model and removes only its own provider on dispose', async () => {
    const { monaco, hovers } = fakeMonaco();
    const path = vi.fn((value: string, at: number) => pathAt(readDraft(value).doc, value, at));
    let current = sourceFor('', { pathAt: () => null });
    const first = registerHover(monaco, 'model-a', () => current);
    registerHover(monaco, 'model-b', () => sourceFor('', { pathAt: path }));
    const [a, b] = hovers;
    const marked = 'classes:\n  link:\n    arrow: po|int\n';
    expect(await hover(a, 'model-a', marked)).toBeNull();
    current = sourceFor('', { pathAt: path });
    expect(await hover(a, 'model-b', marked)).toBeNull();
    expect(await hover(b, 'model-a', marked)).toBeNull();
    expect(path).not.toHaveBeenCalled();
    expect(await hover(a, 'model-a', marked)).not.toBeNull();
    expect(path).toHaveBeenCalledWith(mark(marked).text, mark(marked).offset);
    expect(await hover(b, 'model-b', marked)).not.toBeNull();
    first.dispose();
    expect(hovers).toEqual([b]);
  });

  it.each(['classes:\n  link: {ar|row: point}\n', 'overrides:\n  e-1: {arrow: no|ne}\n'])(
    'shows arrow docs in a flow mapping: %s',
    async (marked) => {
      const { monaco, hovers } = fakeMonaco();
      registerHover(monaco, 'model-a', () =>
        sourceFor('', {
          pathAt: (value, at) => pathAt(readDraft(value).doc, value, at),
        })
      );
      const result = await hover(hovers[0], 'model-a', marked);
      expect(result?.contents[0].value).toContain('`point` is the default and has no wings.');
    }
  );

  it.each([
    'classes:\n  link:\n    arrow: point # ar|row\n',
    'classes:\n  link:\n    arrow: point\n    # ar|row\n',
    'classes:\n  link:\n    arrow: point\n    |\n',
    'classes:\n  link:\n    arrow: point   |\n',
    'classes:\n  link:\n    arrow: |\n',
    'classes:\n  link:\n    linkLabel: no|ne\n',
    'classes:\n  link:\n    match:\n      arrow: po|int\n',
    'classes:\n  link:\n    rows:\n      - kind: value\n        arrow: po|int\n',
    'classes:\n  link:\n    text:\n      arrow: po|int\n',
    'settings:\n  link:\n    arrow: po|int\n',
    'arrow: po|int\n',
  ])('gives no arrow hover outside an arrow key or value: %s', async (marked) => {
    const { monaco, hovers } = fakeMonaco();
    registerHover(monaco, 'model-a', () =>
      sourceFor('', {
        pathAt: (value, at) => pathAt(readDraft(value).doc, value, at),
      })
    );
    expect(await hover(hovers[0], 'model-a', marked)).toBeNull();
  });

  it.each([
    ['classes', '    arrow: |', 'point'],
    ['overrides', '    arrow: tr|iangle', 'triangle'],
    ['classes', '    arrow: "po|int"', 'point'],
    ['overrides', "    arrow: 'no|ne'", 'none'],
    ['classes', '    arrow: "po|', 'point'],
  ])('offers the arrow values in %s at %s', async (root, line, selected) => {
    const { monaco, providers } = fakeMonaco();
    const marked = `${root}:\n  link:\n${line}\n`;
    const { text, offset } = mark(marked);
    registerCompletion(monaco, 'model-a', () =>
      sourceFor(text, {
        pathAt: (value, at) => pathAt(readDraft(value).doc, value, at),
      })
    );
    const suggestions = await ask(providers[0], 'model-a', marked);
    expect(suggestions.map((item) => item.label)).toEqual(['point', 'triangle', 'none']);
    const item = suggestions.find((item) => item.label === selected)!;
    expect(item.kind).toBe(monaco.languages.CompletionItemKind.Constant);
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    const range = 'replace' in item.range ? item.range.replace : item.range;
    const replaced =
      text.slice(0, lineStart + range.startColumn - 1) + item.insertText + text.slice(lineStart + range.endColumn - 1);
    expect(parseDocument(replaced).toJS()).toEqual({ [root]: { link: { arrow: selected } } });
  });

  it.each(['classes', 'overrides'])('documents the arrow key and values in %s', async (root) => {
    const { monaco, providers } = fakeMonaco();
    registerCompletion(monaco, 'model-a', () =>
      sourceFor('', {
        pathAt: (value, at) => pathAt(readDraft(value).doc, value, at),
      })
    );
    const keys = await ask(providers[0], 'model-a', `${root}:\n  link:\n    arr|\n`);
    const docs = keys.find((item) => item.label === 'arrow')?.documentation;
    expect(docs).toEqual({
      value:
        '`point` is the default and has no wings. `triangle` uses the old triangular wings. ' +
        '`none` uses flat ends. This field applies to links. ' +
        'A child class inherits the arrow style from its parent class. A cell override replaces the class arrow style.',
    });
    const values = await ask(providers[0], 'model-a', `${root}:\n  link: {arrow: |}\n`);
    expect(values.map((item) => item.label)).toEqual(['point', 'triangle', 'none']);
    expect(values.map((item) => item.documentation)).toEqual([docs, docs, docs]);
    expect(keys.find((item) => item.label === 'linkLabel')?.documentation).toBeUndefined();
  });

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
