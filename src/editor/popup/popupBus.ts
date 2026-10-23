import { locationService } from '@grafana/runtime';

/** What the popup selects when it opens. */
export type PopupTarget =
  | { kind: 'none' }
  | { kind: 'cell'; cellId: string }
  | { kind: 'problem'; path: string }
  | { kind: 'query'; queryId: string };

/** The panel editor of one dashboard panel. Both sides read it from the Grafana location. */
export interface PopupAddress {
  pathname: string;
  editPanel: string;
}

type Listener = (target: PopupTarget) => void;

const listeners = new Map<string, Set<Listener>>();
const keyOf = (address: PopupAddress) => JSON.stringify([address.pathname, address.editPanel]);

/** The address of the panel editor that is open now. */
export function currentAddress(): PopupAddress {
  return {
    pathname: locationService.getLocation().pathname,
    editPanel: String(locationService.getSearchObject().editPanel ?? ''),
  };
}

/** Ask the panel of this address to open the popup. Returns false when no panel listens for this address. */
export function requestOpen(address: PopupAddress, target: PopupTarget): boolean {
  const matching = listeners.get(keyOf(address));
  if (!matching?.size) {
    return false;
  }
  for (const listener of Array.from(matching)) {
    listener(target);
  }
  return true;
}

/** Listen for open requests of one address. Call the returned function to stop. */
export function subscribe(address: PopupAddress, listener: Listener): () => void {
  const key = keyOf(address);
  const set = listeners.get(key) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (!set.size && listeners.get(key) === set) {
      listeners.delete(key);
    }
  };
}
