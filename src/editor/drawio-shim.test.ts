import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SHIM = fs.readFileSync(path.join(__dirname, 'drawio-shim.js'), 'utf8');
const BASE = 'http://g.local/public/plugins/simnv-drawiomap-panel/drawio/';

type Call = [string, ...unknown[]];

/** Records the native calls. The shim patches the prototype of this class. */
class FakeXhr extends EventTarget {
  static calls: Call[] = [];
  onreadystatechange: (() => void) | null = null;
  readyState = 0;
  status = 0;
  responseText = '';
  constructor() {
    super();
    // Like the event handler attribute of a real XMLHttpRequest.
    this.addEventListener('readystatechange', () => this.onreadystatechange?.());
  }
}
const NATIVE = ['open', 'send', 'setRequestHeader', 'overrideMimeType', 'getResponseHeader', 'getAllResponseHeaders'];

type Xhr = FakeXhr & {
  open(m: string, u: string, a?: boolean): void;
  send(b?: unknown): void;
  setRequestHeader(n: string, v: string): void;
  getResponseHeader(n: string): string | null;
};
type ShimWindow = Window & { DMAP_VFS_FILES?: string[]; dmapVfs?: { put(p: string, t: string): void } };

describe('drawio-shim (XHR from script files in the opaque-origin frame)', () => {
  const realXhr = window.XMLHttpRequest;
  let scripts: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    FakeXhr.calls = [];
    for (const name of NATIVE) {
      (FakeXhr.prototype as unknown as Record<string, unknown>)[name] = function (...args: unknown[]) {
        FakeXhr.calls.push([name, ...args]);
      };
    }
    scripts = [];
    const base = document.createElement('base');
    base.href = BASE;
    document.head.appendChild(base);
    (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
    // The script file of a listed text file calls dmapVfs.put, then the browser fires onload.
    vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      const s = node as unknown as HTMLScriptElement;
      if (s.tagName === 'SCRIPT') {
        const src = s.getAttribute('src')!;
        scripts.push(src);
        if (src !== 'resources/dia_xx.txt.js') {
          (window as ShimWindow).dmapVfs!.put(src.replace(/\.js$/, ''), `text of ${src}`);
        }
        s.onload!(new Event('load'));
        return node;
      }
      return Node.prototype.appendChild.call(document.head, node) as T;
    });
    (window as ShimWindow).DMAP_VFS_FILES = ['resources/dia.txt', 'resources/dia_de.txt', 'resources/dia_xx.txt'];
    new Function(SHIM)();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.querySelectorAll('base').forEach((b) => b.remove());
    (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = realXhr;
    delete (window as ShimWindow).DMAP_VFS_FILES;
  });

  it('answers a listed file from its script file, without a native request', () => {
    const xhr = new FakeXhr() as Xhr;
    const events: string[] = [];
    xhr.onreadystatechange = () => events.push(`readystatechange ${xhr.readyState}`);
    xhr.addEventListener('load', () => events.push('load'));
    xhr.open('GET', 'resources/dia_de.txt', true);
    xhr.setRequestHeader('X-Test', '1');
    xhr.send(null);
    expect(scripts).toEqual(['resources/dia_de.txt.js']);
    expect(events).toEqual([]);
    vi.runAllTimers();
    expect(events).toEqual(['readystatechange 4', 'load']);
    expect(xhr.status).toBe(200);
    expect(xhr.responseText).toBe('text of resources/dia_de.txt.js');
    expect(xhr.getResponseHeader('Content-Type')).toBe('text/plain;charset=utf-8');
    expect(FakeXhr.calls).toEqual([]);

    // The next request uses the stored text: no second script file. A synchronous request works now.
    const again = new FakeXhr() as Xhr;
    again.open('GET', BASE + 'resources/dia_de.txt?v=1', false);
    again.send();
    expect(scripts).toHaveLength(1);
    expect(again.responseText).toBe('text of resources/dia_de.txt.js');
  });

  it('answers 404 when the script file has no text, and for a synchronous request of a file not loaded yet', () => {
    const missing = new FakeXhr() as Xhr;
    missing.open('GET', 'resources/dia_xx.txt', true);
    missing.send();
    vi.runAllTimers();
    expect(missing.status).toBe(404);
    const sync = new FakeXhr() as Xhr;
    sync.open('GET', 'resources/dia.txt', false);
    sync.send();
    expect(sync.status).toBe(404);
    expect(FakeXhr.calls).toEqual([]);
  });

  it('does not change other requests', () => {
    const cases: Array<[string, string]> = [
      ['GET', 'resources/unknown.txt'],
      ['POST', 'resources/dia.txt'],
      ['GET', 'http://other.example/drawio/resources/dia.txt'],
      ['GET', '/api/dashboards/uid/x'],
    ];
    for (const [method, url] of cases) {
      const xhr = new FakeXhr() as Xhr;
      xhr.open(method, url, true);
      xhr.setRequestHeader('X-Test', '1');
      xhr.send('body');
    }
    expect(scripts).toEqual([]);
    expect(FakeXhr.calls.filter((c) => c[0] === 'open').map((c) => c[2])).toEqual(cases.map((c) => c[1]));
    expect(FakeXhr.calls.filter((c) => c[0] === 'send')).toHaveLength(4);
    expect(FakeXhr.calls.filter((c) => c[0] === 'setRequestHeader')).toHaveLength(4);
  });
});

