import { useEffect, useState } from 'react';

/** The panel wrapper while the focus must not show (Shift in the mode `on`, no Shift in `shift`): the CSS hides it. */
export const FOCUS_HIDDEN_ATTR = 'data-dmap-focus-hidden';

/** A text field or an editable element: a key there types. */
const NOT_TYPED = ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'];
const editable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    t.localName === 'textarea' ||
    t.localName === 'select' ||
    (t instanceof HTMLInputElement && !NOT_TYPED.includes(t.type)));

/**
 * True while the Shift key is down, out of a text field. A key up, a blur of the window or a hidden page ends it, so a Shift that the page
 * did not see go up (the focus moved to another window) does not stay on.
 */
export function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      // a capital letter typed in a field (the options, a variable, a search) is no request to hide the hover
      // the first node of the path: a field inside an open shadow root
      if (e.key === 'Shift' && !editable(e.composedPath?.()[0] ?? e.target)) {
        setHeld(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      // the other Shift key can still be down
      if (e.key === 'Shift') {
        // only a key down turns the hide on
        setHeld((held) => held && e.shiftKey);
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
