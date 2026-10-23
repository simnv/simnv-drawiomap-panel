import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { isTop } from './overlayStack';

export interface PopupKeysOptions {
  /** The id of the overlay in `overlayStack`. */
  id: string;
  /** The dialog body. Key events in it reach the React props that this hook returns. */
  dialogRef: RefObject<HTMLElement>;
  enabled: boolean;
  onEscape: () => void;
  /** Cmd/Ctrl+Z. Fires only where the browser has no undo of its own to run (see `ownsUndo`). */
  onUndo?: () => void;
  /** Shift+Cmd/Ctrl+Z and Ctrl+Y. */
  onRedo?: () => void;
}

export interface PopupKeysProps {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => void;
}

/** The dialog of another owner: a datasource dialog, the draw.io modal, a confirmation. It handles its own Esc. */
function inForeignDialog(target: EventTarget | null, own: Element | null | undefined): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  // In the frontend sandbox, an element of the Grafana app (a nested Grafana modal, a datasource dialog) reaches plugin code
  // as a mock without attributes. The mock carries this marker. Such an element belongs to another owner.
  if (target instanceof HTMLElement && target.dataset.grafanaPluginSandboxElement !== undefined) {
    return true;
  }
  const dialog = target.closest('[role="dialog"], iframe');
  return !!dialog && dialog !== own;
}

const isEscape = (event: { key: string; isComposing?: boolean }) => event.key === 'Escape' && !event.isComposing;

/** Input types without text: the browser has no text undo for them, so the draft undo can take the key. */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color', 'image']);

/**
 * The target keeps the native undo: a text input, a textarea, a `contenteditable` element or the Monaco editor
 * (spec 4.3, Q2). The header buttons always undo the draft.
 */
export function hasNativeUndo(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUTS.has(target.type);
  }
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable) ||
    !!target.closest('[contenteditable]:not([contenteditable="false"]), .monaco-editor')
  );
}

/** The element takes part in the page: laid out, not `visibility: hidden`, and not hidden or inert through an ancestor. */
function isShown(el: Element): boolean {
  return (
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden' &&
    !el.closest('[aria-hidden="true"], [inert]')
  );
}

/**
 * Another dialog is open on the page: a datasource dialog, a confirmation. The popup is not the dialog that the user
 * works in, even when the focus has not moved into the other dialog yet.
 */
function foreignDialogOpen(own: Element | null | undefined): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"]')).some(
    (dialog) => dialog !== own && !dialog.contains(own ?? null) && !own?.contains(dialog) && isShown(dialog)
  );
}

type HistoryKey = 'undo' | 'redo';
/** Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z and Ctrl+Y redo. */
function historyKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }) {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) {
    return undefined;
  }
  const key = event.key.toLowerCase();
  if (key === 'z') {
    return (event.shiftKey ? 'redo' : 'undo') satisfies HistoryKey;
  }
  return key === 'y' && event.ctrlKey && !event.shiftKey ? ('redo' satisfies HistoryKey) : undefined;
}

/**
 * Esc ownership of a modal that sets `closeOnEscape={false}` (spec 4.3). Two layers:
 *
 * The same two layers handle the history keys (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y), except in a target that owns undo.
 *
 * 1. The returned React props go on the dialog body. They run after react-select, Monaco and nested React handlers.
 *    React's `stopPropagation` stops the native event at the root container, before the Grafana `esc` key binding.
 * 2. A `document` listener in the capture phase takes the Esc of a target outside the body, for example focus on
 *    `document.body` or on the close button of the header. The capture phase runs before the Grafana `esc` key
 *    binding, which would leave the panel editor. It acts only when this overlay is the top one.
 *
 * Both layers ignore an Esc that something else already handled (`defaultPrevented`) and an Esc inside a dialog
 * that this owner does not own.
 */
export function usePopupKeys({ id, dialogRef, enabled, onEscape, onUndo, onRedo }: PopupKeysOptions): PopupKeysProps {
  const latest = useRef({ enabled, onEscape, onUndo, onRedo });
  useLayoutEffect(() => {
    latest.current = { enabled, onEscape, onUndo, onRedo };
  });
  const ownDialog = useCallback(() => dialogRef.current?.closest('[role="dialog"]'), [dialogRef]);
  /** Run the undo or redo of a key event, if it is one and the target does not own undo. True when it ran. */
  const runHistory = useCallback(
    (event: {
      key: string;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
      altKey: boolean;
      target: unknown;
    }) => {
      const kind = historyKey(event);
      const run = kind === 'undo' ? latest.current.onUndo : kind === 'redo' ? latest.current.onRedo : undefined;
      if (!run || hasNativeUndo(event.target as EventTarget | null) || foreignDialogOpen(ownDialog())) {
        return false;
      }
      run();
      return true;
    },
    [ownDialog]
  );
  // react-select calls preventDefault for every Esc, also with a closed menu. Read the state before it handles the key.
  const wasOpen = useRef(new WeakMap<Event, boolean>());

  const onKeyDownCapture = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (isEscape(event) && event.target instanceof Element) {
      wasOpen.current.set(event.nativeEvent, event.target.getAttribute('aria-expanded') === 'true');
    }
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!latest.current.enabled || inForeignDialog(event.target, ownDialog())) {
        return;
      }
      if (!isEscape(event)) {
        if (!event.defaultPrevented && isTop(id) && runHistory(event)) {
          event.preventDefault();
          event.stopPropagation();
        }
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
    [ownDialog, id, runHistory]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const listener = (event: globalThis.KeyboardEvent) => {
      if (!latest.current.enabled || event.defaultPrevented || !isTop(id)) {
        return;
      }
      if (event.target instanceof Node && dialogRef.current?.contains(event.target)) {
        return;
      }
      if (inForeignDialog(event.target, ownDialog())) {
        return;
      }
      if (isEscape(event)) {
        event.stopPropagation();
        latest.current.onEscape();
      } else if (runHistory(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }, [enabled, id, dialogRef, ownDialog, runHistory]);

  return { onKeyDown, onKeyDownCapture };
}
