import { describe, expect, it } from 'vitest';
import { pathAt, readDraft } from './yamlPath';

/** The path at the `|` mark of `marked` (the mark is not part of the text). */
function at(marked: string): string | null {
  const offset = marked.indexOf('|');
  const text = marked.slice(0, offset) + marked.slice(offset + 1);
  return pathAt(readDraft(text).doc, text, offset);
}

const CLASSES = `classes:
  lan:
    match:
      key: job
    status: up
    rows:
      - query: rx
        label: In
      - kind: metadata
        text: x
overrides:
  sw.1:
    status: down
`;

/** CLASSES with the `|` mark after the first match of `after`. */
const mark = (after: string, text = CLASSES) => {
  const i = text.indexOf(after) + after.length;
  return text.slice(0, i) + '|' + text.slice(i);
};

describe('pathAt (spec 5.3 "The path at an offset")', () => {
  it('on a key: the path of its pair', () => {
    expect(at(mark('cla'))).toBe('classes');
    expect(at(mark('  la'))).toBe('classes.lan');
    expect(at(mark('stat'))).toBe('classes.lan.status');
    expect(at(mark('- que'))).toBe('classes.lan.rows[0].query');
    expect(at(mark('ov'))).toBe('overrides');
  });

  it('on a value: the path goes into the value', () => {
    expect(at(mark('key: j'))).toBe('classes.lan.match.key');
    expect(at(mark('status: u'))).toBe('classes.lan.status');
    expect(at(mark('label: I'))).toBe('classes.lan.rows[0].label');
    expect(at(mark('text: '))).toBe('classes.lan.rows[1].text');
    expect(at('classes:\n  lan:\n    arrow: tri|angle\n')).toBe('classes.lan.arrow');
    expect(at('overrides:\n  edge.1:\n    arr|ow: none\n')).toBe('overrides["edge.1"].arrow');
  });

  it('a key that needs brackets gives a bracket path', () => {
    expect(at(mark('sw.'))).toBe('overrides["sw.1"]');
    expect(at(mark('status: d'))).toBe('overrides["sw.1"].status');
  });

  it('on the dash of a list item: the path of the item', () => {
    expect(at(mark('      -'))).toBe('classes.lan.rows[0]');
    expect(at('rows:\n  - a\n  |- b\n')).toBe('rows[1]');
    expect(at('extends: [a, |b]\n')).toBe('extends[1]');
  });

  it('after the colon of a key with a block value: the path of the key', () => {
    expect(at(mark('lan:'))).toBe('classes.lan');
    expect(at(mark('rows:'))).toBe('classes.lan.rows');
  });

  it('on a blank line: the nearest pair above at the same or a smaller indent', () => {
    const text = 'classes:\n  lan:\n    status: up\n\n    text: {}\n';
    const blank = text.indexOf('\n\n') + 1;
    const withIndent = (n: number) => text.slice(0, blank) + ' '.repeat(n) + '|' + text.slice(blank);
    expect(at(withIndent(4))).toBe('classes.lan.status');
    expect(at(withIndent(2))).toBe('classes.lan');
    expect(at(withIndent(0))).toBe('classes');
    expect(at(withIndent(8))).toBe('classes.lan.status');
  });

  it('on a blank line at the dash column of a list item: the list, not the item (a key stands at dash + 2)', () => {
    expect(at('rows:\n  - query: rx\n  |\n')).toBe('rows');
    expect(at('rows:\n  - query: rx\n    |\n')).toBe('rows[0].query');
  });

  it('on a comment line: the pair above with a key at the column of the offset or to its left', () => {
    expect(at('rows:\n  - query: rx\n    # note|\n')).toBe('rows[0].query');
    expect(at('rows:\n  - query: rx\n  |# note\n')).toBe('rows');
  });

  it('on a blank line at the end of the text', () => {
    expect(at(CLASSES + '\n    |')).toBe('overrides["sw.1"].status');
    expect(at(CLASSES + '\n|')).toBe('overrides');
  });

  it('in the white space after a value: the pair of that line', () => {
    expect(at('classes:\n  lan:\n    status: up   |\n    text: {}\n')).toBe('classes.lan.status');
    expect(at('classes:\n  lan:\n    status: up |\n')).toBe('classes.lan.status');
  });

  it('on an incomplete `query:` with no value: the path of its key', () => {
    expect(at('classes:\n  lan:\n    rows:\n      - query:|\n')).toBe('classes.lan.rows[0].query');
    expect(at('classes:\n  lan:\n    rows:\n      - query: |\n')).toBe('classes.lan.rows[0].query');
    expect(at('classes:\n  lan:\n    rows:\n      - query:|\n        label: x\n')).toBe('classes.lan.rows[0].query');
  });

  it('during a parse error: the path in the partial tree', () => {
    const text = 'classes:\n  lan:\n    status: [up\n  wan: 1\n';
    expect(readDraft(text).entries.length).toBeGreaterThan(0);
    const offset = text.indexOf('[up') + 2;
    expect(pathAt(readDraft(text).doc, text, offset)).toBe('classes.lan.status[0]');
    expect(at('classes:\n  lan:\n   status: up\n  b|ad\n')).toBe('classes.bad');
  });

  it('a text with no pair gives null', () => {
    expect(at('|')).toBeNull();
    expect(at('# only a comment|\n')).toBeNull();
    expect(at('|\nclasses: {}\n')).toBeNull();
  });
});

describe('readDraft: the yaml entries (spec 5.3 step 4)', () => {
  it('a duplicate key gives a yaml entry on its line', () => {
    const { entries } = readDraft('classes:\n  lan: {}\n  lan: {}\n');
    expect(entries).toEqual([{ kind: 'yaml', line: 3, message: expect.stringMatching(/unique/i) }]);
  });

  it('an anchor and an alias give yaml entries; there is no alias expansion', () => {
    const { entries } = readDraft('classes:\n  a: &base {status: up}\n  b: *base\n');
    expect(entries).toEqual([
      { kind: 'yaml', line: 2, message: 'YAML anchors are not allowed.' },
      { kind: 'yaml', line: 3, message: 'YAML aliases are not allowed.' },
    ]);
  });

  it('valid YAML gives no entry and a document for pathAt', () => {
    const draft = readDraft(CLASSES);
    expect(draft.entries).toEqual([]);
    expect(pathAt(draft.doc, CLASSES, CLASSES.indexOf('status'))).toBe('classes.lan.status');
  });
});
