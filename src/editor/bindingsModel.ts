import {
  displayBindings,
  EMPTY_CONFIG,
  type Diagnostic,
  type DisplayConfig,
  type Section,
  type SkippedItem,
  type ValidatedConfig,
} from '../model/config';
import { cellMatches } from '../binding/select';
import { displayProvenance, ownersOfPath } from '../binding/patterns';
import { displayName } from '../adapter/cellTitle';
import type { CellMeta } from '../types';

/** One problem of a list row. A per-cell diagnostic of a shared pattern keeps its cell id. */
export interface RowProblem {
  code: string;
  message: string;
  /** the path of the diagnostic in the config; part of the identity of the problem */
  path: string;
  cellId?: string;
}
interface RowBase {
  /** stable and unique key of the row, also when IDs collide */
  key: string;
  /** index in the saved config array */
  index: number;
  problems: RowProblem[];
  /** the saved item does not parse: a problem row with its diagnostics, no matches, no form */
  skipped?: boolean;
}
export interface PatternRow extends RowBase {
  kind: 'pattern';
  patternId: string;
  name: string;
  selector: string;
  queryIds: string[];
  /** ids of the cells of the diagram that the selector matches */
  matched: string[];
  matchedLabels: string[];
}
export interface OverrideRow extends RowBase {
  kind: 'override';
  cellId: string;
  label: string;
  /** the readable title of the cell, empty when the cell is missing */
  title: string;
  /** the cell id as the editor shows it */
  handle: string;
  /** the display keys that the override sets */
  keys: string[];
  queryIds: string[];
  exists: boolean;
}
export interface WidgetRow extends RowBase {
  kind: 'widget';
  widgetId: string;
  label: string;
  widgetKind: 'sparkline' | 'bar';
  anchorCellId: string;
  queryId: string;
  exists: boolean;
}
/** A named query. `uses` counts the patterns, overrides and widgets that refer to it. */
export interface QueryRow extends RowBase {
  kind: 'query';
  queryId: string;
  name: string;
  sourceKind: 'datasource' | 'panel';
  uses: number;
}
export type BindingRow = PatternRow | OverrideRow | WidgetRow | QueryRow;
export interface BindingsList {
  patterns: PatternRow[];
  overrides: OverrideRow[];
  widgets: WidgetRow[];
  queries: QueryRow[];
  /** Problems that no row owns: invalid structure, a query nobody uses, an unowned cell. */
  general: RowProblem[];
}

const unique = <T>(items: T[]): T[] => Array.from(new Set(items));
const queryIdsOf = (display: Partial<DisplayConfig>) =>
  unique(displayBindings(display).map(({ binding }) => binding.queryId));

/** The cell of a per-cell diagnostic path "cells.<id>.<display path>". The longest known id wins. */
function cellOfPath(path: string, ids: string[]): { cellId: string; rest: string } | undefined {
  let found: { cellId: string; rest: string } | undefined;
  for (const id of ids) {
    const prefix = `cells.${id}.`;
    if (path.startsWith(prefix) && (!found || id.length > found.cellId.length)) {
      found = { cellId: id, rest: path.slice(prefix.length) };
    }
  }
  return found;
}

/** A list row of a skipped item: the saved index, a title from the raw name or id, no matches, its problems. */
function skippedRows<R extends BindingRow>(
  section: Section,
  validated: ValidatedConfig,
  dense: R[],
  make: (item: SkippedItem) => R
): R[] {
  const bySaved = new Map<number, R>();
  dense.forEach((row, j) => bySaved.set(validated.indices[section][j], row));
  for (const item of validated.skippedItems) {
    if (item.section === section) {
      bySaved.set(item.index, make(item));
    }
  }
  return Array.from(bySaved.keys())
    .sort((a, b) => a - b)
    .map((index) => bySaved.get(index)!);
}

/** The list reads a validated config. A plain config is a clean one: every item parses, dense equals saved. */
/**
 * Build the rows of the "All bindings" list from the config, the cells of the diagram and the diagnostics that the
 * editor and the engine already produce (config validation, pattern resolution, metric resolution, hover cards).
 * Pure: the caller decides which diagnostics it has. Matching uses the selector code of the engine (`cellMatches`).
 * The rows follow the saved order and carry the saved index; a skipped item is a problem row without matches, and
 * neither `cellMatches` nor the merge ever sees it.
 */
