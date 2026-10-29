import { describe, expect, it } from 'vitest';
import type { MatchV4 } from '../model/v4';
import { createRegexCache, parseMatchBlock, resolveBlock } from './matcher';
import { resolveTemplateV4 } from './template';

const path = 'classes.node.match';

function parse(match: MatchV4) {
  const result = parseMatchBlock(match, path);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.block;
}

function resolve(match: MatchV4, attrs: Record<string, string> = { key: 'cell-a' }) {
  return resolveBlock(parse(match), (name) => attrs[name], createRegexCache());
}

function regex(body: string) {
  return resolve({ key: ['identity', `job=~${JSON.stringify(body)}`] });
}

describe('parseMatchBlock', () => {
  it('reads bare labels as equality and exposes the resolved matcher', () => {
    const result = resolve({ key: ' instance ' }, { key: 'sw-a' });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.resolved).toEqual([{ label: 'instance', op: '=', value: 'sw-a' }]);
    expect(result.equality).toEqual(new Map([['instance', 'sw-a']]));
    expect(result.test({ instance: 'sw-a' })).toBe(true);
    expect(result.test({ instance: 'sw-ab' })).toBe(false);
  });

  it.each([
    ['job = "${key}"', 'cell-a', true],
    ['job!="${key}"', 'cell-a', false],
    ['job!="${key}"', 'other', true],
    ['job=~"${key}.*"', 'cell-ab', true],
    ['job!~"${key}.*"', 'cell-ab', false],
    ['job!~"${key}.*"', 'other', true],
  ])('combines a list with %s', (matcher, job, want) => {
    const result = resolve({ key: ['identity', matcher] });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({ identity: 'cell-a', job })).toBe(want);
    expect(result.test({ identity: 'other', job })).toBe(false);
  });

  it('keeps matchers and their resolved values in block order', () => {
    const result = resolve(
      { key: ['instance', 'job="node"'], port: 'ifName="${from.key}:${to.port-id}"' },
      {
        key: 'sw-a',
        port: '',
        'from.key': 'sw-b',
        'to.port-id': 'p1',
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.resolved).toEqual([
      { label: 'instance', op: '=', value: 'sw-a' },
      { label: 'job', op: '=', value: 'node' },
      { label: 'ifName', op: '=', value: 'sw-b:p1' },
    ]);
  });

  it('records keys and placeholders as required attributes once', () => {
    expect(parse({ key: 'instance="${key}:${port}:${from.key}:${to.port-id}"', port: 'ifName' }).requiredAttrs).toEqual(
      ['key', 'port', 'from.key', 'to.port-id']
    );
  });

  it.each(['${key}', '${from.key}-${to.port-id}', '${cell.key}', 'a$b ${key}} $${port}', '[[x]]${key}'])(
    'reads the same cell attributes from %s as a template (one placeholder scanner)',
    (text) => {
      const template = resolveTemplateV4(text, { attr: () => undefined, from: () => undefined, to: () => undefined });
      // the record key `k0` is the first required attribute; the placeholders follow in text order
      const block = parse({ k0: `job=${JSON.stringify(text)}` });
      expect(block.requiredAttrs).toEqual(['k0', ...template.missing]);
    }
  );

  it.each<MatchV4>([{}, { key: 'job!=""' }, { key: [] }])(
    'rejects a block that reads no cell attribute: %j',
    (match) => {
      expect(parseMatchBlock(match, path)).toEqual({
        ok: false,
        errors: [{ path, message: 'match must read a cell attribute' }],
      });
    }
  );

  it.each([
    '9job',
    'job="unterminated',
    "job='x'",
    'job=="x"',
    'job="x" trailing',
    String.raw`job="\d"`,
    String.raw`job="\r"`,
    'job="${labels.x}"',
    'job="${value}"',
    'job="${job:csv}"',
    'job="${job.x:csv}"',
    'job="${}"',
    'job="${key"',
  ])('reports a schema error at the matcher path for %s', (matcher) => {
    const result = parseMatchBlock({ key: ['identity', matcher] }, path);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toEqual([{ path: `${path}.key[1]`, message: expect.any(String) }]);
  });

  it('unescapes the four PromQL string escapes', () => {
    const result = resolve({ key: String.raw`job="${'${key}'}\\\"\n\t"` }, { key: 'a' });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.resolved[0].value).toBe('a\\"\n\t');
    expect(result.test({ job: 'a\\"\n\t' })).toBe(true);
  });

  it('keeps bare dashboard variables and literal dollars as text', () => {
    const result = resolve({ key: 'job="${key}:$port:$"' });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({ job: 'cell-a:$port:$' })).toBe(true);
  });
});

