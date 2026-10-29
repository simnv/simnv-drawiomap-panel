import type { BindResultV4 } from '../../binding/bindV4';
import type { ResolvedClass } from '../../binding/classes';
import type { Use } from '../../binding/uses';
import { parsePath, yamlPath } from '../../model/yamlPath';

/** The count of series of a use on one cell; red for 0 (spec 5.3). */
export interface Badge {
  count: number;
  red: boolean;
}

export interface CellSet {
  cells: string[];
  /** the cells of the classes that extend the class of the path */
  lighter: string[];
  badges: Map<string, Badge>;
}

/** The fields of a class that give a use, so their path gives the count of that use. */
const USE_FIELDS = new Set(['status', 'text', 'chart', 'up', 'down', 'capacity']);
/** The kinds of the first use of a class, in their order (spec 5.3, the `match` row). */
const FIRST = ['status', 'row', 'up', 'text', 'chart'] as const;

/** The path of a use without the direction of an `updown` row or chart and of a capacity per direction. */
const baseOf = (path: string) => path.replace(/\.(?:a2b|b2a)$/, '');
/** The use path is the field path or a path below it (`classes.lan.chart.a2b`). */
const under = (path: string, field: string) => path === field || path.startsWith(`${field}.`);

/** The first use of a cell: the status, else the first row, else `up`, else `text`, else `chart`. */
export function firstUses(uses: Use[]): Use[] {
  for (const kind of FIRST) {
    const first = uses.find((u) => u.kind === kind);
    if (first) {
      const base = baseOf(first.path);
      return uses.filter((u) => u.kind === kind && baseOf(u.path) === base);
    }
  }
  return [];
}

/**
 * The count of a group of uses on one cell. An `updown` use has one use per direction: the count is the count of
 * the direction with the fewest series. Undefined for no use.
 */
export function badgeOf(cellId: string, uses: Use[], bound: BindResultV4): Badge | undefined {
  if (!uses.length) {
    return undefined;
  }
  const series = bound.series.get(cellId);
  const count = Math.min(...uses.map((u) => series?.get(u.path)?.length ?? 0));
  return { count, red: count === 0 };
}

/** The cells of each class: the cells whose `bind` names it, in the order of the bind result. */
export function cellsByClass(bound: BindResultV4): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [cellId, patch] of bound.patches) {
    const bind = patch.scope.cell.bind;
    if (bind !== undefined) {
      out.set(bind, [...(out.get(bind) ?? []), cellId]);
    }
  }
  return out;
}

/**
 * The cells to highlight for the YAML path under the cursor, and the badge of each (spec 5.3 "The cells of a path"):
 *
 * - `classes.<c>` and its plain fields: the cells of `c` and, lighter, the cells of the classes that extend `c`.
 * - `classes.<c>.match`: the same cells; the badge of the first use on each cell whose class has this match.
 * - `classes.<c>.rows[i]` and below: the cells of each class whose resolved rows hold this origin path, with the
 *   count of the row on each cell.
 * - `classes.<c>.status`, `.text`, `.chart`, `.up`, `.down`, `.capacity`: the same cells as `classes.<c>`; the badge
 *   of the use on each cell whose use comes from this field.
 * - `overrides.<id>` and below: that one cell, with the badge of its first use.
 * - Other paths: nothing.
 */
export function cellsForPath(path: string, bound: BindResultV4, classes: Map<string, ResolvedClass>): CellSet {
  const [root, name, field, index] = parsePath(path);
  const badges = new Map<string, Badge>();
  const badge = (cellId: string, uses: (all: Use[]) => Use[]) => {
    const found = badgeOf(cellId, uses(bound.uses.get(cellId) ?? []), bound);
    if (found) {
      badges.set(cellId, found);
    }
  };
  if (root === 'overrides' && typeof name === 'string') {
    badge(name, firstUses);
    return { cells: [name], lighter: [], badges };
  }
  if (root !== 'classes' || typeof name !== 'string') {
    return { cells: [], lighter: [], badges };
  }
  const byClass = cellsByClass(bound);
  const cellsOf = (names: string[]) => names.flatMap((n) => byClass.get(n) ?? []);

  if (field === 'rows' && typeof index === 'number') {
    const origin = yamlPath(['classes', name, 'rows', index]);
    const holders = [...classes.values()].filter((c) => c.rows.some((row) => row.origin === origin));
    const cells = cellsOf(holders.map((c) => c.name));
    cells.forEach((id) => badge(id, (uses) => uses.filter((u) => u.kind === 'row' && under(u.path, origin))));
    return { cells, lighter: [], badges };
  }

  const cells = byClass.get(name) ?? [];
  const children = [...classes.values()].filter((c) => c.name !== name && c.chain.includes(name));
  const lighter = cellsOf(children.map((c) => c.name));
  if (field === 'match') {
    const own = yamlPath(['classes', name, 'match']);
    for (const cls of [classes.get(name), ...children]) {
      if (cls?.origins.match === own) {
        byClass.get(cls.name)?.forEach((id) => badge(id, firstUses));
      }
    }
  } else if (typeof field === 'string' && USE_FIELDS.has(field)) {
    const own = yamlPath(['classes', name, field]);
    [...cells, ...lighter].forEach((id) => badge(id, (uses) => uses.filter((u) => under(u.path, own))));
  }
  return { cells, lighter, badges };
}
