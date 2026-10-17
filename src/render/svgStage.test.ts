import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from './sanitize';
import { buildCellIndex, cellMetas, mountSvg } from './svgStage';

const fixture = (n: string) => sanitizeSvg(readFileSync(resolve(__dirname, `../../fixtures/svg/${n}.svg`), 'utf8')).svg;

describe('mountSvg', () => {
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

describe('buildCellIndex on l3-routing', () => {
  const c = document.createElement('div');
  const root = mountSvg(c, fixture('l3-routing'));
  const index = buildCellIndex(root);
  it('indexes every data-cell-id group', () => {
    expect(index.size).toBe(100);
  });
  it('maps pg kinds', () => {
    const kinds = cellMetas(index).reduce<Record<string, number>>(
      (acc, m) => ((acc[m.kind] = (acc[m.kind] ?? 0) + 1), acc),
      {}
    );
    expect(kinds).toMatchObject({ link: 10, node: 10, port: 20, 'link-label': 8 });
  });
  it('finds the edge polyline and the decoded id', () => {
    const e = index.get('pg-link~wan1:pppoe->rtr-a:wan1')!;
    expect(e).toBeDefined();
    expect(e.meta.isEdge).toBe(true);
    expect(e.line?.getAttribute('d')).toMatch(/^M/);
    expect(e.line?.getAttribute('fill')).toBe('none');
    expect(e.meta.from).toMatchObject({ node: 'wan1', port: 'pppoe' });
    expect(e.meta.to).toMatchObject({ node: 'rtr-a', port: 'wan1' });
    expect(e.meta.attrs['pg-id']).toBe('wan1:pppoe->rtr-a:wan1');
  });
  it('finds a vertex shape and label text', () => {
    const n = index.get('pg-node~rtr-a')!;
    expect(n.meta.kind).toBe('node');
    expect(n.shape?.tagName.toLowerCase()).toMatch(/rect|path/);
    expect(n.meta.labelText).toContain('rtr-a');
    expect(n.shape).not.toBe(n.line);
  });
  it('copies link-label text onto the link', () => {
    const e = index.get('pg-link~wan1:pppoe->rtr-a:wan1')!;
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

describe('node icons on l3-routing', () => {
  const c = document.createElement('div');
  const index = buildCellIndex(mountSvg(c, fixture('l3-routing')));
  it('links each node to its icon cell, the icon tile first', () => {
    expect(index.get('pg-node~rtr-a')!.iconId).toBe('pg-icon~rtr-a');
    expect(index.get('pg-node~lte')!.iconId).toBe('pg-iconTile~lte');
    expect(index.get('pg-icon~rtr-a')!.shape?.localName).toBe('ellipse');
  });
  it('marks the icon cells with their node', () => {
    expect(index.get('pg-icon~lte')!.ownerId).toBe('pg-node~lte');
    expect(index.get('pg-iconTile~lte')!.ownerId).toBe('pg-node~lte');
    expect(index.get('pg-node~lte')!.ownerId).toBeUndefined();
  });
  it('keeps the inline stroke width of a vertex shape for the reset', () => {
    const e = index.get('pg-node~rtr-a')!;
    expect(e.original.strokeWidth).toBe((e.shape as SVGElement).style.strokeWidth);
  });
});
