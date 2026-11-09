// Polyfills for jsdom. Call installPolyfills() from the body of each setup file: a setup file runs for every test file,
// but a module that it imports runs once for each worker, and the logic project reuses its workers.
export function installPolyfills(): void {
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

  // jsdom has no IntersectionObserver. @grafana/ui reads it. A stub that never reports is enough for the tests.
  if (typeof window.IntersectionObserver === 'undefined') {
    class IntersectionObserverStub {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    window.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;
  }
}
