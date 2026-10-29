import { afterEach, vi } from 'vitest';
import { installPolyfills } from './vitest.polyfills';

installPolyfills();

// Node loads dompurify once for each worker and binds it to the jsdom of the first file that imports it. The next file
// gets a new jsdom, so DOMPurify.sanitize returns null there: the failure depends on the file order. Fail every time.
vi.mock('dompurify', () => {
  throw new Error('A logic test reaches DOMPurify. Add the file to componentTests in vitest.config.ts.');
});

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
