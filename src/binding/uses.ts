import type { MatchV4, RowV4 } from '../model/v4';
import { yamlPath } from '../model/yamlPath';
import type { CellMeta } from '../types';
import type { ResolvedClass } from './classes';
import { linkFeeds } from './linkFeeds';
import type { UsePath } from './report';

/**
 * One use of a query by a cell (spec 3.2 step 4): the refId, the match block (the row match, else the class match)
 * and the YAML path of its origin. A row or a field that a class inherits through `extends` has the path in the class
 * that declares it (`classes.device.rows[0]`, `classes.device.status`); an override row or field has
 * `overrides.<id>.rows[i]` or `overrides.<id>.<field>`. An `updown` row or chart gives one use per geometric
 * direction, `<path>.a2b` and `<path>.b2a`, with the feeds of `linkFeeds` (3.8.3).
 */
export interface Use {
  kind: 'status' | 'text' | 'row' | 'chart' | 'up' | 'down' | 'capacity';
  refId: string;
  match: MatchV4;
  path: UsePath;
  row?: RowV4;
  /** The interface end for up, down, and each direction of an updown row or chart (I13). */
  end?: 'source' | 'target';
}

/** The end for the uses of one match block, or a decision to omit them (I9, I13). */
export type UsePlan = (match: MatchV4) => 'source' | 'target' | 'drop';

/** The fields that apply only to an edge cell (spec 3.8.6). */
export const LINK_FIELDS = ['up', 'down', 'capacity', 'linkLabel', 'arrow'] as const;

/** The YAML path of the class or the override that sets a field of the class (`classes.device.status`). */
export function fieldPath(cls: ResolvedClass, field: string): string {
  return cls.origins[field] ?? yamlPath(['classes', cls.name, field]);
}

/**
 * The uses of one cell from its effective class (the class after the override of the cell): the status, the text,
 * one use per row query, the chart, and on an edge the `up`, `down` and `capacity` uses. An abstract class (no
 * `match`) has no use: its cells get no data (A7). Without a plan, each directional use follows the cell's own
 * `at`, also on a vertex (I13).
 */
export function listUses(cell: CellMeta, cls: ResolvedClass, plan?: UsePlan): Use[] {
  const classMatch = cls.match;
  if (!classMatch) {
    return [];
  }
  const at = (field: string) => fieldPath(cls, field);
  const uses: Use[] = [];
  const endOf = (match: MatchV4) => plan?.(match) ?? (cell.attrs.at === 'target' ? 'target' : 'source');
  const add = (use: Use) => {
    const end = endOf(use.match);
    if (end !== 'drop') {
      uses.push(use.kind === 'up' || use.kind === 'down' ? { ...use, end } : use);
    }
  };
  const feeds = (match: MatchV4, up: string, down: string) => {
    const end = endOf(match);
    return end === 'drop' ? undefined : { ...linkFeeds(end, up, down), end };
  };
  if (cls.status !== undefined) {
    add({ kind: 'status', refId: cls.status, match: classMatch, path: at('status') });
  }
  if (cls.text) {
    add({ kind: 'text', refId: cls.text.query, match: cls.text.match ?? classMatch, path: at('text') });
  }
  for (const row of cls.rows) {
    const origin = row.origin;
    if (row.kind === 'metadata' || row.kind === 'drilldown') {
      continue;
    }
    const match = row.match ?? classMatch;
    if (row.kind === 'updown') {
      const feed = feeds(match, row.up, row.down);
      if (feed) {
        const { a2b, b2a, end } = feed;
        uses.push({ kind: 'row', refId: a2b, match, path: `${origin}.a2b`, row, end });
        uses.push({ kind: 'row', refId: b2a, match, path: `${origin}.b2a`, row, end });
      }
    } else {
      add({ kind: 'row', refId: row.query, match, path: origin, row });
    }
  }
  const chart = cls.chart;
  if (chart) {
    const match = chart.match ?? classMatch;
    if (chart.kind === 'updown') {
      const feed = feeds(match, chart.up, chart.down);
      if (feed) {
        const { a2b, b2a, end } = feed;
        uses.push({ kind: 'chart', refId: a2b, match, path: `${at('chart')}.a2b`, row: chart, end });
        uses.push({ kind: 'chart', refId: b2a, match, path: `${at('chart')}.b2a`, row: chart, end });
      }
    } else {
      add({ kind: 'chart', refId: chart.query, match, path: at('chart'), row: chart });
    }
  }
  if (!cell.isEdge) {
    return uses;
  }
  if (cls.up !== undefined) {
    add({ kind: 'up', refId: cls.up, match: classMatch, path: at('up') });
  }
  if (cls.down !== undefined) {
    add({ kind: 'down', refId: cls.down, match: classMatch, path: at('down') });
  }
  if (typeof cls.capacity === 'string') {
    add({ kind: 'capacity', refId: cls.capacity, match: classMatch, path: at('capacity') });
  } else if (cls.capacity) {
    for (const dir of ['a2b', 'b2a'] as const) {
      add({ kind: 'capacity', refId: cls.capacity[dir], match: classMatch, path: `${at('capacity')}.${dir}` });
    }
  }
  return uses;
}
