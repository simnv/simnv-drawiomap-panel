import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import type { MatchV4 } from '../model/v4';
import type { CellIndex, CellMeta } from '../types';
import { edgeEnds, type EndContext } from './edgeEnds';
import {
  createIdentity,
  endCap,
  identityNames,
  inheritableNames,
  isEndFree,
  isOwnOnly,
  linkAttr,
  measuredEnd,
  ownerAttr,
  usePlan,
} from './identity';
import { parseMatchBlock } from './matcher';

const cell = (id: string, attrs: Record<string, string> = {}, isEdge = false) => cellMetaFromAttrs(id, attrs, isEdge);

function context(
  cells: CellMeta[],
  parents: Array<[string, string]> = [],
  ends: Array<[string, { source?: string; target?: string }]> = []
): EndContext {
  const index: CellIndex = new Map(
    cells.map((meta) => [
      meta.id,
      { meta, group: document.createElementNS('http://www.w3.org/2000/svg', 'g'), arrows: [], original: {} },
    ])
  );
  return { index, parents: new Map(parents), ends: new Map(ends) };
}

const ownOnly = ['bind', 'at', 'cap', 'capacity', 'label', 'id', 'pg-kind', 'pg-port', 'pg-custom'];
const noEnds = (): EndContext => {
  throw new Error('the end context must stay lazy');
};

describe('ownerAttr (AC1, AC2)', () => {
  it('reads a port node and the first container that has the name', () => {
    const ctx = context(
      [cell('port', { port: 'br-lan' }), cell('node', { key: 'rtr-a' }), cell('site', { site: 'demo' })],
      [
        ['port', 'node'],
        ['node', 'bare-group'],
        ['bare-group', 'site'],
      ]
    );
    expect(ownerAttr('port', 'key', ctx)).toEqual({ value: 'rtr-a', cellId: 'node', via: 'owner' });
    expect(ownerAttr('port', 'site', ctx)).toEqual({ value: 'demo', cellId: 'site', via: 'owner' });
    expect(ownerAttr('node', 'site', ctx)).toEqual({ value: 'demo', cellId: 'site', via: 'owner' });
  });

  it('stops below the XML layer and never reads the root', () => {
    const ctx = context([cell('0', { key: 'root' }), cell('1', { key: 'layer' }), cell('shape')]);
    const xml =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="shape" parent="1" vertex="1"/></root></mxGraphModel>';
    expect(ownerAttr('shape', 'key', { index: ctx.index, ...edgeEnds(xml, ctx.index) })).toBeUndefined();
  });

  it.each(['own-key', ''])('keeps the own value %j', (key) => {
    const ctx = context([cell('port', { key }), cell('node', { key: 'node-key' })], [['port', 'node']]);
    expect(ownerAttr('port', 'key', ctx)).toEqual({ value: key, cellId: 'port', via: 'own' });
  });

  it('does not read prototype properties and stops a cycle', () => {
    const ctx = context(
      [cell('a'), cell('b')],
      [
        ['a', 'b'],
        ['b', 'a'],
      ]
    );
    expect(ownerAttr('a', 'constructor', ctx)).toBeUndefined();
    expect(ownerAttr('a', 'absent', ctx)).toBeUndefined();
  });

  it.each(ownOnly)('keeps %s own-only', (name) => {
    const ctx = context([cell('port'), cell('node', { [name]: 'node-value' })], [['port', 'node']]);
    expect(isOwnOnly(name)).toBe(true);
    expect(ownerAttr('port', name, ctx)).toEqual(
      name === 'id' ? { value: 'port', cellId: 'port', via: 'own' } : undefined
    );
  });

  it('treats key, port and arbitrary identity names as inheritable', () => {
    for (const name of ['key', 'port', 'job', 'device', 'constructor']) {
      expect(isOwnOnly(name)).toBe(false);
    }
  });
});

