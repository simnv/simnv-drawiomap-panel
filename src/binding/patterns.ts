import type { CellMeta, SeriesSelector, TemplateScope } from '../types';
import { cellMatches } from './select';
import {
  displayBindings,
  validateConfig,
  type DiagramConfigV2,
  type Diagnostic,
  type DisplayConfig,
  type QueryBinding,
  type Widget,
} from '../model/config';
import { cellIdentityDiagnostics, cellScope } from '../adapter/portograph';

export interface EffectiveCellBinding {
  cellId: string;
  scope: TemplateScope;
  display: DisplayConfig;
  patternIds: string[];
  overridden: boolean;
  bindings: QueryBinding[];
}
export interface BindingPlan {
  cells: Record<string, EffectiveCellBinding>;
  widgets: Array<{
    widget: Widget;
    anchorCellId: string;
    scope: TemplateScope;
    /** index in config.widgets */ index: number;
  }>;
  diagnostics: Diagnostic[];
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

function mergeSelector<T extends SeriesSelector | QueryBinding>(
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

const LINK_SELECTORS = [
  'a2b',
  'b2a',
  'a2bBinding',
  'b2aBinding',
  'capacityBinding',
  'capacityA2bBinding',
  'capacityB2aBinding',
] as const;

/**
 * Merge only the known nested settings. Arrays replace; changing a status kind replaces that rule.
 * With `track`, every effective path that the patch sets is reported, down to each matcher key and nested key:
 * the same granularity as the merge, from the same code.
 */
export function mergeDisplay(base: DisplayConfig, patch: DisplayConfig | undefined, track?: Track): DisplayConfig {
  if (!patch) {
    return base;
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
        const handled =
          (LINK_SELECTORS as readonly string[]).includes(key) ||
          key === 'card' ||
          (key === 'capacity' && typeof value === 'object');
        if (value !== undefined && !handled) {
          track(`link.${key}`);
        }
      }
    }
    result.link = {
      ...previous,
      ...patch.link,
      a2b: mergeSelector(previous?.a2b, patch.link.a2b, track, 'link.a2b'),
      b2a: mergeSelector(previous?.b2a, patch.link.b2a, track, 'link.b2a'),
      a2bBinding: mergeSelector(previous?.a2bBinding, patch.link.a2bBinding, track, 'link.a2bBinding'),
      b2aBinding: mergeSelector(previous?.b2aBinding, patch.link.b2aBinding, track, 'link.b2aBinding'),
      capacityBinding: mergeSelector(
        previous?.capacityBinding,
        patch.link.capacityBinding,
        track,
        'link.capacityBinding'
      ),
      capacityA2bBinding: mergeSelector(
        previous?.capacityA2bBinding,
        patch.link.capacityA2bBinding,
        track,
        'link.capacityA2bBinding'
      ),
      capacityB2aBinding: mergeSelector(
        previous?.capacityB2aBinding,
        patch.link.capacityB2aBinding,
        track,
        'link.capacityB2aBinding'
      ),
      capacity:
        typeof patch.link.capacity === 'object'
          ? mergeSelector(
              typeof previous?.capacity === 'object' ? previous.capacity : undefined,
              patch.link.capacity,
              track,
              'link.capacity'
            )
          : (patch.link.capacity ?? previous?.capacity),
      card: mergeFields(previous?.card, patch.link.card, track, 'link.card'),
    };
  }
  if (patch.shape) {
    if (track) {
      for (const [key, value] of Object.entries(patch.shape)) {
        if (value !== undefined && !['series', 'binding', 'sparkline'].includes(key)) {
          track(`shape.${key}`);
        }
      }
    }
    result.shape = {
      ...base.shape,
      ...patch.shape,
      series: mergeSelector(base.shape?.series, patch.shape.series, track, 'shape.series'),
      binding: mergeSelector(base.shape?.binding, patch.shape.binding, track, 'shape.binding'),
      sparkline: mergeSelector(base.shape?.sparkline, patch.shape.sparkline, track, 'shape.sparkline'),
    };
  }
  if (patch.hover) {
    result.hover = mergeFields(base.hover, patch.hover, track, 'hover');
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
  return JSON.parse(JSON.stringify(result));
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
  config: DiagramConfigV2,
  cell: CellMeta,
  provenance?: DisplayProvenance
): { display: DisplayConfig; patternIds: string[]; override?: DiagramConfigV2['overrides'][number] } {
  const matching = config.patterns.filter((p) => cellMatches(p.select, cell));
  const override = config.overrides.find((o) => o.cellId === cell.id);
  let display: DisplayConfig = {};
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
export function displayProvenance(config: DiagramConfigV2, cell: CellMeta): DisplayProvenance {
  const provenance: DisplayProvenance = new Map();
  mergeCell(config, cell, provenance);
  return provenance;
}

/**
 * The owners behind a path: those of the path itself, of anything below it, or of an array above it. A path with no
 * owner at or under it (for example a parameter of a binding) goes to the closest ancestor that has owners.
 */
export function ownersOfPath(provenance: DisplayProvenance, path: string): DisplayOwner[] {
  const related = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || a.startsWith(`${b}[`);
  const parent = (at: string) => {
    const up = at.replace(/(\.[^.[\]]*|\[\d+\])$/, '');
    return up === at ? '' : up;
  };
  for (let at = path; at; at = parent(at)) {
    const found: DisplayOwner[] = [];
    for (const [key, owners] of provenance) {
      if (related(at, key) || related(key, at)) {
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

export function resolvePatterns(cells: CellMeta[], input: DiagramConfigV2): BindingPlan {
  const plan: BindingPlan = { cells: Object.create(null), widgets: [], diagnostics: [] };
  const validated = validateConfig(input);
  plan.diagnostics.push(...validated.diagnostics, ...cellIdentityDiagnostics(cells));
  if (!validated.config || plan.diagnostics.length) {
    return plan;
  }
  const config = validated.config;
  const queries = new Map(config.queries.map((query) => [query.id, query]));
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
  for (const cell of cells) {
    const { display, override, patternIds } = mergeCell(config, cell);
    const scope = cellScope(cell);
    const bindings = activeBindings(display).filter(({ binding, path }) =>
      parameters(binding, scope, `cells.${cell.id}.${path}`)
    );
    plan.cells[cell.id] = {
      cellId: cell.id,
      scope,
      display,
      patternIds,
      overridden: !!override,
      bindings: bindings.map(({ binding }) => binding),
    };
  }
  config.overrides.forEach((override, i) => {
    if (!plan.cells[override.cellId]) {
      plan.diagnostics.push({
        code: 'missing-cell',
        path: `overrides[${i}].cellId`,
        message: `Override refers to missing cell ${override.cellId}. Select an existing cell or remove the override.`,
      });
    }
  });
  config.widgets.forEach((widget, i) => {
    const anchor = plan.cells[widget.anchorCellId];
    if (!anchor) {
      plan.diagnostics.push({
        code: 'missing-anchor',
        path: `widgets[${i}].anchorCellId`,
        message: `Widget ${widget.id} needs anchor ${widget.anchorCellId}.`,
      });
    } else if (parameters(widget.binding, anchor.scope, `widgets[${i}].binding`)) {
      plan.widgets.push({ widget, anchorCellId: anchor.cellId, scope: anchor.scope, index: i });
    }
  });
  return plan;
}
