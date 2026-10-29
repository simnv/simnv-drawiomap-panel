import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { IconButton, useStyles2 } from '@grafana/ui';
import { useSandboxHost } from '../../util/sandboxHost';
import { isTop, pop, push } from './overlayStack';
import { usePopupKeys } from './usePopupKeys';

/**
 * A plugin-owned dialog with the look of a Grafana `Modal`.
 *
 * Why not `Modal`: it renders into `#grafana-portal-container`. In the frontend sandbox, plugin code gets only a detached
 * mock for that element, so the imperative DOM work of the diagram stage does not reach the page. The dialog renders
 * into a sandbox host (`useSandboxHost`) in `document.body`.
 *
 * The dialog keeps its z-index one step under the Grafana modal layers, so that a Grafana `ConfirmModal`, the draw.io
 * modal and the `Select` menus (all Grafana portals) paint above it.
 */

const noop = () => {};

/** Below this viewport width, or height, the dialog is a full-screen sheet. */
export const SHEET_BELOW = 640;
export const SHEET_BELOW_HEIGHT = 480;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export interface PluginDialogProps {
  title: string;
  /** The close button of the header calls it. Esc and the backdrop are the business of the owner. */
  onDismiss: () => void;
  /**
   * Take the Esc of the dialog: the dialog joins the overlay stack and closes with this callback. The bindings popup
   * does not use it, because it has its own owner with a close confirmation.
   */
  onEscape?: () => void;
  /** The overlay id of this dialog in `overlayStack`, when the owner registers it. The focus guard acts only on the top overlay. */
  overlayId?: string;
  children: ReactNode;
}

/** The focusable elements of a container, in DOM order, without the hidden ones. */
export function focusableIn(container: Element): HTMLElement[] {
  const hidden = (el: HTMLElement) => {
    for (let node: Element | null = el; node && node !== container.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return true;
      }
    }
    return false;
  };
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert], [aria-hidden="true"]') && !hidden(el)
  );
}

/**
 * Mark everything outside the dialog `inert`, except the ancestors of the Grafana portal container: a nested Grafana
 * modal (confirmation, draw.io, datasource dialogs) lives there. Returns the function that restores the attributes.
 */
export function inertOutside(keep: Array<Element | null>): () => void {
  const marked: Element[] = [];
  const onPath = new Set<Element>();
  for (const el of keep) {
    for (let node: Element | null = el; node; node = node.parentElement) {
      onPath.add(node);
    }
  }
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (!onPath.has(child)) {
        if (!child.hasAttribute('inert') && child.tagName !== 'SCRIPT' && child.tagName !== 'STYLE') {
          child.setAttribute('inert', '');
          marked.push(child);
        }
      } else if (!keep.includes(child)) {
        walk(child);
      }
    }
  };
  walk(document.body);
  return () => marked.forEach((el) => el.removeAttribute('inert'));
}

