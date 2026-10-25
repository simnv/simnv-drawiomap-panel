import {
  displayBindings,
  emptyEntriesNote,
  validateConfig,
  withoutEmptyEntries,
  type Diagnostic,
  type DiagramConfig,
  type QueryDatasourceRef,
} from '../model/config';

export interface PatternDocument {
  kind: 'drawiomap-patterns';
  version: 1;
  config: DiagramConfig;
}
type Section = 'queries' | 'patterns' | 'widgets';
export type ImportDecision = { action: 'replace' } | { action: 'new'; id: string };
export interface ImportResolution {
  queries?: Record<string, ImportDecision>;
  patterns?: Record<string, ImportDecision>;
  widgets?: Record<string, ImportDecision>;
  overrides?: Record<string, string | null>;
  anchors?: Record<string, string>;
}
export interface PatternImportPreview {
  config?: DiagramConfig;
  diagnostics: Diagnostic[];
  /** What the import changed without a failure: the empty entries it dropped. */
  notes: Diagnostic[];
  conflicts: Array<{ section: Section; id: string }>;
  overrides: Array<{ cellId: string; applies: boolean; conflict: boolean }>;
  anchors: Array<{ cellId: string; applies: boolean }>;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const isLists = (value: unknown): value is Record<'queries' | 'patterns' | 'overrides' | 'widgets', unknown[]> =>
  !!value &&
  typeof value === 'object' &&
  (['queries', 'patterns', 'overrides', 'widgets'] as const).every((k) =>
    Array.isArray((value as Record<string, unknown>)[k])
  );
/** The datasource of a query from a reference: a reference without a uid names none. */
const refOf = (ref: DiagramConfig['defaultDatasource']): QueryDatasourceRef | undefined =>
  ref?.uid ? { uid: ref.uid, ...(ref.type ? { type: ref.type } : {}) } : undefined;
/** A clean config: it parses and has no diagnostic. A portable document carries nothing else. */
function checked(input: unknown): DiagramConfig {
  const result = validateConfig(input);
  if (!result.config || result.diagnostics.length) {
    throw new Error(result.diagnostics.map((d) => `${d.path}: ${d.message}`).join('\n'));
  }
  return result.config;
}

/** A portable document carries the datasource context of every referenced native definition. */
export function exportPatternDocument(config: DiagramConfig): PatternDocument {
  const value = checked(config);
  const referenced = new Set([
    ...[...value.patterns, ...value.overrides].flatMap((p) => displayBindings(p.display).map((b) => b.binding.queryId)),
    ...value.widgets.map((w) => w.binding.queryId),
  ]);
  value.queries = value.queries
    .filter((q) => referenced.has(q.id))
    .map((query) =>
      query.source.kind === 'datasource'
        ? {
            ...query,
            source: { ...query.source, datasource: query.source.datasource ?? refOf(value.defaultDatasource) },
          }
        : query
    );
  return { kind: 'drawiomap-patterns', version: 1, config: checked(value) };
}

/** Preparing an import performs no I/O and never mutates the destination. */
export function previewPatternImport(
  destination: DiagramConfig,
  input: unknown,
  cellIds: string[],
  resolution: ImportResolution = {}
): PatternImportPreview {
  const preview: PatternImportPreview = { diagnostics: [], notes: [], conflicts: [], overrides: [], anchors: [] };
  const error = (code: string, path: string, message: string) => preview.diagnostics.push({ code, path, message });
  if (
    !input ||
    typeof input !== 'object' ||
    !('kind' in input) ||
    input.kind !== 'drawiomap-patterns' ||
    !('version' in input) ||
    input.version !== 1 ||
    !('config' in input) ||
    Object.keys(input).some((key) => !['kind', 'version', 'config'].includes(key))
  ) {
    error('invalid-pattern-document', '(root)', 'Expected a drawiomap-patterns document with version 1.');
    return preview;
  }
  const source = isLists(input.config) ? withoutEmptyEntries(input.config) : { config: input.config, removed: 0 };
  const result = validateConfig(source.config);
  if (!result.config || result.diagnostics.length) {
    return { ...preview, diagnostics: result.diagnostics };
  }
  if (source.removed) {
    preview.notes.push(emptyEntriesNote(source.removed));
  }
  const incoming = result.config;
  const config = withoutEmptyEntries(copy(destination)).config;
  incoming.queries = incoming.queries.map((q) =>
    q.source.kind === 'datasource'
      ? { ...q, source: { ...q.source, datasource: q.source.datasource ?? refOf(incoming.defaultDatasource) } }
      : q
  );
  const queryIds = new Map<string, string>();
  for (const section of ['queries', 'patterns', 'widgets'] as const) {
    const identities = new Set<string>();
    for (const item of incoming[section]) {
      const id = item.id;
      const conflict = config[section].some((old) => old.id === id);
      const choice = Object.hasOwn(resolution[section] ?? {}, id) ? resolution[section]![id] : undefined;
      if (conflict) {
        preview.conflicts.push({ section, id });
        if (!choice) {
          error('import-conflict', `${section}.${id}`, `Choose replace or a new identity for ${section} ${id}.`);
        }
      }
      const nextId = choice?.action === 'new' ? choice.id : id;
      if (identities.has(nextId) || (choice?.action === 'new' && config[section].some((old) => old.id === nextId))) {
        error('import-identity-conflict', `${section}.${id}`, `New identity ${nextId} is already used in ${section}.`);
      }
      identities.add(nextId);
      item.id = nextId;
      if (section === 'queries') {
        queryIds.set(id, nextId);
      }
    }
  }
  for (const display of [...incoming.patterns, ...incoming.overrides].map((p) => p.display)) {
    for (const { binding } of displayBindings(display)) {
      binding.queryId = queryIds.get(binding.queryId)!;
    }
  }
  const anchorIds = new Set(incoming.widgets.map((w) => w.anchorCellId));
  preview.anchors = Array.from(anchorIds, (cellId) => ({ cellId, applies: cellIds.includes(cellId) }));
  for (const widget of incoming.widgets) {
    widget.binding.queryId = queryIds.get(widget.binding.queryId)!;
    if (Object.hasOwn(resolution.anchors ?? {}, widget.anchorCellId)) {
      widget.anchorCellId = resolution.anchors![widget.anchorCellId];
    }
    if (!cellIds.includes(widget.anchorCellId)) {
      error(
        'missing-anchor',
        `widgets.${widget.id}.anchorCellId`,
        `Choose an existing chart anchor for ${widget.anchorCellId}.`
      );
    }
  }
  const overrideIds = new Set<string>();
  incoming.overrides = incoming.overrides.flatMap((override) => {
    const cellId = override.cellId;
    const applies = cellIds.includes(cellId);
    const conflict = config.overrides.some((old) => old.cellId === cellId);
    preview.overrides.push({ cellId, applies, conflict });
    const explicit = Object.hasOwn(resolution.overrides ?? {}, cellId);
    const target = explicit ? resolution.overrides![cellId] : cellId;
    if (target === null) {
      return [];
    }
    if (!cellIds.includes(target) || (conflict && !explicit)) {
      error(
        'import-override-conflict',
        `overrides.${cellId}`,
        `Choose an existing element or skip override ${cellId}; selecting its current identity replaces it.`
      );
    }
    if (overrideIds.has(target)) {
      error('import-override-conflict', `overrides.${cellId}`, `Multiple overrides resolve to ${target}.`);
    }
    overrideIds.add(target);
    return [{ ...override, cellId: target }];
  });
  if (preview.diagnostics.length) {
    return preview;
  }
  for (const section of ['queries', 'patterns', 'widgets'] as const) {
    // Keep replacement position, so pattern precedence remains deterministic.
    const merged = config[section].map((old) => incoming[section].find((item) => item.id === old.id) ?? old);
    merged.push(...incoming[section].filter((item) => !config[section].some((old) => old.id === item.id)));
    Object.assign(config, { [section]: merged });
  }
  config.overrides = config.overrides.filter((old) => !overrideIds.has(old.cellId)).concat(incoming.overrides);
  const merged = validateConfig(config);
  return { ...preview, config: merged.diagnostics.length ? undefined : merged.config, diagnostics: merged.diagnostics };
}
