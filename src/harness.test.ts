import { createTheme, dateTime, FieldType, LoadingState, type PanelData } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { netL2Pilot } from './fixtures/pilots-v4';

const names = [
  'attrOf',
  'bind',
  'buildCard',
  'buildCellIndex',
  'buildLegend',
  'cellMetas',
  'compileMatcher',
  'edgeEnds',
  'endAttr',
  'fnv1a',
  'historyOf',
  'mountSvg',
  'sanitizeSvg',
  'setCellAttrs',
  'validateConfig',
];
const theme = createTheme();
const ctx = {
  theme,
  replaceVariables: (text: string) => text,
  display: (_series: unknown, value: number) => ({ numeric: value, text: String(value) }),
  linkWidth: { min: 2, max: 10 },
};

function panelData(series: PanelData['series'] = []): PanelData {
  return {
    state: LoadingState.Done,
    series,
    timeRange: { from: dateTime(0), to: dateTime(120_000), raw: { from: dateTime(0), to: dateTime(120_000) } },
  };
}

async function pilot(data = panelData()) {
  const harness = await import('./harness');
  const svg = harness.sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg">
    <g data-cell-id="host" data-meta-bind="host" data-meta-key="host-a" data-meta-object_class="Server">
      <rect width="40" height="20"/><text>Host A</text>
    </g>
    <g data-cell-id="link" data-meta-bind="lan" data-meta-key="sw-a" data-meta-port="1"
       data-meta-cap="1G" data-meta-path_role="uplink">
      <path d="M 0 0 L 100 0" fill="none" pointer-events="stroke"/>
    </g>
  </svg>`);
  const index = harness.buildCellIndex(harness.mountSvg(document.createElement('div'), svg.svg));
  const validated = harness.validateConfig(netL2Pilot());
  const bound = harness.bind({ index, validated, data, ctx });
  return { harness, index, validated, bound, data };
}

describe('the consumer harness', () => {
  it('exports exactly the pinned names', async () => {
    expect(Object.keys(await import('./harness')).sort()).toEqual(names);
  });

  it('resolves cell and endpoint attributes through the shared resolver', async () => {
    const { attrOf, edgeEnds, endAttr, buildCellIndex, mountSvg } = await import('./harness');
    const index = buildCellIndex(
      mountSvg(
        document.createElement('div'),
        `<svg xmlns="http://www.w3.org/2000/svg">
      <g data-cell-id="node" data-meta-key="host-a"/>
      <g data-cell-id="port" data-meta-port="1"/>
      <g data-cell-id="link" data-meta-key="link-a"/>
    </svg>`
      )
    );
    const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="node" parent="1"/><mxCell id="port" parent="node"/>
      <mxCell id="link" parent="1" edge="1" source="port" target="node"/>
    </root></mxGraphModel>`;
    let reads = 0;
    const context = { index, ...edgeEnds(xml, index) };
    const attrs = attrOf(() => {
      reads++;
      return context;
    })(index.get('link')!.meta);
    expect(attrs('id')).toBe('link');
    expect(attrs('key')).toBe('link-a');
    expect(attrs('missing')).toBeUndefined();
    expect(attrs('constructor')).toBeUndefined();
    expect(reads).toBe(0);
    expect(attrs('from.id')).toBe('port');
    expect(attrs('from.port')).toBe('1');
    expect(attrs('from.key')).toBe('host-a');
    expect(attrs('to.key')).toBe('host-a');
    expect(attrs('to.missing')).toBeUndefined();
    expect(endAttr('link', 'from', 'key', context)).toBe(attrs('from.key'));
  });

  it('validates and binds the network pilot with empty panel data without a schema entry', async () => {
    const { harness, index, validated, bound } = await pilot();
    expect(validated.parsed.config?.version).toBe(4);
    expect([...validated.report, ...bound.report].filter((entry) => entry.kind === 'schema')).toEqual([]);
    expect(harness.cellMetas(index).map((meta) => meta.id)).toEqual(['host', 'link']);
    expect([...bound.patches.keys()]).toEqual(['host', 'link']);
    expect(bound.report.some((entry) => entry.kind === 'no-series')).toBe(true);
    expect(bound.patches.get('host')?.statusV4?.state).toBe('missing');
  });

  it('compiles v4 matches with cell attributes and anchored regex semantics', async () => {
    const { compileMatcher } = await import('./harness');
    const match = compileMatcher({ key: 'job=~"${key}:.*"' }, (name) => (name === 'key' ? 'host.a' : undefined));
    expect(match.ok).toBe(true);
    if (match.ok) {
      expect(match.test({ job: 'host.a:9100' })).toBe(true);
      expect(match.test({ job: 'hostXa:9100' })).toBe(false);
      expect(match.test({ job: 'other-host.a:9100' })).toBe(false);
    }
  });

  it('returns matcher schema errors and missing attributes', async () => {
    const { compileMatcher } = await import('./harness');
    expect(compileMatcher({ key: 'job="unterminated' }, () => undefined, 'classes.host.match')).toMatchObject({
      ok: false,
      errors: [{ path: 'classes.host.match.key' }],
    });
    expect(compileMatcher({ key: 'job' }, () => undefined)).toEqual({ ok: false, kind: 'missing-attr', attr: 'key' });
    expect(compileMatcher({ key: 'job=~"${key}["' }, () => 'host-a')).toMatchObject({
      ok: false,
      kind: 'matcher-error',
    });
  });

  it('reads the v4 history of one use through the card row helper', async () => {
    const { harness, index, validated, bound, data } = await pilot(
      panelData([
        {
          refId: 'host_cpu',
          length: 3,
          fields: [
            { name: 'Time', type: FieldType.time, config: {}, values: [0, 60_000, 120_000] },
            {
              name: 'Value',
              type: FieldType.number,
              config: { unit: 'percent' },
              labels: { job: 'host-a' },
              values: [10, null, 30],
            },
          ],
        },
      ])
    );
    const use = bound.uses.get('host')!.find((use) => use.refId === 'host_cpu')!;
    const context = { ...ctx, index, validated, data };
    const history = harness.historyOf('host', use, bound, context);
    const card = harness.buildCard('host', bound, context);
    expect(history).toMatchObject({
      kind: 'history',
      state: 'ready',
      domain: [0, 100],
      lines: [{ times: [0, 60_000, 120_000], values: [10, null, 30] }],
    });
    expect(history).toEqual({
      ...card.rows.find((row) => row.kind === 'history'),
      key: 'chart',
      format: expect.any(Function),
    });
  });

  it('keeps an empty v4 history empty', async () => {
    const { harness, index, validated, bound, data } = await pilot();
    const use = bound.uses.get('host')!.find((use) => use.refId === 'host_cpu')!;
    expect(harness.historyOf('host', use, bound, { ...ctx, index, validated, data })).toMatchObject({
      kind: 'history',
      state: 'empty',
      text: 'No data',
      lines: [],
    });
  });
});
