import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearQuerySessions } from './src/query/session';

afterEach(() => {
  cleanup();
  // The query sessions are module state keyed by dashboard path and panel id: one test must not warm the next.
  clearQuerySessions();
});

// jsdom has no PointerEvent. React reads pointerType from the native event.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string;
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? 'mouse';
      this.pointerId = init.pointerId ?? 1;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// The test environment may have no localStorage. @grafana/ui reads it (logger) when it loads.
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

// @grafana/ui and @grafana/runtime read matchMedia when they load. jsdom has none.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })) as unknown as typeof window.matchMedia;
}