describe('createIdentity (I17)', () => {
  it('memoizes the measured end for each cell id within one resolver', () => {
    const meta = cell('link', {}, true);
    const ctx = context([meta, cell('port', { key: 'rtr-a' })], [], [['link', { target: 'port' }]]);
    const identity = createIdentity(() => ctx);
    const end = identity.measure(meta, ['key']);
    expect(end).toEqual({ end: 'target', reason: 'only', cellId: 'port', needs: ['key'] });
    expect(identity.measure(cell('link', {}, true), ['other'])).toBe(end);
    expect(createIdentity(() => ctx).measure(meta, ['key'])).not.toBe(end);
  });

  it('records owner and end origins, with no entry for own or absent values', () => {
    const meta = cell('link', {}, true);
    const port = cell('port', { port: 'br-lan' });
    const ctx = context(
      [meta, port, cell('node', { key: 'rtr-a' })],
      [['port', 'node']],
      [['link', { target: 'port' }]]
    );
    const identity = createIdentity(() => ctx);
    const readLink = identity.attr(meta);
    identity.measure(meta, ['key', 'port']);
    expect(readLink('key')).toBe('rtr-a');
    expect(readLink('port')).toBe('br-lan');
    expect(readLink('absent')).toBeUndefined();
    expect(identity.attr(port)('key')).toBe('rtr-a');
    expect(identity.attr(port)('port')).toBe('br-lan');
    expect(identity.inherited).toEqual(
      new Map([
        [
          'link',
          new Map([
            ['key', { value: 'rtr-a', cellId: 'node', via: 'end' }],
            ['port', { value: 'br-lan', cellId: 'port', via: 'end' }],
          ]),
        ],
        ['port', new Map([['key', { value: 'rtr-a', cellId: 'node', via: 'owner' }]])],
      ])
    );
  });

  it('keeps geometric ends independent of the measured end, including own-only names', () => {
    const meta = cell('link', {}, true);
    const ctx = context(
      [meta, cell('a', { 'pg-port': 'eth1' }), cell('node-a', { label: 'Router A' }), cell('b', { key: 'rtr-b' })],
      [['a', 'node-a']],
      [['link', { source: 'a', target: 'b' }]]
    );
    const identity = createIdentity(() => ctx);
    identity.measure(meta, ['key']);
    const read = identity.attr(meta);
    expect(read('key')).toBe('rtr-b');
    expect(read('from.pg-port')).toBe('eth1');
    expect(read('from.label')).toBe('Router A');
    expect(read('from.id')).toBe('a');
    expect(read('to.key')).toBe('rtr-b');
    expect(read('from.constructor')).toBeUndefined();
    expect(identity.inherited.get('link')).toEqual(
      new Map([
        ['key', { value: 'rtr-b', cellId: 'b', via: 'end' }],
        ['from.pg-port', { value: 'eth1', cellId: 'a', via: 'end' }],
        ['from.label', { value: 'Router A', cellId: 'node-a', via: 'end' }],
        ['from.id', { value: 'a', cellId: 'a', via: 'end' }],
        ['to.key', { value: 'rtr-b', cellId: 'b', via: 'end' }],
      ])
    );
  });

  it('reads each own value and id without asking for the ends', () => {
    const identity = createIdentity(noEnds);
    for (const isEdge of [false, true]) {
      const meta = cell(isEdge ? 'link' : 'port', { key: 'rtr-a', port: '', at: 'target', cap: '50M' }, isEdge);
      const read = identity.attr(meta);
      expect(read('key')).toBe('rtr-a');
      expect(read('port')).toBe('');
      expect(read('id')).toBe(meta.id);
      expect(read('cap')).toBe('50M');
      expect(read('bind')).toBeUndefined();
      if (isEdge) {
        expect(identity.measure(meta, [])).toEqual({ end: 'target', reason: 'at', needs: [] });
      }
    }
    expect(identity.inherited.size).toBe(0);
  });

  it('keeps geometric templates available on an unmeasured edge', () => {
    const meta = cell('link', {}, true);
    const ctx = context([meta, cell('port')], [], [['link', { source: 'port' }]]);
    const identity = createIdentity(() => ctx);
    identity.measure(meta, ['key']);
    expect(identity.attr(meta)('key')).toBeUndefined();
    expect(identity.attr(meta)('from.id')).toBe('port');
    expect(identity.attr(meta)('to.id')).toBeUndefined();
  });

  it('does not turn an early own read into a measured-end memo', () => {
    const meta = cell('link', { label: 'Demo link' }, true);
    const ctx = context([meta, cell('port', { key: 'rtr-a' })], [], [['link', { target: 'port' }]]);
    const identity = createIdentity(() => ctx);
    expect(identity.attr(meta)('label')).toBe('Demo link');
    expect(identity.measure(meta, ['key']).end).toBe('target');
  });
});

