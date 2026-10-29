import { describe, expect, it } from 'vitest';
import { createXmlElement, parseXml, serializeXml } from './xml';

const FILE =
  '<mxfile host="app.diagrams.net"><diagram id="p1" name="Page-1"><mxGraphModel><root>' +
  '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<object id="n1" label="Router α" bind="routers"><mxCell vertex="1" parent="1"/></object>' +
  '</root></mxGraphModel></diagram></mxfile>';

describe('parseXml', () => {
  it('gives each element a style, as the Grafana frontend sandbox needs', () => {
    const doc = parseXml(FILE)!;
    const elements = Array.from(doc.getElementsByTagName('*'));
    expect(elements).toHaveLength(8);
    for (const el of elements) {
      expect((el as Element & { style?: unknown }).style).toBeDefined();
    }
  });

  it('keeps names, case and attributes', () => {
    const doc = parseXml(FILE)!;
    expect(doc.documentElement.localName).toBe('mxfile');
    expect(Array.from(doc.getElementsByTagName('mxGraphModel'))).toHaveLength(1);
    expect(doc.getElementsByTagName('mxgraphmodel')).toHaveLength(0);
    expect(doc.querySelector('object')!.getAttribute('label')).toBe('Router α');
    expect(doc.documentElement.hasAttribute('xmlns')).toBe(true);
  });

  it('reads a bare model, a prolog and a comment before the root', () => {
    expect(parseXml('<mxGraphModel><root/></mxGraphModel>')!.documentElement.localName).toBe('mxGraphModel');
    const doc = parseXml('<?xml version="1.0" encoding="UTF-8"?>\n<!-- <x> --><mxfile><diagram/></mxfile>')!;
    expect(doc.documentElement.localName).toBe('mxfile');
    expect(doc.getElementsByTagName('diagram')).toHaveLength(1);
  });

  it('gives undefined when the text does not parse', () => {
    expect(parseXml('<mxfile><diagram></mxfile>')).toBeUndefined();
    expect(parseXml('not xml')).toBeUndefined();
  });

  it('keeps a namespace of the source', () => {
    const doc = parseXml('<a xmlns="urn:x"><b/></a>')!;
    expect(doc.documentElement.namespaceURI).toBe('urn:x');
    expect(serializeXml(doc)).toBe('<a xmlns="urn:x"><b/></a>');
  });
});

describe('serializeXml', () => {
  it.each([
    '<!-- xmlns="http://www.w3.org/2000/svg" --><mxGraphModel><root/></mxGraphModel>',
    '<?probe xmlns="http://www.w3.org/2000/svg"?><mxGraphModel><root/></mxGraphModel>',
    '<?xml version="1.0" encoding="UTF-8"?>\n<mxGraphModel><root/></mxGraphModel>',
    "<?xml version = '1.0' standalone = 'yes'?>\r\n<mxGraphModel><root/></mxGraphModel>",
    '<mxGraphModel xmlns="urn:demo"><root/></mxGraphModel>',
    '<mxGraphModel xmlns="http://www.w3.org/2000/svg"><root/></mxGraphModel>',
  ])('keeps the prolog and the source namespace in %s', (source) => {
    expect(serializeXml(parseXml(source)!)).toBe(source);
  });

  it('keeps namespace text inside a root attribute value', () => {
    const source = '<mxGraphModel note=\' xmlns="http://www.w3.org/2000/svg"\'><root/></mxGraphModel>';
    expect(serializeXml(parseXml(source)!)).toBe(
      '<mxGraphModel note=" xmlns=&quot;http://www.w3.org/2000/svg&quot;"><root/></mxGraphModel>'
    );
  });

  it('gives the source text again, with no namespace of its own', () => {
    expect(serializeXml(parseXml(FILE)!)).toBe(FILE);
  });

  it('writes a new element with no namespace declaration', () => {
    const doc = parseXml(FILE)!;
    const cell = doc.querySelector('mxCell[id="1"]')!;
    const wrapper = createXmlElement(doc, 'object');
    wrapper.setAttribute('id', 'w');
    cell.replaceWith(wrapper);
    wrapper.appendChild(cell);
    expect((wrapper as Element & { style?: unknown }).style).toBeDefined();
    expect(serializeXml(doc)).toContain('<object id="w"><mxCell id="1" parent="0"/></object>');
    expect(serializeXml(doc)).not.toContain('xmlns');
  });
});
