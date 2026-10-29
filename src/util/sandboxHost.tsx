import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import pluginJson from '../plugin.json';

/**
 * A plugin-owned element in `document.body` while the component is mounted: the root of a plugin overlay.
 *
 * Why not the Grafana `Portal`: it renders into `#grafana-portal-container`, which is inside `#reactRoot`. In the frontend
 * sandbox, plugin code gets only a detached mock for an element there, so the overlay is not in the page.
 * `getSafeSandboxDomElement` returns the real element for a node that is under `[data-plugin-sandbox=<id>]`, so the host
 * carries that attribute and sits directly in `document.body`.
 *
 * The host is in the body from the layout effect of the owner on. The layout effects of the children run before it: a
 * child that measures itself must wait for the host to be in the document.
 */
export function useSandboxHost(): HTMLDivElement {
  const [host] = useState(() => {
    const el = document.createElement('div');
    el.dataset.pluginSandbox = pluginJson.id;
    return el;
  });
  // A double mount (StrictMode) adds and removes the host twice.
  useLayoutEffect(() => {
    document.body.appendChild(host);
    return () => host.remove();
  }, [host]);
  return host;
}

/** Renders the children into a sandbox host (`useSandboxHost`). */
export function SandboxPortal({ children }: { children: ReactNode }) {
  return createPortal(children, useSandboxHost());
}
