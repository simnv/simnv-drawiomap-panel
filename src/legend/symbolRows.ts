import type { CellIndex } from '../types';

/**
 * The legend of a portograph diagram draws one row for each node symbol: the cells `pg-legendRow~symbol:router`,
 * `pg-legendSwatch~symbol:router` and so on. The rows point at their nodes only through the attribute
 * `data-meta-pg-symbol` on the node cells (value `router`). A diagram without that attribute has no row link:
 * the rows do nothing. See docs/guide/colours.md, "Colour legend".
 */
export const SYMBOL_ATTR = 'pg-symbol';
/** Set on a legend row element that is linked to nodes. */
export const LEGEND_ROW_ATTR = 'data-dmap-legend-row';

const ROW_ID = /^pg-legend[A-Za-z]*~symbol:(.+)$/;

/** The symbol of a legend cell id, or null. The export writes `%` and `~` inside a part as `%25` and `%7e`. */
export function symbolOfLegendId(id: string): string | null {
  const m = ROW_ID.exec(id);
  if (!m) {
    return null;
  }
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** The node cells of each symbol. */
export function symbolGroups(cells: CellIndex): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [id, entry] of cells) {
    const symbol = entry.meta.kind === 'node' ? entry.meta.attrs[SYMBOL_ATTR] : undefined;
    if (symbol) {
      const ids = groups.get(symbol);
      if (ids) {
        ids.push(id);
      } else {
        groups.set(symbol, [id]);
      }
    }
  }
  return groups;
}

export interface RowMarks {
  /** all cells that have a symbol: the ones that are not hits dim */
  members: string[];
  hits: string[];
}

function symbolAt(target: EventTarget | null, root: Element, groups: Map<string, string[]>): string | null {
  // Only a row of this diagram: a row of another panel with the same symbol is outside.
  let el = target instanceof Element && root.contains(target) ? target : null;
  while (el && el !== root) {
    const id = el.getAttribute('data-cell-id');
    const symbol = id ? symbolOfLegendId(id) : null;
    if (symbol !== null) {
      return groups.has(symbol) ? symbol : null;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Links the legend rows of the diagram to their nodes: the pointer (mouse or pen) or the focus on a row, or a tap
 * on a phone (a second tap on the row, or a tap elsewhere, ends it), gives `onChange` the marks of the symbol; the
 * end gives null. It adds no state to the cells. It does nothing when no node has a symbol. Returns the cleanup.
 */
export function bindSymbolLegend(
  root: SVGSVGElement,
  cells: CellIndex,
  onChange: (marks: RowMarks | null) => void
): () => void {
  const groups = symbolGroups(cells);
  if (!groups.size) {
    return () => {};
  }
  const members = [...groups.values()].flat();
  // Every part of a linked row (row, body, tile, swatch) takes the mark; only the row takes the focus.
  const marked: Element[] = [];
  for (const el of Array.from(root.querySelectorAll('g[data-cell-id^="pg-legend"]'))) {
    const id = el.getAttribute('data-cell-id')!;
    const symbol = symbolOfLegendId(id);
    if (symbol !== null && groups.has(symbol)) {
      el.setAttribute(LEGEND_ROW_ATTR, '');
      if (id.startsWith('pg-legendRow~')) {
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', `Highlight ${symbol}`);
      }
      marked.push(el);
    }
  }
  let current: string | null = null;
  let touch = false;
  const set = (symbol: string | null) => {
    if (symbol === current) {
      return;
    }
    current = symbol;
    onChange(symbol === null ? null : { members, hits: groups.get(symbol)! });
  };
  const at = (e: Event) => symbolAt(e.target, root, groups);
  const isTouch = (e: Event) => (e as PointerEvent).pointerType === 'touch';
  const handlers: Array<[string, (e: Event) => void]> = [
    ['pointerover', (e) => isTouch(e) || set(at(e))],
    ['pointerleave', (e) => isTouch(e) || set(null)],
    ['focusin', (e) => touch || set(at(e))],
    ['focusout', () => touch || set(null)],
    [
      'click',
      (e) => {
        if (touch) {
          const symbol = at(e);
          set(symbol !== null && symbol !== current ? symbol : null);
        }
      },
    ],
  ];
  for (const [type, fn] of handlers) {
    root.addEventListener(type, fn);
  }
  // The page level: the kind of the last pointer (a key after a tap makes the focus work again), and a press outside
  // the linked rows, in this panel or in another, ends a selection.
  const pageHandlers: Array<[string, (e: Event) => void]> = [
    [
      'pointerdown',
      (e) => {
        touch = isTouch(e);
        if (current !== null && at(e) === null) {
          set(null);
        }
      },
    ],
    ['keydown', () => void (touch = false)],
  ];
  for (const [type, fn] of pageHandlers) {
    document.addEventListener(type, fn, true);
  }
  return () => {
    for (const [type, fn] of handlers) {
      root.removeEventListener(type, fn);
    }
    for (const [type, fn] of pageHandlers) {
      document.removeEventListener(type, fn, true);
    }
    for (const el of marked) {
      el.removeAttribute(LEGEND_ROW_ATTR);
      el.removeAttribute('tabindex');
      el.removeAttribute('aria-label');
    }
    set(null);
  };
}