describe('drawio-shim (channel to the host)', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent');
  const realChannel = globalThis.MessageChannel;

  afterEach(() => {
    document.querySelectorAll('meta[name="dmap-channel"]').forEach((m) => m.remove());
    if (realParent) {
      Object.defineProperty(window, 'parent', realParent);
    }
    globalThis.MessageChannel = realChannel;
  });

  function setup(token: string | null) {
    if (token !== null) {
      const meta = document.createElement('meta');
      meta.name = 'dmap-channel';
      meta.content = token;
      document.head.appendChild(meta);
    }
    const toHost: unknown[] = [];
    const port1 = { postMessage: (d: unknown) => toHost.push(d), onmessage: null as null | ((e: unknown) => void) };
    const port2 = { name: 'port2' };
    globalThis.MessageChannel = class {
      port1 = port1;
      port2 = port2;
    } as unknown as typeof MessageChannel;
    const hellos: unknown[][] = [];
    const host = { postMessage: (...args: unknown[]) => hellos.push(args) };
    Object.defineProperty(window, 'parent', { value: host, configurable: true, writable: true });
    new Function(SHIM)();
    return { toHost, port1, port2, hellos, host };
  }

  it('sends one hello with the token and the port, and routes draw.io messages through the port', () => {
    const { toHost, port1, port2, hellos } = setup('f00d');
    expect(hellos).toEqual([['{"dmapHello":"f00d"}', '*', [port2]]]);
    // draw.io: (window.opener || window.parent).postMessage(msg, '*')
    expect(window.parent).toBe(port1);
    (window.parent as unknown as { postMessage(d: unknown, t: unknown): void }).postMessage('{"event":"init"}', '*');
    expect(toHost).toEqual(['{"event":"init"}']);
    // Host messages from the port arrive as window messages with the port as source.
    const got: MessageEvent[] = [];
    const listener = (e: MessageEvent) => got.push(e);
    window.addEventListener('message', listener);
    port1.onmessage!({ data: '{"action":"load"}' });
    window.removeEventListener('message', listener);
    expect(got).toHaveLength(1);
    expect(got[0].data).toBe('{"action":"load"}');
    expect(got[0].source).toBe(port1);
  });

  it('asks the host for images of <base> for the export, and falls back to draw.io when the host has no file', () => {
    const { toHost, port1 } = setup('f00d');
    const original = vi.fn();
    const g = globalThis as unknown as { Editor: unknown; dmapAfterApp(): void };
    g.Editor = function () {};
    (g.Editor as { prototype: Record<string, unknown> }).prototype.convertImageToDataUri = original;
    g.dmapAfterApp();
    const editor = new (g.Editor as new () => { convertImageToDataUri(u: string, d: (s: string) => void): void })();
    const base = document.baseURI;
    const messages: unknown[] = [];
    const listener = (e: MessageEvent) => messages.push(e.data);
    window.addEventListener('message', listener);

    const done = vi.fn();
    editor.convertImageToDataUri('img/lib/a.png', done);
    expect(toHost).toEqual([JSON.stringify({ dmapFetch: 1, url: base + 'img/lib/a.png' })]);
    port1.onmessage!({ data: '{"dmapFile":1,"dataUri":"data:image/png;base64,AQID"}' });
    expect(done).toHaveBeenCalledWith('data:image/png;base64,AQID');
    expect(original).not.toHaveBeenCalled();

    // No file: draw.io converts the image itself (it keeps the URL when that fails).
    editor.convertImageToDataUri('img/lib/b.png', done);
    port1.onmessage!({ data: '{"dmapFile":2,"dataUri":""}' });
    expect(original).toHaveBeenCalledTimes(1);
    expect(original.mock.calls[0][0]).toBe('img/lib/b.png');

    // Other origins never go to the host.
    editor.convertImageToDataUri('https://other.example/a.png', done);
    expect(toHost).toHaveLength(2);
    expect(original).toHaveBeenCalledTimes(2);
    window.removeEventListener('message', listener);
    // File replies are not draw.io messages.
    expect(messages).toEqual([]);
    delete (globalThis as { Editor?: unknown }).Editor;
  });

  it('does nothing without a token', () => {
    const { hellos, host } = setup(null);
    expect(hellos).toEqual([]);
    expect(window.parent).toBe(host);
  });
});
