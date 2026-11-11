import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateTime, FieldType, toDataFrame, type PanelData } from '@grafana/data';
import type { EndContext } from '../../binding/edgeEnds';
import type { CellEntry, CellMeta, Options } from '../../types';
import { endName } from './InspectorV4';
import { demoData, editorProps } from './splitTestKit';

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

const kit = await vi.hoisted(async () => (await import('./splitTestKit')).createFakeMonaco());
const { fake } = kit;
vi.mock('@grafana/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@grafana/ui')>()),
  CodeEditor: kit.CodeEditor,
}));

// Count the calls of the candidate engine; the real function still runs.
const engine = await vi.hoisted(async () => ({ calls: 0 }));
vi.mock('../../binding/candidates', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../binding/candidates')>();
  return {
    ...real,
    candidatesFor: (...args: Parameters<typeof real.candidatesFor>) => {
      engine.calls++;
      return real.candidatesFor(...args);
    },
  };
});

const { SplitEditor } = await import('./SplitEditor');

/** `a`, `b` bind `dev`, `c` binds `sw`, `d` is a bare `mxCell` with no bind, `e` is an edge from `a` to `c`. */
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">' +
  '<g data-cell-id="a" data-meta-bind="dev" data-meta-key="a" data-meta-site="north"><rect width="40" height="30"/><text>A</text></g>' +
  '<g data-cell-id="b" data-meta-bind="dev" data-meta-key="b"><rect x="50" width="40" height="30"/><text>B</text></g>' +
  '<g data-cell-id="c" data-meta-bind="sw" data-meta-key="c"><rect x="100" width="40" height="30"/><text>C</text></g>' +
  '<g data-cell-id="d"><rect x="150" width="40" height="30"/><text>D</text></g>' +
  '<g data-cell-id="e" data-meta-bind="link" data-meta-key="e1"><path d="M 40 15 L 100 15" fill="none" pointer-events="stroke"/></g>' +
  '</svg>';

const XML =
  '<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<object id="a" label="A" bind="dev" key="a" site="north"><mxCell parent="1" vertex="1"/></object>' +
  '<object id="b" label="B" bind="dev" key="b"><mxCell parent="1" vertex="1"/></object>' +
  '<object id="c" label="C" bind="sw" key="c"><mxCell parent="1" vertex="1"/></object>' +
  '<mxCell id="d" value="D" parent="1" vertex="1"/>' +
  '<object id="e" label="" bind="link" key="e1"><mxCell parent="1" edge="1" source="a" target="c"/></object>' +
  '</root></mxGraphModel></diagram></mxfile>';

const CONFIG = {
  version: 4,
  classes: {
    device: { status: 'up' },
    dev: { extends: 'device', match: { key: 'job' } },
    sw: { extends: 'device', match: { key: 'job' }, rows: [{ kind: 'value', query: 'up', unit: 'percent' }] },
    link: { match: { key: 'iface' }, up: 'tx', down: 'rx' },
  },
  overrides: { a: { missing: 'down' } },
};

/** `a` has one series of `up`, `c` has ten, `b` and `d` have none; the link has one series of `tx` and of `rx`. */
function data(): PanelData {
  const base = demoData();
  const now = Date.now();
  const frame = (refId: string, labels: Record<string, string>, value: number) =>
    toDataFrame({
      refId,
      fields: [
        { name: 'Time', type: FieldType.time, values: [now - 60_000, now] },
        { name: 'Value', type: FieldType.number, values: [value - 1, value], labels },
      ],
    });
  const range = { from: dateTime(now - 300_000), to: dateTime(now), raw: { from: 'now-5m', to: 'now' } };
  return {
    ...base,
    timeRange: range,
    series: [
      frame('up', { job: 'a' }, 1),
      ...Array.from({ length: 10 }, (_, i) => frame('up', { job: 'c', instance: `i${i}` }, 10 + i)),
      frame('tx', { iface: 'e1' }, 100),
      frame('rx', { iface: 'e1' }, 5),
    ],
    request: { ...base.request!, range, targets: [{ refId: 'up' }, { refId: 'tx' }, { refId: 'rx' }] },
  };
}

function props(over: Partial<Options> = {}) {
  const options = {
    config: CONFIG,
    diagram: { xml: XML, svg: SVG, hash: 'inspect-1', updatedAt: '' },
    ...over,
  } as unknown as Options;
  return editorProps({ options, data: data() });
}

const stage = () => screen.getByTestId('dmap-popup-stage');
const cell = (id: string) => stage().querySelector(`[data-cell-id="${id}"]`)!;
const inspector = () => screen.getByTestId('dmap-inspector');
const field = (name: string) => within(inspector()).getByTestId(`dmap-inspector-${name}`);
const frame = async () => {
  await act(async () => {
    await new Promise((done) => requestAnimationFrame(() => done(undefined)));
  });
};
/** The line of the first line of the text that matches `re`, from 1. */
const lineOf = (re: RegExp) => fake.text.split('\n').findIndex((line) => re.test(line)) + 1;

