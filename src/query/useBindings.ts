import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { PanelQueryService } from './panel';
import { EMPTY_FRAME, type Frame, type StoreDemand } from './store';

/**
 * The one reader of the store. It declares the demands of a group in an effect and reads the frame of the group
 * (or, with `scope: 'owner'`, of every group of the owner) through `useSyncExternalStore`.
 *
 * While `paused` the held frame is returned: an emission changes nothing that React sees, so the view renders zero
 * times; the first render after the pause gets the live frame with the latest results. No buffer, no pending map.
 *
 * `demands` must be a memo of the caller: a new array each render would call `want()` each render. `want()` is a
 * diff, so that would be correct but wasted.
 */
export function useBindings(
  service: PanelQueryService | undefined,
  owner: string,
  group: string,
  demands: StoreDemand[],
  paused: boolean,
  scope: 'group' | 'owner' = 'group'
): Frame {
  const store = service?.store;
  useEffect(() => {
    store?.want(owner, group, demands);
  }, [store, owner, group, demands]);
  useEffect(() => () => store?.want(owner, group, []), [store, owner, group]);
  const subscribe = useCallback((listener: () => void) => store?.subscribe(listener) ?? (() => {}), [store]);
  const held = useRef<Frame>(EMPTY_FRAME);
  // The ref write in `getSnapshot` is the design (spec 4.4, `useHeld`): it is idempotent and starts no render.
  /* eslint-disable react-hooks/refs */
  const getSnapshot = () => {
    if (!paused) {
      held.current = store ? store.frame(owner, scope === 'owner' ? undefined : group) : EMPTY_FRAME;
    }
    return held.current;
  };
  /* eslint-enable react-hooks/refs */
  return useSyncExternalStore(subscribe, getSnapshot);
}
