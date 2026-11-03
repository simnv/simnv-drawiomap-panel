import { useState } from 'react';

/**
 * The value of the last render in which `hold` was false. While `hold` is true the hook returns that value, so
 * readers that must stay consistent with another input (the stage of a diagram) do not see a newer one. A change
 * while `hold` is false is a state adjustment during the render (React: information from previous renders).
 */
export function useHeld<T>(value: T, hold: boolean): T {
  const [held, setHeld] = useState(value);
  if (!hold && held !== value) {
    setHeld(value);
    return value;
  }
  return held;
}