describe('InspectorV4', () => {
  let rect: { mockRestore(): void };
  beforeEach(() => {
    fake.reset();
    rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(
        () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect
      );
  });
  afterEach(() => rect.mockRestore());

  it('shows nothing until a click on a cell', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    expect(screen.queryByTestId('dmap-inspector')).toBeNull();
    fireEvent.click(cell('a'));
    expect(inspector()).toBeTruthy();
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Close the inspector' }));
    expect(screen.queryByTestId('dmap-inspector')).toBeNull();
  });

  it('shows the id, bind, key, all other attributes, the chain and the override of a cell', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('a'));
    expect(field('id').textContent).toBe('a');
    expect((field('bind') as HTMLInputElement).value).toBe('dev');
    expect((field('key') as HTMLInputElement).value).toBe('a');
    expect(within(field('attrs')).getByText('site').nextSibling?.textContent).toBe('north');
    expect(field('chain').textContent).toBe('device → dev');
    expect(field('override').textContent).toContain('missing: down');
    // a cell with no override shows none
    fireEvent.click(cell('b'));
    expect(within(inspector()).queryByTestId('dmap-inspector-override')).toBeNull();
    expect(field('chain').textContent).toBe('device → dev');
  });

  it('shows per use the refId, the matchers as written and as resolved, the count, 8 label sets and the value', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('c'));
    const [use] = within(inspector()).getAllByTestId('dmap-inspector-use');
    // the path of a use is its origin: `status` comes from the base class
    expect(use.dataset.dmapUse).toBe('classes.device.status');
    expect(within(use).getByTestId('dmap-inspector-refid').textContent).toBe('up');
    expect(within(use).getByTestId('dmap-inspector-written').textContent).toBe('key: job');
    expect(within(use).getByTestId('dmap-inspector-resolved').textContent).toBe('job="c"');
    expect(within(use).getByTestId('dmap-inspector-count').textContent).toBe('10 series');
    const rows = within(use).getAllByTestId('dmap-inspector-series');
    expect(rows).toHaveLength(8);
    expect(rows[0].textContent).toContain('instance="i0"');
    expect(rows[0].textContent).toContain('10');
    expect(within(use).getByText('+2 more')).toBeTruthy();
    // the value has the unit of its use
    const row = within(inspector())
      .getAllByTestId('dmap-inspector-use')
      .find((el) => el.dataset.dmapUse === 'classes.sw.rows[0]')!;
    expect(within(row).getAllByTestId('dmap-inspector-series')[0].textContent).toContain('10%');
    // a cell with no series: the count is 0
    fireEvent.click(cell('b'));
    const [none] = within(inspector()).getAllByTestId('dmap-inspector-use');
    expect(within(none).getByTestId('dmap-inspector-count').textContent).toBe('0 series');
    expect(within(none).queryAllByTestId('dmap-inspector-series')).toHaveLength(0);
  });

  it('moves the cursor to overrides.<id>, else to classes.<bind>, else to the end of classes', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('a'));
    const overrides = lineOf(/^overrides:/);
    expect(fake.editor.setPosition).toHaveBeenLastCalledWith(expect.objectContaining({ lineNumber: overrides + 1 }));
    expect(fake.text.split('\n')[overrides]).toMatch(/^\s+a:/);
    fireEvent.click(cell('b'));
    expect(fake.editor.setPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({ lineNumber: lineOf(/^\s+dev:/) })
    );
  });

  it('does not move the cursor when the cell has no bind and no override', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('b'));
    fake.editor.setPosition.mockClear();
    fake.editor.revealLineInCenter.mockClear();
    // `d` has no bind and no override: it has no place in the text
    fireEvent.click(cell('d'));
    expect(fake.editor.setPosition).not.toHaveBeenCalled();
    expect(fake.editor.revealLineInCenter).not.toHaveBeenCalled();
  });

  it('shows the ends of an edge, the end that the key names and the arrow of each half', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('e'));
    // the label of the cell, the cell id stays in the title
    expect(field('source').textContent).toBe('A');
    expect(field('source').getAttribute('title')).toBe('a');
    expect(field('target').textContent).toBe('C');
    expect(field('target').getAttribute('title')).toBe('c');
    expect(within(inspector()).getByText('Source end (a)')).toBeTruthy();
    expect(within(inspector()).getByText('Target end (b)')).toBeTruthy();
    expect(field('keyed').textContent).toBe('The key names the source end (A).');
    expect(field('a2b').textContent).toBe('a → b: tx (tx)');
    expect(field('b2a').textContent).toBe('b → a: rx (rx)');
    expect(field('at').textContent).toBe('Use the target end');
  });

  it('shows the cell id as visible text when both ends have the same name', async () => {
    const same = SVG.replace('<text>C</text>', '<text>A</text>');
    render(
      <SplitEditor
        {...props({
          diagram: { xml: XML.replace('label="C"', 'label="A"'), svg: same, hash: 'inspect-2', updatedAt: '' },
        })}
      />
    );
    await frame();
    fireEvent.click(cell('e'));
    expect(field('source').textContent).toBe('A (a)');
    expect(field('target').textContent).toBe('A (c)');
  });

  it('shows the link section before the attributes and the uses', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('e'));
    const link = within(inspector()).getByRole('heading', { name: 'Link' });
    const attrs = within(inspector()).getByRole('heading', { name: 'Attributes' });
    expect(link.compareDocumentPosition(attrs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const use of within(inspector()).queryAllByTestId('dmap-inspector-use')) {
      expect(link.compareDocumentPosition(use) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('sets at=target with "Use the target end", then at=source with "Use the source end"', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('e'));
    fireEvent.click(field('at'));
    await frame();
    expect(cell('e').getAttribute('data-meta-at')).toBe('target');
    expect(field('keyed').textContent).toBe('The key names the target end (C).');
    expect(field('a2b').textContent).toBe('a → b: rx (rx)');
    expect(field('b2a').textContent).toBe('b → a: tx (tx)');
    expect(field('at').textContent).toBe('Use the source end');
    fireEvent.click(field('at'));
    await frame();
    expect(cell('e').getAttribute('data-meta-at')).toBe('source');
    expect(field('at').textContent).toBe('Use the target end');
  });

  it('shows the generated-panel note next to the button on a generated panel only', async () => {
    const view = render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('e'));
    expect(within(inspector()).queryByTestId('dmap-inspector-generated')).toBeNull();
    view.unmount();
    render(<SplitEditor {...props({ build: 'b0c1' } as Partial<Options>)} />);
    await frame();
    fireEvent.click(cell('e'));
    const note = field('generated');
    expect(note.textContent).toMatch(/generated/i);
    expect(note.textContent).toContain('the catalogue family (mode A) or the source generator (mode B)');
    expect(note.parentElement).toBe(field('at').parentElement);
  });

  it('sets bind and key on one cell in the XML and the SVG of the draft diagram', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('d'));
    const options = Array.from(inspector().querySelectorAll('datalist option')).map((o) => o.getAttribute('value'));
    expect(options).toEqual(['device', 'dev', 'sw', 'link']);
    fireEvent.change(field('bind'), { target: { value: 'sw' } });
    fireEvent.change(field('key'), { target: { value: 'd' } });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Set bind and key' }));
    await frame();
    expect(cell('d').getAttribute('data-meta-bind')).toBe('sw');
    expect(cell('d').getAttribute('data-meta-key')).toBe('d');
    expect(stage().getAttribute('data-dmap-hash')).not.toBe('inspect-1');
    // the draft diagram binds the new cell: its class chain shows
    expect(field('chain').textContent).toBe('device → sw');
    // an empty field removes the attribute
    fireEvent.change(field('key'), { target: { value: '' } });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Set bind and key' }));
    await frame();
    expect(cell('d').hasAttribute('data-meta-key')).toBe(false);
    expect(cell('d').getAttribute('data-meta-bind')).toBe('sw');
  });

  it('keeps the zoom of the stage after a write', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    await act(async () => {
      fireEvent.wheel(stage().parentElement!, { deltaY: -100, clientX: 400, clientY: 300 });
    });
    await frame();
    const zoomed = stage().querySelector('svg')!.getAttribute('viewBox');
    expect(zoomed).not.toBe('0 0 300 100');
    fireEvent.click(cell('d'));
    fireEvent.change(field('bind'), { target: { value: 'sw' } });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Set bind and key' }));
    await frame();
    expect(stage().getAttribute('data-dmap-hash')).not.toBe('inspect-1');
    expect(cell('d').getAttribute('data-meta-bind')).toBe('sw');
    expect(stage().querySelector('svg')!.getAttribute('viewBox')).toBe(zoomed);
  });

  it('adds the cells of a Shift + drag band to the selection', async () => {
    rect.mockRestore();
    // the band touches a (x 10..50) and b (x 60..100); c, d and e sit far away
    const boxes: Record<string, [number, number, number, number]> = { a: [10, 10, 50, 40], b: [60, 10, 100, 40] };
    rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const [left, top, right, bottom] = boxes[this.getAttribute('data-cell-id') ?? ''] ?? [0, 0, 800, 600];
      const far = this.hasAttribute('data-cell-id') && !boxes[this.getAttribute('data-cell-id')!];
      return (
        far
          ? { left: 3000, top: 3000, right: 3010, bottom: 3010, width: 10, height: 10, x: 3000, y: 3000 }
          : { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top }
      ) as DOMRect;
    });
    const capture = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true };
    Object.assign(HTMLElement.prototype, capture);
    try {
      render(<SplitEditor {...props()} />);
      await frame();
      fireEvent.click(cell('e'));
      const wrapper = stage().parentElement!;
      const mouse = { pointerType: 'mouse', pointerId: 1, button: 0 };
      fireEvent.pointerDown(wrapper, { ...mouse, shiftKey: true, clientX: 5, clientY: 5 });
      fireEvent.pointerMove(wrapper, { ...mouse, clientX: 110, clientY: 50 });
      fireEvent.pointerUp(wrapper, { ...mouse, clientX: 110, clientY: 50 });
      // the band adds to the selection: `e` stays
      expect(within(inspector()).getByText('3 cells selected')).toBeTruthy();
      expect(['a', 'b', 'c', 'e'].map((id) => cell(id).getAttribute('data-dmap-selected'))).toEqual([
        'true',
        'true',
        'false',
        'true',
      ]);
    } finally {
      for (const name of Object.keys(capture)) {
        Reflect.deleteProperty(HTMLElement.prototype, name);
      }
    }
  });

  it('assigns a class to a multi-select and keeps the key of each cell', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('a'));
    fireEvent.click(cell('b'), { shiftKey: true });
    fireEvent.click(cell('d'), { shiftKey: true });
    expect(within(inspector()).getByText('3 cells selected')).toBeTruthy();
    expect(['a', 'b', 'd'].map((id) => cell(id).getAttribute('data-dmap-selected'))).toEqual(['true', 'true', 'true']);
    fireEvent.change(field('bind'), { target: { value: 'sw' } });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Assign class' }));
    await frame();
    expect(['a', 'b', 'd'].map((id) => cell(id).getAttribute('data-meta-bind'))).toEqual(['sw', 'sw', 'sw']);
    expect(['a', 'b', 'd'].map((id) => cell(id).getAttribute('data-meta-key'))).toEqual(['a', 'b', null]);
    // a shift click on a selected cell takes it out of the selection
    fireEvent.click(cell('d'), { shiftKey: true });
    expect(within(inspector()).getByText('2 cells selected')).toBeTruthy();
  });

  it('shows the message of a write that the diagram refuses', async () => {
    const compressed = '<mxfile><diagram id="p1" name="Page-1">7ZZNb9swDIZ/jY4b</diagram></mxfile>';
    render(<SplitEditor {...props({ diagram: { xml: compressed, svg: SVG, hash: 'z', updatedAt: '' } })} />);
    await frame();
    fireEvent.click(cell('d'));
    fireEvent.change(field('bind'), { target: { value: 'sw' } });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Set bind and key' }));
    await frame();
    expect(within(inspector()).getByRole('alert').textContent).toContain(
      'Open the diagram in draw.io once and save it'
    );
    expect(cell('d').hasAttribute('data-meta-bind')).toBe(false);
  });
});