describe('linkAttr (I8, AC2)', () => {
  it.each(['link-port', ''])('keeps an own value %j without reading the ends', (port) => {
    const meta = cell('link', { port }, true);
    expect(linkAttr(meta, 'port', { end: 'target', reason: 'at', needs: ['key', 'port'] }, noEnds)).toEqual({
      value: port,
      cellId: 'link',
      via: 'own',
    });
  });

  it('reads through the measured end, never through the edge container', () => {
    const meta = cell('link', {}, true);
    const ctx = context(
      [meta, cell('port', { port: 'br-lan' }), cell('node', { key: 'rtr-a' }), cell('box', { site: 'wrong' })],
      [
        ['port', 'node'],
        ['link', 'box'],
      ],
      [['link', { target: 'port' }]]
    );
    const end = measuredEnd(meta, ['key', 'port'], () => ctx);
    expect(linkAttr(meta, 'key', end, () => ctx)).toEqual({ value: 'rtr-a', cellId: 'node', via: 'end' });
    expect(linkAttr(meta, 'port', end, () => ctx)).toEqual({ value: 'br-lan', cellId: 'port', via: 'end' });
    expect(linkAttr(meta, 'site', end, () => ctx)).toBeUndefined();
    expect(linkAttr(meta, 'constructor', end, () => ctx)).toBeUndefined();
  });

  it('finds the end when an explicit at result has no cellId', () => {
    const meta = cell('link', { at: 'target' }, true);
    const ctx = context([meta, cell('port', { key: 'rtr-a' })], [], [['link', { target: 'port' }]]);
    expect(linkAttr(meta, 'key', measuredEnd(meta, ['key'], noEnds), () => ctx)).toEqual({
      value: 'rtr-a',
      cellId: 'port',
      via: 'end',
    });
  });

  it.each(ownOnly)('does not read %s from an end', (name) => {
    const meta = cell('link', {}, true);
    expect(linkAttr(meta, name, { end: 'source', reason: 'own', needs: [] }, noEnds)).toEqual(
      name === 'id' ? { value: 'link', cellId: 'link', via: 'own' } : undefined
    );
  });

  it('an unmeasured link reads only its own values without reading the ends', () => {
    const meta = cell('link', { site: 'demo' }, true);
    const end = { end: 'none', reason: 'none', needs: ['key'] } as const;
    expect(linkAttr(meta, 'key', { ...end, needs: ['key'] }, noEnds)).toBeUndefined();
    expect(linkAttr(meta, 'site', { ...end, needs: ['key'] }, noEnds)).toEqual({
      value: 'demo',
      cellId: 'link',
      via: 'own',
    });
  });
});

describe('endCap (I14, amended lazy lookup)', () => {
  it('distinguishes two links with lazy at=source results and different source port capacities', () => {
    const first = cell('first', { key: 'rtr-a', port: 'br-lan', at: 'source' }, true);
    const second = cell('second', { key: 'rtr-b', port: 'br-lan', at: 'source' }, true);
    const ctx = context(
      [first, second, cell('a', { cap: '50M' }), cell('b', { cap: '100M' })],
      [],
      [
        ['first', { source: 'a' }],
        ['second', { source: 'b' }],
      ]
    );
    const a = measuredEnd(first, [], noEnds);
    const b = measuredEnd(second, [], noEnds);
    expect(a).toEqual({ end: 'source', reason: 'at', needs: [] });
    expect(b).toEqual(a);
    expect(endCap(first, a, ctx)).toEqual({ cellId: 'a', cap: '50M' });
    expect(endCap(second, b, ctx)).toEqual({ cellId: 'b', cap: '100M' });
  });

  it('reads the own pair of a target port and does not inherit from its node', () => {
    const meta = cell('link', { at: 'target' }, true);
    const ctx = context(
      [meta, cell('port', { cap: '', capacity: '100M' }), cell('node', { cap: '1G' })],
      [['port', 'node']],
      [['link', { target: 'port' }]]
    );
    expect(endCap(meta, measuredEnd(meta, [], noEnds), ctx)).toEqual({ cellId: 'port', cap: '', capacity: '100M' });
    const noPair = context(
      [meta, cell('port'), cell('node', { cap: '1G' })],
      [['port', 'node']],
      [['link', { target: 'port' }]]
    );
    expect(endCap(meta, measuredEnd(meta, [], noEnds), noPair)).toEqual({ cellId: 'port' });
  });

  it('reads the capacity of an anonymous node end for reason own', () => {
    const meta = cell('link', { key: 'rtr-a' }, true);
    const ctx = context([meta, cell('node', { capacity: '1G' })], [], [['link', { source: 'node' }]]);
    expect(endCap(meta, measuredEnd(meta, [], noEnds), ctx)).toEqual({ cellId: 'node', capacity: '1G' });
  });

  it('has no capacity for an unmeasured link, an absent end, or an unindexed end', () => {
    const meta = cell('link', {}, true);
    const ctx = context([meta], [], [['link', { source: 'absent' }]]);
    expect(endCap(meta, { end: 'none', reason: 'none', needs: ['key'] }, ctx)).toBeUndefined();
    expect(endCap(meta, { end: 'source', reason: 'own', needs: [] }, ctx)).toBeUndefined();
    expect(endCap(meta, { end: 'target', reason: 'at', needs: [] }, ctx)).toBeUndefined();
  });

  it('does not read capacity from a prototype', () => {
    const meta = cell('link', {}, true);
    const port = cell('port');
    port.attrs = Object.create({ cap: '1G', capacity: '2G' });
    expect(port.attrs.cap).toBe('1G');
    expect(port.attrs.capacity).toBe('2G');
    expect(Object.hasOwn(port.attrs, 'cap')).toBe(false);
    expect(Object.hasOwn(port.attrs, 'capacity')).toBe(false);
    const ctx = context([meta, port], [], [['link', { source: 'port' }]]);
    expect(endCap(meta, { end: 'source', reason: 'own', needs: [] }, ctx)).toEqual({ cellId: 'port' });
  });
});

