import { describe, expect, it } from 'vitest';
import { buildEditorSrcdoc, bundledEditorBase, editorTarget } from './target';

describe('bundledEditorBase', () => {
  it('resolves the plugin public path against the document base (app_sub_url)', () => {
    expect(bundledEditorBase('public/plugins/simnv-drawiomap-panel/', 'http://g.local/grafana/')).toBe(
      'http://g.local/grafana/public/plugins/simnv-drawiomap-panel/drawio/'
    );
  });
  it('keeps an absolute public path (plugin CDN)', () => {
    expect(bundledEditorBase('https://cdn.example/simnv-drawiomap-panel/1.0.0/public/plugins/x/', 'http://g/')).toBe(
      'https://cdn.example/simnv-drawiomap-panel/1.0.0/public/plugins/x/drawio/'
    );
  });
});

describe('buildEditorSrcdoc', () => {
  it('sets base, parameters, a restrictive CSP and the nonce on both scripts', () => {
    const doc = buildEditorSrcdoc('http://g/public/plugins/p/drawio/', '?embed=1&proto=json', 'abc"');
    expect(doc).toContain('<base href="http://g/public/plugins/p/drawio/">');
    expect(doc).toContain('<meta name="dmap-search" content="?embed=1&amp;proto=json">');
    expect(doc).toContain('connect-src http://g/public/plugins/p/drawio/ data: blob:');
    expect(doc).toContain('default-src http://g/public/plugins/p/drawio/;');
    expect(doc.match(/<script nonce="abc&quot;" src=/g)).toHaveLength(2);
    expect(buildEditorSrcdoc('http://g/', '?x=1')).not.toContain('nonce=');
  });
});

describe('editorTarget', () => {
  it('uses the external editor for a URL and the bundled editor for an empty value', () => {
    const ext = editorTarget('http://localhost:8080', false, 'http://g');
    expect(ext).toMatchObject({ kind: 'url', origin: 'http://localhost:8080' });
    const bundled = editorTarget('  ', true, 'http://g');
    expect(bundled.kind).toBe('bundled');
    expect(bundled.origin).toBe('http://g');
    expect(bundled.kind === 'bundled' && bundled.srcDoc).toContain('dark=1');
  });
});