/** A plain draw.io diagram: ports inside nodes, links with `bind` only (spec I8, I23). */
function inferred() {
  type Cell = { id: string; label: string; attrs?: Record<string, string>; parent?: string; edge?: [string, string] };
  const cells: Cell[] = [
    { id: 'n1', label: 'Node 1', attrs: { key: 'n1' } },
    { id: 'n2', label: 'Node 2', attrs: { key: 'n2' } },
    { id: 'n3', label: 'Node 3', attrs: { key: 'n3' } },
    { id: 'n4', label: 'Node 4' },
    { id: 'p1', label: 'p1', parent: 'n1' },
    { id: 'p2', label: 'p2', parent: 'n2', attrs: { bind: 'portc', port: 'eth0', cap: '100M' } },
    { id: 'p3', label: 'p3', parent: 'n3', attrs: { port: 'eth1' } },
    { id: 'p4', label: 'p4', parent: 'n4' },
    { id: 'e_only', label: '', attrs: { bind: 'link' }, edge: ['p1', 'p2'] },
    { id: 'e_both', label: '', attrs: { bind: 'link' }, edge: ['p2', 'p3'] },
    { id: 'e_at', label: '', attrs: { bind: 'link', at: 'target' }, edge: ['p2', 'p3'] },
    { id: 'e_own', label: '', attrs: { bind: 'link', key: 'n1', port: 'eth0' }, edge: ['p1', 'p4'] },
    { id: 'e_part', label: '', attrs: { bind: 'link5', port: 'eth9' }, edge: ['p1', 'p4'] },
    { id: 'e_none', label: '', attrs: { bind: 'link' }, edge: ['p4', 'n4'] },
    { id: 'e_ov', label: '', attrs: { bind: 'link' }, edge: ['p1', 'p2'] },
    { id: 'e_mix', label: '', attrs: { bind: 'mixed' }, edge: ['p1', 'p2'] },
    { id: 'e_att', label: '', attrs: { bind: 'link', at: 'target' }, edge: ['p1', 'p2'] },
    { id: 'e_order', label: '', attrs: { bind: 'link5o', port: 'eth9' }, edge: ['p1', 'p4'] },
    { id: 'b1', label: 'B1', attrs: { bind: 'bad', key: 'n1' } },
    { id: 'b2', label: 'B2', attrs: { bind: 'badu', key: 'n1' } },
    { id: 'm1', label: 'M', attrs: { bind: 'multi', key: 'n1' } },
  ];
  const attr = (a: Record<string, string> = {}) => Object.entries(a).map(([k, v]) => `${k}="${v}"`);
  const xml =
    '<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    cells
      .map((c) => {
        const [a, b] = c.edge ?? [];
        const geometry = `<mxCell parent="${c.parent ?? '1'}" ${c.edge ? `edge="1" source="${a}" target="${b}"` : 'vertex="1"'}/>`;
        return `<object id="${c.id}" label="${c.label}" ${attr(c.attrs).join(' ')}>${geometry}</object>`;
      })
      .join('') +
    '</root></mxGraphModel></diagram></mxfile>';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">' +
    cells
      .map((c, i) => {
        const meta = Object.entries(c.attrs ?? {}).map(([k, v]) => `data-meta-${k}="${v}"`);
        const shape = c.edge
          ? `<path d="M ${i} 15 L ${i + 40} 15" fill="none" pointer-events="stroke"/>`
          : `<rect x="${i * 10}" width="40" height="30"/><text>${c.label}</text>`;
        return `<g data-cell-id="${c.id}" ${meta.join(' ')}>${shape}</g>`;
      })
      .join('') +
    '</svg>';
  const config = {
    version: 4,
    classes: {
      link: { match: { key: 'job', port: 'device' }, up: 'tx', down: 'rx' },
      link5: {
        match: { key: 'job', port: 'device' },
        up: 'tx',
        rows: [{ kind: 'value', query: 'tx', match: { key: 'job', site: 'site' } }],
      },
      link5o: { match: { site: 'site', key: 'job', port: 'device' }, up: 'tx' },
      bad: { match: { key: 'job=~"${key}(?=x)"' }, status: 'up' },
      badu: { match: { key: 'job=~"${key}(?=x)"' }, status: 'nosuch' },
      mixed: {
        match: { key: 'job', port: 'device' },
        up: 'tx',
        down: 'rx',
        rows: [{ kind: 'updown', up: 'tx', down: 'rx', match: { id: 'edge' } }],
      },
      portc: { match: { key: 'job', port: 'device' }, status: 'up' },
      multi: {
        match: { key: 'job' },
        status: 'up',
        text: { query: 'up' },
        rows: [{ kind: 'history', query: 'up' }],
        chart: { kind: 'history', query: 'up' },
      },
    },
    overrides: { e_ov: { match: { key: 'node', port: 'iface' } } },
  };
  const base = data();
  const now = Date.now();
  const frame = (refId: string, labels: Record<string, string>, value: number) =>
    toDataFrame({
      refId,
      fields: [
        { name: 'Time', type: FieldType.time, values: [now - 60_000, now] },
        { name: 'Value', type: FieldType.number, values: [value - 1, value], labels },
      ],
    });
  const series = [
    frame('up', { job: 'n2', device: 'eth0' }, 1),
    frame('up', { job: 'n1' }, 1),
    frame('tx', { job: 'n2', device: 'eth0' }, 100),
    frame('rx', { job: 'n2', device: 'eth0' }, 5),
    frame('tx', { job: 'n3', device: 'eth1' }, 100),
    frame('rx', { job: 'n3', device: 'eth1' }, 5),
    frame('tx', { node: 'n2', iface: 'eth0' }, 100),
    frame('rx', { node: 'n2', iface: 'eth0' }, 5),
  ];
  return editorProps({
    options: { config, diagram: { xml, svg, hash: 'inferred-1', updatedAt: '' } } as unknown as Options,
    data: {
      ...base,
      series,
      request: { ...base.request!, targets: ['up', 'tx', 'rx'].map((refId) => ({ refId })) },
    },
  });
}

