import { createTheme, dateTime, FieldType, LoadingState, type DataFrame, type Labels } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { cellMetaFromAttrs } from '../adapter/portograph';
import { validateConfig } from '../model/validate';
import type { CellEntry, CellIndex } from '../types';
import { bindV4 } from './bindV4';
import { candidatesFor } from './candidates';
import { bindContextFor } from './context';
import { endContextOf } from './edgeEnds';

type Cell = [id: string, attrs: Record<string, string>, edge?: boolean];

function frame(labels: Labels, refId = 'up'): DataFrame {
  return {
    refId,
    length: 1,
    fields: [
      { name: 'Time', type: FieldType.time, config: {}, values: [1000] },
      { name: 'Value', type: FieldType.number, config: {}, labels, values: [1] },
    ],
  };
}

function setup(match: Record<string, string | string[]>, cells: Cell[], frames: DataFrame[], xml?: string) {
  const index: CellIndex = new Map(
    cells.map(([id, attrs, edge]) => [id, { meta: cellMetaFromAttrs(id, attrs, edge ?? false) } as CellEntry])
  );
  const timeRange = { from: dateTime(0), to: dateTime(1000), raw: { from: dateTime(0), to: dateTime(1000) } };
  const result = bindV4({
    index,
    xml,
    validated: validateConfig({ version: 4, classes: { host: { match, status: 'up' } } }),
    data: { state: LoadingState.Done, series: frames, timeRange },
    ctx: bindContextFor({
      theme: createTheme(),
      replaceVariables: (s) => s,
      timeZone: 'utc',
      linkWidth: { min: 2, max: 10 },
    }),
  });
  const byRef = new Map(
    [...new Set(frames.map((f) => f.refId!))].map((ref) => [ref, frames.filter((f) => f.refId === ref)])
  );
  const ctx = { index, ends: endContextOf(xml, index) };
  return { result, byRef, ctx, candidates: (id = 'a') => candidatesFor(id, result, byRef, ctx) };
}

