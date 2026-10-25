import type { CellMeta, TemplateScope } from '../types';
import { cellMatches } from './select';
import {
  displayBindings,
  EMPTY_CONFIG,
  invalidBounds,
  invalidFreshness,
  validateConfig,
  type DiagramConfig,
  type Diagnostic,
  type DisplayConfig,
  type HoverSpec,
  type LinkDirection,
  type QueryBinding,
  type Widget,
} from '../model/config';
import { cellIdentityDiagnostics, cellScope } from '../adapter/portograph';
import { INVALID_FRESHNESS_TEXT } from './status';

/** The merged display of a cell: the hover of a merged display always has a rows list. */
export type MergedDisplay = Omit<DisplayConfig, 'hover'> & { hover?: HoverSpec };

export interface EffectiveCellBinding {
  cellId: string;
  scope: TemplateScope;
  display: MergedDisplay;
  patternIds: string[];
  overridden: boolean;
  /** the bindings of the display that can run for this cell: a usable query and the parameter paths it needs */
  bindings: QueryBinding[];
  /** set when nothing binds: a skipped item touched the cell, or its id is ambiguous. The reason. */
  unavailable?: string;
}
export interface PlanWidget {
  widget: Widget;
  anchorCellId: string;
  scope: TemplateScope;
  /** the index in the saved widgets list */
  index: number;
  /** set when the widget is admitted but cannot show its chart: an unusable query, an invalid range or freshness */
  unavailable?: string;
}
export interface BindingPlan {
  cells: Record<string, EffectiveCellBinding>;
  widgets: PlanWidget[];
  diagnostics: Diagnostic[];
  /** the validated, dense config: every reader of the query list reads this one, not the saved document */
  config: DiagramConfig;
}

/**
 * Called for each leaf display path that a patch writes. It records the owner at the leaf only and ends the earlier
 * owners at the leaf and below it. With `clear`, it only ends the owners below the path: a whole subtree is replaced.
 */
type Track = (path: string, clear?: boolean) => void;

function mergeFields<T extends object>(
  base: T | undefined,
  patch: T | undefined,
  track?: Track,
  path = ''
): T | undefined {
  if (patch !== undefined && track) {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        track(`${path}.${key}`);
      }
    }
  }
  return patch === undefined ? base : { ...base, ...patch };
}

function mergeSelector<T extends QueryBinding>(
  base: T | undefined,
  patch: T | undefined,
  track?: Track,
  path = ''
): T | undefined {
  if (patch !== undefined && track) {
    for (const [key, value] of Object.entries(patch)) {
      if (key !== 'match' && value !== undefined) {
        track(`${path}.${key}`);
      }
    }
  }
  return patch === undefined
    ? base
    : { ...base, ...patch, match: mergeFields(base?.match, patch.match, track, track ? `${path}.match` : '') };
}

/** One link direction: the bindings merge as selectors, the capacity is a leaf. */
function mergeDirection(
  base: LinkDirection | undefined,
  patch: LinkDirection | undefined,
  track?: Track,
  path = ''
): LinkDirection | undefined {
  if (patch === undefined) {
    return base;
  }
  if (track) {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && key !== 'binding' && key !== 'capacityBinding') {
        track(`${path}.${key}`);
      }
    }
  }
  return {
    ...base,
    ...patch,
    binding: mergeSelector(base?.binding, patch.binding, track, `${path}.binding`),
    capacityBinding: mergeSelector(base?.capacityBinding, patch.capacityBinding, track, `${path}.capacityBinding`),
  };
}

/**
 * Merge only the known nested settings. Arrays replace; changing a status kind replaces that rule.
 * With `track`, every effective path that the patch sets is reported, down to each matcher key and nested key:
 * the same granularity as the merge, from the same code.
 */
