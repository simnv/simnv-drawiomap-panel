import { displayBindings, type DiagramConfigV2, type Diagnostic, type DisplayConfig } from '../model/config';
import { cellMatches } from '../binding/select';
import type { CellMeta } from '../types';

/** One problem of a list row. A per-cell diagnostic of a shared pattern keeps its cell id. */
export interface RowProblem {
  code: string;
  message: string;
  cellId?: string;
}
interface RowBase {
  /** stable key of the row */
  key: string;
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
}
export interface OverrideRow extends RowBase {
  kind: 'override';
  cellId: string;
  label: string;
  /** the display keys that the override sets */
  keys: string[];
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
}

const unique = <T>(items: T[]): T[] => Array.from(new Set(items));

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
  const patternMatches = config.patterns.map((p) => cells.filter((c) => cellMatches(p.select, c)).map((c) => c.id));
  const patterns: PatternRow[] = config.patterns.map((p, i) => ({
    kind: 'pattern',
    key: `pattern:${p.id}`,
    patternId: p.id,
    name: p.name,
    selector: p.select.kind ?? 'any',
    queryIds: unique(displayBindings(p.display).map(({ binding }) => binding.queryId)),
    matched: patternMatches[i],
    problems: [],
  }));
  const overrides: OverrideRow[] = config.overrides.map((o) => ({
    kind: 'override',
    key: `override:${o.cellId}`,
    cellId: o.cellId,
    label: byId.get(o.cellId)?.labelText ?? '',
    keys: Object.entries(o.display)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key),
    exists: byId.has(o.cellId),
    problems: [],
  }));
  const widgets: WidgetRow[] = config.widgets.map((w) => ({
    kind: 'widget',
    key: `widget:${w.id}`,
    widgetId: w.id,
    label: w.label,
    widgetKind: w.kind,
    anchorCellId: w.anchorCellId,
    queryId: w.binding.queryId,
    exists: byId.has(w.anchorCellId),
    problems: [],
  }));

  const seen = new Set<string>();
  const add = (row: BindingRow | undefined, problem: RowProblem) => {
    const id = `${row?.key}|${problem.code}|${problem.cellId ?? ''}|${problem.message}`;
    if (row && !seen.has(id)) {
      seen.add(id);
      row.problems.push(problem);
    }
  };
  const indexed = (path: string, section: string) => {
    const match = new RegExp(`^${section}\\[(\\d+)\\]`).exec(path);
    return match ? Number(match[1]) : undefined;
  };
  for (const d of diagnostics) {
    const problem = { code: d.code, message: d.message };
    const p = indexed(d.path, 'patterns');
    const o = indexed(d.path, 'overrides');
    const w = indexed(d.path, 'widgets');
    if (p !== undefined) {
      add(patterns[p], problem);
    } else if (o !== undefined) {
      add(overrides[o], problem);
    } else if (w !== undefined) {
      add(widgets[w], problem);
    } else {
      const hit = cellOfPath(d.path, ids);
      if (!hit) {
        continue;
      }
      // Blame the owners of the display section the diagnostic came from: the patterns that match the cell and
      // the override of the cell. When none of them sets the section, the merge is the cause: blame all of them.
      const section = hit.rest.split(/[.[]/)[0] as keyof DisplayConfig;
      const matching = patterns.filter((_, i) => patternMatches[i].includes(hit.cellId));
      const override = overrides.find((row) => row.cellId === hit.cellId);
      const owners: BindingRow[] = [
        ...matching.filter(
          (row) => config.patterns.find((x) => x.id === row.patternId)?.display[section] !== undefined
        ),
        ...(override && config.overrides.find((x) => x.cellId === hit.cellId)?.display[section] !== undefined
          ? [override]
          : []),
      ];
      for (const row of owners.length ? owners : [...matching, ...(override ? [override] : [])]) {
        add(row, { ...problem, cellId: hit.cellId });
      }
    }
  }
  // Problems that the diagram alone shows. The engine reports the missing ones too, but not while the config is invalid.
  if (cells.length > 0) {
    for (const row of patterns) {
      if (!row.matched.length) {
        add(row, { code: 'no-match', message: 'The selector matches no element of the diagram.' });
      }
    }
    for (const row of overrides) {
      if (!row.exists) {
        add(row, {
          code: 'missing-cell',
          message: `Override refers to missing cell ${row.cellId}. Select an existing cell or remove the override.`,
        });
      }
    }
    for (const row of widgets) {
      if (!row.exists) {
        add(row, { code: 'missing-anchor', message: `Widget ${row.widgetId} needs anchor ${row.anchorCellId}.` });
      }
    }
  }
  return { patterns, overrides, widgets };
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
      ? [row.name, row.patternId, row.selector, ...row.queryIds, ...row.matched]
      : row.kind === 'override'
        ? [row.cellId, row.label, ...row.keys]
        : [row.label, row.widgetId, row.anchorCellId, row.queryId];
  return haystack.some((text) => text.toLowerCase().includes(needle));
}

export function filterBindings(list: BindingsList, filter: BindingsFilter): BindingsList {
  return {
    patterns: list.patterns.filter((row) => rowMatches(row, filter)),
    overrides: list.overrides.filter((row) => rowMatches(row, filter)),
    widgets: list.widgets.filter((row) => rowMatches(row, filter)),
  };
}
