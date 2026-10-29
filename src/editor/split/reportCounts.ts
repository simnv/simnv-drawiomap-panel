import type { BindResultV4 } from '../../binding/bindV4';
import type { ResolvedClass } from '../../binding/classes';
import type { UsePath } from '../../binding/report';
import { badgeOf, cellsByClass, firstUses } from './cellsForPath';

/** The number of cells with 0, 1 and more series. */
export interface SeriesCounts {
  zero: number;
  one: number;
  many: number;
}

const add = (counts: SeriesCounts, n: number) => {
  if (n === 0) {
    counts.zero++;
  } else if (n === 1) {
    counts.one++;
  } else {
    counts.many++;
  }
};

/**
 * The counts of the match report (spec 4): per class, the number of its cells and, by the first use of each cell
 * (as the `match` badge of spec 5.3), the cells with 0, 1 and more series; per use, the cells with 0, 1 and more
 * series. A use has its origin path, so a row of a base class counts the cells of each child class under the base
 * path. Each class of `classes` has an entry; a cell whose `bind` names no such class counts nowhere.
 */
export function reportCounts(
  bound: BindResultV4,
  classes: Map<string, ResolvedClass>
): { perClass: Map<string, SeriesCounts & { cells: number }>; perUse: Map<UsePath, SeriesCounts> } {
  const perClass = new Map([...classes.keys()].map((name) => [name, { cells: 0, zero: 0, one: 0, many: 0 }]));
  const perUse = new Map<UsePath, SeriesCounts>();
  for (const [name, cells] of cellsByClass(bound)) {
    const counts = perClass.get(name);
    if (!counts) {
      continue;
    }
    for (const cellId of cells) {
      counts.cells++;
      const uses = bound.uses.get(cellId) ?? [];
      const series = bound.series.get(cellId);
      for (const use of uses) {
        const of = perUse.get(use.path) ?? { zero: 0, one: 0, many: 0 };
        add(of, series?.get(use.path)?.length ?? 0);
        perUse.set(use.path, of);
      }
      const first = badgeOf(cellId, firstUses(uses), bound);
      if (first) {
        add(counts, first.count);
      }
    }
  }
  return { perClass, perUse };
}
