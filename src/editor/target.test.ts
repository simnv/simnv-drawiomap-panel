import { describe, expect, it } from 'vitest';
import { buildEditorSrcdoc, bundledEditorBase, EDITOR_SANDBOX, editorTarget } from './target';

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
  it('sets base, parameters, a restrictive CSP, the XHR shim and the nonce on all scripts', () => {
    const doc = buildEditorSrcdoc('http://g/public/plugins/p/drawio/', '?embed=1&proto=json', {
      token: 'f00d',
      nonce: 'abc"',
    });
    expect(doc).toContain('<base href="http://g/public/plugins/p/drawio/">');
    expect(doc).toContain('<meta name="dmap-search" content="?embed=1&amp;proto=json">');
    expect(doc).toContain('connect-src http://g/public/plugins/p/drawio/ data: blob:');
    expect(doc).toContain('default-src http://g/public/plugins/p/drawio/;');
    expect(doc.match(/<script nonce="abc&quot;" src=/g)).toHaveLength(3);
    // The shim must run before bootstrap.js loads app.min.js.
    expect(doc.indexOf('js/dmap-shim.js')).toBeLessThan(doc.indexOf('js/bootstrap.js'));
    expect(doc).toContain('<meta name="dmap-channel" content="f00d">');
    expect(buildEditorSrcdoc('http://g/', '?x=1', { token: 't' })).not.toContain('nonce=');
  });
});

describe('editorTarget', () => {
  it('uses the bundled editor in an opaque-origin frame', () => {
    const bundled = editorTarget(true, 'f00d');
    expect(bundled).toMatchObject({ origin: 'null', sandbox: EDITOR_SANDBOX });
    expect(bundled.base).toMatch(/\/public\/plugins\/simnv-drawiomap-panel\/drawio\/$/);
    expect(bundled.srcDoc).toContain('dark=1');
    expect(bundled.srcDoc).toContain('content="f00d"');
    expect(EDITOR_SANDBOX.split(' ')).not.toContain('allow-same-origin');
    expect(EDITOR_SANDBOX.split(' ')).toContain('allow-scripts');
  });
});
