import React, { useRef } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTheme, getDefaultTimeRange, LoadingState, type PanelProps, ThemeContext } from '@grafana/data';
import { DrawioMapPanel } from '../components/DrawioMapPanel';
import { DiagramStage, type StageSelection } from '../editor/popup/DiagramStage';
import { useStage } from './useStage';
import type { CellPatch, HalfState, Options, PatchMap } from '../types';

/**
 * The panel and the popup stage paint the same patches in the same way. The panel binds through a stub: it shows
 * the patches of the test, as the popup does.
 */
const bound = vi.hoisted(() => ({ patches: new Map() as Map<string, unknown> }));
/** The stage index of each applier call. */
const applied = vi.hoisted(() => [] as unknown[]);
vi.mock('../binding/bindV4', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../binding/bindV4')>();
  return {
    ...actual,
    bindV4: () => ({ patches: bound.patches, uses: new Map(), series: new Map(), report: [], deadlines: [] }),
  };
});
vi.mock('../render/applier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../render/applier')>();
  return {
    ...actual,
    applyPatches: (...args: Parameters<typeof actual.applyPatches>) => {
      applied.push(args[0]);
      return actual.applyPatches(...args);
    },
  };
});

// @grafana/ui reads matchMedia (uPlot) and localStorage (logger) when it loads. Set them before the imports run.
vi.hoisted(() => {
  if (!window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  }
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});

const svg = readFileSync(resolve(__dirname, '../fixtures/authoring.svg'), 'utf8');
/** The diagram of a saved hash: the identity of a stage is its svg text, so another hash is another text. */
const svgFor = (hash: string) => (hash === 'h1' ? svg : svg.replace('</svg>', `<desc>${hash}</desc></svg>`));
const LINK_WIDTH = { min: 2, max: 10 };
const NONE: StageSelection = { selected: [], affected: [], highlight: [] };

const half = (over: Partial<HalfState> = {}): HalfState => ({
  status: 'ok',
  color: '#00ff00',
  width: 4,
  label: '41 Mb/s · 41% of 100 Mb/s',
  stepIndex: 0,
  percent: 41,
  percentDisplay: '41%',
  display: { text: '41', suffix: ' Mb/s', numeric: 41 },
  ...over,
});
const node = (cellId: string, color: string): CellPatch => ({
  cellId,
  scope: { cell: {} },
  shape: { status: 'ok', color, target: 'shape', stepIndex: 0 },
  urls: [],
});
const link = (halves: { a2b?: HalfState; b2a?: HalfState }): CellPatch => ({
  cellId: 'link-1',
  scope: { cell: {} },
  urls: [],
  link: { ...halves, labelMode: 'percent' },
});
const patchMap = (...list: CellPatch[]): PatchMap => new Map(list.map((p) => [p.cellId, p]));

function panelProps(hash: string): PanelProps<Options> {
  const timeRange = getDefaultTimeRange();
  return {
    id: 1,
    title: 't',
    transparent: false,
    width: 800,
    height: 600,
    options: {
      diagram: { xml: '<mxfile/>', svg: svgFor(hash), hash, updatedAt: '2026-10-17T00:00:00Z' },
      zoom: { mode: 'fit', percent: 100, wheel: false, pan: false },
      linkWidth: LINK_WIDTH,
    },
    data: { series: [], state: LoadingState.Done, timeRange },
    timeRange,
    timeZone: 'browser',
    fieldConfig: { defaults: {}, overrides: [] },
    replaceVariables: (s: string) => s,
    renderCounter: 0,
    onOptionsChange: () => {},
    onFieldConfigChange: () => {},
    onChangeTimeRange: () => {},
    eventBus: {
      subscribe: () => ({ unsubscribe() {} }),
      getStream: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
      newScopedBus() {
        return this;
      },
    } as never,
  } as PanelProps<Options>;
}

