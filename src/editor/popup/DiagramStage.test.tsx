import React, { useRef } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramStage, type StageSelection } from './DiagramStage';
import { useStage } from '../../stage/useStage';
import type { ViewBox } from '../../render/zoom';
import type { CellPatch, PatchMap } from '../../types';
import type { Badge } from '../split/cellsForPath';

const svg = readFileSync(resolve(__dirname, '../../fixtures/authoring.svg'), 'utf8');
const NONE: StageSelection = { selected: [], affected: [], highlight: [] };
const patch = (cellId: string, color: string): CellPatch => ({
  cellId,
  scope: { cell: {} },
  shape: { status: 'ok', color, target: 'shape', stepIndex: 0 },
  urls: [],
});
const patches = (...list: CellPatch[]): PatchMap => new Map(list.map((p) => [p.cellId, p]));

interface HarnessProps {
  svg?: string;
  hash?: string;
  patches?: PatchMap;
  selection?: StageSelection;
  onSelect?: (id: string, options: { shift: boolean }) => void;
  onBox?: (ids: string[]) => void;
  onStage?: (stage: ReturnType<typeof useStage>) => void;
  badges?: Map<string, Badge>;
  view?: ViewBox | null;
  setView?: React.Dispatch<React.SetStateAction<ViewBox | null>>;
}
function Harness({
  svg: text = svg,
  hash = 'h1',
  patches: map = new Map(),
  selection = NONE,
  onSelect,
  onBox,
  onStage,
  ...rest
}: HarnessProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stage = useStage(ref, text, hash);
  onStage?.(stage);
  return (
    <DiagramStage
      stage={stage}
      stageRef={ref}
      patches={map}
      selection={selection}
      onSelect={onSelect ?? (() => {})}
      onBox={onBox}
      {...rest}
    />
  );
}

const frame = async () => {
  await act(async () => {
    await new Promise((done) => requestAnimationFrame(() => done(undefined)));
  });
};

