import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sanitizeSvg } from '../render/sanitize';
import { buildCellIndex, mountSvg } from '../render/svgStage';
import { resolvePatterns } from '../binding/patterns';
import {
  commitDraft,
  createDraft,
  EMPTY_CONFIG,
  exportPatternDocument,
  previewPatternImport,
  reduceDraft,
} from '../editor/draft';
import { handleMessage, initialState } from '../editor/protocol';
import {
  applyContract,
  attachLinkLabels,
  cellMetaFromAttrs,
  cellIdentityDiagnostics,
  cellScope,
  contractWarning,
  nodeIcons,
  nodeParts,
  parseEndpoint,
} from './portograph';

describe('saved semantic identity', () => {
  it('retains ordinary nested rectangle identity and Unicode through save/export/reopen and portable assignment', () => {
    const xml = readFileSync(resolve(__dirname, '../fixtures/authoring.drawio'), 'utf8');
    const svg = readFileSync(resolve(__dirname, '../fixtures/authoring.svg'), 'utf8');
    const exporting = handleMessage(initialState(xml), { event: 'save', xml }, { mode: 'edit', isDark: false });
    expect(exporting.send).toContainEqual(expect.objectContaining({ action: 'export', embedCellMetadata: true }));
    const result = handleMessage(
      exporting.state,
      { event: 'export', data: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` },
      { mode: 'edit', isDark: false }
    ).result!;
    const reopened = JSON.parse(JSON.stringify(result));
    const index = buildCellIndex(mountSvg(document.createElement('div'), sanitizeSvg(reopened.svg).svg));
    const ordinary = index.get('ordinary-chart')!;
    expect(ordinary.meta.key).toBe('ordinary-chart');
    expect(ordinary.meta.labelText).toBe('Трафик α 🚀');
    expect(ordinary.shape?.localName).toBe('rect');
    expect(index.get('chart-group')?.shape).toBeUndefined();
    const xmlDocument = new DOMParser().parseFromString(reopened.xml, 'application/xml');
    expect(xmlDocument.querySelector('mxCell[id="ordinary-chart"]')?.getAttribute('parent')).toBe('chart-group');
    expect(xmlDocument.querySelector('mxCell[id="ordinary-chart"]')?.getAttribute('value')).toBe('Трафик α 🚀');
    let draft = reduceDraft(
      createDraft({ ...EMPTY_CONFIG, queries: [{ id: 'q', name: 'Трафик', source: { kind: 'panel', refId: 'A' } }] }),
      {
        type: 'widget',
        widget: {
          id: 'w',
          anchorCellId: ordinary.meta.id,
          kind: 'sparkline',
          label: 'Трафик α 🚀',
          binding: { queryId: 'q', match: {}, reducer: 'last' },
        },
      }
    );
    const imported = previewPatternImport(
      EMPTY_CONFIG,
      exportPatternDocument(commitDraft(draft)),
      Array.from(index.keys())
    ).config!;
    expect(
      resolvePatterns(
        Array.from(index.values(), (cell) => cell.meta),
        imported
      ).widgets[0].anchorCellId
    ).toBe('ordinary-chart');
    index.delete('ordinary-chart');
    expect(
      resolvePatterns(
        Array.from(index.values(), (cell) => cell.meta),
        imported
      ).diagnostics
    ).toContainEqual(expect.objectContaining({ code: 'missing-anchor' }));
    expect(imported.widgets).toHaveLength(1);
    draft = reduceDraft(createDraft(imported), { type: 'remove-widget', id: 'w' });
    expect(commitDraft(draft).widgets).toEqual([]);
  });
  it('diagnoses pasted semantic metadata on real indexed cells until the copied pg-id is repaired', () => {
    const svg = readFileSync(resolve(__dirname, '../fixtures/authoring.svg'), 'utf8');
    const root = mountSvg(document.createElement('div'), sanitizeSvg(svg).svg);
    const copy = root.querySelector('[data-cell-id="device-1"]')!.cloneNode(true) as Element;
    copy.setAttribute('data-cell-id', 'device-copy');
    root.append(copy);
    const plan = () =>
      resolvePatterns(
        Array.from(buildCellIndex(root).values(), (cell) => cell.meta),
        EMPTY_CONFIG
      );
    expect(plan().diagnostics).toContainEqual(expect.objectContaining({ code: 'duplicate-semantic-id' }));
    copy.setAttribute('data-meta-pg-id', 'device-copy');
    expect(plan().diagnostics).toEqual([]);
    expect(plan().cells['device-copy'].scope.cell?.label).toBe('Router α');
    expect(plan().cells['device-1'].scope.cell?.label).toBe('Router α');
  });
  it('explains copied pg-id metadata conflicts without falling back to Unicode labels', () => {
    const cells = [
      cellMetaFromAttrs('copy-1', { 'pg-id': 'router', 'pg-kind': 'node' }, false, 'Роутер α'),
      cellMetaFromAttrs('copy-2', { 'pg-id': 'router', 'pg-kind': 'node' }, false, 'Роутер β'),
    ];
    expect(cellIdentityDiagnostics(cells)).toEqual([
      expect.objectContaining({ code: 'duplicate-semantic-id', message: expect.stringMatching(/pg-id.*draw.io/) }),
    ]);
    cells[1].key = 'router-copy';
    expect(cellIdentityDiagnostics(cells)).toEqual([]);
  });
  it('retains physical IDs, semantic IDs and metric metadata through XML/SVG save and reopen', () => {
    const diagram = JSON.parse(
      JSON.stringify({
        xml: readFileSync(resolve(__dirname, '../../fixtures/demo/demo-l1.drawio'), 'utf8'),
        svg: readFileSync(resolve(__dirname, '../../fixtures/demo/svg/demo-l1.svg'), 'utf8'),
      })
    );
    const xml = new DOMParser().parseFromString(diagram.xml, 'application/xml');
    const reopenedXml = new DOMParser().parseFromString(new XMLSerializer().serializeToString(xml), 'application/xml');
    const index = buildCellIndex(mountSvg(document.createElement('div'), sanitizeSvg(diagram.svg).svg));
    const objects = Array.from(reopenedXml.querySelectorAll('object[pg-id]'));
    expect(objects.length).toBeGreaterThan(10);
    for (const object of objects) {
      const id = object.getAttribute('id')!;
      const meta = index.get(id)?.meta;
      expect(meta?.id).toBe(id);
      expect(meta?.key).toBe(object.getAttribute('pg-id'));
      for (const key of ['pg-id', 'pg-kind', 'pg-from', 'pg-to', 'device', 'job', 'capacity']) {
        if (object.hasAttribute(key)) {
          expect(meta?.attrs[key]).toBe(object.getAttribute(key));
        }
      }
    }
    expect(cellIdentityDiagnostics([...index.values()].map((entry) => entry.meta))).toEqual([]);
  });

  it('retains directional endpoint parameters independently of the display label', () => {
    const cell = cellMetaFromAttrs(
      'edge-1',
      { 'pg-id': 'uplink', 'pg-kind': 'link', 'pg-from': 'router-a:eth1#2', 'pg-to': 'router-b:eth2', device: 'wan' },
      true,
      'Same label'
    );
    expect(cellScope(cell)).toEqual({
      cell: { ...cell.attrs, id: 'edge-1', key: 'uplink', label: 'Same label' },
      from: { node: 'router-a', port: 'eth1', ordinal: '2', raw: 'router-a:eth1#2' },
      to: { node: 'router-b', port: 'eth2', ordinal: '1', raw: 'router-b:eth2' },
    });
  });
});

describe('parseEndpoint', () => {
  it('parses node, node:port and node:port#n', () => {
    expect(parseEndpoint('rtr-a')).toEqual({ node: 'rtr-a', port: undefined, ordinal: 1, raw: 'rtr-a' });
    expect(parseEndpoint('rtr-a:wan1')).toEqual({
      node: 'rtr-a',
      port: 'wan1',
      ordinal: 1,
      raw: 'rtr-a:wan1',
    });
    expect(parseEndpoint('sw1:eth#2')).toEqual({ node: 'sw1', port: 'eth', ordinal: 2, raw: 'sw1:eth#2' });
  });
});

describe('cellMetaFromAttrs', () => {
  it('maps a link with the pg contract', () => {
    const m = cellMetaFromAttrs(
      'pg-link~isp-a:pppoe->rtr-a:wan1',
      {
        label: '',
        'pg-kind': 'link',
        'pg-id': 'isp-a:pppoe->rtr-a:wan1',
        'pg-from': 'isp-a:pppoe',
        'pg-to': 'rtr-a:wan1',
      },
      true
    );
    expect(m.kind).toBe('link');
    expect(m.key).toBe('isp-a:pppoe->rtr-a:wan1');
    expect(m.from?.node).toBe('isp-a');
    expect(m.to?.port).toBe('wan1');
    expect(m.labelText).toBe('');
  });
  it('maps a node and a port', () => {
    const n = cellMetaFromAttrs(
      'pg-node~rtr-a',
      { 'pg-kind': 'node', 'pg-id': 'rtr-a', label: '<div>rtr-a</div>' },
      false,
      'rtr-a'
    );
    expect(n.kind).toBe('node');
    expect(n.key).toBe('rtr-a');
    expect(n.labelText).toBe('rtr-a');
    const p = cellMetaFromAttrs(
      'pg-port~rtr-a~wan3~1',
      { 'pg-kind': 'port', 'pg-id': 'rtr-a:wan3', 'pg-node': 'rtr-a', 'pg-port': 'wan3' },
      false,
      'wan3'
    );
    expect(p.kind).toBe('port');
    expect(p.attrs['pg-port']).toBe('wan3');
  });
  it('falls back for hand-drawn cells without pg attributes', () => {
    const v = cellMetaFromAttrs('node-a', { host: 'rtr-b', label: 'A' }, false, 'A');
    expect(v).toMatchObject({ kind: 'other', key: 'node-a', labelText: 'A', isEdge: false });
    expect(v.attrs.host).toBe('rtr-b');
    const e = cellMetaFromAttrs('edge-1', {}, true, '10G');
    expect(e).toMatchObject({ kind: 'other', isEdge: true, labelText: '10G' });
    expect(e.from).toBeUndefined();
  });
  it('keeps meta attributes such as capacity and job', () => {
    const m = cellMetaFromAttrs(
      'x',
      { 'pg-kind': 'link', 'pg-id': 'a->b', 'pg-from': 'a', 'pg-to': 'b', capacity: '1000000000' },
      true
    );
    expect(m.attrs.capacity).toBe('1000000000');
  });
});

describe('attachLinkLabels', () => {
  it('copies the link-label text onto its link by pg-of', () => {
    const link = cellMetaFromAttrs(
      'pg-link~a->b',
      { 'pg-kind': 'link', 'pg-id': 'a->b', 'pg-from': 'a', 'pg-to': 'b' },
      true
    );
    const label = cellMetaFromAttrs(
      'pg-linkLabel~a->b',
      { 'pg-kind': 'link-label', 'pg-of': 'a->b' },
      false,
      'metric 10'
    );
    const out = attachLinkLabels([link, label]);
    expect(out.find((c) => c.id === 'pg-link~a->b')?.labelText).toBe('metric 10');
    expect(out).toHaveLength(2);
  });
});

describe('nodeIcons', () => {
  const node = (id: string, key: string) => cellMetaFromAttrs(id, { 'pg-kind': 'node', 'pg-id': key }, false);
  const bare = (id: string, attrs: Record<string, string> = {}) => cellMetaFromAttrs(id, attrs, false);
  it('prefers a pg-kind=node-icon cell with pg-of', () => {
    const cells = [
      node('pg-node~a', 'a'),
      bare('pg-icon~a'),
      bare('custom-icon', { 'pg-kind': 'node-icon', 'pg-of': 'a' }),
    ];
    expect(nodeIcons(cells).get('a')).toBe('custom-icon');
  });
  it('a tile behind the tagged glyph takes the colour', () => {
    const cells = [
      node('pg-node~a', 'a'),
      bare('pg-iconTile~a'),
      bare('pg-icon~a', { 'pg-kind': 'node-icon', 'pg-of': 'a' }),
    ];
    expect(nodeIcons(cells).get('a')).toBe('pg-iconTile~a');
  });
  it('falls back to the icon tile, then to the icon cell id', () => {
    const cells = [
      node('pg-node~a', 'a'),
      bare('pg-icon~a'),
      bare('pg-iconTile~a'),
      node('pg-node~b', 'b'),
      bare('pg-icon~b'),
    ];
    const icons = nodeIcons(cells);
    expect(icons.get('a')).toBe('pg-iconTile~a');
    expect(icons.get('b')).toBe('pg-icon~b');
  });
  it('has no entry for a node without an icon', () => {
    expect(nodeIcons([node('pg-node~c', 'c')]).has('c')).toBe(false);
  });
});

describe('nodeParts', () => {
  it('maps the icon, tile and description cells of a node to the node cell', () => {
    const cells = [
      cellMetaFromAttrs('pg-node~a', { 'pg-kind': 'node', 'pg-id': 'a' }, false),
      cellMetaFromAttrs('pg-icon~a', {}, false),
      cellMetaFromAttrs('pg-iconTile~a', {}, false),
      cellMetaFromAttrs('t', { 'pg-kind': 'node-icon', 'pg-of': 'a' }, false),
      cellMetaFromAttrs('pg-nodeDescription~a', {}, false),
      cellMetaFromAttrs('pg-icon~zz', {}, false),
    ];
    expect(Object.fromEntries(nodeParts(cells))).toEqual({
      t: 'pg-node~a',
      'pg-iconTile~a': 'pg-node~a',
      'pg-icon~a': 'pg-node~a',
      'pg-nodeDescription~a': 'pg-node~a',
    });
  });
});

describe('applyContract', () => {
  const cells = (schema?: string) => [
    cellMetaFromAttrs('0', schema === undefined ? { label: '' } : { label: '', 'pg-schema': schema }, false),
    cellMetaFromAttrs('pg-node~a', { 'pg-kind': 'node', 'pg-id': 'a' }, false, 'A'),
    cellMetaFromAttrs(
      'pg-link~a:p1->b:p2',
      { 'pg-kind': 'link', 'pg-id': 'a:p1->b:p2', 'pg-from': 'a:p1', 'pg-to': 'b:p2' },
      true
    ),
  ];

  it('keeps the portograph kinds for schema 1', () => {
    const metas = cells('1');
    expect(applyContract(metas)).toEqual({ schema: '1', warning: undefined });
    expect(metas.map((m) => m.kind)).toEqual(['other', 'node', 'link']);
    expect(metas[2].from?.node).toBe('a');
  });

  it('makes all cells generic when the root has no pg-schema', () => {
    const metas = cells();
    expect(applyContract(metas)).toEqual({ schema: undefined, warning: undefined });
    expect(metas.map((m) => m.kind)).toEqual(['other', 'other', 'other']);
    expect(metas[1].key).toBe('pg-node~a');
    expect(metas[2].from).toBeUndefined();
    expect(metas[2].to).toBeUndefined();
    // The attributes stay: rules can still select generic cells by them.
    expect(metas[2].attrs['pg-from']).toBe('a:p1');
  });

  it('makes all cells generic when there is no root cell', () => {
    const metas = cells('1').slice(1);
    expect(applyContract(metas).schema).toBeUndefined();
    expect(metas.map((m) => m.kind)).toEqual(['other', 'other']);
  });

  it('warns about a higher schema and reads the cells as schema 1', () => {
    const metas = cells('2');
    expect(applyContract(metas)).toEqual({
      schema: '2',
      warning: 'diagram uses portograph contract v2; panel supports 1',
    });
    expect(metas.map((m) => m.kind)).toEqual(['other', 'node', 'link']);
  });
});

describe('contractWarning', () => {
  it('reads pg-schema of the root cell from the SVG text', () => {
    const svg = (s: string) => `<svg><g data-cell-id="0" data-meta-label="" ${s}></g><g data-cell-id="1"></g></svg>`;
    expect(contractWarning(svg('data-meta-pg-schema="1"'))).toBeUndefined();
    expect(contractWarning(svg(''))).toBeUndefined();
    expect(contractWarning(svg('data-meta-pg-schema="3"'))).toBe(
      'diagram uses portograph contract v3; panel supports 1'
    );
    // pg-schema on another cell does not count.
    expect(contractWarning('<svg><g data-cell-id="7" data-meta-pg-schema="3"></g></svg>')).toBeUndefined();
  });
});
