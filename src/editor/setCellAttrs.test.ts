import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeSvg } from '../render/sanitize';
import type { Diagram } from '../types';
import { fnv1a } from '../util/hash';
import { setCellAttrs } from './setCellAttrs';

const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
  <object id="host-a" label="Host A" bind="host" key="host-a" port="1" pg-kind="node"><mxCell parent="1" vertex="1" style="rounded=1;"><mxGeometry width="80" height="40" as="geometry"/></mxCell></object>
  <UserObject id="host-b" label="Host B" key="host-b"><mxCell parent="1" vertex="1"/></UserObject>
  <mxCell id="link-a" value="A &amp; B" source="host-a" target="host-b" parent="1" style="endArrow=none;" edge="1"><mxGeometry relative="1" as="geometry"><mxPoint x="10" y="20" as="sourcePoint"/></mxGeometry></mxCell>
  <mxCell id="bare-node" parent="1" vertex="1"/>
</root></mxGraphModel>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="host-a" data-meta-label="Host A" data-meta-bind="host" data-meta-key="host-a" data-meta-port="1" data-meta-pg-kind="node" transform="translate(1,2)"><rect width="80" height="40"/></g><g data-cell-id="host-b" data-meta-label="Host B" data-meta-key="host-b"/><g data-cell-id="link-a" data-meta-label="A &amp; B"><path d="M0 0L20 20"/></g><g data-cell-id="bare-node" data-meta-label=""/></svg>`;

function diagram(xml = `<mxfile><diagram id="page-1">${model}</diagram></mxfile>`): Diagram {
  return { xml, svg, hash: 'old', updatedAt: '2026-10-28T00:00:00.000Z' };
}

function parse(text: string) {
  return new DOMParser().parseFromString(text, 'text/xml');
}

afterEach(() => vi.useRealTimers());

describe('setCellAttrs', () => {
  it('changes both copies and keeps other attributes, labels and children', () => {
    const input = Object.freeze(diagram());
    const result = setCellAttrs(input, [{ id: 'host-a', attrs: { bind: 'server', key: 'host-c', at: 'target' } }]);
    const object = parse(result.xml).getElementById('host-a')!;
    expect(object.getAttribute('bind')).toBe('server');
    expect(object.getAttribute('key')).toBe('host-c');
    expect(object.getAttribute('at')).toBe('target');
    expect(object.getAttribute('label')).toBe('Host A');
    expect(object.getAttribute('port')).toBe('1');
    expect(object.getAttribute('pg-kind')).toBe('node');
    expect(object.querySelector('mxCell')?.outerHTML).toBe(parse(input.xml).querySelector('object mxCell')?.outerHTML);
    const group = parse(result.svg).querySelector('g')!;
    expect(group.getAttribute('data-meta-bind')).toBe('server');
    expect(group.getAttribute('data-meta-key')).toBe('host-c');
    expect(group.getAttribute('data-meta-at')).toBe('target');
    expect(group.getAttribute('data-meta-label')).toBe('Host A');
    expect(group.getAttribute('data-meta-port')).toBe('1');
    expect(group.getAttribute('data-meta-pg-kind')).toBe('node');
    expect(group.getAttribute('transform')).toBe('translate(1,2)');
    expect(group.querySelector('rect')?.getAttribute('width')).toBe('80');
    expect(input).toEqual(diagram());
  });

  it('wraps a bare edge, moves id and value, and keeps its geometry and end attributes', () => {
    const result = setCellAttrs(diagram(), [{ id: 'link-a', attrs: { bind: 'lan', at: 'target' } }]);
    const wrapper = parse(result.xml).getElementById('link-a')!;
    expect(wrapper.localName).toBe('object');
    expect(wrapper.getAttribute('label')).toBe('A & B');
    expect(wrapper.getAttribute('bind')).toBe('lan');
    const cell = wrapper.querySelector('mxCell')!;
    expect(cell.hasAttribute('id')).toBe(false);
    expect(cell.hasAttribute('value')).toBe(false);
    for (const [key, value] of Object.entries({
      source: 'host-a',
      target: 'host-b',
      parent: '1',
      style: 'endArrow=none;',
      edge: '1',
    })) {
      expect(cell.getAttribute(key)).toBe(value);
    }
    expect(cell.querySelector('mxGeometry')?.outerHTML).toBe(
      parse(model).querySelector('mxCell[edge] mxGeometry')?.outerHTML
    );
  });

  it('wraps a bare vertex with an empty label and keeps its vertex flag', () => {
    const result = setCellAttrs(diagram(), [{ id: 'bare-node', attrs: { bind: 'host' } }]);
    const wrapper = parse(result.xml).getElementById('bare-node')!;
    expect(wrapper.getAttribute('label')).toBe('');
    expect(wrapper.querySelector('mxCell')?.getAttribute('vertex')).toBe('1');
    expect(wrapper.querySelector('mxCell')?.getAttribute('parent')).toBe('1');
  });

  it('sets a class on several cells without changing their keys or UserObject wrapper', () => {
    const result = setCellAttrs(
      diagram(),
      ['host-a', 'host-b'].map((id) => ({ id, attrs: { bind: 'server' } }))
    );
    const xml = parse(result.xml);
    const image = parse(result.svg);
    for (const id of ['host-a', 'host-b']) {
      expect(xml.getElementById(id)?.getAttribute('key')).toBe(id);
      expect(xml.getElementById(id)?.getAttribute('bind')).toBe('server');
      expect(image.querySelector(`[data-cell-id="${id}"]`)?.getAttribute('data-meta-bind')).toBe('server');
    }
    expect(xml.getElementById('host-b')?.localName).toBe('UserObject');
  });

  it('removes attributes with null and preserves an empty string', () => {
    const result = setCellAttrs(diagram(), [{ id: 'host-a', attrs: { bind: null, key: '' } }]);
    expect(parse(result.xml).getElementById('host-a')?.hasAttribute('bind')).toBe(false);
    const group = parse(result.svg).querySelector('g')!;
    expect(group.hasAttribute('data-meta-bind')).toBe(false);
    expect(group.getAttribute('data-meta-key')).toBe('');
  });

  it('keeps attribute values with XML syntax and whitespace', () => {
    const key = 'a"<&\n\t\rb';
    const result = setCellAttrs(diagram(), [{ id: 'host-a', attrs: { key } }]);
    expect(parse(result.xml).getElementById('host-a')?.getAttribute('key')).toBe(key);
    expect(parse(result.svg).querySelector('g')?.getAttribute('data-meta-key')).toBe(key);
  });

  it('writes page one only and accepts a standalone mxGraphModel', () => {
    const input = diagram(`<mxfile><diagram>${model}</diagram><diagram>${model}</diagram></mxfile>`);
    const result = setCellAttrs(input, [{ id: 'host-a', attrs: { bind: 'server' } }]);
    const pages = parse(result.xml).querySelectorAll('diagram');
    expect(pages[0].querySelector('object')?.getAttribute('bind')).toBe('server');
    expect(pages[1].outerHTML).toBe(parse(input.xml).querySelectorAll('diagram')[1].outerHTML);
    expect(
      parse(setCellAttrs(diagram(model), [{ id: 'host-a', attrs: { bind: 'server' } }]).xml).documentElement.localName
    ).toBe('mxGraphModel');
  });

  it('refuses a cell that occurs only on page two', () => {
    const input = diagram(
      `<mxfile><diagram><mxGraphModel><root/></mxGraphModel></diagram><diagram>${model}</diagram></mxfile>`
    );
    expect(() => setCellAttrs(input, [{ id: 'host-a', attrs: { bind: 'host' } }])).toThrow(/page 1/);
  });

  it('refuses a compressed first page with the specified recovery message', () => {
    expect(() =>
      setCellAttrs(diagram('<mxfile><diagram>compressed</diagram></mxfile>'), [
        { id: 'host-a', attrs: { bind: 'host' } },
      ])
    ).toThrow('Open the diagram in draw.io once and save it. Then the panel can write to it.');
  });

  it.each([
    '<mxGraphModel><root><mxCell id="host-a"/><mxCell id="host-a"/></root></mxGraphModel>',
    '<mxGraphModel><root><object id="host-a"><mxCell/></object><UserObject id="host-a"><mxCell/></UserObject></root></mxGraphModel>',
  ])('refuses duplicate XML cell IDs', (xml) => {
    expect(() => setCellAttrs(diagram(xml), [{ id: 'host-a', attrs: { bind: 'host' } }])).toThrow(/duplicate/i);
  });

  it('refuses an unknown cell', () => {
    expect(() => setCellAttrs(diagram(), [{ id: 'unknown', attrs: { bind: 'host' } }])).toThrow(/page 1/);
  });

  it.each(['pg-x', 'PG-X', 'id', 'ID', 'label', 'placeholders', 'xmlns', 'xmlThing', '1key', 'a:b', 'a.b', 'a b', ''])(
    'refuses the attribute name %j',
    (name) => {
      expect(() => setCellAttrs(diagram(), [{ id: 'host-a', attrs: { [name]: null } }])).toThrow(/attribute name/i);
    }
  );

  it.each(['<mxfile>', '<mxGraphModel><root></mxGraphModel>', '<mxfile/>'])(
    'refuses invalid XML or a missing page',
    (xml) => {
      expect(() => setCellAttrs(diagram(xml), [{ id: 'host-a', attrs: { bind: 'host' } }])).toThrow(/XML|page 1/);
    }
  );

  it('refuses a missing or duplicate SVG group and malformed SVG', () => {
    for (const image of [
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      svg.replace('</svg>', '<g data-cell-id="host-a"/></svg>'),
      '<svg>',
    ]) {
      expect(() => setCellAttrs({ ...diagram(), svg: image }, [{ id: 'host-a', attrs: { bind: 'host' } }])).toThrow();
    }
  });

  it('returns stable XML and SVG with the content hash and the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T01:00:00.000Z'));
    const changes = [{ id: 'host-a', attrs: { bind: 'server', _role: 'primary', 'port-name': 'eth1' } }];
    const first = setCellAttrs(diagram(), changes);
    expect(setCellAttrs(first, changes)).toEqual(first);
    expect(first.hash).toBe(fnv1a(first.svg + first.xml));
    expect(first.updatedAt).toBe('2026-10-29T01:00:00.000Z');
    expect(first.hash).not.toBe('old');
  });

  it('keeps new metadata through the sanitizer and a second sanitizer pass is stable', () => {
    const result = setCellAttrs(diagram(), [{ id: 'host-a', attrs: { bind: 'server', key: 'host-c', at: 'target' } }]);
    const clean = sanitizeSvg(result.svg).svg;
    const group = parse(clean).querySelector('g')!;
    expect(group.getAttribute('data-meta-bind')).toBe('server');
    expect(group.getAttribute('data-meta-key')).toBe('host-c');
    expect(group.getAttribute('data-meta-at')).toBe('target');
    expect(group.getAttribute('data-meta-label')).toBe('Host A');
    expect(sanitizeSvg(clean).svg).toBe(clean);
  });
});
