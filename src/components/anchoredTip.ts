import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

/**
 * The look of the Grafana tooltip. Fixed in a sandbox host in the body: the Grafana Tooltip renders into
 * #grafana-portal-container, which the frontend sandbox gives the plugin only as a detached mock.
 */
export const getTipStyles = (theme: GrafanaTheme2) => ({
  tip: css`
    position: fixed;
    left: 0;
    top: 0;
    pointer-events: none;
    max-width: 360px;
    padding: ${theme.spacing(0.5, 1)};
    background: ${theme.components.tooltip.background};
    color: ${theme.components.tooltip.text};
    font-size: ${theme.typography.bodySmall.fontSize};
    box-shadow: ${theme.shadows.z2};
    border-radius: ${theme.shape.radius.default};
    z-index: ${theme.zIndex.tooltip};
  `,
});

/** The anchor of an open tooltip in the viewport. */
export interface TipAnchor {
  x: number;
  y: number;
  height: number;
}

/**
 * The open state of a tooltip on a small anchor. The tooltip opens with no delay: a mouse pointer or the keyboard
 * focus shows it, a tap toggles it (a phone has no hover), Esc closes it, a scroll closes it. Spread `props` on the
 * anchor. Render the tooltip when `tip` is not null, with `id` as its id. Call `hide` when the anchor goes away: React
 * sends no leave or blur for an element that it removes.
 */
export function useAnchoredTip(anchor: { current: HTMLElement | null }) {
  const id = useId();
  const [tip, setTip] = useState<TipAnchor | null>(null);
  // A tap gives the anchor the focus: that focus must not undo the toggle of the tap.
  const touch = useRef(false);
  const show = () => {
    const r = anchor.current?.getBoundingClientRect();
    setTip(r ? { x: r.right, y: r.top, height: r.height } : { x: 0, y: 0, height: 0 });
  };
  const hide = useCallback(() => setTip(null), []);
  // The tooltip has a fixed place: a scroll of the page or of a parent would leave it behind, so it closes.
  const open = tip !== null;
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => setTip(null);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [open]);
  const props = {
    tabIndex: 0,
    'aria-describedby': tip ? id : undefined,
    onPointerDown: (e: PointerEvent) => {
      touch.current = e.pointerType === 'touch';
    },
    onPointerEnter: (e: PointerEvent) => e.pointerType !== 'touch' && show(),
    onPointerLeave: (e: PointerEvent) => e.pointerType !== 'touch' && hide(),
    onFocus: (_e: FocusEvent) => touch.current || show(),
    onBlur: () => {
      // the next focus can come from the keyboard
      touch.current = false;
      hide();
    },
    onKeyDown: (e: KeyboardEvent) => {
      touch.current = false;
      if (e.key === 'Escape' && tip) {
        e.stopPropagation();
        hide();
      }
    },
    onClick: () => {
      if (touch.current) {
        if (tip) {
          hide();
        } else {
          show();
        }
      }
    },
  };
  return { id, tip, props, hide };
}
