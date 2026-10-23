import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { isTop } from './overlayStack';

export interface EscOwnerOptions {
  /** The id of the overlay in `overlayStack`. */
  id: string;
  /** The dialog body. Key events in it reach the React props that this hook returns. */
  dialogRef: RefObject<HTMLElement>;
  enabled: boolean;
  onEscape: () => void;
}

export interface EscOwnerProps {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => void;
}

/** The dialog of another owner: a datasource dialog, the draw.io modal, a confirmation. It handles its own Esc. */
function inForeignDialog(target: EventTarget | null, own: Element | null | undefined): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const dialog = target.closest('[role="dialog"], iframe');
  return !!dialog && dialog !== own;
}

const isEscape = (event: { key: string; isComposing?: boolean }) => event.key === 'Escape' && !event.isComposing;

/**
 * Esc ownership of a modal that sets `closeOnEscape={false}` (spec 4.3). Two layers:
 *
 * 1. The returned React props go on the dialog body. They run after react-select, Monaco and nested React handlers.
 *    React's `stopPropagation` stops the native event at the root container, before the Grafana `esc` key binding.
 * 2. A `document` listener in the bubble phase takes the Esc of a target outside the body, for example focus on
 *    `document.body` or on the header. It acts only when this overlay is the top one.
 *
 * Both layers ignore an Esc that something else already handled (`defaultPrevented`) and an Esc inside a dialog
 * that this owner does not own.
 */
export function useEscOwner({ id, dialogRef, enabled, onEscape }: EscOwnerOptions): EscOwnerProps {
  const latest = useRef({ enabled, onEscape });
  useLayoutEffect(() => {
    latest.current = { enabled, onEscape };
  });
  // react-select calls preventDefault for every Esc, also with a closed menu. Read the state before it handles the key.
  const wasOpen = useRef(new WeakMap<Event, boolean>());

  const ownDialog = useCallback(() => dialogRef.current?.closest('[role="dialog"]'), [dialogRef]);

  const onKeyDownCapture = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (isEscape(event) && event.target instanceof Element) {
      wasOpen.current.set(event.nativeEvent, event.target.getAttribute('aria-expanded') === 'true');
    }
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!latest.current.enabled || !isEscape(event) || inForeignDialog(event.target, ownDialog())) {
        return;
      }
      if (event.defaultPrevented) {
        // A closed combobox prevents the default of Esc but has nothing to close: the dialog takes the key.
        const target = event.target instanceof Element ? event.target : undefined;
        const idleCombobox =
          target?.getAttribute('role') === 'combobox' && wasOpen.current.get(event.nativeEvent) === false;
        if (!idleCombobox) {
          return;
        }
      }
      event.stopPropagation();
      latest.current.onEscape();
    },
    [ownDialog]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const listener = (event: globalThis.KeyboardEvent) => {
      if (!latest.current.enabled || !isEscape(event) || event.defaultPrevented || !isTop(id)) {
        return;
      }
      if (event.target instanceof Node && dialogRef.current?.contains(event.target)) {
        return;
      }
      if (inForeignDialog(event.target, ownDialog())) {
        return;
      }
      latest.current.onEscape();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [enabled, id, dialogRef, ownDialog]);

  return { onKeyDown, onKeyDownCapture };
}
