import { displayBindings, type DiagramConfigV2, type Diagnostic, type DisplayConfig } from '../model/config';
import { cellMatches } from '../binding/select';
import { displayProvenance, ownersOfPath } from '../binding/patterns';
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
  /** index in its config array */
  index: number;
  problems: RowProblem[];
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
export type BindingRow = PatternRow | OverrideRow | WidgetRow;
export interface BindingsList {
  patterns: PatternRow[];
  overrides: OverrideRow[];
  widgets: WidgetRow[];
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

/**
 * Build the rows of the "All bindings" list from the config, the cells of the diagram and the diagnostics that the
 * editor and the engine already produce (config validation, pattern resolution, metric resolution, hover cards).
 * Pure: the caller decides which diagnostics it has. Matching uses the selector code of the engine (`cellMatches`).
 */
export function buildBindingsList(config: DiagramConfigV2, cells: CellMeta[], diagnostics: Diagnostic[]): BindingsList {
  const ids = cells.map((c) => c.id);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const patternMatches = config.patterns.map((p) => cells.filter((c) => cellMatches(p.select, c)));
  const patterns: PatternRow[] = config.patterns.map((p, i) => ({
    kind: 'pattern',
    key: `pattern:${i}:${p.id}`,
    index: i,
    patternId: p.id,
    name: p.name,
    selector: p.select.kind ?? 'any',
    queryIds: queryIdsOf(p.display),
    matched: patternMatches[i].map((c) => c.id),
    matchedLabels: patternMatches[i].map((c) => c.labelText).filter(Boolean),
    problems: [],
  }));
  const overrides: OverrideRow[] = config.overrides.map((o, i) => ({
    kind: 'override',
    key: `override:${i}:${o.cellId}`,
    index: i,
    cellId: o.cellId,
    label: byId.get(o.cellId)?.labelText ?? '',
    keys: Object.entries(o.display)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key),
    queryIds: queryIdsOf(o.display),
    exists: byId.has(o.cellId),
    problems: [],
  }));
  const widgets: WidgetRow[] = config.widgets.map((w, i) => ({
    kind: 'widget',
    key: `widget:${i}:${w.id}`,
    index: i,
    widgetId: w.id,
    label: w.label,
    widgetKind: w.kind,
    anchorCellId: w.anchorCellId,
    queryId: w.binding.queryId,
    exists: byId.has(w.anchorCellId),
    problems: [],
  }));

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
    const p = indexed(d.path, 'patterns');
    const o = indexed(d.path, 'overrides');
    const w = indexed(d.path, 'widgets');
    const q = indexed(d.path, 'queries');
    if (p !== undefined && patterns[p]) {
      // A colliding ID is a problem of every pattern that has it: any of them would open the wrong one.
      const rows =
        d.code === 'duplicate-pattern-id'
          ? patterns.filter((r) => r.patternId === patterns[p].patternId)
          : [patterns[p]];
      rows.forEach((row) => add(row, problem));
    } else if (o !== undefined && overrides[o]) {
      add(overrides[o], problem);
    } else if (w !== undefined && widgets[w]) {
      const rows =
        d.code === 'duplicate-widget-id' ? widgets.filter((r) => r.widgetId === widgets[w].widgetId) : [widgets[w]];
      rows.forEach((row) => add(row, problem));
    } else if (q !== undefined && config.queries[q]) {
      const rows = referencing(config.queries[q].id);
      if (rows.length) {
        rows.forEach((row) => add(row, problem));
      } else {
        add(undefined, problem);
      }
    } else {
      const hit = cellOfPath(d.path, ids);
      if (!hit) {
        add(undefined, problem);
        continue;
      }
      // Blame every owner that contributed a field of the failing path to the merge (the shared merge says who).
      // When none did, the merge itself is the cause: blame all the owners of the cell.
      const matching = patterns.filter((_, i) => patternMatches[i].some((c) => c.id === hit.cellId));
      const override = overrides.find((row) => row.cellId === hit.cellId);
      const chain: BindingRow[] = [...matching, ...(override ? [override] : [])];
      const meta = byId.get(hit.cellId);
      const contributed = meta ? ownersOfPath(provenanceOf(meta), hit.rest) : [];
      const owners: BindingRow[] = contributed.flatMap((owner) =>
        owner.kind === 'pattern'
          ? [patterns[owner.index] as BindingRow]
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
      if (!row.matched.length) {
        add(row, {
          code: 'no-match',
          path: `patterns[${row.index}].select`,
          message: 'The selector matches no element of the diagram.',
        });
      }
    }
    for (const row of overrides) {
      if (!row.exists) {
        add(row, {
          code: 'missing-cell',
          path: `overrides[${row.index}].cellId`,
          message: `Override refers to missing cell ${row.cellId}. Select an existing cell or remove the override.`,
        });
      }
    }
    for (const row of widgets) {
      if (!row.exists) {
        add(row, {
          code: 'missing-anchor',
          path: `widgets[${row.index}].anchorCellId`,
          message: `Widget ${row.widgetId} needs anchor ${row.anchorCellId}.`,
        });
      }
    }
  }
  return { patterns, overrides, widgets, general };
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
        ? [row.cellId, row.label, ...row.keys, ...row.queryIds]
        : [row.label, row.widgetId, row.anchorCellId, row.queryId];
  return haystack.some((text) => text.toLowerCase().includes(needle));
}

/** The general problems stay in every filter: they belong to no row. */
export function filterBindings(list: BindingsList, filter: BindingsFilter): BindingsList {
  return {
    patterns: list.patterns.filter((row) => rowMatches(row, filter)),
    overrides: list.overrides.filter((row) => rowMatches(row, filter)),
    widgets: list.widgets.filter((row) => rowMatches(row, filter)),
    general: list.general,
  };
}
