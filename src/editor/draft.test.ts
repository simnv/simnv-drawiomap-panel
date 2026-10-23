import { describe, expect, it } from 'vitest';
import type { DiagramConfigV2 } from '../model/config';
import {
  commitDraft,
  createDraft,
  draftPatternIndex,
  reduceDraft,
  exportPatternDocument,
  previewPatternImport,
} from './draft';

export const saved: DiagramConfigV2 = {
  version: 2,
  queries: [],
  overrides: [],
  widgets: [],
  patterns: [{ id: 'devices', name: 'Devices', select: { kind: 'node' }, display: { label: 'Shared' } }],
};

describe('remove-override', () => {
  it('removes only the override of the cell from the draft and keeps the saved config', () => {
    const base = createDraft({
      ...saved,
      overrides: [
        { cellId: 'a', display: { label: 'A' } },
        { cellId: 'b', display: { label: 'B' } },
      ],
    });
    const next = reduceDraft(base, { type: 'remove-override', cellId: 'a' });
    expect(next.config.overrides.map((o) => o.cellId)).toEqual(['b']);
    expect(next.saved.overrides).toHaveLength(2);
    expect(reduceDraft(next, { type: 'reset' }).config.overrides).toHaveLength(2);
  });
});

describe('binding draft', () => {
  it('requires a destination anchor and rejects invalid identity or query remapping without mutating the panel', () => {
    const document = exportPatternDocument({
      ...saved,
      patterns: [],
      queries: [{ id: 'q', name: 'CPU', source: { kind: 'panel', refId: 'A' } }],
      widgets: [
        {
          id: 'w',
          kind: 'bar',
          label: 'CPU',
          anchorCellId: 'old-region',
          min: 0,
          max: 100,
          binding: { queryId: 'q', match: {}, reducer: 'last' },
        },
      ],
    });
    const destination = { ...saved, patterns: [] };
    const missing = previewPatternImport(destination, document, ['new-region']);
    expect(missing.config).toBeUndefined();
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-anchor' }));
    const imported = previewPatternImport(destination, document, ['new-region'], {
      anchors: { 'old-region': 'new-region' },
    });
    expect(imported.config?.widgets[0].anchorCellId).toBe('new-region');
    const invalid = previewPatternImport(destination, { ...document, config: { ...document.config, queries: [] } }, [
      'new-region',
    ]);
    expect(invalid.config).toBeUndefined();
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-query' }));
    const collision = previewPatternImport(imported.config!, document, ['new-region'], {
      queries: { q: { action: 'new', id: 'q' } },
      patterns: {},
      widgets: { w: { action: 'replace' } },
      anchors: { 'old-region': 'new-region' },
    });
    expect(collision.config).toBeUndefined();
    expect(collision.diagnostics).toContainEqual(expect.objectContaining({ code: 'import-identity-conflict' }));
    expect(destination.widgets).toEqual([]);
  });
  it('previews conflicts and applicability, then remaps every query reference atomically by ID', () => {
    const binding = { queryId: 'q', match: {}, reducer: 'last' as const };
    const source: DiagramConfigV2 = {
      ...saved,
      queries: [{ id: 'q', name: 'Repeated name', source: { kind: 'panel', refId: 'A' } }],
      patterns: [
        {
          id: 'p',
          name: 'Pattern',
          select: { ids: ['region'] },
          display: {
            shape: { binding },
            link: { a2bBinding: binding, b2aBinding: binding, capacityBinding: binding },
            status: {
              kind: 'mapping',
              binding,
              default: { state: 'normal', reason: 'OK' },
              mappings: [{ value: 0, state: 'down', reason: 'Down' }],
            },
            hover: {
              rows: [
                { kind: 'value', label: 'Value', binding },
                { kind: 'history', label: 'History', binding },
              ],
            },
          },
        },
      ],
      overrides: [
        { cellId: 'region', display: { shape: { binding } } },
        { cellId: 'missing', display: { label: 'Missing' } },
      ],
      widgets: [
        {
          id: 'w',
          anchorCellId: 'region',
          kind: 'sparkline',
          label: 'Chart',
          binding,
          freshness: { expectedIntervalMs: 2000, staleAfterMs: 5000 },
        },
      ],
    };
    const destination: DiagramConfigV2 = {
      ...source,
      overrides: [{ cellId: 'region', display: { label: 'Original' } }],
      queries: [{ id: 'q', name: 'Repeated name', source: { kind: 'panel', refId: 'Z' } }],
    };
    const document = exportPatternDocument(source);
    const preview = previewPatternImport(destination, document, ['region', 'region-copy']);
    expect(preview.config).toBeUndefined();
    expect(preview.conflicts).toEqual(
      expect.arrayContaining([
        { section: 'queries', id: 'q' },
        { section: 'patterns', id: 'p' },
        { section: 'widgets', id: 'w' },
      ])
    );
    expect(preview.overrides).toEqual([
      { cellId: 'region', applies: true, conflict: true },
      { cellId: 'missing', applies: false, conflict: false },
    ]);
    const resolved = previewPatternImport(destination, document, ['region', 'region-copy'], {
      queries: { q: { action: 'new', id: 'q-copy' } },
      patterns: { p: { action: 'new', id: 'p-copy' } },
      widgets: { w: { action: 'new', id: 'w-copy' } },
      overrides: { region: 'region-copy', missing: null },
    });
    expect(resolved.diagnostics).toEqual([]);
    const imported = resolved.config!;
    expect(imported.queries.map((q) => [q.id, q.source])).toEqual([
      ['q', { kind: 'panel', refId: 'Z' }],
      ['q-copy', { kind: 'panel', refId: 'A' }],
    ]);
    const p = imported.patterns[1].display;
    expect(
      [
        p.shape?.binding,
        p.link?.a2bBinding,
        p.link?.b2aBinding,
        p.link?.capacityBinding,
        p.status?.binding,
        ...(p.hover?.rows.map((row: any) => row.binding) ?? []),
        imported.overrides[1].display.shape?.binding,
        imported.widgets[1].binding,
      ].map((b) => b?.queryId)
    ).toEqual(Array(9).fill('q-copy'));
    expect(imported.overrides[1].cellId).toBe('region-copy');
    expect(imported.widgets[1].freshness).toEqual({ expectedIntervalMs: 2000, staleAfterMs: 5000 });
    expect(destination.queries).toHaveLength(1);
    const replace = previewPatternImport(destination, document, ['region'], {
      queries: { q: { action: 'replace' } },
      patterns: { p: { action: 'replace' } },
      widgets: { w: { action: 'replace' } },
      overrides: { region: 'region', missing: null },
    });
    expect(replace.config?.queries).toHaveLength(1);
    expect(replace.config?.queries[0].source).toEqual({ kind: 'panel', refId: 'A' });
    expect(replace.config?.patterns).toHaveLength(1);
    expect(previewPatternImport(destination, { ...document, version: 99 }, []).config).toBeUndefined();
  });
  it('exports referenced queries with their inherited datasource and imports across different panel defaults', () => {
    const source: DiagramConfigV2 = {
      ...saved,
      defaultDatasource: { uid: 'source-prom', type: 'prometheus' },
      queries: [
        {
          id: 'q-source',
          name: 'Same name',
          source: {
            kind: 'datasource',
            target: { refId: 'D', ...{ expr: 'rate(трафик[5m])', opaque: { x: [1, 2] } } },
            parameters: {},
          },
        },
        { id: 'unused', name: 'Unused', source: { kind: 'panel', refId: 'B' } },
      ],
      patterns: [
        {
          id: 'p',
          name: 'Порты α',
          select: { kind: 'any' },
          display: {
            hover: {
              rows: [
                {
                  kind: 'history',
                  label: 'История 🚀',
                  binding: { queryId: 'q-source', match: {}, reducer: 'last' },
                  freshness: { expectedIntervalMs: 1000, staleAfterMs: 4000 },
                },
              ],
            },
          },
        },
      ],
    };
    const document = exportPatternDocument(source);
    expect(document).toMatchObject({ kind: 'drawiomap-patterns', version: 1 });
    expect(document.config.queries).toHaveLength(1);
    expect(document.config.queries[0].source).toMatchObject({ datasource: { uid: 'source-prom', type: 'prometheus' } });
    const destination: DiagramConfigV2 = {
      ...saved,
      patterns: [],
      defaultDatasource: { uid: 'destination-testdata' },
      queries: [{ id: 'q-destination', name: 'Same name', source: { kind: 'panel', refId: 'Z' } }],
    };
    const preview = previewPatternImport(destination, JSON.parse(JSON.stringify(document)), []);
    expect(preview.diagnostics).toEqual([]);
    expect(preview.config?.defaultDatasource).toEqual({ uid: 'destination-testdata' });
    expect(preview.config?.queries.find((q) => q.id === 'q-source')?.source).toEqual(document.config.queries[0].source);
    expect(preview.config?.patterns[0].display.hover?.rows[0]).toMatchObject({
      label: 'История 🚀',
      binding: { queryId: 'q-source' },
      freshness: { expectedIntervalMs: 1000, staleAfterMs: 4000 },
    });
    expect(source.queries[0].source).not.toHaveProperty('datasource');
    expect(destination.patterns).toEqual([]);
  });
  it('edits one physical element without changing its shared pattern or saved configuration', () => {
    let draft = reduceDraft(createDraft(saved), { type: 'select', cellId: 'device-1' });
    draft = reduceDraft(draft, { type: 'display', display: { label: 'Local' } });
    expect(commitDraft(draft).overrides).toEqual([{ cellId: 'device-1', display: { label: 'Local' } }]);
    expect(commitDraft(draft).patterns[0].display.label).toBe('Shared');
    expect(saved.overrides).toEqual([]);
  });
  it('edits the selected pattern and resets to saved on cancel or undo', () => {
    let draft = reduceDraft(createDraft(saved), { type: 'select', cellId: 'device-1' });
    draft = reduceDraft(draft, { type: 'scope', scope: 'pattern', patternId: 'devices' });
    draft = reduceDraft(draft, { type: 'display', display: { label: 'All devices' } });
    expect(commitDraft(draft).patterns[0].display.label).toBe('All devices');
    expect(commitDraft(draft).overrides).toEqual([]);
    expect(reduceDraft(draft, { type: 'reset' }).config).toEqual(saved);
    const applied = reduceDraft(draft, { type: 'applied' });
    const changed = reduceDraft(applied, { type: 'display', display: { label: 'Unsaved' } });
    expect(reduceDraft(changed, { type: 'reset' }).config.patterns[0].display.label).toBe('All devices');
    expect(reduceDraft(changed, { type: 'select', cellId: 'device-2' }).scope).toBe('element');
  });
  it('rejects conflicting imports atomically and prevents invalid bindings from committing', () => {
    const draft = reduceDraft(createDraft(saved), { type: 'import', config: saved });
    expect(draft.diagnostics).toContainEqual(expect.objectContaining({ code: 'import-pattern-conflict' }));
    expect(draft.config).toEqual(saved);
    expect(() => commitDraft(draft)).toThrow(/conflict/i);
    const selected = reduceDraft(createDraft(saved), { type: 'select', cellId: 'device-1' });
    const invalid = reduceDraft(selected, {
      type: 'display',
      display: { shape: { binding: { queryId: 'missing', match: {}, reducer: 'last' } } },
    });
    expect(() => commitDraft(invalid)).toThrow(/missing/);
  });
  it('does not silently strip invalid native properties during a draft edit', () => {
    const draft = reduceDraft(createDraft(saved), {
      type: 'query',
      query: {
        id: 'native',
        name: 'Native',
        source: {
          kind: 'datasource',
          datasource: { uid: 'prom' },
          parameters: {},
          target: { refId: 'D', unsupported: undefined } as any,
        },
      },
    });
    expect(() => commitDraft(draft)).toThrow(/losslessly persistable/);
  });
  it('keeps existing override settings when another setting in the same section changes', () => {
    let draft = reduceDraft(createDraft(saved), { type: 'select', cellId: 'device-1' });
    draft = reduceDraft(draft, { type: 'display', display: { shape: { target: 'stroke' } } });
    draft = reduceDraft(draft, { type: 'display', display: { shape: { text: true } } });
    expect(commitDraft(draft).overrides[0].display.shape).toEqual({ target: 'stroke', text: true });
  });
});

