import {
  validateConfig,
  type Diagnostic,
  type DiagramConfigV2,
  type DisplayConfig,
  type NamedQuery,
  type Pattern,
  type Widget,
} from '../model/config';
import type { CellSelector } from '../types';

export const EMPTY_CONFIG: DiagramConfigV2 = { version: 2, queries: [], patterns: [], overrides: [], widgets: [] };
export interface BindingDraft {
  saved: DiagramConfigV2;
  config: DiagramConfigV2;
  cellId?: string;
  scope: 'element' | 'pattern';
  patternId?: string;
  diagnostics: Diagnostic[];
}
export type DraftAction =
  | { type: 'select'; cellId: string }
  | { type: 'scope'; scope: 'element' | 'pattern'; patternId?: string }
  | { type: 'display'; display: Partial<DisplayConfig> }
  | { type: 'query'; query: NamedQuery }
  | { type: 'default-datasource'; datasource: DiagramConfigV2['defaultDatasource'] }
  | { type: 'pattern'; pattern: Pattern }
  | { type: 'selector'; select: CellSelector }
  | { type: 'widget'; widget: Widget }
  | { type: 'remove-widget'; id: string }
  | { type: 'import'; config: unknown }
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
export function createDraft(config: DiagramConfigV2): BindingDraft {
  return { saved: copy(config), config: copy(config), scope: 'element', diagnostics: [] };
}
export function reduceDraft(draft: BindingDraft, action: DraftAction): BindingDraft {
  if (action.type === 'select') {
    return { ...draft, cellId: action.cellId, scope: 'element', patternId: undefined };
  }
  if (action.type === 'scope') {
    return { ...draft, scope: action.scope, patternId: action.patternId };
  }
  if (action.type === 'reset') {
    return { ...draft, config: copy(draft.saved), diagnostics: [] };
  }
  if (action.type === 'applied') {
    return { ...draft, saved: commitDraft(draft), diagnostics: [] };
  }
  let config = draft.config;
  if (action.type === 'import') {
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
      if (!config.patterns.some((p) => p.id === draft.patternId)) {
        return draft;
      }
      config = {
        ...config,
        patterns: config.patterns.map((p) =>
          p.id === draft.patternId ? { ...p, display: changeDisplay(p.display, action.display) } : p
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
      patterns: config.patterns.map((p) => (p.id === draft.patternId ? { ...p, select: copy(action.select) } : p)),
    };
  } else if (action.type === 'widget') {
    config = { ...config, widgets: [...config.widgets.filter((w) => w.id !== action.widget.id), copy(action.widget)] };
  } else if (action.type === 'remove-widget') {
    config = { ...config, widgets: config.widgets.filter((w) => w.id !== action.id) };
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
