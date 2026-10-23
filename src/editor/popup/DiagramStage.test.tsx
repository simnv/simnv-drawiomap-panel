import React, { useRef } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramStage, type StageSelection } from './DiagramStage';
import { useStage } from '../../components/useStage';
import type { CellPatch, PatchMap } from '../../types';

const svg = readFileSync(resolve(__dirname, '../../fixtures/authoring.svg'), 'utf8');
const NONE: StageSelection = { selected: [], affected: [], highlight: [] };
const patch = (cellId: string, color: string): CellPatch => ({
  cellId,
  ruleNames: [],
  scope: { cell: {} },
  shape: { status: 'ok', color, target: 'shape', stepIndex: 0 },
  urls: [],
  warnings: [],
});
const patches = (...list: CellPatch[]): PatchMap => new Map(list.map((p) => [p.cellId, p]));

interface HarnessProps {
  svg?: string;
  hash?: string;
  patches?: PatchMap;
  selection?: StageSelection;
  onSelect?: (id: string, options: { shift: boolean }) => void;
  onStage?: (stage: ReturnType<typeof useStage>) => void;
}
function Harness({
  svg: text = svg,
  hash = 'h1',
  patches: map = new Map(),
  selection = NONE,
  onSelect,
  onStage,
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
      owner="popup:1"
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
});