describe('duplicate pattern IDs', () => {
  const dup: DiagramConfigV2 = {
    ...saved,
    patterns: [
      { id: 'same', name: 'First', select: { kind: 'node' }, display: {} },
      { id: 'same', name: 'Second', select: { kind: 'link' }, display: {} },
    ],
  };
  it('edits only the pattern at the exact index', () => {
    let draft = reduceDraft(createDraft(dup), { type: 'select', cellId: 'a' });
    draft = reduceDraft(draft, { type: 'scope', scope: 'pattern', patternId: 'same', patternIndex: 1 });
    draft = reduceDraft(draft, { type: 'display', display: { label: 'Edited' } });
    draft = reduceDraft(draft, { type: 'selector', select: { kind: 'port' } });
    expect(draft.config.patterns.map((p) => [p.display.label, p.select.kind])).toEqual([
      [undefined, 'node'],
      ['Edited', 'port'],
    ]);
  });
  it('falls back to the first pattern with the ID without an index, and ignores a stale index', () => {
    let draft = reduceDraft(createDraft(dup), { type: 'scope', scope: 'pattern', patternId: 'same' });
    expect(draftPatternIndex(draft)).toBe(0);
    draft = reduceDraft(draft, { type: 'scope', scope: 'pattern', patternId: 'same', patternIndex: 5 });
    expect(draftPatternIndex(draft)).toBe(0);
  });
  it('does not add a second pattern with an existing ID, and flags an import with one', () => {
    const replaced = reduceDraft(createDraft(saved), {
      type: 'pattern',
      pattern: { id: 'devices', name: 'Again', select: {}, display: {} },
    });
    expect(replaced.config.patterns).toHaveLength(1);
    const imported = reduceDraft(createDraft(saved), { type: 'import', config: saved });
    expect(imported.diagnostics.map((d) => d.code)).toContain('import-pattern-conflict');
  });
});
