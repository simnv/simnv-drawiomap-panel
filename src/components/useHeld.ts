import { useRef } from 'react';

/**
 * The value while `hold` is false; the last live value while `hold` is true.
 *
 * It is ref-based on purpose: there is no state write during render, so a caller that passes a new object on every
 * render cannot start a render loop. Hold each input apart. Never build a new object just to hold it.
 */
export function useHeld<T>(value: T, hold: boolean): T {
  const ref = useRef(value);
  // The ref write in render is the design (spec 4.4): it is idempotent and starts no render.
  /* eslint-disable react-hooks/refs */
  if (!hold) {
    ref.current = value;
  }
  return ref.current;
  /* eslint-enable react-hooks/refs */
}
