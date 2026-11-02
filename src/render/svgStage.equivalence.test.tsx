// This file is .tsx on purpose: the `components` test project takes it. It reaches DOMPurify through sanitizeSvg.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assignTitles } from '../adapter/cellTitle';
import { applyContract, attachLinkLabels, cellMetaFromAttrs, nodeIcons, nodeParts } from '../adapter/portograph';
import type { CellEntry, CellIndex } from '../types';
import { markerEnd } from './geometry';
import { sanitizeSvg } from './sanitize';
import { buildCellIndex, cellMetas, mountSvg } from './svgStage';

// ORACLE: a copy of buildCellIndex as it was before the single-pass change. Each cell group runs its own
// querySelectorAll over its whole subtree and drops the elements of nested cells. Do not "improve" this copy.
const SHAPE_TAGS = new Set(['rect', 'path', 'ellipse', 'circle', 'polygon', 'image']);

function insideNestedCell(el: Element, group: Element): boolean {
  let p = el.parentElement;
  while (p && p !== group) {
    if (p.hasAttribute('data-cell-id')) {
      return true;
    }
    p = p.parentElement;
  }
  return false;
}

function ownDescendants(group: Element, selector: string): Element[] {
  return Array.from(group.querySelectorAll(selector)).filter((el) => !insideNestedCell(el, group));
}

function metaAttrs(group: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(group.attributes)) {
    if (a.name.startsWith('data-meta-')) {
      attrs[a.name.slice('data-meta-'.length)] = a.value;
    }
  }
  return attrs;
}