describe('measuredEnd (AC3)', () => {
  it.each([
    ['source', 'source'],
    ['target', 'target'],
    ['', 'source'],
    ['other', 'source'],
  ])('own at=%j takes precedence without reading the ends', (at, end) => {
    expect(measuredEnd(cell('link', { at }, true), ['key', 'port'], noEnds)).toEqual({
      end,
      reason: 'at',
      needs: ['key', 'port'],
    });
  });

  it('keeps an explicit source even when only the target is instrumented', () => {
    const meta = cell('link', { at: 'source' }, true);
    const ctx = context([meta, cell('target', { key: 'rtr-a' })], [], [['link', { target: 'target' }]]);
    expect(measuredEnd(meta, ['key'], () => ctx)).toEqual({ end: 'source', reason: 'at', needs: ['key'] });
  });

  it('has reason own with no dependent use and does not read the ends', () => {
    expect(measuredEnd(cell('link', {}, true), [], noEnds)).toEqual({ end: 'source', reason: 'own', needs: [] });
  });

  it.each(['source', 'target'] as const)('selects the only instrumented %s end through its owner', (end) => {
    const meta = cell('link', {}, true);
    const ctx = context(
      [meta, cell('port', { port: 'br-lan' }), cell('node', { key: 'rtr-a' }), cell('other')],
      [['port', 'node']],
      [['link', end === 'source' ? { source: 'port', target: 'other' } : { source: 'other', target: 'port' }]]
    );
    expect(measuredEnd(meta, ['key', 'port'], () => ctx)).toEqual({
      end,
      reason: 'only',
      cellId: 'port',
      needs: ['key', 'port'],
    });
  });

  it('selects the source when both ends qualify', () => {
    const meta = cell('link', {}, true);
    const ctx = context(
      [meta, cell('a', { key: '' }), cell('b', { key: 'rtr-b' })],
      [],
      [['link', { source: 'a', target: 'b' }]]
    );
    expect(measuredEnd(meta, ['key'], () => ctx)).toEqual({
      end: 'source',
      reason: 'both',
      cellId: 'a',
      needs: ['key'],
    });
  });

  it('keeps a partial own identity when neither end qualifies', () => {
    const meta = cell('link', { key: '' }, true);
    expect(measuredEnd(meta, ['key', 'port'], () => context([meta]))).toEqual({
      end: 'source',
      reason: 'own',
      needs: ['key', 'port'],
    });
  });

  it('is unmeasured when neither end qualifies and no identity name is own', () => {
    const meta = cell('link', {}, true);
    const ctx = context(
      [meta, cell('a', { key: 'rtr-a' }), cell('b', { port: 'br-lan' })],
      [],
      [['link', { source: 'a', target: 'b' }]]
    );
    expect(measuredEnd(meta, ['key', 'port'], () => ctx)).toEqual({
      end: 'none',
      reason: 'none',
      needs: ['key', 'port'],
    });
    expect(measuredEnd(meta, ['constructor'], () => ctx).end).toBe('none');
  });

  it('an own port narrows the required end attributes to key', () => {
    const meta = cell('link', { port: 'vlan-demo' }, true);
    const ctx = context([meta, cell('a'), cell('b', { key: 'rtr-b' })], [], [['link', { source: 'a', target: 'b' }]]);
    expect(measuredEnd(meta, ['key', 'port'], () => ctx)).toEqual({
      end: 'target',
      reason: 'only',
      cellId: 'b',
      needs: ['key', 'port'],
    });
  });

  it('does not infer port from pg-port or at from a prototype', () => {
    const meta = cell('link', {}, true);
    meta.attrs = Object.create({ at: 'target', key: 'prototype' });
    expect(meta.attrs.at).toBe('target');
    expect(meta.attrs.key).toBe('prototype');
    expect(Object.hasOwn(meta.attrs, 'at')).toBe(false);
    expect(Object.hasOwn(meta.attrs, 'key')).toBe(false);
    const ctx = context([meta, cell('a', { key: 'rtr-a', 'pg-port': 'br-lan' })], [], [['link', { source: 'a' }]]);
    expect(measuredEnd(meta, ['key', 'port'], () => ctx)).toEqual({
      end: 'none',
      reason: 'none',
      needs: ['key', 'port'],
    });
  });
});

