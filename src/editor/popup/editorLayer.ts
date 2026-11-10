import { clearOwnedAttrs, setOwnedAttrs } from '../../render/cellAttrs';
import type { CellIndex } from '../../types';

export interface StageSelection {
  /** Every selected cell. The primary one is the last. */
  selected: string[];
  /** The cell that the single-cell sections edit. */
  primary?: string;
  /** Cells that a proposed selector would match and the selection does not hold. */
  extra?: string[];
  /** Selected cells that a proposed selector would miss. */
  missed?: string[];
  /** The cells that the edited pattern or override changes. */
  affected: string[];
  /** The cells of the YAML path under the cursor or of a report entry (spec 5.3). The other cells dim. */
  highlight: string[];
  /** The cells of the classes that extend the class under the cursor: a lighter highlight. */
  lighter?: string[];
}

/** The sets of the cells that a selection tags, and the union of them. */
export interface Tagged {
  selected: Set<string>;
  extra: Set<string>;
  missed: Set<string>;
  affected: Set<string>;
  highlight: Set<string>;
  lighter: Set<string>;
  primary: string | undefined;
  all: Set<string>;
}

export function tagSelection(selection: StageSelection): Tagged {
  const { selected, primary, extra, missed, affected, highlight, lighter } = selection;
  const sets = {
    selected: new Set(selected),
    extra: new Set(extra),
    missed: new Set(missed),
    affected: new Set(affected),
    highlight: new Set(highlight),
    lighter: new Set(lighter),
  };
  const all = new Set<string>();
  for (const set of Object.values(sets)) {
    set.forEach((id) => all.add(id));
  }
  if (primary !== undefined) {
    all.add(primary);
  }
  return { ...sets, primary, all };
}

const flag = (on: boolean) => (on ? 'true' : 'false');

/** The `data-dmap-*` flags of the cell `id`: the cell group and its outline in the stage carry the same ones. */
export function cellFlags(tagged: Tagged, id: string): Record<string, 'true' | 'false'> {
  return {
    'data-dmap-selected': flag(tagged.selected.has(id)),
    'data-dmap-primary': flag(id === tagged.primary),
    'data-dmap-extra': flag(tagged.extra.has(id)),
    'data-dmap-missed': flag(tagged.missed.has(id)),
    'data-dmap-affected': flag(tagged.affected.has(id)),
    'data-dmap-highlight': flag(tagged.highlight.has(id)),
    'data-dmap-lighter': flag(tagged.lighter.has(id)),
  };
}

/** The cell `id` has an outline: a flag other than `primary` (that one only moves the outline out) is on. */
export const isOutlined = (tagged: Tagged, id: string) =>
  [tagged.selected, tagged.extra, tagged.missed, tagged.affected, tagged.highlight, tagged.lighter].some((set) =>
    set.has(id)
  );

export interface EditorLayer {
  /** Write the editor attributes for `selection`. Only the cells that the old or the new selection tags change. */
  apply: (selection: StageSelection) => void;
  /** Remove the editor layer from every cell. The next `apply` writes every cell again. */
  clear: () => void;
}

/**
 * The editor layer of the cell attributes (tab stop, role, label and the `data-dmap-*` flags of the selection).
 * The first `apply` writes every cell. Each next `apply` writes only the cells in the union of the old and the new
 * tagged cells: a cell that neither selection tags keeps its `false` flags. The result in the DOM is the same as
 * the result of a full sweep of the index.
 */
export function createEditorLayer(index: CellIndex): EditorLayer {
  /** The cells that the last `apply` tagged. `null`: the layer has no attributes yet. */
  let last: Set<string> | null = null;

  return {
    apply(selection) {
      const next = tagSelection(selection);
      const touch = last === null ? index.keys() : new Set([...last, ...next.all]);
      for (const id of touch) {
        const cell = index.get(id);
        if (!cell) {
          continue;
        }
        setOwnedAttrs(cell.group, 'editor', {
          tabindex: '0',
          role: 'button',
          'aria-label': `${id} diagram element`,
          ...cellFlags(next, id),
        });
      }
      last = next.all;
    },
    clear() {
      index.forEach((cell) => clearOwnedAttrs(cell.group, 'editor'));
      last = null;
    },
  };
}
