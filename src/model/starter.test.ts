import { describe, expect, it } from 'vitest';
import { buildStarter, isEmptyConfig, starterFacts } from './starter';
import { validateConfig } from './validate';

type Case = [string, Parameters<typeof buildStarter>[0], Record<string, unknown>];

const node = (status?: string) => ({ match: { key: 'job' }, ...(status ? { status } : {}) });

const cases: Case[] = [
  [
    'portograph, tx and rx',
    { portograph: true, edges: true, refIds: ['up', 'lan_tx', 'lan_rx'] },
    { node: node('up'), link: { match: { key: 'job', port: 'device' }, up: 'lan_tx', down: 'lan_rx' } },
  ],
  [
    'portograph, in and out (out is up)',
    { portograph: true, edges: true, refIds: ['A', 'bytes_in', 'bytes_out'] },
    { node: node('A'), link: { match: { key: 'job', port: 'device' }, up: 'bytes_out', down: 'bytes_in' } },
  ],
  [
    'portograph, up and down names',
    { portograph: true, edges: true, refIds: ['state', 'rate_up', 'rate_down'] },
    { node: node('state'), link: { match: { key: 'job', port: 'device' }, up: 'rate_up', down: 'rate_down' } },
  ],
  [
    'portograph, one counter only',
    { portograph: true, edges: true, refIds: ['A', 'B'] },
    { node: node('A'), link: { match: { key: 'job', port: 'device' } } },
  ],
  [
    'portograph, no target',
    { portograph: true, edges: false, refIds: [] },
    { node: node(), link: { match: { key: 'job', port: 'device' } } },
  ],
  ['plain, no edge', { portograph: false, edges: false, refIds: ['A'] }, { node: node('A') }],
  [
    'plain, edges',
    { portograph: false, edges: true, refIds: ['status', 'tx', 'rx'] },
    { node: node('status'), link: { match: { key: 'job' }, up: 'tx', down: 'rx' } },
  ],
  [
    'the status looks like state, not the first',
    { portograph: false, edges: false, refIds: ['A', 'node_state'] },
    { node: node('node_state') },
  ],
];

describe('buildStarter', () => {
  it.each(cases)('%s', (_name, input, classes) => {
    const config = buildStarter(input);
    expect(config).toEqual({ version: 4, freshness: '3x', classes });
    const { parsed, report } = validateConfig(config);
    expect(parsed.config).not.toBeNull();
    expect(report.filter((e) => e.kind === 'schema')).toEqual([]);
  });
});

describe('isEmptyConfig', () => {
  it.each([
    [undefined, true],
    [null, true],
    [{}, true],
    [{ classes: {} }, true],
    [{ version: 4, classes: {} }, false],
    [{ version: 4, classes: { a: {} } }, false],
    [{ classes: { a: {} } }, false],
    [[], false],
    ['text', false],
  ])('%j is %s', (value, expected) => {
    expect(isEmptyConfig(value)).toBe(expected);
  });
});

describe('starterFacts', () => {
  const xml = (edge: boolean) =>
    `<mxGraphModel><root><mxCell id="1"/>${edge ? '<mxCell id="e" edge="1"/>' : ''}</root></mxGraphModel>`;
  const svg = (schema: boolean) => `<svg><g data-cell-id="0"${schema ? ' data-meta-pg-schema="1"' : ''}></g></svg>`;
  it('reads a portograph with an edge', () => {
    expect(starterFacts({ xml: xml(true), svg: svg(true) })).toEqual({ portograph: true, edges: true });
  });
  it('reads a plain diagram with no edge', () => {
    expect(starterFacts({ xml: xml(false), svg: svg(false) })).toEqual({ portograph: false, edges: false });
  });
  it('assumes edges for a compressed page', () => {
    expect(starterFacts({ xml: '<mxfile><diagram>eJz</diagram></mxfile>', svg: svg(false) }).edges).toBe(true);
  });
});
