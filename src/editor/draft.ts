import {
  validateConfig,
  type Diagnostic,
  type DiagramConfigV2,
  type DisplayConfig,
  type NamedQuery,
  type Pattern,
  type Widget,
} from '../model/config';
import type { CellSelector, Diagram } from '../types';
import { previewPatternImport, type ImportResolution } from './portable';
export { exportPatternDocument, previewPatternImport } from './portable';

export const EMPTY_CONFIG: DiagramConfigV2 = { version: 2, queries: [], patterns: [], overrides: [], widgets: [] };
export interface BindingDraft {
  saved: DiagramConfigV2;
  config: DiagramConfigV2;
  cellId?: string;
  scope: 'element' | 'pattern';
  patternId?: string;
  /** The exact pattern when pattern IDs collide; the ID alone is ambiguous then. */
  patternIndex?: number;
  diagnostics: Diagnostic[];
  /** The diagram of the draft. A geometry save in draw.io changes it. */
  diagram?: Diagram;
  /** The diagram of the last Apply, or the one the draft started with. */
  savedDiagram?: Diagram;
}
export type DraftAction =
  | { type: 'select'; cellId: string }
  | { type: 'scope'; scope: 'element' | 'pattern'; patternId?: string; patternIndex?: number }
  | { type: 'display'; display: Partial<DisplayConfig> }
  /** Remove a path from the display of the edited owner (the cell override or the edited pattern). */
  | { type: 'unset'; path: string }
  | { type: 'query'; query: NamedQuery }
  | { type: 'default-datasource'; datasource: DiagramConfigV2['defaultDatasource'] }
  | { type: 'pattern'; pattern: Pattern }
  | { type: 'selector'; select: CellSelector }
  | { type: 'widget'; widget: Widget }
  | { type: 'remove-widget'; id: string }
  /** Remove a named query. Bindings that still use it get a diagnostic. */
  | { type: 'remove-query'; id: string }
  | { type: 'remove-override'; cellId: string }
  | { type: 'import'; config: unknown }
  | { type: 'import-patterns'; document: unknown; cellIds: string[]; resolution: ImportResolution }
  | { type: 'diagram'; diagram: Diagram }
  | { type: 'reset' | 'applied' };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function changeDisplay(base: Partial<DisplayConfig>, patch: Partial<DisplayConfig>): DisplayConfig {
  return copy({
    ...base,
    ...patch,
    ...(patch.shape ? { shape: { ...base.shape, ...patch.shape } } : {}),
    ...(patch.link ? { link: { ...base.link, ...patch.link } } : {}),
  });
}
/** True for a value that holds nothing: an object without keys (not an array). */
const isEmptyObject = (value: unknown) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;

/**
 * The display without `path` (dotted keys, no indexes). Objects that become empty go away with it. A hover without
 * rows is not valid, so removing `hover.rows` removes the whole hover.
 */
export function unsetPath<T extends Partial<DisplayConfig>>(display: T, path: string): T {
  const keys = path === 'hover.rows' ? ['hover'] : path.split('.');
  const next = copy(display) as Record<string, unknown>;
  const trail: Array<Record<string, unknown>> = [next];
  for (const key of keys.slice(0, -1)) {
    const child = trail[trail.length - 1][key];
    if (typeof child !== 'object' || child === null || Array.isArray(child)) {
      return display;
    }
    trail.push(child as Record<string, unknown>);
  }
  const leaf = keys[keys.length - 1];
  if (!(leaf in trail[trail.length - 1])) {
    return display;
  }
  delete trail[trail.length - 1][leaf];
  for (let i = trail.length - 1; i > 0; i--) {
    if (!isEmptyObject(trail[i])) {
      break;
    }
    delete trail[i - 1][keys[i - 1]];
  }
  return next as T;
}