describe('identity names (I6, AC3)', () => {
  it('drops geometric and own-only names and returns a sorted set', () => {
    expect(inheritableNames(['port', 'from.key', 'key', 'to.port', ...ownOnly, 'port', 'site'])).toEqual([
      'key',
      'port',
      'site',
    ]);
  });

  it('a block is end-free when each inheritable name is own, including an empty value', () => {
    const meta = cell('link', { key: '', port: 'br-lan' }, true);
    expect(isEndFree(meta, ['key', 'port', 'id', 'from.site', 'to.key', 'cap'])).toBe(true);
    expect(isEndFree(meta, ['key', 'site'])).toBe(false);
    expect(isEndFree(meta, ['constructor'])).toBe(false);
    expect(isEndFree(meta, [])).toBe(true);
  });

  it('unions the whole dependent blocks and leaves out end-free blocks', () => {
    const meta = cell('link', { key: 'rtr-a', site: 'demo' }, true);
    expect(identityNames(meta, [['site'], ['port', 'key'], ['device', 'port'], ['id', 'from.site']])).toEqual([
      'device',
      'key',
      'port',
    ]);
    expect(identityNames(meta, [])).toEqual([]);
    expect(identityNames(meta, [['site', 'key'], ['id']])).toEqual([]);
  });
});

describe('usePlan (I9, I13)', () => {
  const ownMatch: MatchV4 = { key: 'job' };
  const dependentMatch: MatchV4 = { port: 'device' };
  const geometricMatch: MatchV4 = { id: 'edge="${from.key}"' };
  const blocks = new Map<MatchV4, readonly string[]>([
    [ownMatch, ['key']],
    [dependentMatch, ['port']],
    [geometricMatch, ['id', 'from.key', 'to.port', 'cap', 'label', 'pg-kind']],
  ]);

  it.each(['source', 'target'] as const)('keeps end-free blocks at source when the measured end is %s', (end) => {
    const plan = usePlan(cell('link', { key: '' }, true), blocks, { end, reason: 'only', needs: ['port'] });
    expect(plan(ownMatch)).toBe('source');
    expect(plan(geometricMatch)).toBe('source');
    expect(plan(dependentMatch)).toBe(end);
  });

  it('drops only the dependent blocks of an unmeasured link', () => {
    const plan = usePlan(cell('link', { key: '' }, true), blocks, { end: 'none', reason: 'none', needs: ['port'] });
    expect(plan(ownMatch)).toBe('source');
    expect(plan(geometricMatch)).toBe('source');
    expect(plan(dependentMatch)).toBe('drop');
  });

  it.each([
    ['target', 'target'],
    ['source', 'source'],
    ['', 'source'],
    ['other', 'source'],
  ])('own at=%j controls each block before dependence or a drop', (at, want) => {
    const plan = usePlan(cell('link', { key: '', at }, true), blocks, { end: 'none', reason: 'none', needs: ['port'] });
    expect(plan(ownMatch)).toBe(want);
    expect(plan(geometricMatch)).toBe(want);
    expect(plan(dependentMatch)).toBe(want);
  });

  it('does not treat prototype at or identity names as own values', () => {
    const meta = cell('link', {}, true);
    meta.attrs = Object.create({ at: 'target', key: 'rtr-a' });
    const plan = usePlan(meta, blocks, { end: 'none', reason: 'none', needs: ['key', 'port'] });
    expect(plan(ownMatch)).toBe('drop');
    expect(plan(dependentMatch)).toBe('drop');
    expect(plan(geometricMatch)).toBe('source');
  });

  it('uses required placeholder names as well as the record keys of a match', () => {
    const match: MatchV4 = { id: 'job="${site}"' };
    const parsed = parseMatchBlock(match, 'classes.link.match');
    if (!parsed.ok) {
      throw new Error('the match must parse');
    }
    const plan = usePlan(cell('link', {}, true), new Map([[match, parsed.block.requiredAttrs]]), {
      end: 'target',
      reason: 'only',
      needs: ['site'],
    });
    expect(plan(match)).toBe('target');
  });
});
