import { useEffect, useState } from 'react';

/** The panel wrapper while Shift hides the hover: the panel CSS hides the focus. */
export const SHIFT_ATTR = 'data-dmap-shift';

/**
 * True while the Shift key is down. A key up, a blur of the window or a hidden page ends it, so a Shift that the page
 * did not see go up (the focus moved to another window) does not stay on.
 */
export function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setHeld(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setHeld(false);
      }
    };
    const off = () => setHeld(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', off);
    document.addEventListener('visibilitychange', off);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', off);
      document.removeEventListener('visibilitychange', off);
    };
  }, []);
  return held;
}