describe('InspectorV4 with an inferred identity', () => {
  let rect: { mockRestore(): void };
  beforeEach(() => {
    fake.reset();
    rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(
        () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect
      );
  });
  afterEach(() => rect.mockRestore());

  const open = async (id: string) => {
    render(<SplitEditor {...inferred()} />);
    await frame();
    fireEvent.click(cell(id));
  };
  const sectionOf = (path: string) =>
    within(inspector())
      .getAllByTestId('dmap-inspector-use')
      .find((el) => el.dataset.dmapUse === path)!;

  it('shows an inherited value with its origin in the attribute list', async () => {
    await open('p2');
    const attrs = within(field('attrs'));
    expect(attrs.getByText('key').nextSibling?.textContent).toBe('n2 (from Node 2)');
    expect(attrs.getByText('port').nextSibling?.textContent).toBe('eth0');
    // the use of the port shows the matchers with the inherited key, not "Missing attribute"
    expect(within(sectionOf('classes.portc.status')).getByTestId('dmap-inspector-resolved').textContent).toBe(
      'job="n2", device="eth0"'
    );
    expect(within(sectionOf('classes.portc.status')).getByTestId('dmap-inspector-count').textContent).toBe('1 series');
  });

  it('shows a name of a cell that is not inherited as its own value only', async () => {
    await open('e_own');
    expect(within(field('attrs')).queryByText(/from /)).toBeNull();
  });

  it.each([
    ['e_at', 'target: at=target on the link'],
    ['e_only', 'target: only this end gives key, port'],
    ['e_both', 'source: both ends give key, port. Set at=target to measure the target end.'],
    ['e_own', 'source: the link has key, port itself'],
    // rule 5: the link has port; the source end gives key; no end gives site
    ['e_part', 'source: the link has port itself; the source end gives key; site is missing'],
    ['e_none', 'none: no end gives key, port. Put them on a port, or on the link.'],
  ])('says why the measured end of %s is what it is', async (id, text) => {
    await open(id);
    expect(field('measured').textContent).toBe(text);
  });

  it('shows the feed of an inferred target: the lines a → b and b → a name the flipped queries', async () => {
    await open('e_only');
    expect(field('keyed').textContent).toBe('The key names the target end (p2).');
    expect(field('a2b').textContent).toBe('a → b: rx (rx)');
    expect(field('b2a').textContent).toBe('b → a: tx (tx)');
    const up = sectionOf('classes.link.up');
    expect(within(up).getByTestId('dmap-inspector-resolved').textContent).toBe('job="n2", device="eth0"');
    expect(within(up).getByTestId('dmap-inspector-feed').textContent).toBe('target end (inferred)');
    expect(within(up).getByTestId('dmap-inspector-count').textContent).toBe('1 series');
  });

  it('keeps the unflipped lines for an inferred source', async () => {
    await open('e_own');
    expect(field('a2b').textContent).toBe('a → b: tx (tx)');
    expect(within(sectionOf('classes.link.up')).getByTestId('dmap-inspector-feed').textContent).toBe('source end');
  });

  it('resolves the match of an override with the inherited value', async () => {
    await open('e_ov');
    expect(within(sectionOf('classes.link.up')).getByTestId('dmap-inspector-resolved').textContent).toBe(
      'node="n2", iface="eth0"'
    );
  });

  it('names the end cell that gives the capacity', async () => {
    await open('e_only');
    expect(field('capacity').textContent).toBe('Capacity: a → b 100 Mb/s (cap of p2), b → a 100 Mb/s (cap of p2)');
  });

  it('lists the dependent uses of an unmeasured link as not measured, with their match as written', async () => {
    await open('e_none');
    const list = field('not-measured');
    expect(list.textContent).toContain('classes.link.up');
    expect(list.textContent).toContain('key: job; port: device');
    expect(within(inspector()).queryAllByTestId('dmap-inspector-use')).toHaveLength(0);
  });

  it('gives each of status, text, a history row and a chart its matcher text', async () => {
    await open('m1');
    const uses = within(inspector()).getAllByTestId('dmap-inspector-use');
    expect(uses.map((u) => u.dataset.dmapUse)).toEqual([
      'classes.multi.status',
      'classes.multi.text',
      'classes.multi.rows[0]',
      'classes.multi.chart',
    ]);
    for (const el of uses) {
      expect(within(el).getByTestId('dmap-inspector-resolved').textContent).toBe('job="n1"');
    }
  });

  it('says which end the names come from whatever the order of the match', async () => {
    await open('e_order');
    expect(field('measured').textContent).toBe(
      'source: the link has port itself; the source end gives key; site is missing'
    );
  });

  it.each([
    ['b1', 'known query'],
    ['b2', 'unknown query'],
  ])('keeps the reason of a matcher error (%s, %s)', async (id) => {
    await open(id);
    const [first] = within(inspector()).getAllByTestId('dmap-inspector-use');
    expect(within(first).getByTestId('dmap-inspector-resolved').textContent).toBe(
      'Matcher error: not in the PromQL regex dialect: (?=x'
    );
  });

  it('writes the end that the button names, at every step', async () => {
    // explicit at=target, only the target gives the identity: "source" writes at=source
    await open('e_att');
    expect(field('at').textContent).toBe('Use the source end');
    fireEvent.click(field('at'));
    await frame();
    expect(cell('e_att').getAttribute('data-meta-at')).toBe('source');
    expect(field('measured').textContent).toBe('source: at=source on the link');
    // explicit source: "target" writes at=target, also when that equals the inferred end
    expect(field('at').textContent).toBe('Use the target end');
    fireEvent.click(field('at'));
    await frame();
    expect(cell('e_att').getAttribute('data-meta-at')).toBe('target');
    expect(field('measured').textContent).toBe('target: at=target on the link');
    expect(field('at').textContent).toBe('Use the source end');
    fireEvent.click(field('at'));
    await frame();
    expect(cell('e_att').getAttribute('data-meta-at')).toBe('source');
  });

  it('writes the named end always, so an end-free row follows it too', async () => {
    await open('e_mix');
    const feed = (path: string) => within(sectionOf(path)).getByTestId('dmap-inspector-feed').textContent;
    // inferred target for the halves; the end-free row keeps the source feed (I13)
    expect(feed('classes.mixed.up')).toBe('target end (inferred)');
    expect(feed('classes.mixed.rows[0].a2b')).toBe('source end');
    // "source": every use moves to the source
    fireEvent.click(field('at'));
    await frame();
    expect(cell('e_mix').getAttribute('data-meta-at')).toBe('source');
    expect(feed('classes.mixed.up')).toBe('source end (at=source on the link)');
    expect(feed('classes.mixed.rows[0].a2b')).toBe('source end (at=source on the link)');
    // "target" writes at=target, not a clear: the row moves to the target feed with the halves
    expect(field('at').textContent).toBe('Use the target end');
    fireEvent.click(field('at'));
    await frame();
    expect(cell('e_mix').getAttribute('data-meta-at')).toBe('target');
    expect(feed('classes.mixed.up')).toBe('target end (at=target on the link)');
    expect(feed('classes.mixed.rows[0].a2b')).toBe('target end (at=target on the link)');
  });

  it('writes the other end for an inferred end, and removes at with "Infer the end"', async () => {
    await open('e_only');
    expect(field('at').textContent).toBe('Use the source end');
    expect(within(inspector()).queryByTestId('dmap-inspector-infer')).toBeNull();
    fireEvent.click(field('at'));
    await frame();
    expect(cell('e_only').getAttribute('data-meta-at')).toBe('source');
    expect(field('measured').textContent).toBe('source: at=source on the link');
    fireEvent.click(field('infer'));
    await frame();
    expect(cell('e_only').hasAttribute('data-meta-at')).toBe(false);
    expect(field('measured').textContent).toBe('target: only this end gives key, port');
  });
});