export function mergeDisplay(base: DisplayConfig, patch: DisplayConfig | undefined, track?: Track): MergedDisplay {
  if (!patch) {
    return base as MergedDisplay;
  }
  const result: DisplayConfig = { ...base, ...patch };
  if (track) {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && !['link', 'shape', 'hover', 'status'].includes(key)) {
        track(key);
      }
    }
  }
  if (patch.link) {
    const previous = base.link;
    if (track) {
      for (const [key, value] of Object.entries(patch.link)) {
        if (value !== undefined && !['a2b', 'b2a', 'capacityBinding'].includes(key)) {
          track(`link.${key}`);
        }
      }
    }
    result.link = {
      ...previous,
      ...patch.link,
      a2b: mergeDirection(previous?.a2b, patch.link.a2b, track, 'link.a2b'),
      b2a: mergeDirection(previous?.b2a, patch.link.b2a, track, 'link.b2a'),
      capacityBinding: mergeSelector(
        previous?.capacityBinding,
        patch.link.capacityBinding,
        track,
        'link.capacityBinding'
      ),
      capacity: patch.link.capacity ?? previous?.capacity,
    };
  }
  if (patch.shape) {
    if (track) {
      for (const [key, value] of Object.entries(patch.shape)) {
        if (value !== undefined && key !== 'binding') {
          track(`shape.${key}`);
        }
      }
    }
    result.shape = {
      ...base.shape,
      ...patch.shape,
      binding: mergeSelector(base.shape?.binding, patch.shape.binding, track, 'shape.binding'),
    };
  }
  if (patch.hover) {
    // An owner may set only `hover.enabled`: the merged hover always has a rows list.
    const hover = mergeFields(base.hover, patch.hover, track, 'hover')!;
    result.hover = { ...hover, rows: hover.rows ?? [] };
  }
  if (patch.status) {
    const sameKind = base.status?.kind === patch.status.kind;
    if (track) {
      // A status of another kind replaces the whole rule: clear it, then own the leaves that the patch writes.
      if (!sameKind) {
        track('status', true);
      }
      for (const [key, value] of Object.entries(patch.status)) {
        if (value !== undefined && !['binding', 'default', 'freshness'].includes(key)) {
          track(`status.${key}`);
        }
      }
      const previous = sameKind ? base.status : undefined;
      mergeSelector(previous?.binding, patch.status.binding, track, 'status.binding');
      mergeFields(previous?.default, patch.status.default, track, 'status.default');
      mergeFields(previous?.freshness, patch.status.freshness, track, 'status.freshness');
    }
    if (sameKind) {
      result.status = {
        ...base.status,
        ...patch.status,
        binding: mergeSelector(base.status!.binding, patch.status.binding)!,
        default: mergeFields(base.status!.default, patch.status.default)!,
        freshness: mergeFields(base.status!.freshness, patch.status.freshness),
      };
    }
  }
  // The schema admits JSON settings only. Clone inherited arrays/records so cells never share mutable settings.
  return JSON.parse(JSON.stringify(result)) as MergedDisplay;
}

/** Who contributes to a merged display: a pattern by its index in the config, or the override of the cell. */
export type DisplayOwner = { kind: 'pattern'; index: number } | { kind: 'override'; cellId: string };
/** The display paths that the owners set, in the order of the merge. A replacing owner ends the earlier ones below it. */
export type DisplayProvenance = Map<string, DisplayOwner[]>;

/**
 * The merge of one cell: the matching patterns in config order, then its override. The one place of this rule.
 * Without `provenance` this is the plain merge of view mode: no owner objects, no paths.
 */
export function mergeCell(
  config: DiagramConfig,
  cell: CellMeta,
  provenance?: DisplayProvenance
): { display: MergedDisplay; patternIds: string[]; override?: DiagramConfig['overrides'][number] } {
  const matching = config.patterns.filter((p) => cellMatches(p.select, cell));
  const override = config.overrides.find((o) => o.cellId === cell.id);
  let display: MergedDisplay = {};
  if (!provenance) {
    for (const p of matching) {
      display = mergeDisplay(display, p.display);
    }
    display = mergeDisplay(display, override?.display);
    return { display, override, patternIds: matching.map((p) => p.id) };
  }
  const ownerTrack =
    (owner: DisplayOwner): Track =>
    (path, clear) => {
      for (const key of Array.from(provenance.keys())) {
        if (key === path || key.startsWith(`${path}.`) || key.startsWith(`${path}[`)) {
          provenance.delete(key);
        }
      }
      if (!clear) {
        provenance.set(path, [owner]);
      }
    };
  for (const p of matching) {
    display = mergeDisplay(display, p.display, ownerTrack({ kind: 'pattern', index: config.patterns.indexOf(p) }));
  }
  if (override) {
    display = mergeDisplay(display, override.display, ownerTrack({ kind: 'override', cellId: cell.id }));
  }
  return { display, override, patternIds: matching.map((p) => p.id) };
}

