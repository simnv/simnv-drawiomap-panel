import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearQuerySessions } from './src/query/session';
import { installPolyfills } from './vitest.polyfills';

installPolyfills();

afterEach(() => {
  cleanup();
  // The query sessions are module state keyed by dashboard path and panel id: one test must not warm the next.
  clearQuerySessions();
});
