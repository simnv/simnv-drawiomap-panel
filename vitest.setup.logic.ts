import { afterEach, vi } from 'vitest';
import { installPolyfills } from './vitest.polyfills';

installPolyfills();

// The logic project reuses its workers (isolate: false): the files of one worker share their module registry.
// Each file still gets its own jsdom document. Reset what a test can leave behind.
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  for (const name of document.body.getAttributeNames()) {
    document.body.removeAttribute(name);
  }
  for (const name of document.documentElement.getAttributeNames()) {
    document.documentElement.removeAttribute(name);
  }
  window.localStorage.clear();
  window.sessionStorage.clear();
});
