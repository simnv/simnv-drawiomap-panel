import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from './sanitize';
import { buildCellIndex, cellMetas, mountSvg } from './svgStage';

const fixture = (n: string) =>
  sanitizeSvg(readFileSync(resolve(__dirname, `../../fixtures/demo/svg/${n}.svg`), 'utf8')).svg;

describe('mountSvg', () => {
  it('rejects duplicate physical identities instead of silently indexing the last pasted cell', () => {
    const root = mountSvg(
      document.createElement('div'),
      '<svg><g data-cell-id="copied"><rect/></g><g data-cell-id="copied"><rect/></g></svg>'
    );
    expect(() => buildCellIndex(root)).toThrow(/copied.*unique identity/i);
  });
  it('replaces the container content with the svg root', () => {
    const c = document.createElement('div');
    c.innerHTML = '<p>old</p>';
    const root = mountSvg(c, fixture('hand-drawn'));
    expect(c.children).toHaveLength(1);
    expect(c.firstElementChild).toBe(root);
    expect(root.tagName.toLowerCase()).toBe('svg');
    expect(root.getAttribute('viewBox')).toMatch(/^0 0 /);
  });
});

describe('buildCellIndex on demo-l3', () => {
  const c = document.createElement('div');
  const root = mountSvg(c, fixture('demo-l3'));
  const index = buildCellIndex(root);
  it('indexes every data-cell-id group', () => {
    expect(index.size).toBe(100);
  });
  it('maps pg kinds', () => {
    const kinds = cellMetas(index).reduce<Record<string, number>>(
      (acc, m) => ((acc[m.kind] = (acc[m.kind] ?? 0) + 1), acc),
      {}
    );
    expect(kinds).toMatchObject({ link: 10, node: 10, port: 20, 'link-label': 2 });
  });
  it('finds the edge polyline and the decoded id', () => {
    const e = index.get('pg-link~isp-a:pppoe->rtr-a:wan1')!;
    expect(e).toBeDefined();
    expect(e.meta.isEdge).toBe(true);
    expect(e.line?.getAttribute('d')).toMatch(/^M/);
    expect(e.line?.getAttribute('fill')).toBe('none');
    expect(e.meta.from).toMatchObject({ node: 'isp-a', port: 'pppoe' });
    expect(e.meta.to).toMatchObject({ node: 'rtr-a', port: 'wan1' });
    expect(e.meta.attrs['pg-id']).toBe('isp-a:pppoe->rtr-a:wan1');
  });
  it('finds a vertex shape and label text', () => {
    const n = index.get('pg-node~rtr-a')!;
    expect(n.meta.kind).toBe('node');
    expect(n.shape?.tagName.toLowerCase()).toMatch(/rect|path/);
    expect(n.meta.labelText).toContain('rtr-a');
    expect(n.shape).not.toBe(n.line);
  });
  it('copies link-label text onto the link', () => {
    const e = index.get('pg-link~isp-a:pppoe->rtr-a:wan1')!;
    expect(e.meta.labelText).toContain('metric 10');
  });
  it('records original styles for reset', () => {
    const n = index.get('pg-node~rtr-a')!;
    expect(n.original).toHaveProperty('fill');
  });
  it('records detached clones of the label markup', () => {
    const n = index.get('pg-node~rtr-a')!;
    const nodes = n.original.labelNodes!;
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0].parentNode).toBeNull();
    expect(nodes.map((x) => (x as Element).outerHTML ?? x.textContent).join('')).toBe(n.label!.innerHTML);
  });
});

describe('buildCellIndex on plain-text labels', () => {
  it('reads a node name as one native <text> and its description as a cell of its own', () => {
    const index = buildCellIndex(mountSvg(document.createElement('div'), fixture('demo-l3')));
    const n = index.get('pg-node~rtr-a')!;
    expect(n.label?.localName).toBe('text');
    expect(n.meta.labelText).toBe('rtr-a');
    expect(index.get('pg-nodeDescription~rtr-a')?.meta).toMatchObject({ kind: 'other', labelText: 'multi-WAN + PBR' });
  });
  it('joins the lines of a multi-line label and keeps their <g> as the label', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-cell-id="n"><g><rect width="5" height="5"/></g><g><g fill="#000"><text x="1" y="2">first</text><text x="1" y="4">second</text></g></g></g></svg>`;
    const index = buildCellIndex(mountSvg(document.createElement('div'), svg));
    const n = index.get('n')!;
    expect(n.label?.localName).toBe('g');
    expect(n.meta.labelText).toBe('first second');
  });
  it('keeps a single <text> as the label when its parent is not a draw.io label group', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-cell-id="n"><a><text>A</text><text>B</text></a></g><g data-cell-id="m"><g><path d="M0 0"/><text>C</text><text>D</text></g></g></svg>`;
    const index = buildCellIndex(mountSvg(document.createElement('div'), svg));
    expect(index.get('n')!.label?.localName).toBe('text');
    expect(index.get('n')!.meta.labelText).toBe('A');
    expect(index.get('m')!.label?.localName).toBe('text');
  });
});

describe('buildCellIndex on hand-drawn', () => {
  const c = document.createElement('div');
  const index = buildCellIndex(mountSvg(c, fixture('hand-drawn')));
  it('indexes plain and object cells with kind other', () => {
    expect(index.get('node-a')?.meta).toMatchObject({ kind: 'other', key: 'node-a', labelText: 'rtr-b' });
    expect(index.get('node-a')?.meta.attrs.host).toBe('rtr-b');
    expect(index.get('node-b')?.meta.labelText).toBe('rtr-a');
    expect(index.get('edge-ab')?.meta.isEdge).toBe(true);
    expect(index.get('edge-ab')?.meta.attrs.capacity).toBe('100000000');
    expect(index.get('lbl-ab')?.meta.labelText).toBe('10G');
  });
});

describe('node icons on demo-l3', () => {
  const c = document.createElement('div');
  const index = buildCellIndex(mountSvg(c, fixture('demo-l3')));
  it('links each node to its icon cell, the icon tile first', () => {
    expect(index.get('pg-node~rtr-a')!.iconId).toBe('pg-icon~rtr-a');
    expect(index.get('pg-node~lte')!.iconId).toBe('pg-iconTile~lte');
    expect(index.get('pg-icon~rtr-a')!.shape?.localName).toBe('ellipse');
  });
  it('marks the icon cells with their node', () => {
    expect(index.get('pg-icon~lte')!.ownerId).toBe('pg-node~lte');
    expect(index.get('pg-iconTile~lte')!.ownerId).toBe('pg-node~lte');
    expect(index.get('pg-nodeDescription~rtr-a')!.ownerId).toBe('pg-node~rtr-a');
    expect(index.get('pg-node~lte')!.ownerId).toBeUndefined();
  });
  it('keeps the inline stroke width of a vertex shape for the reset', () => {
    const e = index.get('pg-node~rtr-a')!;
    expect(e.original.strokeWidth).toBe((e.shape as SVGElement).style.strokeWidth);
  });
});

describe('buildCellIndex and pg-schema', () => {
  it('reads the pg attributes as generic cells when the root cell has no pg-schema', () => {
    const svg = fixture('demo-l3').replace(/\sdata-meta-pg-schema="1"/, '');
    const index = buildCellIndex(mountSvg(document.createElement('div'), svg));
    const metas = cellMetas(index);
    expect(metas.length).toBe(100);
    expect(metas.every((m) => m.kind === 'other' && m.key === m.id && !m.from)).toBe(true);
  });
});
