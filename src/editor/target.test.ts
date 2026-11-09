import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildEditorSrcdoc,
  bundledEditorBase,
  EDITOR_PRELOADS,
  EDITOR_RESOURCE_SCRIPT,
  EDITOR_SANDBOX,
  editorTarget,
} from './target';

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
    expect(doc.match(/<script nonce="abc&quot;" (?:defer )?src=/g)).toHaveLength(4);
    // The shim must run before bootstrap.js loads app.min.js.
    expect(doc.indexOf('js/dmap-shim.js')).toBeLessThan(doc.indexOf('js/bootstrap.js'));
    expect(doc).toContain('<meta name="dmap-channel" content="f00d">');
    expect(buildEditorSrcdoc('http://g/', '?x=1', { token: 't' })).not.toContain('nonce=');
  });
  it('preloads the scripts that draw.io adds later, with the nonce, before the first script', () => {
    const doc = buildEditorSrcdoc('http://g/', '?x=1', { token: 't', nonce: 'n1' });
    const links = doc.match(/<link nonce="n1" rel="preload" as="script" href="[^"]+">/g) ?? [];
    expect(links.map((l) => l.match(/href="([^"]+)"/)![1])).toEqual(EDITOR_PRELOADS);
    expect(doc.indexOf('rel="preload"')).toBeLessThan(doc.indexOf('<script'));
    expect(buildEditorSrcdoc('http://g/', '?x=1', { token: 't' })).toContain(
      '<link rel="preload" as="script" href="js/app.min.js">'
    );
  });
  it('loads the resource script after the shim, deferred, so the shim answers resources/dia.txt from memory', () => {
    const doc = buildEditorSrcdoc('http://g/', '?x=1', { token: 't', nonce: 'n1' });
    const tag = `<script nonce="n1" defer src="${EDITOR_RESOURCE_SCRIPT}"></script>`;
    expect(doc).toContain(tag);
    expect(doc.indexOf('js/dmap-shim.js')).toBeLessThan(doc.indexOf(tag));
    expect(doc.indexOf(tag)).toBeLessThan(doc.indexOf('js/bootstrap.js'));
    expect(EDITOR_RESOURCE_SCRIPT).toBe('resources/dia.txt.js');
  });
});

// The names of the preloads must follow the vendored draw.io. Only when .drawio/webapp is there (npm run build).
const WEBAPP = join(process.cwd(), '.drawio', 'webapp');
describe.skipIf(!existsSync(WEBAPP))('EDITOR_PRELOADS against the vendored draw.io', () => {
  it('names files of the vendored webapp', () => {
    expect([...EDITOR_PRELOADS, EDITOR_RESOURCE_SCRIPT].filter((f) => !existsSync(join(WEBAPP, f)))).toEqual([]);
  });
  it('names the scripts that bootstrap.js and app.min.js load', () => {
    const loaders =
      readFileSync(join(WEBAPP, 'js/bootstrap.js'), 'utf8') + readFileSync(join(WEBAPP, 'js/app.min.js'), 'utf8');
    expect(EDITOR_PRELOADS.filter((f) => !loaders.includes(`'${f}'`) && !loaders.includes(`"${f}"`))).toEqual([]);
  });
  it('names the default resource bundle that PreConfig.js lists', () => {
    const preConfig = readFileSync(join(WEBAPP, 'js/PreConfig.js'), 'utf8');
    expect(preConfig).toContain(`"${EDITOR_RESOURCE_SCRIPT.replace(/\.js$/, '')}"`);
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