function oracleLabelOf(group: Element): { el?: Element; text: string } {
  const text = ownDescendants(group, 'text')[0];
  if (text) {
    const parent = text.parentElement;
    const children = parent ? Array.from(parent.children) : [];
    const lines = children.filter((el) => el.localName === 'text');
    const isLabelGroup =
      parent?.localName === 'g' &&
      !parent.hasAttribute('data-cell-id') &&
      lines.length > 1 &&
      children.every((el) => el.localName === 'text' || el.localName === 'rect');
    const el = isLabelGroup ? parent! : text;
    const own = isLabelGroup ? lines : [text];
    return {
      el,
      text: own
        .map((l) => l.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    };
  }
  const fo = ownDescendants(group, 'foreignObject')[0];
  if (fo) {
    return { el: fo, text: (fo.textContent ?? '').replace(/\s+/g, ' ').trim() };
  }
  return { text: '' };
}

function oracleBuildCellIndex(root: SVGSVGElement): CellIndex {
  const index: CellIndex = new Map();
  for (const group of Array.from(root.querySelectorAll('g[data-cell-id]')) as SVGGElement[]) {
    const id = group.getAttribute('data-cell-id')!;
    if (index.has(id)) {
      throw new Error(`Cell ${id} is duplicated. Assign each pasted cell a unique identity in draw.io.`);
    }
    const paths = ownDescendants(group, 'path') as SVGPathElement[];
    const line = paths.find((p) => p.getAttribute('fill') === 'none' && p.getAttribute('pointer-events') === 'stroke');
    const arrows = line ? paths.filter((p) => p !== line && p.getAttribute('pointer-events') === 'all') : [];
    const ends = line
      ? ownDescendants(group, 'ellipse, circle').flatMap((el) => {
          const end = el.closest('switch, foreignObject') ? undefined : markerEnd(line, el as SVGGraphicsElement);
          return end ? [{ el: el as SVGGraphicsElement, end }] : [];
        })
      : [];
    let shape: SVGGraphicsElement | undefined;
    if (!line) {
      shape = ownDescendants(group, Array.from(SHAPE_TAGS).join(',')).find(
        (el) => SHAPE_TAGS.has(el.localName) && !el.closest('switch, foreignObject')
      ) as SVGGraphicsElement | undefined;
    }
    const label = oracleLabelOf(group);
    const meta = cellMetaFromAttrs(id, metaAttrs(group), !!line, label.text || undefined);
    index.set(id, {
      meta,
      group,
      shape,
      line,
      arrows,
      ends,
      label: label.el,
      original: {
        fill: shape?.style.fill,
        stroke: shape?.style.stroke ?? line?.style.stroke,
        strokeWidth: (line ?? (shape as SVGElement | undefined))?.style.strokeWidth,
        text: label.text,
        labelNodes: label.el && Array.from(label.el.childNodes, (n) => n.cloneNode(true)),
      },
    });
  }
  const metas = cellMetas(index);
  applyContract(metas);
  attachLinkLabels(metas);
  assignTitles(metas);
  const icons = nodeIcons(metas);
  const owners = nodeParts(metas);
  for (const entry of index.values()) {
    if (entry.meta.kind === 'node') {
      entry.iconId = icons.get(entry.meta.key);
    }
    entry.ownerId = owners.get(entry.meta.id);
  }
  return index;
}

/** Same element in the same place. DOM nodes compare by identity, the rest by value. */
function expectSameEntry(actual: CellEntry, expected: CellEntry, id: string): void {
  const at = `cell ${id}`;
  expect(actual.group, `${at} group`).toBe(expected.group);
  expect(actual.shape ?? null, `${at} shape`).toBe(expected.shape ?? null);
  expect(actual.line ?? null, `${at} line`).toBe(expected.line ?? null);
  expect(actual.label ?? null, `${at} label`).toBe(expected.label ?? null);
  expect(actual.arrows.length, `${at} arrow count`).toBe(expected.arrows.length);
  actual.arrows.forEach((a, i) => expect(a, `${at} arrow ${i}`).toBe(expected.arrows[i]));
  const aEnds = actual.ends ?? [];
  const eEnds = expected.ends ?? [];
  expect(aEnds.length, `${at} end count`).toBe(eEnds.length);
  aEnds.forEach((e, i) => {
    expect(e.el, `${at} end ${i} element`).toBe(eEnds[i].el);
    expect(e.end, `${at} end ${i} point`).toEqual(eEnds[i].end);
  });
  const { labelNodes: aNodes, ...aRest } = actual.original;
  const { labelNodes: eNodes, ...eRest } = expected.original;
  expect(aRest, `${at} original`).toEqual(eRest);
  expect(aNodes?.length, `${at} label node count`).toBe(eNodes?.length);
  aNodes?.forEach((n, i) => expect(n.isEqualNode(eNodes![i]), `${at} label node ${i}`).toBe(true));
  expect(actual.meta, `${at} meta`).toEqual(expected.meta);
  expect(actual.iconId, `${at} iconId`).toEqual(expected.iconId);
  expect(actual.ownerId, `${at} ownerId`).toEqual(expected.ownerId);
}

/** Build both indexes on the same mounted SVG and compare every entry and the key order. */
function expectSameIndex(root: SVGSVGElement): number {
  const expected = oracleBuildCellIndex(root);
  const actual = buildCellIndex(root);
  expect(Array.from(actual.keys())).toEqual(Array.from(expected.keys()));
  for (const [id, entry] of expected) {
    expectSameEntry(actual.get(id)!, entry, id);
  }
  return actual.size;
}

const mount = (svg: string) => mountSvg(document.createElement('div'), svg);

describe('buildCellIndex equals the per-group scan on the demo SVG files', () => {
  const dir = resolve(__dirname, '../../fixtures/demo/svg');
  const files = readdirSync(dir).filter((f) => f.endsWith('.svg'));
  it('finds the demo SVG files', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });
  it.each(files)('%s (sanitised)', (file) => {
    const root = mount(sanitizeSvg(readFileSync(resolve(dir, file), 'utf8')).svg);
    expect(expectSameIndex(root)).toBeGreaterThan(0);
  });
  it.each(files)('%s (raw)', (file) => {
    const root = mount(readFileSync(resolve(dir, file), 'utf8'));
    expectSameIndex(root);
  });
});

