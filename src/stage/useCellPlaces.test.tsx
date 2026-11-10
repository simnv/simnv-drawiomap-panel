import React, { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearFakeLayout, clientRect, fakeLayout } from '../render/layoutTestKit';
import type { CellEntry, CellIndex } from '../types';
import { CellFocusRing } from './CellFocusRing';
import { useCellPlaces, type CellPlace } from './useCellPlaces';
import type { Stage } from './useStage';
import { LAYOUT_EVENT } from './useStageLayout';
import { PAINTED_EVENT } from './useStagePaint';

const SVG = 'http://www.w3.org/2000/svg';

/** A stage of three cells: a node (a button), a linked legend row (a tab stop, no role) and a cell with no tab stop. */
function stageOf(host: HTMLElement): Stage {
  host.innerHTML =
    `<svg xmlns="${SVG}">` +
    '<g data-cell-id="a" tabindex="0" role="button"><rect/></g>' +
    '<g data-cell-id="pg-legendRow~symbol:router" tabindex="0" aria-label="Highlight router"><rect/></g>' +
    '<g data-cell-id="c"><rect/></g>' +
    '</svg>';
  const root = host.querySelector('svg')!;
  const index: CellIndex = new Map(
    Array.from(root.querySelectorAll('g[data-cell-id]'), (group) => [
      group.getAttribute('data-cell-id')!,
      { group } as unknown as CellEntry,
    ])
  );
  return { root, index, warnings: [], pending: false };
}

const boxes: Record<string, [number, number, number, number]> = {
  a: [100, 50, 220, 110],
  'pg-legendRow~symbol:router': [10, 500, 90, 520],
  c: [300, 50, 400, 110],
};
let scale = 1;
const layout = () =>
  fakeLayout(
    (el) => {
      const b =
        el.localName === 'rect' ? boxes[el.closest('[data-cell-id]')?.getAttribute('data-cell-id') ?? ''] : undefined;
      return b ? clientRect(...b) : undefined;
    },
    clientRect(0, 0, 800, 600),
    () => ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 })
  );

afterEach(() => {
  clearFakeLayout();
  scale = 1;
  document.body.innerHTML = '';
});

function Places({ stage, ids, onPlaces }: { stage: Stage; ids: string[]; onPlaces: (p: CellPlace[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  onPlaces(useCellPlaces(stage, ids, ref));
  return <div ref={ref} />;
}

function setup(ids: string[]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stage = stageOf(host);
  let places: CellPlace[] = [];
  render(<Places stage={stage} ids={ids} onPlaces={(p) => (places = p)} />);
  return { stage, places: () => places };
}

const fire = async (target: EventTarget, type: string) => {
  await act(async () => {
    target.dispatchEvent(new Event(type));
  });
};

describe('useCellPlaces', () => {
  it('maps the boxes again on each write of the view box (LAYOUT_EVENT), with no new input', async () => {
    layout();
    const { stage, places } = setup(['a']);
    expect(places()).toEqual([{ id: 'a', left: 100, top: 50, width: 120, height: 60 }]);
    // a wheel step: the view box changes, the component that owns the hook does not render
    scale = 2;
    await fire(stage.root!, LAYOUT_EVENT);
    expect(places()).toEqual([{ id: 'a', left: 200, top: 100, width: 240, height: 120 }]);
  });

  it('measures again after a paint (PAINTED_EVENT)', async () => {
    layout();
    const { stage, places } = setup(['a']);
    boxes.a = [99, 49, 221, 111];
    try {
      // a layout alone maps the old root boxes
      await fire(stage.root!, LAYOUT_EVENT);
      expect(places()[0].width).toBe(120);
      await fire(stage.root!, PAINTED_EVENT);
      expect(places()[0]).toEqual({ id: 'a', left: 99, top: 49, width: 122, height: 62 });
    } finally {
      boxes.a = [100, 50, 220, 110];
    }
  });

  it('measures nothing while the stage has no usable screen matrix (0 x 0), then at its first layout', async () => {
    scale = 0;
    layout();
    const { stage, places } = setup(['a']);
    expect(places()).toEqual([]);
    scale = 1;
    await fire(stage.root!, LAYOUT_EVENT);
    expect(places()).toEqual([{ id: 'a', left: 100, top: 50, width: 120, height: 60 }]);
  });
});

describe('CellFocusRing', () => {
  function ringSetup() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const stage = stageOf(host);
    function Harness() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div ref={ref}>
          <CellFocusRing stage={stage} wrapperRef={ref} container={host} />
        </div>
      );
    }
    render(<Harness />);
    const group = (id: string) => stage.index.get(id)!.group as unknown as SVGGElement;
    const ring = () => document.querySelector('[data-testid="dmap-cell-focus"]') as HTMLElement | null;
    return { group, ring };
  }
  const key = async (el: Element, name: string) => {
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    });
  };

  it('a linked legend row (a tab stop with no role) gets the ring as a cell does', async () => {
    layout();
    const { group, ring } = ringSetup();
    await act(async () => {
      group('pg-legendRow~symbol:router').focus();
    });
    await key(group('pg-legendRow~symbol:router'), 'ArrowDown');
    expect(ring()!.getAttribute('data-dmap-focus')).toBe('pg-legendRow~symbol:router');
    expect([ring()!.style.left, ring()!.style.top, ring()!.style.width]).toEqual(['10px', '500px', '80px']);
  });

  it('a modifier alone after the focus of a click is no keyboard use; another key is', async () => {
    layout();
    const { group, ring } = ringSetup();
    const a = group('a');
    const matches = Element.prototype.matches;
    // the focus of a click: no :focus-visible
    const click = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? false : matches.call(this, selector);
    });
    await act(async () => {
      a.focus();
    });
    click.mockRestore();
    expect(ring()).toBeNull();
    await key(a, 'Shift');
    expect(ring()).toBeNull();
    await key(a, 'Enter');
    expect(ring()!.getAttribute('data-dmap-focus')).toBe('a');
  });
});
