import { describe, expect, it } from 'vitest';
import { importDiagram } from './importDiagram';

describe('importDiagram', () => {
  it('accepts an mxfile and warns on multiple pages', () => {
    const r = importDiagram('<mxfile><diagram id="a"><mxGraphModel/></diagram><diagram id="b"/></mxfile>');
    expect(r.xml).toContain('<mxfile');
    expect(r.warnings[0]).toMatch(/2 pages/);
  });
  it('wraps a bare mxGraphModel', () => {
    const r = importDiagram('<mxGraphModel><root/></mxGraphModel>');
    expect(r.xml).toMatch(/^<mxfile><diagram[^>]*><mxGraphModel>/);
    expect(r.warnings).toEqual([]);
  });
  it('extracts the diagram from an SVG with a content attribute', () => {
    const r = importDiagram('<svg content="&lt;mxfile&gt;&lt;diagram/&gt;&lt;/mxfile&gt;"></svg>');
    expect(r.xml).toBe('<mxfile><diagram/></mxfile>');
  });
  it('rejects other text', () => {
    expect(() => importDiagram('hello')).toThrow(/draw\.io/);
  });
});
