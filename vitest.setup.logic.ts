import { afterEach, vi } from 'vitest';
import './vitest.setup';

// The logic project runs with isolate: false, so the files of one worker share one jsdom document.
// Reset what a test can leave behind, so the next file starts clean.
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
