/**
 * Attributes that more than one owner writes on a cell group (tabindex, role, aria-label). Each owner writes
 * and clears only its own layer. The DOM shows the value of the layer with the highest priority; when no
 * layer has the attribute, the DOM gets back the value of the diagram. So a data refresh of the patch applier
 * does not remove the tab stops and roles of the binding editor, and the editor does not restore stale values
 * of the applier when it closes.
 */
export type AttrOwner = 'applier' | 'editor';

/** Lowest priority first: the editor wins over the applier. */
const PRIORITY: AttrOwner[] = ['applier', 'editor'];

interface Layers {
  /** the value of the diagram, before the first owner wrote the attribute (null: no attribute) */
  original: Map<string, string | null>;
  values: Map<AttrOwner, Record<string, string>>;
}

const layers = new WeakMap<Element, Layers>();

function render(el: Element, state: Layers, names: Iterable<string>): void {
  for (const name of names) {
    let value: string | null | undefined;
    for (const owner of PRIORITY) {
      const v = state.values.get(owner)?.[name];
      if (v !== undefined) {
        value = v;
      }
    }
    if (value === undefined) {
      value = state.original.get(name) ?? null;
      state.original.delete(name);
    }
    if (value === null) {
      el.removeAttribute(name);
    } else {
      el.setAttribute(name, value);
    }
  }
}

/** Replace the layer of `owner` on `el` with `attrs`. */
export function setOwnedAttrs(el: Element, owner: AttrOwner, attrs: Record<string, string>): void {
  let state = layers.get(el);
  if (!state) {
    state = { original: new Map(), values: new Map() };
    layers.set(el, state);
  }
  const before = Object.keys(state.values.get(owner) ?? {});
  for (const name of Object.keys(attrs)) {
    if (!state.original.has(name) && !PRIORITY.some((o) => state!.values.get(o)?.[name] !== undefined)) {
      state.original.set(name, el.getAttribute(name));
    }
  }
  state.values.set(owner, { ...attrs });
  render(el, state, new Set([...before, ...Object.keys(attrs)]));
}

/** Remove the layer of `owner` on `el`. The other layers, or the diagram values, show again. */
export function clearOwnedAttrs(el: Element, owner: AttrOwner): void {
  const state = layers.get(el);
  const own = state?.values.get(owner);
  if (!state || !own) {
    return;
  }
  state.values.delete(owner);
  render(el, state, Object.keys(own));
}
