import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { TooltipBox } from './ChartHover';
import { SandboxPortal } from '../util/sandboxHost';

// The real sandbox portal: it attaches its host to the document in its own layout effect, after the layout
// effect of the box. jsdom gives no element a size: this stub gives the box one once it is in the document.
const size = { w: 200, h: 80 };
const view = { w: 1000, h: 800 };
const sized = (el: HTMLElement) => el.isConnected && el.getAttribute('data-testid') === 'dmap-chart-tooltip';
const descriptors = {
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
};

type Callback = () => void;
const observers: Array<{ callback: Callback; targets: Element[]; disconnected: boolean }> = [];
class Observer {
  entry = { callback: () => {}, targets: [] as Element[], disconnected: false };
  constructor(callback: Callback) {
    this.entry.callback = callback;
    observers.push(this.entry);
  }
  observe(el: Element) {
    this.entry.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.entry.disconnected = true;
  }
}

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const flushFrame = () =>
  act(() => {
    const due = [...frames.values()];
    frames = new Map();
    due.forEach((cb) => cb(0));
  });

beforeEach(() => {
  size.w = 200;
  size.h = 80;
  view.w = 1000;
  view.h = 800;
  observers.length = 0;
  frames = new Map();
  nextFrame = 1;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return sized(this) ? size.w : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return sized(this) ? size.h : 0;
    },
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => view.w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => view.h });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(nextFrame, cb);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', Observer);
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', descriptors.offsetWidth!);
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', descriptors.offsetHeight!);
});

const mount = (x: number, y: number) =>
  render(
    <SandboxPortal>
      <TooltipBox x={x} y={y} live={false} className="box">
        <span>value</span>
      </TooltipBox>
    </SandboxPortal>
  );
const box = () => screen.getByTestId('dmap-chart-tooltip');
// the browser reports the size of the box once it is in the document
const observe = () => act(() => observers.forEach((o) => !o.disconnected && o.callback()));

describe('TooltipBox in the sandbox portal', () => {
  it('is hidden and unflipped before the portal attaches it; the size report flips it to the edge and shows it', () => {
    mount(900, 50);
    const el = box();
    expect(el.isConnected).toBe(true);
    expect(el.closest('body > [data-plugin-sandbox]')).toBeTruthy();
    // the layout effect of the box ran before the portal attached the host: no size, no place, hidden
    expect(el.style.visibility).toBe('hidden');
    expect(el.style.transform).toBe('');
    expect(observers).toHaveLength(1);
    expect(observers[0].targets).toEqual([el]);
    observe();
    expect(el.style.transform).toBe('translate(690px, 60px)');
    expect(el.style.visibility).toBe('');
  });

  it('places again when the content changes size at the same anchor', () => {
    mount(900, 780);
    observe();
    expect(box().style.transform).toBe('translate(690px, 690px)');
    size.w = 300;
    size.h = 120;
    observe();
    expect(box().style.transform).toBe('translate(590px, 650px)');
  });

  it('measures at once on a later commit, when the box is already in the document', () => {
    const view = mount(100, 50);
    observe();
    expect(box().style.transform).toBe('translate(110px, 60px)');
    view.rerender(
      <SandboxPortal>
        <TooltipBox x={900} y={780} live={false} className="box">
          <span>other</span>
        </TooltipBox>
      </SandboxPortal>
    );
    expect(box().style.transform).toBe('translate(690px, 690px)');
  });

  it('retries with frames when there is no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    mount(900, 50);
    const el = box();
    expect(el.style.visibility).toBe('hidden');
    expect(frames.size).toBe(1);
    flushFrame();
    expect(el.style.transform).toBe('translate(690px, 60px)');
    expect(el.style.visibility).toBe('');
    expect(frames.size).toBe(0);
  });

  it('gives up the frame retries after a bound when the box never gets a size', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    size.w = 0;
    size.h = 0;
    mount(100, 50);
    for (let i = 0; i < 20 && frames.size; i++) {
      flushFrame();
    }
    expect(frames.size).toBe(0);
    expect(box().style.visibility).toBe('hidden');
  });

  it('places again on a window resize and on a visual viewport change', () => {
    const viewport = new EventTarget();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    mount(900, 50);
    observe();
    expect(box().style.transform).toBe('translate(690px, 60px)');
    view.w = 600;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(box().style.transform).toBe('translate(390px, 60px)');
    view.w = 1000;
    act(() => {
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(box().style.transform).toBe('translate(690px, 60px)');
    view.w = 500;
    act(() => {
      viewport.dispatchEvent(new Event('scroll'));
    });
    expect(box().style.transform).toBe('translate(290px, 60px)');
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
  });

  it('stops observing and listening on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = mount(100, 50);
    view.unmount();
    expect(observers[0].disconnected).toBe(true);
    expect(remove.mock.calls.some(([type]) => type === 'resize')).toBe(true);
    remove.mockRestore();
  });
});