function Popup({ patches, hash }: { patches: PatchMap; hash: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stage = useStage(ref, svgFor(hash));
  return (
    <DiagramStage
      stage={stage}
      stageRef={ref}
      patches={patches}
      selection={NONE}
      onSelect={() => {}}
      hash={hash}
      linkWidth={LINK_WIDTH}
    />
  );
}

/** Both stages with the same patches. A new data object makes the panel bind again. */
function both({ patches, hash = 'h1', dark = true }: { patches: PatchMap; hash?: string; dark?: boolean }) {
  bound.patches = patches;
  const props = panelProps(hash);
  return (
    <ThemeContext.Provider value={createTheme({ colors: { mode: dark ? 'dark' : 'light' } })}>
      <DrawioMapPanel {...props} data={{ ...props.data }} />
      <Popup patches={patches} hash={hash} />
    </ThemeContext.Provider>
  );
}

const frame = async () => {
  await act(async () => {
    await new Promise((done) => requestAnimationFrame(() => done(undefined)));
  });
};
const panelRoot = () => screen.getByTestId('dmap-stage').querySelector<SVGSVGElement>(':scope > svg')!;
const popupRoot = () => screen.getByTestId('dmap-popup-stage').querySelector<SVGSVGElement>(':scope > svg')!;
const appliesOn = (root: SVGSVGElement) =>
  applied.filter((index) => root.contains((index as Map<string, { group: Element }>).get('device-1')?.group ?? null))
    .length;

/** The attributes of the consumer layers: the interaction marks of the panel and the editor layer of the popup. */
const CONSUMER_ATTRS = [
  'role',
  'tabindex',
  'aria-label',
  'data-dmap-interactive',
  'data-dmap-selected',
  'data-dmap-primary',
  'data-dmap-extra',
  'data-dmap-missed',
  'data-dmap-affected',
  'data-dmap-highlight',
  'data-dmap-lighter',
];
/** The painted content of a stage root: the cells with their data-* and styles, the overlay and the labels. */
function painted(root: SVGSVGElement): string {
  const copy = root.cloneNode(true) as SVGSVGElement;
  copy.querySelectorAll('*').forEach((el) => CONSUMER_ATTRS.forEach((name) => el.removeAttribute(name)));
  // The placement stamps count up per document, not per stage.
  copy.querySelectorAll('[data-dmap-placed-at]').forEach((el) => el.removeAttribute('data-dmap-placed-at'));
  return copy.innerHTML;
}
const halves = (root: SVGSVGElement, which: 'a2b' | 'b2a') =>
  root.querySelectorAll(`polyline.dmap-half[data-dmap-half="${which}"]`).length;
const labels = (root: SVGSVGElement, which: 'a2b' | 'b2a') =>
  root.querySelectorAll(`text.dmap-link-label[data-dmap-half="${which}"]`).length;

const ALL = () => patchMap(node('device-1', 'rgb(1, 2, 3)'), link({ a2b: half(), b2a: half({ percent: 12 }) }));

describe('the paint of the panel and the popup stage', () => {
  beforeEach(() => {
    applied.length = 0;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'fonts');
  });

  it('gives the same data-* attributes, overlay and labels for the same patches', async () => {
    render(both({ patches: ALL() }));
    await frame();
    const panel = panelRoot();
    const popup = popupRoot();
    expect(panel).not.toBe(popup);
    expect(panel.querySelector('[data-cell-id="device-1"]')!.getAttribute('data-dmap-target')).toBe('shape');
    expect(halves(panel, 'a2b')).toBe(1);
    expect(labels(panel, 'b2a')).toBe(1);
    expect(painted(panel)).toBe(painted(popup));
  });

  it('sets the root colour scheme from the theme on both roots', async () => {
    const view = render(both({ patches: ALL() }));
    await frame();
    expect(panelRoot().style.colorScheme).toBe('dark');
    expect(popupRoot().style.colorScheme).toBe('dark');
    view.rerender(both({ patches: ALL(), dark: false }));
    expect(panelRoot().style.colorScheme).toBe('light');
    expect(popupRoot().style.colorScheme).toBe('light');
  });

  it('paints a new stage in full when the diagram changes, with no paint left on the old root', async () => {
    const view = render(both({ patches: ALL() }));
    await frame();
    const old = { panel: panelRoot(), popup: popupRoot() };
    view.rerender(both({ patches: ALL(), hash: 'h2' }));
    await frame();
    const panel = panelRoot();
    const popup = popupRoot();
    expect(panel).not.toBe(old.panel);
    expect(popup).not.toBe(old.popup);
    expect(old.panel.isConnected).toBe(false);
    expect(panel.querySelector('[data-cell-id="device-1"]')!.getAttribute('data-dmap-target')).toBe('shape');
    expect(halves(panel, 'b2a')).toBe(1);
    expect(labels(panel, 'a2b')).toBe(1);
    expect(painted(panel)).toBe(painted(popup));
  });

  it('applies the patches once more on an OS colour change, with the same picture on both stages', async () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    };
    vi.stubGlobal('matchMedia', () => media);
    const view = render(both({ patches: ALL() }));
    await frame();
    const panel = panelRoot();
    const popup = popupRoot();
    const before = { panel: appliesOn(panel), popup: appliesOn(popup), picture: painted(panel) };
    expect(before.panel).toBeGreaterThan(0);
    expect(before.popup).toBeGreaterThan(0);
    media.matches = true;
    act(() => listeners.forEach((cb) => cb()));
    await waitFor(() => expect(appliesOn(panel)).toBe(before.panel + 1));
    expect(appliesOn(popup)).toBe(before.popup + 1);
    expect(painted(panel)).toBe(before.picture);
    expect(painted(popup)).toBe(before.picture);
    view.unmount();
    expect(listeners.size).toBe(0);
  });

  it('cuts the strokes again on both stages when a late web font loads, and stops on unmount', async () => {
    const fonts = Object.assign(new EventTarget(), { ready: new Promise<void>(() => {}) });
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
    const view = render(both({ patches: ALL() }));
    await frame();
    const roots = [panelRoot(), popupRoot()];
    const glyphs = (width: number) =>
      roots.forEach((root) =>
        root.querySelectorAll('text.dmap-link-label').forEach((t) => {
          const x = Number(t.getAttribute('x'));
          (t as unknown as { getBBox: () => DOMRect }).getBBox = () =>
            ({ x: x - width / 2, y: 0, width, height: 10 }) as DOMRect;
        })
      );
    const cuts = () =>
      roots.map((root) =>
        Array.from(root.querySelectorAll('polyline.dmap-half[data-dmap-cell="link-1"]'))
          .map((h) => h.getAttribute('stroke-dasharray') ?? '')
          .join(',')
      );
    glyphs(20);
    fonts.dispatchEvent(new Event('loadingdone'));
    const narrow = cuts();
    expect(narrow[0]).not.toBe('');
    expect(narrow[1]).toBe(narrow[0]);
    glyphs(40);
    fonts.dispatchEvent(new Event('loadingdone'));
    const wide = cuts();
    expect(wide[0]).not.toBe(narrow[0]);
    expect(wide[1]).toBe(wide[0]);
    view.unmount();
    glyphs(60);
    fonts.dispatchEvent(new Event('loadingdone'));
    expect(cuts()).toEqual(wide);
  });

  it('removes one link half and its label on both stages, and keeps the other half', async () => {
    const view = render(both({ patches: ALL() }));
    await frame();
    view.rerender(both({ patches: patchMap(node('device-1', 'rgb(1, 2, 3)'), link({ a2b: half() })) }));
    await frame();
    for (const root of [panelRoot(), popupRoot()]) {
      expect(halves(root, 'a2b')).toBe(1);
      expect(halves(root, 'b2a')).toBe(0);
      expect(labels(root, 'a2b')).toBe(1);
      expect(labels(root, 'b2a')).toBe(0);
    }
    expect(painted(panelRoot())).toBe(painted(popupRoot()));
  });

  it('makes the same number of DOM mutations as before over a series of refreshes (the refresh bench)', async () => {
    const view = render(both({ patches: ALL() }));
    await frame();
    const observe = (root: SVGSVGElement) => {
      const seen = { count: 0 };
      const observer = new MutationObserver((records) => (seen.count += records.length));
      observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
      return () => seen.count + observer.takeRecords().length;
    };
    const panel = observe(panelRoot());
    const popup = observe(popupRoot());
    const refreshes = [
      ALL(),
      patchMap(node('device-1', 'rgb(4, 5, 6)'), link({ a2b: half({ percent: 90, width: 8 }), b2a: half() })),
      patchMap(node('device-1', 'rgb(4, 5, 6)'), link({ a2b: half({ percent: 90, width: 8 }), b2a: half() })),
      patchMap(node('device-1', 'rgb(1, 2, 3)'), link({ a2b: half({ color: '#ff0000', percentDisplay: '95%' }) })),
    ];
    for (const patches of refreshes) {
      view.rerender(both({ patches }));
      await frame();
    }
    const counts = { panel: panel(), popup: popup() };
    // the width change of a2b also rewrites the points of the half and of its head (the head grows with the width);
    // the cut under a label is one attribute of a half (no mask element to build again)
    expect(counts).toEqual({ panel: 90, popup: 106 });
  });
});