describe('buildCellIndex equals the per-group scan on nested groups', () => {
  const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  const cases: Record<string, string> = {
    'cell inside cell': svg(
      '<g data-cell-id="outer"><rect id="o1"/><text>outer</text>' +
        '<g data-cell-id="inner"><rect id="i1"/><text>inner</text></g>' +
        '<rect id="o2"/></g>'
    ),
    'three levels, plain groups between cells': svg(
      '<g data-cell-id="0"><g data-cell-id="1"><g><g data-cell-id="a"><g><rect id="ra"/></g></g>' +
        '<g data-cell-id="b"><path id="pb" d="M0 0L1 1"/></g></g></g></g>'
    ),
    'element directly in a wrapper, before and after the nested cell': svg(
      '<g data-cell-id="wrap"><rect id="w1"/><g data-cell-id="kid"><circle id="k1"/></g><rect id="w2"/>' +
        '<text>wrapper text</text></g>'
    ),
    'wrapper with only nested cells owns nothing': svg(
      '<g data-cell-id="wrap"><g data-cell-id="a"><rect/></g><g data-cell-id="b"><rect/></g></g>'
    ),
    'empty groups': svg('<g data-cell-id="e1"></g><g data-cell-id="e2"><g></g></g><g data-cell-id="e3"/>'),
    'element outside every cell': svg('<rect id="loose"/><g data-cell-id="a"><rect/></g><text>loose</text>'),
    'text inside foreignObject': svg(
      '<g data-cell-id="fo1"><rect/><switch><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">html label</div></foreignObject>' +
        '<text>fallback</text></switch></g>' +
        '<g data-cell-id="fo2"><switch><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">only html</div></foreignObject></switch></g>'
    ),
    'shape only inside switch or foreignObject is skipped': svg(
      '<g data-cell-id="s1"><switch><rect id="inswitch"/></switch><foreignObject><rect id="info"/></foreignObject>' +
        '<ellipse id="real"/></g>'
    ),
    'multi-line plain-text label group': svg(
      '<g data-cell-id="ml"><rect/><g><rect/><text>line one</text><text>line two</text></g></g>'
    ),
    'edge with arrows and end dots': svg(
      '<g data-cell-id="edge"><path d="M0 0L10 0" fill="none" pointer-events="stroke"/>' +
        '<path d="M10 0L8 2L8 -2Z" pointer-events="all"/><ellipse cx="0" cy="0" rx="2" ry="2"/>' +
        '<circle cx="10" cy="0" r="2"/><circle cx="5" cy="5" r="2"/></g>'
    ),
    'edge inside a wrapper with a node inside the edge': svg(
      '<g data-cell-id="wrap"><g data-cell-id="edge"><path d="M0 0L10 0" fill="none" pointer-events="stroke"/>' +
        '<g data-cell-id="inner"><circle cx="0" cy="0" r="2"/><path d="M0 0L1 1"/></g></g></g>'
    ),
    'non-g element that has data-cell-id': svg(
      '<g data-cell-id="a"><a data-cell-id="link"><rect id="hidden"/></a><rect data-cell-id="notgroup"/><circle id="c"/></g>'
    ),
    'portograph-style ids and meta attributes': svg(
      '<g data-cell-id="pg-layer~diagram"><g data-cell-id="pg-group~g1" data-meta-pg-id="g1">' +
        '<g data-cell-id="pg-node~n1" data-meta-pg-id="n1" data-meta-pg-kind="node"><rect/><text>node 1</text></g></g></g>'
    ),
  };
  it.each(Object.entries(cases))('%s', (_name, markup) => {
    const root = mount(markup);
    expectSameIndex(root);
  });
  it('checks the nested-cell cases against hand-written expectations', () => {
    const index = buildCellIndex(
      mount(
        svg('<g data-cell-id="outer"><rect id="o1"/><g data-cell-id="inner"><rect id="i1"/><text>inner</text></g></g>')
      )
    );
    expect(index.get('outer')!.shape?.id).toBe('o1');
    expect(index.get('outer')!.label).toBeUndefined();
    expect(index.get('inner')!.shape?.id).toBe('i1');
    expect(index.get('inner')!.original.text).toBe('inner');
  });
  it('keeps the duplicate-identity error', () => {
    const markup = svg('<g data-cell-id="x"><rect/></g><g data-cell-id="x"><rect/></g>');
    expect(() => buildCellIndex(mount(markup))).toThrow(/x is duplicated/);
  });
});