describe('endName', () => {
  const meta = (m: Partial<CellMeta> & { id: string }): CellEntry =>
    ({ meta: { key: m.id, attrs: {}, labelText: '', isEdge: false, kind: 'node', ...m } }) as unknown as CellEntry;
  const ctx = (entries: CellEntry[], parents: Array<[string, string]> = []): EndContext => ({
    index: new Map(entries.map((e) => [e.meta.id, e])),
    ends: new Map(),
    parents: new Map(parents),
  });

  it('names a portograph port by its node label and port', () => {
    const c = ctx(
      [
        meta({ id: 'pg-node~rtr-a', labelText: 'Router A' }),
        meta({ id: 'pg-port~rtr-a~br-lan~1', kind: 'port', labelText: 'br-lan', attrs: { 'pg-node': 'rtr-a' } }),
      ],
      [['pg-port~rtr-a~br-lan~1', 'pg-node~rtr-a']]
    );
    expect(endName('pg-port~rtr-a~br-lan~1', c)).toBe('Router A · br-lan');
  });

  it('falls back to pg-node and pg-port, then to the id', () => {
    const c = ctx([
      meta({ id: 'p1', kind: 'port', attrs: { 'pg-node': 'rtr-a', 'pg-port': 'lan' } }),
      meta({ id: 'x' }),
    ]);
    expect(endName('p1', c)).toBe('rtr-a · lan');
    expect(endName('x', c)).toBe('x');
    expect(endName('unknown-cell', c)).toBe('unknown-cell');
    expect(endName(undefined, c)).toBeUndefined();
  });

  it('names a plain draw.io end by its label on one line', () => {
    expect(endName('n', ctx([meta({ id: 'n', labelText: 'Core\n switch' })]))).toBe('Core switch');
  });
});

