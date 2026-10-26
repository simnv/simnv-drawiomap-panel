import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

const mediaQuery = (): MediaQueryList | undefined =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : undefined;

function subscribe(onChange: () => void): () => void {
  const query = mediaQuery();
  if (!query) {
    return () => {};
  }
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const read = (): boolean => mediaQuery()?.matches ?? false;

/**
 * True while the OS prefers a dark colour scheme. The patch applier takes it as an input of its colour scheme: an
 * element that sets its own `color-scheme` resolves a `light-dark()` paint against the OS preference, not against
 * the theme on the root, so a change must evaluate every cell again. A host without `matchMedia` (jsdom) gives
 * false and subscribes to nothing.
 */
export function useOsDark(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}