export function buildBindingsList(
  validated: ValidatedConfig,
  cells: CellMeta[],
  diagnostics: Diagnostic[]
): BindingsList {
  const config = validated.config ?? EMPTY_CONFIG;
  const ids = cells.map((c) => c.id);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const savedIndex = (section: Section, j: number) => validated.indices[section][j];
  const patternMatches = new Map<number, CellMeta[]>();
  const patterns: PatternRow[] = skippedRows(
    'patterns',
    validated,
    config.patterns.map((p, j): PatternRow => {
      const index = savedIndex('patterns', j);
      const matched = cells.filter((c) => cellMatches(p.select, c));
      patternMatches.set(index, matched);
      return {
        kind: 'pattern',
        key: `pattern:${index}:${p.id}`,
        index,
        patternId: p.id,
        name: p.name,
        selector: p.select.kind ?? 'any',
        queryIds: queryIdsOf(p.display),
        matched: matched.map((c) => c.id),
        matchedLabels: matched.flatMap((c) => [c.labelText, c.title ?? '']).filter(Boolean),
        problems: [],
      };
    }),
    (item) => ({
      kind: 'pattern',
      key: `pattern:${item.index}:skipped`,
      index: item.index,
      patternId: item.id ?? item.title,
      name: item.title.replace(/^Pattern /, ''),
      selector: '',
      queryIds: [],
      matched: [],
      matchedLabels: [],
      problems: [],
      skipped: true,
    })
  );
  const overrides: OverrideRow[] = skippedRows(
    'overrides',
    validated,
    config.overrides.map((o, j): OverrideRow => {
      const index = savedIndex('overrides', j);
      return {
        kind: 'override',
        key: `override:${index}:${o.cellId}`,
        index,
        cellId: o.cellId,
        label: byId.get(o.cellId)?.labelText ?? '',
        handle: byId.get(o.cellId)?.handle ?? o.cellId,
        title:
          byId.has(o.cellId) && displayName(byId.get(o.cellId), o.cellId) !== (byId.get(o.cellId)?.handle ?? o.cellId)
            ? displayName(byId.get(o.cellId), o.cellId)
            : '',
        keys: Object.entries(o.display)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key),
        queryIds: queryIdsOf(o.display),
        exists: byId.has(o.cellId),
        problems: [],
      };
    }),
    (item) => ({
      kind: 'override',
      key: `override:${item.index}:skipped`,
      index: item.index,
      cellId: item.cellId ?? '',
      label: '',
      handle: item.cellId ?? item.title,
      title: '',
      keys: [],
      queryIds: [],
      exists: item.cellId !== undefined && byId.has(item.cellId),
      problems: [],
      skipped: true,
    })
  );
  const widgets: WidgetRow[] = skippedRows(
    'widgets',
    validated,
    config.widgets.map((w, j): WidgetRow => {
      const index = savedIndex('widgets', j);
      return {
        kind: 'widget',
        key: `widget:${index}:${w.id}`,
        index,
        widgetId: w.id,
        label: w.label,
        widgetKind: w.kind,
        anchorCellId: w.anchorCellId,
        queryId: w.binding.queryId,
        exists: byId.has(w.anchorCellId),
        problems: [],
      };
    }),
    (item) => ({
      kind: 'widget',
      key: `widget:${item.index}:skipped`,
      index: item.index,
      widgetId: item.id ?? item.title,
      label: item.title.replace(/^Widget /, ''),
      widgetKind: 'sparkline',
      anchorCellId: '',
      queryId: '',
      exists: false,
      problems: [],
      skipped: true,
    })
  );

  const referencingCount = (queryId: string) =>
    patterns.filter((row) => row.queryIds.includes(queryId)).length +
    overrides.filter((row) => row.queryIds.includes(queryId)).length +
    widgets.filter((row) => row.queryId === queryId).length;
  const queries: QueryRow[] = skippedRows(
    'queries',
    validated,
    config.queries.map((q, j): QueryRow => {
      const index = savedIndex('queries', j);
      return {
        kind: 'query',
        key: `query:${index}:${q.id}`,
        index,
        queryId: q.id,
        name: q.name,
        sourceKind: q.source.kind,
        uses: referencingCount(q.id),
        problems: [],
      };
    }),
    (item) => ({
      kind: 'query',
      key: `query:${item.index}:skipped`,
      index: item.index,
      queryId: item.id ?? item.title,
      name: item.title.replace(/^Query /, ''),
      sourceKind: 'panel',
      uses: 0,
      problems: [],
      skipped: true,
    })
  );

  const provenance = new Map<string, ReturnType<typeof displayProvenance>>();
  const provenanceOf = (cell: CellMeta) => {
    if (!provenance.has(cell.id)) {
      provenance.set(cell.id, displayProvenance(config, cell));
    }
    return provenance.get(cell.id)!;
  };
  const general: RowProblem[] = [];
  const seen = new Set<string>();
  const add = (row: BindingRow | undefined, problem: RowProblem) => {
    const id = `${row?.key ?? 'general'}|${problem.code}|${problem.path}|${problem.cellId ?? ''}|${problem.message}`;
    if (!seen.has(id)) {
      seen.add(id);
      (row ? row.problems : general).push(problem);
    }
  };
  /** the row of a saved index in a section */
  const rowAt = <R extends BindingRow>(rows: R[], index: number | undefined): R | undefined =>
    index === undefined ? undefined : rows.find((row) => row.index === index);
  const indexed = (path: string, section: string) => {
    const match = new RegExp(`^${section}\\[(\\d+)\\]`).exec(path);
    return match ? Number(match[1]) : undefined;
  };
  const referencing = (queryId: string): BindingRow[] => [
    ...patterns.filter((row) => row.queryIds.includes(queryId)),
    ...overrides.filter((row) => row.queryIds.includes(queryId)),
    ...widgets.filter((row) => row.queryId === queryId),
  ];
  for (const d of diagnostics) {
    const problem: RowProblem = { code: d.code, message: d.message, path: d.path };
    const p = rowAt(patterns, indexed(d.path, 'patterns'));
    const o = rowAt(overrides, indexed(d.path, 'overrides'));
    const w = rowAt(widgets, indexed(d.path, 'widgets'));
    const q = rowAt(queries, indexed(d.path, 'queries'));
    if (p) {
      // A colliding ID is a problem of every pattern that has it: any of them would open the wrong one.
      const rows = d.code === 'duplicate-pattern-id' ? patterns.filter((r) => r.patternId === p.patternId) : [p];
      rows.forEach((row) => add(row, problem));
    } else if (o) {
      add(o, problem);
    } else if (w) {
      const rows = d.code === 'duplicate-widget-id' ? widgets.filter((r) => r.widgetId === w.widgetId) : [w];
      rows.forEach((row) => add(row, problem));
    } else if (q) {
      // The query row owns the problem. The rows that use the query show it too.
      [q, ...referencing(q.queryId)].forEach((row) => add(row, problem));
    } else {
      const hit = cellOfPath(d.path, ids);
      if (!hit) {
        add(undefined, problem);
        continue;
      }
      // Blame every owner that contributed a field of the failing path to the merge (the shared merge says who).
      // When none did, the merge itself is the cause: blame all the owners of the cell.
      const matching = patterns.filter((row) => patternMatches.get(row.index)?.some((c) => c.id === hit.cellId));
      const override = overrides.find((row) => row.cellId === hit.cellId);
      const chain: BindingRow[] = [...matching, ...(override ? [override] : [])];
      const meta = byId.get(hit.cellId);
      const contributed = meta ? ownersOfPath(provenanceOf(meta), hit.rest) : [];
      // a provenance owner holds the dense index of the pattern: the row has the saved one
      const owners: BindingRow[] = contributed.flatMap((owner) =>
        owner.kind === 'pattern'
          ? ((rowAt(patterns, savedIndex('patterns', owner.index)) as BindingRow | undefined) ?? [])
          : overrides.filter((row) => row.cellId === owner.cellId)
      );
      for (const row of owners.length ? owners : chain) {
        add(row, { ...problem, cellId: hit.cellId });
      }
      if (!chain.length) {
        add(undefined, problem);
      }
    }
  }
  // Problems that the diagram alone shows. The engine reports the missing ones too, but not while the config is invalid.
  if (cells.length > 0) {
    for (const row of patterns) {
      if (!row.matched.length && !row.skipped) {
        add(row, {
          code: 'no-match',
          path: `patterns[${row.index}].select`,
          message: 'The selector matches no element of the diagram.',
        });
      }
    }
    for (const row of overrides) {
      if (!row.exists && !row.skipped) {
        add(row, {
          code: 'missing-cell',
          path: `overrides[${row.index}].cellId`,
          message: `Override refers to missing cell ${row.cellId}. Select an existing cell or remove the override.`,
        });
      }
    }
    for (const row of widgets) {
      if (!row.exists && !row.skipped) {
        add(row, {
          code: 'missing-anchor',
          path: `widgets[${row.index}].anchorCellId`,
          message: `Widget ${row.widgetId} needs anchor ${row.anchorCellId}.`,
        });
      }
    }
  }
  return { patterns, overrides, widgets, queries, general };
}