export function PluginDialog({ title, onDismiss, onEscape, overlayId, children }: PluginDialogProps) {
  const styles = useStyles2(getStyles);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const escId = `plugin-dialog-${titleId}`;
  const hasEscape = !!onEscape;
  useEffect(() => {
    if (!hasEscape) {
      return;
    }
    push(escId);
    return () => pop(escId);
  }, [hasEscape, escId]);
  const guardId = overlayId ?? escId;
  const esc = usePopupKeys({ id: escId, dialogRef, enabled: hasEscape, onEscape: onEscape ?? noop });
  // The layout effect of the hook puts the host in the body before the layout effect below.
  const host = useSandboxHost();

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // In the frontend sandbox the portal container is a mock element, and its place in the page is unknown. Then the whole
    // app root stays usable, because a nested Grafana modal lives inside it; aria-modal, the backdrop and the focus trap
    // keep the user in the dialog.
    const portal = document.getElementById('grafana-portal-container');
    const portalKnown = !!portal && portal.dataset.grafanaPluginSandboxElement === undefined;
    const restoreInert = inertOutside([host, portalKnown ? portal : document.getElementById('reactRoot')]);
    if (!dialogRef.current?.contains(document.activeElement)) {
      dialogRef.current?.focus();
    }
    return () => {
      restoreInert();
      document.body.style.overflow = overflow;
      // The opener (the corner button) keeps the keyboard place of the user.
      if (opener?.isConnected) {
        opener.focus();
      }
    };
  }, [host]);

  // Focus guard. A removed focused element (a replaced subtree, a deleted row) drops the focus on the body, and no key
  // event starts inside the dialog then. While the dialog is the top overlay, a focus outside the dialog and outside the
  // background goes back to the last focused element of the dialog, or to its first tabbable element.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    let last: HTMLElement | null = null;
    // Only the page behind the dialog is background: the elements inside #reactRoot outside the Grafana portal container.
    // A real element outside #reactRoot is a body-level portal of another library (a datasource listbox): the focus may
    // stay there. A sandbox mock is ambiguous: in the sandbox, every element of #reactRoot reaches the plugin as a mock,
    // the focused element of a nested Grafana modal (metrics explorer) too, so a mock is allowed.
    const allowed = (el: Element) => {
      if (dialog.contains(el)) {
        return true;
      }
      if (el instanceof HTMLElement && el.dataset.grafanaPluginSandboxElement !== undefined) {
        return true;
      }
      if (el.closest('#grafana-portal-container, [role="dialog"]')) {
        return true;
      }
      return !el.closest('#reactRoot');
    };
    const check = () => {
      if (!isTop(guardId)) {
        return;
      }
      const active = document.activeElement;
      if (active && active !== document.body && allowed(active)) {
        return;
      }
      const target = last?.isConnected && dialog.contains(last) ? last : (focusableIn(dialog)[0] ?? dialog);
      target.focus();
    };
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && dialog.contains(event.target)) {
        last = event.target;
      } else {
        later();
      }
    };
    const observer = new MutationObserver(later);
    observer.observe(dialog, { childList: true, subtree: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', later);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', later);
    };
  }, [guardId]);

  // Tab and Shift+Tab wrap inside the dialog. A nested Grafana modal is a React child, so its key events arrive here too:
  // only the keys of the elements inside the dialog count.
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const dialog = dialogRef.current;
    if (event.key !== 'Tab' || !dialog || !(event.target instanceof Node) || !dialog.contains(event.target)) {
      return;
    }
    const items = focusableIn(dialog);
    if (!items.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return createPortal(
    <>
      <div className={styles.backdrop} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.dialog}
        onKeyDown={(event) => {
          onKeyDown(event);
          esc.onKeyDown(event);
        }}
        onKeyDownCapture={esc.onKeyDownCapture}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <IconButton name="times" size="xl" tooltip="Close" aria-label="Close" onClick={onDismiss} />
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </>,
    host
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  backdrop: css({
    position: 'fixed',
    inset: 0,
    zIndex: theme.zIndex.modalBackdrop - 1,
    backgroundColor: theme.components.overlay.background,
  }),
  // A tall viewport value has a fallback: `dvh` follows the visible height on iPhone Safari (the toolbars come and go), `vh`
  // is the height with the toolbars hidden. On a phone (narrow, or a short landscape screen) the dialog is a full-screen
  // sheet. The safe-area insets keep the header and the buttons out of the notch and the home indicator. They are zero
  // unless the page asks for `viewport-fit=cover`.
  dialog: css`
    position: fixed;
    z-index: ${theme.zIndex.modal - 1};
    top: 5vh;
    top: 5dvh;
    left: 2.5vw;
    width: 95vw;
    height: 90vh;
    height: 90dvh;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
    background: ${theme.colors.background.primary};
    box-shadow: ${theme.shadows.z3};
    border-radius: ${theme.shape.radius.lg};
    border: 1px solid ${theme.colors.border.weak};
    background-clip: padding-box;
    outline: none;
    @media (max-width: ${SHEET_BELOW}px), (max-height: ${SHEET_BELOW_HEIGHT}px) {
      inset: 0;
      width: 100%;
      height: 100vh;
      height: 100dvh;
      max-height: 100%;
      border: 0;
      border-radius: 0;
      padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px)
        env(safe-area-inset-left, 0px);
    }
  `,
  header: css({
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 42,
    padding: theme.spacing(0.5, 2, 0),
    color: theme.colors.text.primary,
  }),
  title: css({ margin: 0, fontSize: theme.typography.h4.fontSize, fontWeight: theme.typography.fontWeightMedium }),
  content: css({
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: 'flex',
    padding: theme.spacing(0, 2, 2),
    [`@media (max-width: ${SHEET_BELOW}px), (max-height: ${SHEET_BELOW_HEIGHT}px)`]: {
      padding: theme.spacing(0, 1, 1),
    },
  }),
});
