import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateTime, FieldType, toDataFrame, type PanelData } from '@grafana/data';
import type { Options } from '../../types';
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
    // `d` has no bind: the end of `classes`, the line before `overrides`
    fireEvent.click(cell('d'));
    expect(fake.editor.setPosition).toHaveBeenLastCalledWith(expect.objectContaining({ lineNumber: overrides - 1 }));
    expect(fake.editor.revealLineInCenter).toHaveBeenLastCalledWith(overrides - 1);
  });

  it('shows the ends of an edge, the end that the key names and the arrow of each half', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('e'));
    expect(field('source').textContent).toBe('a');
    expect(field('target').textContent).toBe('c');
    expect(field('keyed').textContent).toBe('The key names the source end.');
    expect(field('a2b').textContent).toBe('a → b: tx (tx)');
    expect(field('b2a').textContent).toBe('b → a: rx (rx)');
    expect(field('at').textContent).toBe('key is at the target');
  });

  it('sets at=target with "key is at the target", then clears it with "key is at the source"', async () => {
    render(<SplitEditor {...props()} />);
    await frame();
    fireEvent.click(cell('e'));
    fireEvent.click(field('at'));
    await frame();
    expect(cell('e').getAttribute('data-meta-at')).toBe('target');
    expect(field('keyed').textContent).toBe('The key names the target end.');
    expect(field('a2b').textContent).toBe('a → b: rx (rx)');
    expect(field('b2a').textContent).toBe('b → a: tx (tx)');
    expect(field('at').textContent).toBe('key is at the source');
    fireEvent.click(field('at'));
    await frame();
    expect(cell('e').hasAttribute('data-meta-at')).toBe(false);
    expect(field('at').textContent).toBe('key is at the target');
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