describe('candidatesFor', () => {
  it('offers an orphan series for a wrong key', () => {
    const { candidates } = setup(
      { key: 'job' },
      [['a', { bind: 'host', key: 'wrong' }]],
      [frame({ job: 'node-rtr-a' })]
    );
    expect(candidates()).toEqual([
      {
        use: 'classes.host.status',
        target: 'a',
        attr: 'key',
        value: 'node-rtr-a',
        labels: { job: 'node-rtr-a' },
        via: 'orphan',
      },
    ]);
  });

  it('offers both devices for a wrong port, with orphans before a selected series', () => {
    const { candidates } = setup(
      { key: 'job', port: 'device' },
      [
        ['a', { bind: 'host', key: 'node-rtr-a', port: 'wrong' }],
        ['b', { bind: 'host', key: 'node-rtr-a', port: 'eth1' }],
      ],
      [
        frame({ job: 'node-rtr-a', device: 'eth1' }),
        frame({ job: 'node-rtr-a', device: 'eth2' }),
        frame({ job: 'node-rtr-b', device: 'eth3' }),
      ]
    );
    expect(candidates().map(({ attr, value, via }) => ({ attr, value, via }))).toEqual([
      { attr: 'port', value: 'eth2', via: 'orphan' },
      { attr: 'port', value: 'eth1', via: 'any' },
    ]);
  });

  it('changes only the failed matcher and rejects series that fail both matchers', () => {
    const { candidates } = setup(
      { key: 'job', port: 'device' },
      [['a', { bind: 'host', key: 'wrong', port: 'eth1' }]],
      [frame({ job: 'node-rtr-b', device: 'eth2' }), frame({ job: 'node-rtr-a', device: 'eth1' })]
    );
    expect(candidates().map(({ attr, value }) => ({ attr, value }))).toEqual([{ attr: 'key', value: 'node-rtr-a' }]);
  });

  it('offers a missing attribute when no cell gives it, and checks the other matcher', () => {
    const { candidates, result } = setup(
      { key: 'job', port: 'device' },
      [['a', { bind: 'host', key: 'node-rtr-a' }]],
      [frame({ job: 'node-rtr-a', device: 'eth1' }), frame({ job: 'node-rtr-b', device: 'eth2' })]
    );
    expect(result.resolved.get('a')?.get('classes.host.status')).toEqual({ problem: 'Missing attribute port' });
    expect(candidates().map(({ attr, value }) => ({ attr, value }))).toEqual([{ attr: 'port', value: 'eth1' }]);
  });

  it('does not derive attribute values from regex matchers', () => {
    const { candidates } = setup(
      { key: 'job=~"${key}.*"' },
      [['a', { bind: 'host', key: 'wrong' }]],
      [frame({ job: 'node-rtr-a' })]
    );
    expect(candidates()).toEqual([]);
  });

  it.each([undefined, 'target'])('targets the measured end cell of a link with at=%s', (at) => {
    const xml =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="pa" parent="1"/><mxCell id="pb" parent="1"/>' +
      '<mxCell id="a" edge="1" parent="1" source="pa" target="pb"/></root></mxGraphModel>';
    const { candidates, result } = setup(
      { key: 'job', port: 'device' },
      [
        ['pa', {}],
        ['pb', { key: 'node-rtr-a', port: 'wrong' }],
        ['a', { bind: 'host', ...(at ? { at } : {}) }, true],
      ],
      [frame({ job: 'node-rtr-a', device: 'eth1' })],
      xml
    );
    expect(result.measured.get('a')?.end).toBe('target');
    expect(candidates().map(({ target, attr, value }) => ({ target, attr, value }))).toEqual([
      { target: 'pb', attr: 'port', value: 'eth1' },
    ]);
  });

  it('keeps the fixed series order, then limits the result to eight suggestions', () => {
    const frames = Array.from({ length: 12 }, (_, i) => frame({ job: `node-${String(11 - i).padStart(2, '0')}` }));
    const { candidates } = setup({ key: 'job' }, [['a', { bind: 'host', key: 'wrong' }]], frames);
    expect(candidates().map((c) => c.value)).toEqual([
      'node-00',
      'node-01',
      'node-02',
      'node-03',
      'node-04',
      'node-05',
      'node-06',
      'node-07',
    ]);
  });

  it('keeps series order when different series fail different matchers', () => {
    const { candidates } = setup(
      { key: 'job', port: 'device' },
      [['a', { bind: 'host', key: 'node-rtr-a', port: 'eth2' }]],
      [frame({ job: 'node-rtr-b', device: 'eth2' }), frame({ job: 'node-rtr-a', device: 'eth1' })]
    );
    expect(candidates().map((c) => c.value)).toEqual(['eth1', 'node-rtr-b']);
  });

  it('does not read inherited label properties, including constructor', () => {
    const inherited: Labels = Object.create({ constructor: 'node-rtr-a' });
    const own: Labels = Object.create(null);
    Object.defineProperty(own, 'constructor', { value: 'node-rtr-b', enumerable: true });
    const { candidates } = setup(
      { key: 'constructor' },
      [['a', { bind: 'host', key: 'wrong' }]],
      [frame(inherited), frame(own)]
    );
    expect(candidates().map((c) => c.value)).toEqual(['node-rtr-b']);
  });

  it('returns no suggestions without frames, for a matching use, or for an unknown cell', () => {
    const empty = setup({ key: 'job' }, [['a', { bind: 'host', key: 'wrong' }]], []);
    const matched = setup(
      { key: 'job' },
      [['a', { bind: 'host', key: 'node-rtr-a' }]],
      [frame({ job: 'node-rtr-a' }), frame({ job: 'node-rtr-b' })]
    );
    expect(empty.candidates()).toEqual([]);
    expect(matched.candidates()).toEqual([]);
    expect(matched.candidates('unknown')).toEqual([]);
  });

  it('deduplicates equal repairs without losing orphan preference', () => {
    const { candidates } = setup(
      { key: 'job' },
      [['a', { bind: 'host', key: 'wrong' }]],
      [frame({ job: 'node-rtr-a', site: 'a' }), frame({ job: 'node-rtr-a', site: 'b' })]
    );
    expect(candidates().map((c) => c.value)).toEqual(['node-rtr-a']);
  });

  it('does not throw when a label has an unexpected value', () => {
    const labels = { job: 'node-rtr-a' };
    const { candidates } = setup({ key: 'job' }, [['a', { bind: 'host', key: 'wrong' }]], [frame(labels)]);
    Object.assign(labels, { invalid: BigInt(1), missing: undefined });
    expect(candidates().map((c) => c.value)).toEqual(['node-rtr-a']);
  });

  it('extracts the attribute value from an equality template', () => {
    const { candidates } = setup(
      { key: 'job="node-${key}"' },
      [['a', { bind: 'host', key: 'wrong' }]],
      [frame({ job: 'node-rtr-a' })]
    );
    expect(candidates().map((c) => c.value)).toEqual(['rtr-a']);
  });

  it('targets an explicit geometric end and returns its attribute name', () => {
    const xml =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="pa" parent="1"/><mxCell id="pb" parent="1"/>' +
      '<mxCell id="a" edge="1" parent="1" source="pa" target="pb"/></root></mxGraphModel>';
    const { candidates } = setup(
      { id: 'job="${to.key}"' },
      [
        ['pa', {}],
        ['pb', { key: 'wrong' }],
        ['a', { bind: 'host' }, true],
      ],
      [frame({ job: 'node-rtr-a' })],
      xml
    );
    expect(candidates().map(({ target, attr, value }) => ({ target, attr, value }))).toEqual([
      { target: 'pb', attr: 'key', value: 'node-rtr-a' },
    ]);
  });
});