/** Which owners the effective display of a cell comes from, by path. Only the editor asks for it. */
export function displayProvenance(config: DiagramConfig, cell: CellMeta): DisplayProvenance {
  const provenance: DisplayProvenance = new Map();
  mergeCell(config, cell, provenance);
  return provenance;
}

/** Path `a` is `b` or lies below it (a nested key or an array index). The one test of "below" for provenance paths. */
export const pathRelated = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || a.startsWith(`${b}[`);

/**
 * The owners behind a path: those of the path itself, of anything below it, or of an array above it. A path with no
 * owner at or under it (for example a parameter of a binding) goes to the closest ancestor that has owners.
 */
export function ownersOfPath(provenance: DisplayProvenance, path: string): DisplayOwner[] {
  const parent = (at: string) => {
    const up = at.replace(/(\.[^.[\]]*|\[\d+\])$/, '');
    return up === at ? '' : up;
  };
  for (let at = path; at; at = parent(at)) {
    const found: DisplayOwner[] = [];
    for (const [key, owners] of provenance) {
      if (pathRelated(at, key) || pathRelated(key, at)) {
        for (const owner of owners) {
          if (!found.some((x) => x.kind === owner.kind && JSON.stringify(x) === JSON.stringify(owner))) {
            found.push(owner);
          }
        }
      }
    }
    if (found.length) {
      return found;
    }
  }
  return [];
}

function activeBindings(display: DisplayConfig): ReturnType<typeof displayBindings> {
  if (display.enabled === false) {
    return [];
  }
  return displayBindings({
    ...display,
    link: display.link?.enabled === false ? undefined : display.link,
    shape: display.shape?.enabled === false ? undefined : display.shape,
    status: display.status?.enabled === false ? undefined : display.status,
    hover: display.hover?.enabled === false ? undefined : display.hover,
  });
}

/** The cell ids that `cellIdentityDiagnostics` reports: a duplicate id or a duplicate `pg-id`, with the reason. */
function ambiguousCells(cells: CellMeta[], diagnostics: Diagnostic[]): Map<string, string> {
  const ambiguous = new Map<string, string>();
  for (const d of diagnostics) {
    const at = /^cells\[(\d+)\]\.(id|key)$/.exec(d.path);
    if (!at) {
      continue;
    }
    const duplicate = cells[Number(at[1])];
    const key = at[2] as 'id' | 'key';
    for (const cell of cells) {
      if (cell[key] === duplicate[key] && !ambiguous.has(cell.id)) {
        ambiguous.set(cell.id, d.message);
      }
    }
  }
  return ambiguous;
}

/**
 * The plan of a diagram: the merged display of every cell, the bindings that can run for it, the admitted widgets.
 * `input` is the saved document: an item that does not parse is skipped and the cells it touched are unavailable;
 * a binding whose query is unknown, skipped or unusable, or whose parameter paths the cell lacks, is left out of
 * `cell.bindings` (the engine shows the consumer as unavailable). Diagnostics use the saved indices.
 */