describe('DiagramStage', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('mounts the svg in the popup stage container and fits it to the pane', async () => {
    render(<Harness />);
    await frame();
    const stage = screen.getByTestId('dmap-popup-stage');
    const root = stage.querySelector(':scope > svg')!;
    expect(root).toBeTruthy();
    expect(root.getAttribute('viewBox')).toBe('0 0 640 320');
    expect(root.getAttribute('width')).toBe('100%');
    expect(root.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(screen.queryByTestId('dmap-stage')).toBeNull();
    expect(screen.queryByTestId('dmap-panel')).toBeNull();
  });

  it('applies the patches and the editor layer', async () => {
    const view = render(<Harness patches={patches(patch('device-1', 'rgb(1, 2, 3)'))} />);
    await frame();
    const stage = screen.getByTestId('dmap-popup-stage');
    const shape = stage.querySelector('[data-cell-id="device-1"] rect') as SVGRectElement;
    expect(shape.style.fill).toBe('rgb(1, 2, 3)');
    view.rerender(<Harness patches={new Map()} />);
    await frame();
    expect(shape.style.fill).toBe('');
  });

  it('draws the value labels of a link patch above everything, and takes them away with the patch', async () => {
    const half = {
      status: 'ok' as const,
      color: '#0f0',
      width: 4,
      label: '41 Mb/s · 41% of 100 Mb/s',
      stepIndex: 0,
      percent: 41,
      percentDisplay: '41%',
    };
    const link: CellPatch = {
      ...patch('link-1', '#0f0'),
      shape: undefined,
      link: { a2b: half, b2a: half, labelMode: 'percent' },
    };
    const view = render(<Harness patches={patches(link)} />);
    await frame();
    const root = screen.getByTestId('dmap-popup-stage').querySelector(':scope > svg')!;
    const labels = root.querySelectorAll('text.dmap-link-label');
    expect(labels).toHaveLength(2);
    expect(labels[0].textContent).toBe('41%');
    expect(root.lastElementChild?.classList.contains('dmap-link-labels')).toBe(true);
    view.rerender(<Harness patches={new Map()} />);
    await frame();
    expect(root.querySelectorAll('text.dmap-link-label')).toHaveLength(0);
  });

  it('marks the selected, affected and highlighted cells and makes every cell a button', () => {
    render(
      <Harness selection={{ selected: ['device-1'], affected: ['device-1', 'device-2'], highlight: ['link-1'] }} />
    );
    const cell = (id: string) => screen.getByTestId('dmap-popup-stage').querySelector(`g[data-cell-id="${id}"]`)!;
    expect(cell('device-1').getAttribute('data-dmap-selected')).toBe('true');
    expect(cell('device-2').getAttribute('data-dmap-selected')).toBe('false');
    expect(cell('device-2').getAttribute('data-dmap-affected')).toBe('true');
    expect(cell('link-1').getAttribute('data-dmap-highlight')).toBe('true');
    expect(cell('device-2').getAttribute('role')).toBe('button');
    expect(cell('device-2').getAttribute('tabindex')).toBe('0');
    expect(cell('device-2').getAttribute('aria-label')).toBe('device-2 diagram element');
  });

  it('lights the highlighted and the lighter cells and dims the other cells', () => {
    const view = render(
      <Harness selection={{ selected: [], affected: [], highlight: ['device-1'], lighter: ['device-2'] }} />
    );
    const cell = (id: string) => screen.getByTestId('dmap-popup-stage').querySelector(`g[data-cell-id="${id}"]`)!;
    const root = screen.getByTestId('dmap-popup-stage').querySelector('svg')!;
    expect(cell('device-1').getAttribute('data-dmap-highlight')).toBe('true');
    expect(cell('device-2').getAttribute('data-dmap-lighter')).toBe('true');
    expect(cell('device-1').getAttribute('data-dmap-lighter')).toBe('false');
    expect(root.classList.contains('dmap-legend-active')).toBe(true);
    expect(cell('device-1').classList.contains('dmap-legend-hit')).toBe(true);
    expect(cell('device-2').classList.contains('dmap-legend-hit')).toBe(true);
    expect(cell('link-1').classList.contains('dmap-legend-member')).toBe(true);
    expect(cell('link-1').classList.contains('dmap-legend-hit')).toBe(false);
    // no highlight: nothing dims
    view.rerender(<Harness selection={NONE} />);
    expect(root.classList.contains('dmap-legend-active')).toBe(false);
    expect(root.querySelectorAll('.dmap-legend-member')).toHaveLength(0);
  });

  it('puts a badge with the count on the top-right corner of each cell, red for 0', async () => {
    const boxes: Record<string, Partial<DOMRect>> = {
      'device-1': { left: 100, top: 50, right: 160, bottom: 90 },
      'device-2': { left: 200, top: 60, right: 250, bottom: 100 },
    };
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const id = this.getAttribute('data-cell-id') ?? '';
      return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, ...boxes[id] } as DOMRect;
    });
    const badges = new Map([
      ['device-1', { count: 2, red: false }],
      ['device-2', { count: 0, red: true }],
    ]);
    const view = render(<Harness badges={badges} />);
    await frame();
    const shown = screen.getAllByTestId('dmap-cell-badge');
    expect(shown.map((el) => [el.dataset.dmapBadge, el.textContent, el.dataset.dmapRed])).toEqual([
      ['device-1', '2', 'false'],
      ['device-2', '0', 'true'],
    ]);
    expect([shown[0].style.left, shown[0].style.top]).toEqual(['160px', '50px']);
    view.rerender(<Harness badges={new Map()} />);
    await frame();
    expect(screen.queryAllByTestId('dmap-cell-badge')).toHaveLength(0);
  });

  it('follows a view of the parent and gives the reset to the parent', async () => {
    const setView = vi.fn();
    const view: ViewBox = { x: 10, y: 20, w: 320, h: 160 };
    render(<Harness view={view} setView={setView} />);
    await frame();
    const root = screen.getByTestId('dmap-popup-stage').querySelector('svg')!;
    expect(root.getAttribute('viewBox')).toBe('10 20 320 160');
    await act(async () => {
      fireEvent.click(screen.getByTestId('dmap-popup-reset-zoom'));
    });
    expect(setView).toHaveBeenLastCalledWith(null);
  });

  it('selects a cell on a click, with the shift state, and on Enter and Space', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const stage = screen.getByTestId('dmap-popup-stage');
    fireEvent.click(stage.querySelector('[data-cell-id="device-2"] rect')!);
    expect(onSelect).toHaveBeenLastCalledWith('device-2', { shift: false });
    fireEvent.click(stage.querySelector('[data-cell-id="device-1"] text')!, { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith('device-1', { shift: true });
    fireEvent.keyDown(stage.querySelector('[data-cell-id="device-1"]')!, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('device-1', { shift: false });
    fireEvent.keyDown(stage.querySelector('[data-cell-id="device-2"]')!, { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith('device-2', { shift: false });
    onSelect.mockClear();
    fireEvent.click(stage);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clears the editor layer on unmount', () => {
    const view = render(<Harness selection={{ ...NONE, selected: ['device-1'] }} />);
    const cell = screen.getByTestId('dmap-popup-stage').querySelector('g[data-cell-id="device-1"]')!;
    expect(cell.getAttribute('data-dmap-selected')).toBe('true');
    view.unmount();
    expect(cell.hasAttribute('data-dmap-selected')).toBe(false);
    expect(cell.hasAttribute('role')).toBe(false);
    expect(cell.hasAttribute('tabindex')).toBe(false);
  });

  it('keeps its own DOM tree: a second stage of the same svg does not change the first', async () => {
    const first = render(
      <Harness patches={patches(patch('device-1', 'rgb(9, 9, 9)'))} selection={{ ...NONE, selected: ['device-1'] }} />
    );
    await frame();
    const before = first.container.innerHTML;
    const second = render(<Harness patches={patches(patch('device-2', 'rgb(7, 7, 7)'))} />);
    await frame();
    expect(first.container.innerHTML).toBe(before);
    const root = (view: typeof first) => view.container.querySelector('svg')!;
    expect(root(first)).not.toBe(root(second));
    expect(root(second).querySelector('[data-cell-id="device-1"]')!.hasAttribute('data-dmap-selected')).toBe(true);
    expect(root(second).querySelector('[data-cell-id="device-1"]')!.getAttribute('data-dmap-selected')).toBe('false');
  });

  it('rebuilds for a new diagram hash and keeps the selection attributes on the new cells', async () => {
    const changed = svg.replace('Router α', 'Router β');
    const view = render(<Harness selection={{ ...NONE, selected: ['device-1'] }} />);
    const rootBefore = view.container.querySelector('svg');
    view.rerender(<Harness svg={changed} hash="h2" selection={{ ...NONE, selected: ['device-1'] }} />);
    await frame();
    const rootAfter = view.container.querySelector('svg');
    expect(rootAfter).not.toBe(rootBefore);
    expect(rootAfter!.textContent).toContain('Router β');
    expect(rootAfter!.querySelector('g[data-cell-id="device-1"]')!.getAttribute('data-dmap-selected')).toBe('true');
  });

  it('zooms with the wheel and resets with the button', async () => {
    render(<Harness />);
    await frame();
    const stage = screen.getByTestId('dmap-popup-stage');
    const root = stage.querySelector('svg')!;
    expect(screen.queryByTestId('dmap-popup-reset-zoom')).toBeNull();
    await act(async () => {
      fireEvent.wheel(stage.parentElement!, { deltaY: -100, clientX: 400, clientY: 300 });
    });
    await frame();
    expect(root.getAttribute('viewBox')).not.toBe('0 0 640 320');
    const reset = screen.getByTestId('dmap-popup-reset-zoom');
    await act(async () => {
      fireEvent.click(reset);
    });
    await frame();
    expect(root.getAttribute('viewBox')).toBe('0 0 640 320');
    expect(screen.queryByTestId('dmap-popup-reset-zoom')).toBeNull();
  });

  it('keeps the view for a new diagram with the same geometry, and fits a diagram with a new geometry', async () => {
    const view = render(<Harness />);
    await frame();
    await act(async () => {
      fireEvent.wheel(screen.getByTestId('dmap-popup-stage').parentElement!, {
        deltaY: -100,
        clientX: 400,
        clientY: 300,
      });
    });
    await frame();
    const zoomed = view.container.querySelector('svg')!.getAttribute('viewBox');
    expect(zoomed).not.toBe('0 0 640 320');
    // a write of a cell attribute: a new root, the same view box
    view.rerender(<Harness svg={svg.replace('Router α', 'Router β')} hash="h2" />);
    await frame();
    expect(view.container.querySelector('svg')!.textContent).toContain('Router β');
    expect(view.container.querySelector('svg')!.getAttribute('viewBox')).toBe(zoomed);
    // a new diagram with another size starts at the fitted view
    const larger = svg.replace('viewBox="0 0 640 320"', 'viewBox="0 0 1280 640"');
    view.rerender(<Harness svg={larger} hash="h3" />);
    await frame();
    expect(view.container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 1280 640');
  });
});

describe('DiagramStage box select', () => {
  // The stage is 800 x 600. device-1 is at x 100..200, device-2 at 300..400, link-1 at 850..950 (outside the stage).
  const rects: Record<string, [number, number, number, number]> = {
    'device-1': [100, 100, 200, 160],
    'device-2': [300, 100, 400, 160],
    'link-1': [850, 100, 950, 160],
  };
  const rectOf = (l: number, t: number, r: number, b: number) =>
    ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t }) as DOMRect;
  let capture: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const id = this.getAttribute('data-cell-id');
      if (!id) {
        return rectOf(0, 0, 800, 600);
      }
      // A cell without a rectangle in the table sits far away from every band.
      return rectOf(...(rects[id] ?? [3000, 3000, 3010, 3010]));
    });
    capture = vi.fn();
    Object.assign(HTMLElement.prototype, {
      setPointerCapture: capture,
      releasePointerCapture: vi.fn(),
      hasPointerCapture: () => true,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
    Reflect.deleteProperty(HTMLElement.prototype, 'releasePointerCapture');
    Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture');
  });

  const setup = (props: HarnessProps = {}) => {
    const onBox = vi.fn();
    const onSelect = vi.fn();
    render(<Harness onBox={onBox} onSelect={onSelect} {...props} />);
    const stage = screen.getByTestId('dmap-popup-stage');
    return { onBox, onSelect, stage, wrapper: stage.parentElement as HTMLElement };
  };
  const mouse = { pointerType: 'mouse', pointerId: 1, button: 0 };
  const start = (el: Element, x: number, y: number, shiftKey = true) =>
    fireEvent.pointerDown(el, { ...mouse, shiftKey, clientX: x, clientY: y });
  const move = (el: Element, x: number, y: number) => fireEvent.pointerMove(el, { ...mouse, clientX: x, clientY: y });
  const release = (el: Element, x: number, y: number) => fireEvent.pointerUp(el, { ...mouse, clientX: x, clientY: y });

  it('draws a band under Shift + drag, requests the pointer capture and selects the cells it touches', () => {
    const { onBox, wrapper } = setup();
    start(wrapper, 50, 50);
    expect(screen.queryByTestId('dmap-box-select')).toBeNull();
    move(wrapper, 250, 200);
    const band = screen.getByTestId('dmap-box-select');
    expect(band.style.left).toBe('50px');
    expect(band.style.width).toBe('200px');
    expect(capture).toHaveBeenCalledWith(1);
    release(wrapper, 250, 200);
    expect(screen.queryByTestId('dmap-box-select')).toBeNull();
    expect(onBox).toHaveBeenCalledWith(['device-1']);
  });

  it('selects every cell that the band touches, in the order of the diagram', () => {
    const { onBox, wrapper } = setup();
    start(wrapper, 150, 120);
    move(wrapper, 350, 140);
    release(wrapper, 350, 140);
    expect(onBox).toHaveBeenCalledWith(['device-1', 'device-2']);
  });

  it('clips a band that ends outside the stage to the stage', () => {
    const { onBox, wrapper } = setup();
    start(wrapper, 250, 120);
    // The release arrives at the stage by capture, 300 px right of its edge.
    move(wrapper, 1100, 140);
    expect(screen.getByTestId('dmap-box-select').style.width).toBe('550px');
    release(wrapper, 1100, 140);
    // link-1 sits at 850..950: outside the clipped band.
    expect(onBox).toHaveBeenCalledWith(['device-2']);
  });

  it('cancels the band on Esc: nothing is selected, the release and its click do nothing', () => {
    const { onBox, onSelect, stage, wrapper } = setup();
    start(wrapper, 50, 50);
    move(wrapper, 250, 200);
    expect(screen.getByTestId('dmap-box-select')).toBeTruthy();
    const keydown = fireEvent.keyDown(window, { key: 'Escape' });
    expect(keydown).toBe(false);
    expect(screen.queryByTestId('dmap-box-select')).toBeNull();
    release(wrapper, 250, 200);
    fireEvent.click(stage.querySelector('[data-cell-id="device-1"] rect')!);
    expect(onBox).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not let Esc reach other handlers while a band is active, and lets it pass afterwards', () => {
    const { wrapper } = setup();
    const other = vi.fn();
    document.addEventListener('keydown', other, true);
    start(wrapper, 50, 50);
    move(wrapper, 250, 200);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(other).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(other).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', other, true);
  });

  it('suppresses the click after a band once, then clicks work again', () => {
    const { onSelect, stage, wrapper } = setup();
    start(wrapper, 50, 50);
    move(wrapper, 250, 200);
    release(wrapper, 250, 200);
    const rect = stage.querySelector('[data-cell-id="device-2"] rect')!;
    fireEvent.click(rect);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(rect);
    expect(onSelect).toHaveBeenCalledWith('device-2', { shift: false });
  });

  it('keeps a Shift + click without a drag as a toggle click', () => {
    const { onBox, onSelect, stage, wrapper } = setup();
    const rect = stage.querySelector('[data-cell-id="device-2"] rect')!;
    start(rect, 350, 120);
    release(rect, 350, 120);
    fireEvent.click(rect, { shiftKey: true });
    expect(onBox).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith('device-2', { shift: true });
    expect(wrapper).toBeTruthy();
  });

  it('ends the band on pointercancel and selects nothing', () => {
    const { onBox, wrapper } = setup();
    start(wrapper, 50, 50);
    move(wrapper, 250, 200);
    fireEvent.pointerCancel(wrapper, { ...mouse });
    expect(screen.queryByTestId('dmap-box-select')).toBeNull();
    release(wrapper, 250, 200);
    expect(onBox).not.toHaveBeenCalled();
  });

  it('ignores touch pointers, a press without Shift and a press on the reset button', () => {
    const { onBox, wrapper } = setup();
    fireEvent.pointerDown(wrapper, { pointerType: 'touch', pointerId: 2, shiftKey: true, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(wrapper, { pointerType: 'touch', pointerId: 2, clientX: 250, clientY: 200 });
    expect(screen.queryByTestId('dmap-box-select')).toBeNull();
    start(wrapper, 50, 50, false);
    move(wrapper, 250, 200);
    release(wrapper, 250, 200);
    expect(screen.queryByTestId('dmap-box-select')).toBeNull();
    expect(onBox).not.toHaveBeenCalled();
  });

  it('does not pan the view while the band is active', async () => {
    const { wrapper, stage } = setup();
    await frame();
    const root = stage.querySelector('svg')!;
    const before = root.getAttribute('viewBox');
    start(wrapper, 50, 50);
    move(wrapper, 250, 200);
    release(wrapper, 250, 200);
    await frame();
    expect(root.getAttribute('viewBox')).toBe(before);
  });

  it('keeps suppressing the click after Esc until that pointer ends, however long it was down', () => {
    vi.useFakeTimers();
    try {
      const { onSelect, stage, wrapper } = setup();
      start(wrapper, 50, 50);
      move(wrapper, 250, 200);
      fireEvent.keyDown(window, { key: 'Escape' });
      // The pointer stays down for much longer than the click window.
      vi.advanceTimersByTime(5000);
      release(wrapper, 250, 200);
      fireEvent.click(stage.querySelector('[data-cell-id="device-1"] rect')!);
      expect(onSelect).not.toHaveBeenCalled();
      // The click that follows is a normal click again.
      fireEvent.click(stage.querySelector('[data-cell-id="device-1"] rect')!);
      expect(onSelect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a pending band when its pointer ends outside the stage before the capture, so the pan works again', async () => {
    const { wrapper, stage } = setup();
    await frame();
    const root = stage.querySelector('svg')!;
    const before = root.getAttribute('viewBox');
    // A Shift press that leaves before the slop: the stage never sees the release.
    start(wrapper, 5, 5);
    fireEvent.pointerUp(document.body, { ...mouse, clientX: 900, clientY: 900 });
    // A plain drag pans the view.
    fireEvent.pointerDown(wrapper, { ...mouse, pointerId: 2, shiftKey: false, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(wrapper, { ...mouse, pointerId: 2, clientX: 360, clientY: 300 });
    fireEvent.pointerUp(wrapper, { ...mouse, pointerId: 2, clientX: 360, clientY: 300 });
    await frame();
    expect(root.getAttribute('viewBox')).not.toBe(before);
  });

  it('clears a pending band on pointercancel outside the stage', () => {
    const { wrapper } = setup();
    start(wrapper, 5, 5);
    fireEvent.pointerCancel(document.body, { ...mouse });
    start(wrapper, 50, 50, false);
    move(wrapper, 250, 200);
    expect(screen.queryByTestId('dmap-box-select')).toBeNull();
  });

  it('marks the primary, the extra and the missed cells', () => {
    render(
      <Harness
        selection={{
          ...NONE,
          selected: ['device-1', 'link-1'],
          primary: 'link-1',
          extra: ['device-2'],
          missed: ['link-1'],
        }}
      />
    );
    const cell = (id: string) => screen.getByTestId('dmap-popup-stage').querySelector(`g[data-cell-id="${id}"]`)!;
    expect(cell('link-1').getAttribute('data-dmap-primary')).toBe('true');
    expect(cell('device-1').getAttribute('data-dmap-primary')).toBe('false');
    expect(cell('device-2').getAttribute('data-dmap-extra')).toBe('true');
    expect(cell('link-1').getAttribute('data-dmap-missed')).toBe('true');
    expect(cell('device-1').getAttribute('data-dmap-missed')).toBe('false');
  });
});