/** The index of the pattern that the draft edits. It honours the exact index while that pattern still has the ID. */
export function draftPatternIndex(draft: Pick<BindingDraft, 'config' | 'patternId' | 'patternIndex'>): number {
  const { patterns } = draft.config;
  return draft.patternIndex !== undefined && patterns[draft.patternIndex]?.id === draft.patternId
    ? draft.patternIndex
    : patterns.findIndex((p) => p.id === draft.patternId);
}
export function createDraft(config: DiagramConfigV2, diagram?: Diagram): BindingDraft {
  return {
    saved: copy(config),
    config: copy(config),
    scope: 'element',
    diagnostics: [],
    diagram,
    savedDiagram: diagram,
  };
}
/** True when the config or the diagram differs from the last saved state. */
export function isDirty(draft: BindingDraft): boolean {
  return (
    JSON.stringify(draft.config) !== JSON.stringify(draft.saved) || draft.diagram?.hash !== draft.savedDiagram?.hash
  );
}
export function reduceDraft(draft: BindingDraft, action: DraftAction): BindingDraft {
  if (action.type === 'select') {
    return { ...draft, cellId: action.cellId, scope: 'element', patternId: undefined, patternIndex: undefined };
  }
  if (action.type === 'scope') {
    return { ...draft, scope: action.scope, patternId: action.patternId, patternIndex: action.patternIndex };
  }
  if (action.type === 'reset') {
    return { ...draft, config: copy(draft.saved), diagram: draft.savedDiagram, diagnostics: [] };
  }
  if (action.type === 'applied') {
    // The committed config is the normalised one. The draft takes it, so that the draft is not dirty after Apply.
    const saved = commitDraft(draft);
    return { ...draft, saved, config: copy(saved), savedDiagram: draft.diagram, diagnostics: [] };
  }
  if (action.type === 'diagram') {
    return { ...draft, diagram: action.diagram };
  }
  let config = draft.config;
  if (action.type === 'import-patterns') {
    const preview = previewPatternImport(config, action.document, action.cellIds, action.resolution);
    return preview.config
      ? { ...draft, config: preview.config, diagnostics: [] }
      : { ...draft, diagnostics: preview.diagnostics };
  } else if (action.type === 'import') {
    const result = validateConfig(action.config);
    if (!result.config) {
      return { ...draft, diagnostics: result.diagnostics };
    }
    const incoming = result.config;
    const diagnostics: Diagnostic[] = [];
    for (const section of ['queries', 'patterns', 'widgets'] as const) {
      for (const item of incoming[section]) {
        if (config[section].some((old) => old.id === item.id)) {
          diagnostics.push({
            code: `import-${section === 'patterns' ? 'pattern' : section === 'queries' ? 'query' : 'widget'}-conflict`,
            path: section,
            message: `Import conflict: ${item.id} already exists. Choose a new identity or replace it explicitly.`,
          });
        }
      }
    }
    for (const override of incoming.overrides) {
      if (config.overrides.some((old) => old.cellId === override.cellId)) {
        diagnostics.push({
          code: 'import-override-conflict',
          path: 'overrides',
          message: `Import conflict: override for ${override.cellId} already exists.`,
        });
      }
    }
    if (diagnostics.length) {
      return { ...draft, diagnostics };
    }
    config = {
      ...config,
      queries: [...config.queries, ...incoming.queries],
      patterns: [...config.patterns, ...incoming.patterns],
      overrides: [...config.overrides, ...incoming.overrides],
      widgets: [...config.widgets, ...incoming.widgets],
    };
  } else if (action.type === 'display') {
    if (draft.scope === 'pattern') {
      const at = draftPatternIndex(draft);
      if (at < 0) {
        return draft;
      }
      config = {
        ...config,
        patterns: config.patterns.map((p, i) =>
          i === at ? { ...p, display: changeDisplay(p.display, action.display) } : p
        ),
      };
    } else {
      if (!draft.cellId) {
        return draft;
      }
      const old = config.overrides.find((o) => o.cellId === draft.cellId);
      config = {
        ...config,
        overrides: [
          ...config.overrides.filter((o) => o.cellId !== draft.cellId),
          { cellId: draft.cellId, display: changeDisplay(old?.display ?? {}, action.display) },
        ],
      };
    }
  } else if (action.type === 'unset') {
    if (draft.scope === 'pattern') {
      const at = draftPatternIndex(draft);
      const display = config.patterns[at]?.display;
      const next = display && unsetPath(display, action.path);
      if (!next || next === display) {
        return draft;
      }
      config = { ...config, patterns: config.patterns.map((p, i) => (i === at ? { ...p, display: next } : p)) };
    } else {
      const old = config.overrides.find((o) => o.cellId === draft.cellId);
      const next = old && unsetPath(old.display, action.path);
      if (!old || !next || next === old.display) {
        return draft;
      }
      // An override that holds nothing any more goes away.
      config = {
        ...config,
        overrides: Object.keys(next).length
          ? config.overrides.map((o) => (o === old ? { ...o, display: next } : o))
          : config.overrides.filter((o) => o !== old),
      };
    }
  } else if (action.type === 'query') {
    const validated = validateConfig({
      ...EMPTY_CONFIG,
      defaultDatasource: config.defaultDatasource,
      queries: [action.query],
    });
    // Retain invalid native values for diagnostics instead of silently normalizing them through JSON.
    const query = validated.config?.queries[0] ?? action.query;
    config = {
      ...config,
      queries: config.queries.some((q) => q.id === query.id)
        ? config.queries.map((q) => (q.id === query.id ? query : q))
        : [...config.queries, query],
    };
  } else if (action.type === 'default-datasource') {
    config = { ...config, defaultDatasource: action.datasource };
  } else if (action.type === 'pattern') {
    config = {
      ...config,
      patterns: config.patterns.some((p) => p.id === action.pattern.id)
        ? config.patterns.map((p) => (p.id === action.pattern.id ? copy(action.pattern) : p))
        : [...config.patterns, copy(action.pattern)],
    };
  } else if (action.type === 'selector') {
    config = {
      ...config,
      patterns: config.patterns.map((p, i) =>
        i === draftPatternIndex(draft) ? { ...p, select: copy(action.select) } : p
      ),
    };
  } else if (action.type === 'widget') {
    config = { ...config, widgets: [...config.widgets.filter((w) => w.id !== action.widget.id), copy(action.widget)] };
  } else if (action.type === 'remove-query') {
    config = { ...config, queries: config.queries.filter((q) => q.id !== action.id) };
  } else if (action.type === 'remove-widget') {
    config = { ...config, widgets: config.widgets.filter((w) => w.id !== action.id) };
  } else if (action.type === 'remove-override') {
    config = { ...config, overrides: config.overrides.filter((o) => o.cellId !== action.cellId) };
  }
  return { ...draft, config, diagnostics: [] };
}
export function commitDraft(draft: BindingDraft): DiagramConfigV2 {
  const result = validateConfig(draft.config);
  const diagnostics = [...draft.diagnostics, ...result.diagnostics];
  if (!result.config || diagnostics.length) {
    throw new Error(diagnostics.map((d) => d.message).join('\n'));
  }
  return result.config;
}
