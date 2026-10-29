import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { installPolyfills } from './vitest.polyfills';

installPolyfills();

afterEach(() => {
  cleanup();
});