export interface BindingsFilter {
  text: string;
  problemsOnly: boolean;
}

/** Text matches the name, the cell id or label, the anchor and the query ids. Case-insensitive. */
export function rowMatches(row: BindingRow, filter: BindingsFilter): boolean {
  if (filter.problemsOnly && !row.problems.length) {
    return false;
  }
  const needle = filter.text.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack =
    row.kind === 'pattern'
      ? [row.name, row.patternId, row.selector, ...row.queryIds, ...row.matched, ...row.matchedLabels]
      : row.kind === 'override'
        ? [row.cellId, row.handle, row.label, row.title, ...row.keys, ...row.queryIds]
        : row.kind === 'widget'
          ? [row.label, row.widgetId, row.anchorCellId, row.queryId]
          : [row.name, row.queryId, row.sourceKind];
  return haystack.some((text) => text.toLowerCase().includes(needle));
}

/** The general problems stay in every filter: they belong to no row. */
export function filterBindings(list: BindingsList, filter: BindingsFilter): BindingsList {
  return {
    patterns: list.patterns.filter((row) => rowMatches(row, filter)),
    overrides: list.overrides.filter((row) => rowMatches(row, filter)),
    widgets: list.widgets.filter((row) => rowMatches(row, filter)),
    queries: list.queries.filter((row) => rowMatches(row, filter)),
    general: list.general,
  };
}