describe('resolveBlock', () => {
  it.each(['port', 'from.key', 'to.key'])('requires the cell attribute %s without a variable fallback', (attr) => {
    const result = resolve({ key: `instance="${'${' + attr + '}'}"` });
    expect(result).toEqual({ ok: false, kind: 'missing-attr', attr });
  });

  it('requires a record key even when its matcher uses another attribute', () => {
    expect(resolve({ port: 'instance="${key}"' })).toEqual({ ok: false, kind: 'missing-attr', attr: 'port' });
  });

  it('accepts an empty attribute and compares absent labels as empty strings', () => {
    const result = resolve({ key: 'job' }, { key: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({})).toBe(true);
  });

  it.each([
    ['job!="x"', true],
    ['job=""', true],
    ['job=~".*"', true],
    ['job!~"x"', true],
    ['job="x"', false],
  ])('tests %s on an absent label', (matcher, want) => {
    const result = resolve({ key: ['identity', matcher] });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({ identity: 'cell-a' })).toBe(want);
  });

  it('substitutes equality values without parsing them again', () => {
    const value = 'a."\\${port}';
    const result = resolve({ key: 'job="${key}"' }, { key: value });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({ job: value })).toBe(true);
    expect(result.resolved[0].value).toBe(value);
  });

  it('escapes regex metacharacters, quotes and backslashes in cell values', () => {
    const value = 'a."\\(?i)${port}[x]*+?^|{}';
    const result = resolve({ key: 'job=~"${key}"' }, { key: value });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({ job: value })).toBe(true);
    expect(result.test({ job: value + 'x' })).toBe(false);
    expect(result.equality).toBeUndefined();
  });

  it('anchors a regex to the whole label', () => {
    const result = regex('a');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({ identity: 'cell-a', job: 'a' })).toBe(true);
    expect(result.test({ identity: 'cell-a', job: 'ab' })).toBe(false);
    expect(result.test({ identity: 'cell-a', job: 'a\n' })).toBe(false);
  });

  it('treats inherited object properties as absent labels', () => {
    const result = resolve({ key: ['identity', 'constructor=""', '__proto__=""', 'toString=""'] });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({ identity: 'cell-a' })).toBe(true);
  });

  it('decodes a double backslash before compiling a digit class', () => {
    const result = resolve({ key: ['identity', String.raw`entity=~"\\d+"`] });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.resolved[1]).toEqual({ label: 'entity', op: '=~', value: String.raw`\d+` });
    expect(result.test({ identity: 'cell-a', entity: '123' })).toBe(true);
    expect(result.test({ identity: 'cell-a', entity: 'ddd' })).toBe(false);
  });

  it('accepts one leading case-insensitive flag', () => {
    const result = regex('(?i)node-a');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({ identity: 'cell-a', job: 'NODE-A' })).toBe(true);
    expect(result.test({ identity: 'cell-a', job: 'NODE-AB' })).toBe(false);
  });

  it.each([
    [String.raw`\s`, '\u00a0', false],
    [String.raw`\s`, '\u000b', false],
    [String.raw`\s`, '\r', true],
    [String.raw`\s`, '\t', true],
    [String.raw`\s`, '\n', true],
    [String.raw`\s`, '\f', true],
    [String.raw`\s`, ' ', true],
    [String.raw`\S`, '\u00a0', true],
    [String.raw`\S`, '\u000b', true],
    [String.raw`\S`, '\r', false],
    [String.raw`[\s]`, '\u00a0', false],
    [String.raw`[\s]`, '\u000b', false],
    [String.raw`[\s]`, '\r', true],
    [String.raw`[^\s]`, '\u00a0', true],
    [String.raw`[^\s]`, '\u000b', true],
    [String.raw`[^\s]`, '\r', false],
    [String.raw`[\s-x]`, 'a', false],
    [String.raw`[\s-x]`, '5', false],
    [String.raw`[\s-x]`, 'w', false],
    [String.raw`[\s-x]`, '-', true],
    [String.raw`[\s-x]`, 'x', true],
    [String.raw`[\s-x]`, '\t', true],
    [String.raw`[\d-x]`, '-', true],
    [String.raw`[\d-x]`, 'x', true],
    [String.raw`[\d-x]`, '5', true],
    [String.raw`[\d-x]`, 'e', false],
    [String.raw`[\D-x]`, '-', true],
    [String.raw`[\D-x]`, '5', false],
    [String.raw`[\w-x]`, '-', true],
    [String.raw`[\w-x]`, 'e', true],
    [String.raw`[\w-x]`, '!', false],
    [String.raw`[\W-x]`, '-', true],
    [String.raw`[\W-x]`, 'x', true],
    [String.raw`[\W-x]`, 'e', false],
    [String.raw`[\s-]`, '-', true],
    [String.raw`[\s-]`, 'a', false],
    ['[[]', '[', true],
    ['[[]', ']', false],
    ['.', '\r', true],
    ['.', '\u2028', true],
    ['.', '\u2029', true],
    ['.', '\n', false],
    [String.raw`\.`, '.', true],
    [String.raw`\.`, '\r', false],
    ['[.]', '.', true],
    ['[.]', '\r', false],
  ])('keeps RE2 character semantics for %s and %j', (body, job, want) => {
    const result = regex(body);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({ identity: 'cell-a', job })).toBe(want);
  });

  it.each([
    '(?P<n>a)',
    '(?s)a',
    '(?m)a',
    '(?U)a',
    '(?i:a)',
    'a(?i)',
    '(?i)(?i)a',
    '(?<=a)b',
    '(?<!a)b',
    '(?=a)a',
    '(?!a)b',
    '(?<n>a)',
    String.raw`(a)\1`,
    String.raw`\k<n>`,
    String.raw`\A`,
    String.raw`node-a\z`,
    String.raw`\Qx\E`,
    String.raw`\C`,
    String.raw`\p{L}`,
    String.raw`\P{L}`,
    String.raw`\u0041`,
    String.raw`\u{41}`,
    String.raw`\cA`,
    String.raw`[\b]`,
    String.raw`[\S]`,
    String.raw`[^\Sx]`,
    '[]',
    '[^]',
  ])('rejects a regex outside the PromQL dialect: %s', (body) => {
    const result = regex(body);
    expect(result).toEqual({
      ok: false,
      kind: 'matcher-error',
      text: `job=~${JSON.stringify(body)}`,
      message: expect.stringContaining('not in the PromQL regex dialect'),
    });
  });

  it.each([String.raw`\y`, '[', '*', '\\'])('reports a regex compile error for %s', (body) => {
    expect(regex(body)).toMatchObject({ ok: false, kind: 'matcher-error', message: expect.any(String) });
  });

  it.each([
    [String.raw`\-\_`, '-_', 'a_'],
    [String.raw`[\-\_]+`, '_--_', 'a'],
    [String.raw`\:\@\#\=\!\,\<\>\%\&\'\"\;\~` + '\\`', ':@#=!,<>%&\'";~`', 'other'],
    [String.raw`[\-\_]`, '-', 'a'],
  ])('rewrites escaped punctuation as the same literal: %s', (body, yes, no) => {
    const result = regex(body);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({ identity: 'cell-a', job: yes })).toBe(true);
    expect(result.test({ identity: 'cell-a', job: no })).toBe(false);
  });

  it('does not scan escaped backslashes as a dialect form', () => {
    const result = regex(String.raw`\\z`);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.test({ identity: 'cell-a', job: String.raw`\z` })).toBe(true);
  });

  it('reuses one cache without mixing resolved values or regex flags', () => {
    const cache = createRegexCache();
    const block = parse({ key: 'job=~"${key}"' });
    const first = resolveBlock(block, () => 'a', cache);
    const second = resolveBlock(block, () => 'b', cache);
    const third = resolveBlock(parse({ key: ['identity', 'job=~"(?i)a"'] }), () => 'cell-a', cache);
    expect(first.ok && first.test({ job: 'a' })).toBe(true);
    expect(first.ok && first.test({ job: 'A' })).toBe(false);
    expect(second.ok && second.test({ job: 'b' })).toBe(true);
    expect(second.ok && second.test({ job: 'a' })).toBe(false);
    expect(third.ok && third.test({ identity: 'cell-a', job: 'A' })).toBe(true);
  });
});