export function resolvePatterns(cells: CellMeta[], input: unknown): BindingPlan {
  const validated = validateConfig(input);
  const plan: BindingPlan = {
    cells: Object.create(null),
    widgets: [],
    diagnostics: [...validated.diagnostics],
    config: validated.config ?? EMPTY_CONFIG,
  };
  const identity = cellIdentityDiagnostics(cells);
  plan.diagnostics.push(...identity);
  if (!validated.config) {
    return plan;
  }
  const config = validated.config;
  const { indices } = validated;

  // the cells that nothing may bind, with the first reason
  const unavailable = ambiguousCells(cells, identity);
  const mark = (cellId: string, reason: string) => {
    if (!unavailable.has(cellId)) {
      unavailable.set(cellId, reason);
    }
  };
  for (const item of validated.skippedItems) {
    if (item.section === 'patterns') {
      const reason = `${item.title} is not applied`;
      if (item.select) {
        const select = item.select;
        const matched = cells.filter((cell) => cellMatches(select, cell));
        matched.forEach((cell) => mark(cell.id, reason));
        plan.diagnostics.push({
          code: 'skipped-cells',
          path: `patterns[${item.index}]`,
          message: `${matched.length} cell${matched.length === 1 ? '' : 's'} unavailable: ${reason}.`,
        });
      } else {
        // the match set is unknown: every cell is unavailable
        cells.forEach((cell) => mark(cell.id, reason));
        plan.diagnostics.push({
          code: 'skipped-cells',
          path: `patterns[${item.index}].select`,
          message: `Every cell is unavailable: ${reason} and its selector does not parse.`,
        });
      }
    } else if (item.section === 'overrides' && item.cellId !== undefined) {
      mark(item.cellId, `${item.title} is not applied`);
    }
  }

  const queries = new Map(config.queries.map((query) => [query.id, query]));
  /** why a binding cannot run for any cell: no such query, a skipped query, an unusable query */
  const queryProblem = (binding: QueryBinding): string | undefined => {
    const reason = validated.unusableQueries.get(binding.queryId);
    if (reason !== undefined) {
      return `Query ${binding.queryId} cannot run: ${reason}.`;
    }
    if (!queries.has(binding.queryId)) {
      const diagnostic = validated.diagnostics.find(
        (d) => d.code === 'unknown-query' && d.message.startsWith(`Query ${binding.queryId} `)
      );
      return diagnostic?.message ?? `Query ${binding.queryId} does not exist.`;
    }
    return undefined;
  };
  const parameters = (binding: QueryBinding, scope: TemplateScope, path: string) => {
    const source = queries.get(binding.queryId)?.source;
    if (source?.kind !== 'datasource') {
      return true;
    }
    let valid = true;
    for (const [name, scopePath] of Object.entries(source.parameters)) {
      const [root, key] = scopePath.split('.') as ['cell' | 'from' | 'to', string];
      const values = scope[root];
      if (!values || !Object.prototype.hasOwnProperty.call(values, key) || typeof values[key] !== 'string') {
        valid = false;
        plan.diagnostics.push({
          code: 'missing-parameter-path',
          path: `${path}.parameters.${name}`,
          message: `Query ${binding.queryId} requires ${scopePath}. Add this metadata to the element or change parameter ${name}.`,
        });
      }
    }
    return valid;
  };
  /** true when the binding can run for the cell; else the reason is reported at `path` */
  const usable = (binding: QueryBinding, scope: TemplateScope, path: string): boolean => {
    const problem = queryProblem(binding);
    if (problem !== undefined) {
      plan.diagnostics.push({ code: 'unknown-query', path: `${path}.queryId`, message: problem });
      return false;
    }
    return parameters(binding, scope, path);
  };
  for (const cell of cells) {
    const { display, override, patternIds } = mergeCell(config, cell);
    const scope = cellScope(cell);
    const reason = unavailable.get(cell.id);
    const bindings =
      reason === undefined
        ? activeBindings(display).filter(({ binding, path }) => usable(binding, scope, `cells.${cell.id}.${path}`))
        : [];
    plan.cells[cell.id] = {
      cellId: cell.id,
      scope,
      display,
      patternIds,
      overridden: !!override,
      bindings: bindings.map(({ binding }) => binding),
      ...(reason === undefined ? {} : { unavailable: reason }),
    };
  }
  config.overrides.forEach((override, j) => {
    if (!plan.cells[override.cellId]) {
      plan.diagnostics.push({
        code: 'missing-cell',
        path: `overrides[${indices.overrides[j]}].cellId`,
        message: `Override refers to missing cell ${override.cellId}. Select an existing cell or remove the override.`,
      });
    }
  });
  config.widgets.forEach((widget, j) => {
    const index = indices.widgets[j];
    const anchor = plan.cells[widget.anchorCellId];
    if (!anchor) {
      plan.diagnostics.push({
        code: 'missing-anchor',
        path: `widgets[${index}].anchorCellId`,
        message: `Widget ${widget.id} needs anchor ${widget.anchorCellId}.`,
      });
      return;
    }
    // a widget with a problem is admitted with the reason: the chart layer shows the text instead of the chart
    const problem = queryProblem(widget.binding);
    const admitted: PlanWidget = { widget, anchorCellId: anchor.cellId, scope: anchor.scope, index };
    if (problem !== undefined) {
      plan.diagnostics.push({ code: 'unknown-query', path: `widgets[${index}].binding.queryId`, message: problem });
      admitted.unavailable = problem;
    } else if (!parameters(widget.binding, anchor.scope, `widgets[${index}].binding`)) {
      admitted.unavailable = 'Binding metadata is unavailable';
    } else if (invalidBounds(widget.min, widget.max)) {
      admitted.unavailable = 'Invalid range';
    } else if (invalidFreshness(widget.freshness)) {
      admitted.unavailable = INVALID_FRESHNESS_TEXT;
    }
    plan.widgets.push(admitted);
  });
  return plan;
}
