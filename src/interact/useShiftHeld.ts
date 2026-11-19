import { useEffect, useState } from 'react';

/** The panel wrapper while Shift hides the hover: the panel CSS hides the focus. */
export const SHIFT_ATTR = 'data-dmap-shift';

/** A text field or an editable element: a key there types. */
const editable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.isContentEditable || t.localName === 'input' || t.localName === 'textarea' || t.localName === 'select');

/**
 * True while the Shift key is down, out of a text field. A key up, a blur of the window or a hidden page ends it, so a Shift that the page
 * did not see go up (the focus moved to another window) does not stay on.
 */
export function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      // a capital letter typed in a field (the options, a variable, a search) is no request to hide the hover
      if (e.key === 'Shift' && !editable(e.target)) {
        setHeld(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      // the other Shift key can still be down
      if (e.key === 'Shift') {
        setHeld(e.shiftKey);
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