/** One problem of the list with the row that owns it. A problem that no row owns has no row. */
export interface ProblemEntry {
  /** stable key; the same problem under two rows is one entry */
  key: string;
  row?: BindingRow;
  problem: RowProblem;
}

/**
 * All problems of the list, each once. A problem that several rows show (a query problem shows under the query and
 * under the rows that use it) belongs to the first row in the order queries, patterns, overrides, widgets.
 */
export function problemsOf(list: BindingsList): ProblemEntry[] {
  const seen = new Set<string>();
  const entries: ProblemEntry[] = [];
  const add = (row: BindingRow | undefined, problem: RowProblem) => {
    const key = [problem.code, problem.path, problem.cellId ?? '', problem.message].join('|');
    if (!seen.has(key)) {
      seen.add(key);
      entries.push({ key, row, problem });
    }
  };
  for (const row of [...list.queries, ...list.patterns, ...list.overrides, ...list.widgets]) {
    row.problems.forEach((problem) => add(row, problem));
  }
  list.general.forEach((problem) => add(undefined, problem));
  return entries;
}

/**
 * The cells that a filter text finds: the exact id first, then the ids that start with the text, then the ids
 * or labels that contain it. Case-insensitive. Empty text finds nothing. It returns all matches; the UI pages them.
 */
export function cellRows(text: string, cells: CellMeta[]): CellMeta[] {
  const needle = text.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const tier = (cell: CellMeta) => {
    const id = cell.id.toLowerCase();
    if (id === needle) {
      return 0;
    }
    if (id.startsWith(needle)) {
      return 1;
    }
    return id.includes(needle) ||
      (cell.labelText ?? '').toLowerCase().includes(needle) ||
      (cell.title ?? '').toLowerCase().includes(needle)
      ? 2
      : 3;
  };
  return cells
    .map((cell, order) => ({ cell, order, rank: tier(cell) }))
    .filter((entry) => entry.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((entry) => entry.cell);
}