describe('InspectorV4 attribute row', () => {
  let rect: { mockRestore(): void };
  beforeEach(() => {
    fake.reset();
    rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(
        () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect
      );
  });
  afterEach(() => rect.mockRestore());

  const open = async (id: string, over: Partial<Options> = {}) => {
    const p = inferred();
    render(<SplitEditor {...p} options={{ ...p.options, ...over } as Options} />);
    await frame();
    fireEvent.click(cell(id));
  };
  const attrs = () => field('attrs');
  const nameInput = () => within(inspector()).getByRole('textbox', { name: 'Attribute name' });
  const valueInput = () => within(inspector()).getByRole('textbox', { name: 'Attribute value' });
  const add = (name: string, value: string) => {
    fireEvent.change(nameInput(), { target: { value: name } });
    fireEvent.change(valueInput(), { target: { value: value } });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Add attribute' }));
  };

  it('adds an attribute in lowercase, with Undo and Redo', async () => {
    await open('p1');
    add('Port', 'x');
    await frame();
    expect(cell('p1').getAttribute('data-meta-port')).toBe('x');
    expect(within(attrs()).getByText('port').nextSibling?.textContent).toBe('x');
    expect((nameInput() as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await frame();
    expect(cell('p1').hasAttribute('data-meta-port')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await frame();
    expect(cell('p1').getAttribute('data-meta-port')).toBe('x');
  });

  it('allows an empty value', async () => {
    await open('p1');
    add('port', '');
    await frame();
    expect(cell('p1').getAttribute('data-meta-port')).toBe('');
    expect(within(attrs()).getByText('port')).toBeTruthy();
  });

  it('adds with Enter in the name or the value field', async () => {
    await open('p1');
    fireEvent.change(nameInput(), { target: { value: 'site' } });
    fireEvent.change(valueInput(), { target: { value: 'north' } });
    fireEvent.keyDown(valueInput(), { key: 'Enter' });
    await frame();
    expect(cell('p1').getAttribute('data-meta-site')).toBe('north');
  });

  it.each([
    ['', 'Enter a name.'],
    ['1x', 'Use a letter or _ first'],
    ['a b', 'Use a letter or _ first'],
    ['\u212Aey', 'Use a letter or _ first'],
    ['a\u212A', 'Use a letter or _ first'],
    ['\u0130d', 'Use a letter or _ first'],
    ['__proto__', 'not allowed'],
    ['pg-kind', 'reserved'],
    ['ID', 'reserved'],
    ['label', 'reserved'],
    ['placeholders', 'reserved'],
    ['xmlns', 'reserved'],
    ['bind', 'bind and key'],
    ['key', 'bind and key'],
    ['at', 'end'],
  ])('refuses the name %j with an inline error', async (name, message) => {
    await open('p1');
    const before = cell('p1').getAttributeNames();
    add(name, 'v');
    await frame();
    expect(within(inspector()).getByTestId('dmap-inspector-attr-error').textContent).toContain(message);
    expect(cell('p1').getAttributeNames()).toEqual(before);
  });

  it('refuses a name that the cell has already', async () => {
    await open('p2');
    add('port', 'x');
    expect(within(inspector()).getByTestId('dmap-inspector-attr-error').textContent).toContain('Edit');
    expect(cell('p2').getAttribute('data-meta-port')).toBe('eth0');
  });

  it('edits a value; Escape cancels the edit', async () => {
    await open('p2');
    fireEvent.click(within(attrs()).getByRole('button', { name: 'Edit port' }));
    const input = within(attrs()).getByRole('textbox', { name: 'Value of port' });
    fireEvent.change(input, { target: { value: 'eth7' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(within(attrs()).queryByRole('textbox', { name: 'Value of port' })).toBeNull();
    expect(cell('p2').getAttribute('data-meta-port')).toBe('eth0');
    fireEvent.click(within(attrs()).getByRole('button', { name: 'Edit port' }));
    const again = within(attrs()).getByRole('textbox', { name: 'Value of port' });
    expect((again as HTMLInputElement).value).toBe('eth0');
    fireEvent.change(again, { target: { value: 'eth7' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    await frame();
    expect(cell('p2').getAttribute('data-meta-port')).toBe('eth7');
  });

  it('removes an attribute', async () => {
    await open('p2');
    fireEvent.click(within(attrs()).getByRole('button', { name: 'Remove cap' }));
    await frame();
    expect(cell('p2').hasAttribute('data-meta-cap')).toBe(false);
    expect(within(attrs()).queryByText('cap')).toBeNull();
  });

  it('keeps bind, key, at and the reserved names read-only', async () => {
    await open('e_at');
    expect(within(attrs()).getByText('at')).toBeTruthy();
    expect(within(attrs()).queryByRole('button', { name: /^(Edit|Remove) (at|bind|key)$/ })).toBeNull();
    expect(within(attrs()).queryByRole('button', { name: 'Edit bind' })).toBeNull();
  });

  it('keeps a pg-* attribute read-only', async () => {
    const p = inferred();
    const xml = p.options.diagram!.xml.replace('id="p1" label="p1"', 'id="p1" label="p1" pg-port="e0"');
    const svg = p.options.diagram!.svg.replace('<g data-cell-id="p1"', '<g data-cell-id="p1" data-meta-pg-port="e0"');
    render(<SplitEditor {...p} options={{ ...p.options, diagram: { ...p.options.diagram, xml, svg } } as Options} />);
    await frame();
    fireEvent.click(cell('p1'));
    expect(within(attrs()).getByText('pg-port').nextSibling?.textContent).toBe('e0');
    expect(within(attrs()).queryByRole('button', { name: /pg-port/ })).toBeNull();
  });

  it('offers "Set here" for an inherited value and copies it as an own attribute', async () => {
    await open('p2');
    const inheritedKey = within(attrs()).getByText('key').nextSibling as HTMLElement;
    expect(inheritedKey.textContent).toBe('n2 (from Node 2)');
    expect(cell('p2').hasAttribute('data-meta-key')).toBe(false);
    fireEvent.click(within(attrs()).getByRole('button', { name: 'Set key here' }));
    await frame();
    expect(cell('p2').getAttribute('data-meta-key')).toBe('n2');
    expect(within(attrs()).queryByRole('button', { name: 'Set key here' })).toBeNull();
  });

  it('shows the attributes of the measured end of a link, and "Select the ... end" selects it', async () => {
    await open('e_only');
    const measured = field('measured').textContent!;
    const end = measured.startsWith('source') ? 'source' : 'target';
    const target = end === 'source' ? 'p1' : 'p2';
    const block = within(inspector()).getByTestId('dmap-inspector-end-attrs');
    expect(block.textContent).toContain(target === 'p2' ? 'eth0' : 'n1');
    expect(within(block).queryByRole('button', { name: /^(Edit|Remove)/ })).toBeNull();
    fireEvent.click(within(block).getByRole('button', { name: `Select the ${end} end` }));
    await frame();
    expect(field('id').textContent).toBe(target);
    expect(within(inspector()).queryByTestId('dmap-inspector-end-attrs')).toBeNull();
  });

  it('shows both ends of a link that no end measures', async () => {
    await open('e_none');
    const blocks = within(inspector()).getAllByTestId('dmap-inspector-end-attrs');
    expect(blocks).toHaveLength(2);
    expect(within(inspector()).getByRole('button', { name: 'Select the source end' })).toBeTruthy();
    expect(within(inspector()).getByRole('button', { name: 'Select the target end' })).toBeTruthy();
  });

  it('shows no end block for a vertex', async () => {
    await open('p2');
    expect(within(inspector()).queryByTestId('dmap-inspector-end-attrs')).toBeNull();
  });

  it('shows the generated-panel note for the attributes on a generated panel only', async () => {
    await open('p1');
    expect(within(inspector()).queryByTestId('dmap-inspector-attrs-generated')).toBeNull();
    cleanup();
    await open('p1', { build: 'b0c1' } as Partial<Options>);
    expect(field('attrs-generated').textContent).toMatch(/next build writes these attributes again/);
  });

  it('labels each control', async () => {
    await open('p2');
    expect(within(attrs()).getByRole('button', { name: 'Edit port' })).toBeTruthy();
    expect(within(attrs()).getByRole('button', { name: 'Remove port' })).toBeTruthy();
    expect(nameInput()).toBeTruthy();
    expect(valueInput()).toBeTruthy();
  });

  it('is not offered for a multi-select', async () => {
    await open('p1');
    fireEvent.click(cell('p2'), { shiftKey: true });
    expect(within(inspector()).queryByRole('textbox', { name: 'Attribute name' })).toBeNull();
  });

  const saveEdit = async (attr: string, to: string) => {
    fireEvent.click(within(attrs()).getByRole('button', { name: `Edit ${attr}` }));
    const input = within(attrs()).getByRole('textbox', { name: `Value of ${attr}` });
    fireEvent.change(input, { target: { value: to } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await frame();
  };
  const editBox = (attr: string) => within(attrs()).queryByRole('textbox', { name: `Value of ${attr}` });

  it('drops an open edit when Undo changes its attribute, and again for Redo', async () => {
    await open('p2');
    await saveEdit('port', 'eth7');
    fireEvent.click(within(attrs()).getByRole('button', { name: 'Edit port' }));
    fireEvent.change(editBox('port')!, { target: { value: 'typed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await frame();
    expect(editBox('port')).toBeNull();
    expect(cell('p2').getAttribute('data-meta-port')).toBe('eth0');
    fireEvent.click(within(attrs()).getByRole('button', { name: 'Edit port' }));
    expect((editBox('port') as HTMLInputElement).value).toBe('eth0');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await frame();
    expect(editBox('port')).toBeNull();
    expect(cell('p2').getAttribute('data-meta-port')).toBe('eth7');
  });

  it('drops an open edit when Undo removes its attribute', async () => {
    await open('p1');
    add('site', 'a');
    await frame();
    fireEvent.click(within(attrs()).getByRole('button', { name: 'Edit site' }));
    expect(editBox('site')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await frame();
    expect(editBox('site')).toBeNull();
    expect(within(attrs()).queryByText('site')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await frame();
    expect(editBox('site')).toBeNull();
  });

  it.each(['Save port', 'Cancel the edit of port'])(
    'Escape on the button "%s" cancels the edit and stays out of the dialog keys',
    async (label) => {
      await open('p2');
      fireEvent.click(within(attrs()).getByRole('button', { name: 'Edit port' }));
      fireEvent.change(editBox('port')!, { target: { value: 'eth7' } });
      const button = within(attrs()).getByRole('button', { name: label });
      const bubbled = vi.fn();
      document.addEventListener('keydown', bubbled);
      fireEvent.keyDown(button, { key: 'Escape' });
      document.removeEventListener('keydown', bubbled);
      expect(editBox('port')).toBeNull();
      expect(bubbled).not.toHaveBeenCalled();
      expect(cell('p2').getAttribute('data-meta-port')).toBe('eth0');
    }
  );

  it('Escape on the Add attribute button clears the add row and stays out of the dialog keys', async () => {
    await open('p1');
    fireEvent.change(nameInput(), { target: { value: 'site' } });
    const button = within(inspector()).getByRole('button', { name: 'Add attribute' });
    const bubbled = vi.fn();
    document.addEventListener('keydown', bubbled);
    fireEvent.keyDown(button, { key: 'Escape' });
    document.removeEventListener('keydown', bubbled);
    expect((nameInput() as HTMLInputElement).value).toBe('');
    expect(bubbled).not.toHaveBeenCalled();
  });
});

describe('InspectorV4 suggestions', () => {
  let rect: { mockRestore(): void };
  beforeEach(() => {
    fake.reset();
    rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(
        () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect
      );
  });
  afterEach(() => rect.mockRestore());

  const spare = () =>
    toDataFrame({
      refId: 'up',
      fields: [
        { name: 'Time', type: FieldType.time, values: [Date.now()] },
        { name: 'Value', type: FieldType.number, values: [1], labels: { job: 'spare' } },
      ],
    });
  const withSpare = () => {
    const p = props();
    return { ...p, data: { ...p.data, series: [...p.data.series, spare()] } };
  };
  const suggestions = () => within(inspector()).queryAllByTestId('dmap-inspector-suggestion');

  it('shows a suggestion under a use with no series, the orphan first, with its labels and a badge', async () => {
    render(<SplitEditor {...withSpare()} />);
    await frame();
    fireEvent.click(cell('b'));
    const rows = suggestions();
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].textContent).toContain('Set key = spare on B');
    expect(rows[0].textContent).toContain('job="spare"');
    expect(within(rows[0]).getByText('unused series')).toBeTruthy();
    expect(within(rows[1]).queryByText('unused series')).toBeNull();
  });

  it('shows nothing for a use that has series, and no empty box', async () => {
    render(<SplitEditor {...withSpare()} />);
    await frame();
    fireEvent.click(cell('c'));
    expect(within(inspector()).queryByTestId('dmap-inspector-suggestions')).toBeNull();
    expect(within(inspector()).queryByText(/No suggestion/)).toBeNull();
  });

  it('applies a suggestion with Undo and Redo, and the use gets one series', async () => {
    render(<SplitEditor {...withSpare()} />);
    await frame();
    fireEvent.click(cell('b'));
    fireEvent.click(within(suggestions()[0]).getByRole('button', { name: 'Set it' }));
    await frame();
    expect(cell('b').getAttribute('data-meta-key')).toBe('spare');
    const [use] = within(inspector()).getAllByTestId('dmap-inspector-use');
    expect(within(use).getByTestId('dmap-inspector-count').textContent).toBe('1 series');
    expect(within(inspector()).queryByTestId('dmap-inspector-suggestions')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await frame();
    expect(cell('b').getAttribute('data-meta-key')).toBe('b');
    expect(suggestions().length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await frame();
    expect(cell('b').getAttribute('data-meta-key')).toBe('spare');
  });

  it('says on the button that the write goes to the end port, and keeps the link selected', async () => {
    const p = inferred();
    const diagram = p.options.diagram!;
    const options = {
      ...p.options,
      diagram: {
        ...diagram,
        xml: diagram.xml.replace('port="eth0" cap', 'port="eth9" cap'),
        svg: diagram.svg.replace('data-meta-port="eth0"', 'data-meta-port="eth9"'),
      },
    } as Options;
    render(<SplitEditor {...p} options={options} />);
    await frame();
    fireEvent.click(cell('e_only'));
    const [row] = suggestions();
    expect(row.textContent).toContain('Set port = eth0 on p2');
    fireEvent.click(within(row).getByRole('button', { name: 'Set on p2' }));
    await frame();
    expect(cell('p2').getAttribute('data-meta-port')).toBe('eth0');
    expect(field('id').textContent).toBe('e_only');
    const use = within(inspector())
      .getAllByTestId('dmap-inspector-use')
      .find((el) => el.dataset.dmapUse === 'classes.link.up')!;
    expect(within(use).getByTestId('dmap-inspector-count').textContent).toBe('1 series');
  });

  it('names an end with its cell id when both ends have the same name', async () => {
    const p = inferred();
    const diagram = p.options.diagram!;
    const options = {
      ...p.options,
      diagram: {
        ...diagram,
        xml: diagram.xml
          .replace('port="eth0" cap', 'port="eth9" cap')
          .replace('<object id="p2" label="p2"', '<object id="p2" label="p1"'),
        svg: diagram.svg
          .replace('data-meta-port="eth0"', 'data-meta-port="eth9"')
          .replace('<text>p2</text>', '<text>p1</text>'),
      },
    } as Options;
    render(<SplitEditor {...p} options={options} />);
    await frame();
    fireEvent.click(cell('e_only'));
    const [row] = suggestions();
    expect(row.textContent).toContain('Set port = eth0 on p1 (p2)');
    expect(within(row).getByRole('button', { name: 'Set on p1 (p2)' })).toBeTruthy();
  });

  it('runs the candidate engine once for the same inputs, not on every render', async () => {
    const p = withSpare();
    const { rerender } = render(<SplitEditor {...p} />);
    await frame();
    fireEvent.click(cell('b'));
    expect(suggestions().length).toBeGreaterThan(0);
    const before = engine.calls;
    expect(before).toBeGreaterThan(0);
    // unrelated renders: the cursor in the code box lights cells; the data, the draft and the selection stay
    act(() => fake.moveTo(fake.text.indexOf('classes:')));
    act(() => fake.moveTo(fake.text.indexOf('link:')));
    rerender(<SplitEditor {...p} />);
    await frame();
    expect(engine.calls).toBe(before);
  });

  it('says there is no suggestion for a regex match', async () => {
    render(<SplitEditor {...inferred()} />);
    await frame();
    fireEvent.click(cell('b1'));
    expect(within(inspector()).getByText('No suggestion for a regex match.')).toBeTruthy();
    expect(suggestions()).toHaveLength(0);
  });
});
