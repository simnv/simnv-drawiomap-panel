import { describe, expect, it } from 'vitest';
import { mergeCell } from '../binding/patterns';
import { validateConfig, type DiagramConfig } from '../model/config';
import {
  commitDraft,
  createDraft,
  draftPatternIndex,
  isDirty,
  reduceDraft,
  unsetPath,
  exportPatternDocument,
  previewPatternImport,
  type DraftAction,
} from './draft';

describe('entries of the saved config that are not objects', () => {
  // a saved document can hold anything; the boundary drops such entries once, with one note
  const nulls = {
    version: 3,
    queries: [null, { id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
    patterns: [null, { id: 'p', name: 'P', select: {}, display: {} }],
    overrides: [null],
    widgets: [null],
  } as unknown as DiagramConfig;
  it('the draft loads without them, says so once and is not dirty; every action then reads objects only', () => {
    const loaded = createDraft(nulls);
    expect(loaded.diagnostics).toEqual([
      { code: 'empty-entries', path: '(root)', message: expect.stringMatching(/^4 empty entries removed/) },
    ]);
    expect([loaded.config.queries, loaded.config.patterns, loaded.config.overrides, loaded.config.widgets]).toEqual([
      [nulls.queries[1]],
      [nulls.patterns[1]],
      [],
      [],
    ]);
    expect(isDirty(loaded)).toBe(false);
    let draft = reduceDraft(loaded, { type: 'select', cellId: 'device-1' });
    const binding = { queryId: 'q', match: {}, reducer: 'last' as const };
    const actions: DraftAction[] = [
      { type: 'display', display: { label: 'x' } },
      { type: 'unset', path: 'label' },
      { type: 'query', query: { id: 'q2', name: 'Q2', source: { kind: 'panel', refId: 'B' } } },
      { type: 'pattern', pattern: { id: 'p2', name: 'P2', select: {}, display: {} } },
      { type: 'widget', widget: { id: 'w', anchorCellId: 'device-1', kind: 'sparkline', label: 'W', binding } },
      { type: 'remove-widget', id: 'w' },
      { type: 'remove-query', id: 'q2' },
      { type: 'remove-override', cellId: 'device-1' },
    ];
    for (const action of actions) {
      draft = reduceDraft(draft, action);
    }
    expect(draft.diagnostics).toEqual([]);
    expect(draft.config.queries.map((q) => q.id)).toEqual(['q']);
  });
  it('an import drops them from the source and from the destination, and notes the ones of the source', () => {
    const document = {
      kind: 'drawiomap-patterns',
      version: 1,
      config: {
        version: 3,
        queries: [null, { id: 'q3', name: 'Q3', source: { kind: 'panel', refId: 'C' } }],
        patterns: [3, { id: 'p3', name: 'P3', select: { ids: ['device-2'] }, display: { label: 'y' } }],
        overrides: ['x', { cellId: 'device-2', display: { label: 'z' } }],
        widgets: [[]],
      },
    };
    const preview = previewPatternImport(nulls, document, ['device-2']);
    expect(preview.diagnostics).toEqual([]);
    expect(preview.notes).toEqual([
      { code: 'empty-entries', path: '(root)', message: expect.stringMatching(/^4 empty entries removed/) },
    ]);
    expect(preview.config?.queries.map((q) => q.id)).toEqual(['q', 'q3']);
    expect(preview.config?.patterns.map((p) => p.id)).toEqual(['p', 'p3']);
    expect(preview.config?.overrides.map((o) => o.cellId)).toEqual(['device-2']);
    expect(preview.config?.widgets).toEqual([]);
    const imported = reduceDraft(createDraft(nulls), {
      type: 'import-patterns',
      document,
      cellIds: ['device-2'],
      resolution: {},
    });
    expect(imported.diagnostics.map((d) => d.code)).toEqual(['empty-entries']);
  });
});

export const saved: DiagramConfig = {
  version: 3,
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
    const source: DiagramConfig = {
      ...saved,
      queries: [{ id: 'q', name: 'Repeated name', source: { kind: 'panel', refId: 'A' } }],
      patterns: [
        {
          id: 'p',
          name: 'Pattern',
          select: { ids: ['region'] },
          display: {
            shape: { binding },
            link: { a2b: { binding: binding }, b2a: { binding: binding }, capacityBinding: binding },
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
    const destination: DiagramConfig = {
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
        p.link?.a2b?.binding,
        p.link?.b2a?.binding,
        p.link?.capacityBinding,
        p.status?.binding,
        ...(p.hover?.rows?.map((row: any) => row.binding) ?? []),
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
    const source: DiagramConfig = {
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
    const destination: DiagramConfig = {
      ...saved,
      patterns: [],
      defaultDatasource: { uid: 'destination-testdata' },
      queries: [{ id: 'q-destination', name: 'Same name', source: { kind: 'panel', refId: 'Z' } }],
    };
    const preview = previewPatternImport(destination, JSON.parse(JSON.stringify(document)), []);
    expect(preview.diagnostics).toEqual([]);
    expect(preview.config?.defaultDatasource).toEqual({ uid: 'destination-testdata' });
    expect(preview.config?.queries.find((q) => q.id === 'q-source')?.source).toEqual(document.config.queries[0].source);
    expect(preview.config?.patterns[0].display.hover?.rows?.[0]).toMatchObject({
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
  const dup: DiagramConfig = {
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

describe('draft diagram', () => {
  const diagram = (hash: string) => ({ svg: `<svg data-${hash}/>`, xml: `<mxfile ${hash}/>`, hash, updatedAt: '' });
  it('starts with the diagram and without a change', () => {
    const draft = createDraft(saved, diagram('a'));
    expect(draft.diagram?.hash).toBe('a');
    expect(draft.savedDiagram?.hash).toBe('a');
    expect(isDirty(draft)).toBe(false);
  });
  it('takes a new diagram and is dirty until the diagram returns', () => {
    const draft = reduceDraft(createDraft(saved, diagram('a')), { type: 'diagram', diagram: diagram('b') });
    expect(draft.diagram?.hash).toBe('b');
    expect(draft.savedDiagram?.hash).toBe('a');
    expect(isDirty(draft)).toBe(true);
    expect(isDirty(reduceDraft(draft, { type: 'diagram', diagram: diagram('a') }))).toBe(false);
  });
  it('restores the saved diagram on reset', () => {
    const changed = reduceDraft(createDraft(saved, diagram('a')), { type: 'diagram', diagram: diagram('b') });
    const reset = reduceDraft(changed, { type: 'reset' });
    expect(reset.diagram?.hash).toBe('a');
    expect(isDirty(reset)).toBe(false);
  });
  it('copies the diagram into the saved diagram on applied', () => {
    const changed = reduceDraft(createDraft(saved, diagram('a')), { type: 'diagram', diagram: diagram('b') });
    const applied = reduceDraft(changed, { type: 'applied' });
    expect(applied.savedDiagram?.hash).toBe('b');
    expect(isDirty(applied)).toBe(false);
    expect(reduceDraft(applied, { type: 'reset' }).diagram?.hash).toBe('b');
  });
  it('handles a draft without a diagram', () => {
    const draft = createDraft(saved);
    expect(draft.diagram).toBeUndefined();
    expect(isDirty(draft)).toBe(false);
  });
});

describe('isDirty', () => {
  it('is true after a config edit and false after Apply and after reset', () => {
    const edited = reduceDraft(createDraft(saved), { type: 'select', cellId: 'device-1' });
    expect(isDirty(edited)).toBe(false);
    const changed = reduceDraft(edited, { type: 'display', display: { label: 'New' } });
    expect(isDirty(changed)).toBe(true);
    expect(isDirty(reduceDraft(changed, { type: 'applied' }))).toBe(false);
    expect(isDirty(reduceDraft(changed, { type: 'reset' }))).toBe(false);
  });
  it('is false again when an edit is typed back to the saved value', () => {
    const base = reduceDraft(createDraft(saved), {
      type: 'scope',
      scope: 'pattern',
      patternId: 'devices',
      patternIndex: 0,
    });
    const there = reduceDraft(base, { type: 'display', display: { label: 'X' } });
    const back = reduceDraft(there, { type: 'display', display: { label: 'Shared' } });
    expect(isDirty(there)).toBe(true);
    expect(isDirty(back)).toBe(false);
  });
});

describe('unset', () => {
  const binding = { queryId: 'q', match: {}, reducer: 'last' as const };
  const rows = [{ kind: 'metadata' as const, label: 'Device', path: 'cell.key' }];
  const withOverride = (display: DiagramConfig['overrides'][number]['display']) =>
    reduceDraft(
      createDraft({
        ...saved,
        patterns: [{ ...saved.patterns[0], display: { label: 'Shared', hover: { rows } } }],
        overrides: [{ cellId: 'a', display }],
      }),
      { type: 'select', cellId: 'a' }
    );

  it('removes a leaf from the override and keeps the other fields', () => {
    const next = reduceDraft(withOverride({ label: 'Mine', url: '/d/x' }), { type: 'unset', path: 'label' });
    expect(next.config.overrides).toEqual([{ cellId: 'a', display: { url: '/d/x' } }]);
    expect(next.saved.overrides[0].display.label).toBe('Mine');
  });

  it('removes the override when it holds nothing any more', () => {
    const next = reduceDraft(withOverride({ label: 'Mine' }), { type: 'unset', path: 'label' });
    expect(next.config.overrides).toEqual([]);
  });

  it('removes a nested leaf and the objects that become empty', () => {
    const next = reduceDraft(withOverride({ link: { a2b: { binding: binding } }, label: 'Mine' }), {
      type: 'unset',
      path: 'link.a2b.binding',
    });
    expect(next.config.overrides[0].display).toEqual({ label: 'Mine' });
    const kept = reduceDraft(withOverride({ link: { a2b: { binding: binding }, enabled: false } }), {
      type: 'unset',
      path: 'link.a2b.binding',
    });
    expect(kept.config.overrides[0].display).toEqual({ link: { enabled: false } });
  });

  it('removes only hover.rows: hover.enabled stays and the config stays valid', () => {
    const next = reduceDraft(withOverride({ hover: { enabled: false, rows } }), { type: 'unset', path: 'hover.rows' });
    expect(next.config.overrides[0].display).toEqual({ hover: { enabled: false } });
    expect(validateConfig(next.config).diagnostics).toEqual([]);
    // The merge keeps the override's `enabled` and takes the rows of the pattern.
    const cell = { id: 'a', kind: 'node', key: 'a', attrs: {}, labelText: '', isEdge: false } as const;
    expect(mergeCell(next.config, cell).display.hover).toEqual({ enabled: false, rows });
  });

  it('removes the hover when hover.rows was its only key, and hover.enabled alone', () => {
    const next = reduceDraft(withOverride({ hover: { rows }, label: 'Mine' }), { type: 'unset', path: 'hover.rows' });
    expect(next.config.overrides[0].display).toEqual({ label: 'Mine' });
    const enabledOnly = reduceDraft(withOverride({ hover: { enabled: true, rows } }), {
      type: 'unset',
      path: 'hover.enabled',
    });
    expect(enabledOnly.config.overrides[0].display).toEqual({ hover: { rows } });
  });

  it('removes a path from the edited pattern in pattern scope and keeps the pattern', () => {
    const base = reduceDraft(withOverride({ label: 'Mine' }), {
      type: 'scope',
      scope: 'pattern',
      patternId: 'devices',
      patternIndex: 0,
    });
    const next = reduceDraft(base, { type: 'unset', path: 'label' });
    expect(next.config.patterns[0].display).toEqual({ hover: { rows } });
    expect(next.config.overrides[0].display.label).toBe('Mine');
    expect(reduceDraft(next, { type: 'unset', path: 'hover.rows' }).config.patterns[0]).toMatchObject({
      id: 'devices',
      display: {},
    });
  });

  it('does nothing for a path that the owner does not set', () => {
    const draft = withOverride({ label: 'Mine' });
    expect(reduceDraft(draft, { type: 'unset', path: 'url' })).toBe(draft);
    expect(reduceDraft(draft, { type: 'unset', path: 'link.a2b.binding' })).toBe(draft);
    const noOverride = reduceDraft(createDraft(saved), { type: 'select', cellId: 'zzz' });
    expect(reduceDraft(noOverride, { type: 'unset', path: 'label' })).toBe(noOverride);
  });

  it('leaves the input of unsetPath untouched', () => {
    const display = { label: 'x', link: { enabled: true } };
    expect(unsetPath(display, 'link.enabled')).toEqual({ label: 'x' });
    expect(display.link.enabled).toBe(true);
  });
});

describe('remove-query', () => {
  it('removes only the query from the draft and keeps the saved config and the bindings that use it', () => {
    const binding = { queryId: 'q1', match: {}, reducer: 'last' as const };
    const base = createDraft({
      ...saved,
      queries: [
        { id: 'q1', name: 'One', source: { kind: 'panel', refId: 'A' } },
        { id: 'q2', name: 'Two', source: { kind: 'panel', refId: 'B' } },
      ],
      overrides: [{ cellId: 'a', display: { shape: { binding } } }],
    });
    const next = reduceDraft(base, { type: 'remove-query', id: 'q1' });
    expect(next.config.queries.map((q) => q.id)).toEqual(['q2']);
    expect(next.config.overrides).toEqual(base.config.overrides);
    expect(next.saved.queries).toHaveLength(2);
    expect(reduceDraft(base, { type: 'remove-query', id: 'nope' }).config.queries).toHaveLength(2);
  });
});

describe('batch', () => {
  it('applies its actions in order', () => {
    const next = reduceDraft(createDraft(saved), {
      type: 'batch',
      actions: [
        { type: 'pattern', pattern: { id: 'new', name: 'New', select: { ids: ['a', 'b'] }, display: {} } },
        { type: 'select', cellId: 'a' },
        { type: 'scope', scope: 'pattern', patternId: 'new', patternIndex: 1 },
      ],
    });
    expect(next.config.patterns.map((p) => p.id)).toEqual(['devices', 'new']);
    expect(next.cellId).toBe('a');
    expect(next.scope).toBe('pattern');
    expect(draftPatternIndex(next)).toBe(1);
  });

  it('removes several overrides', () => {
    const base = createDraft({
      ...saved,
      overrides: ['a', 'b', 'c'].map((cellId) => ({ cellId, display: { label: cellId } })),
    });
    const next = reduceDraft(base, {
      type: 'batch',
      actions: [
        { type: 'remove-override', cellId: 'a' },
        { type: 'remove-override', cellId: 'c' },
      ],
    });
    expect(next.config.overrides.map((o) => o.cellId)).toEqual(['b']);
  });
});

describe('display-many', () => {
  const rows = [{ kind: 'metadata' as const, label: 'Identity', path: 'cell.key' }];
  const linkBinding = { queryId: 'q', match: {}, reducer: 'last' as const };
  const base = () =>
    createDraft({
      ...saved,
      patterns: [
        {
          id: 'devices',
          name: 'Devices',
          select: { kind: 'node' },
          display: { label: 'Shared', hover: { rows }, link: { a2b: { binding: linkBinding } } },
        },
      ],
      overrides: [
        { cellId: 'a', display: { url: '/d/a', hover: { rows: [{ ...rows[0], label: 'A rows' }] } } },
        { cellId: 'b', display: { label: 'B label' } },
      ],
    });
  const ids = ['a', 'b', 'c'];

  it('sets a leaf in the override of each cell and creates the missing overrides', () => {
    const next = reduceDraft(base(), { type: 'display-many', cellIds: ids, ops: [{ path: 'label', value: 'New' }] });
    expect(next.config.overrides.map((o) => o.cellId)).toEqual(['a', 'b', 'c']);
    expect(next.config.overrides.map((o) => o.display.label)).toEqual(['New', 'New', 'New']);
  });

  it('keeps every other leaf of the existing overrides, hover rows included', () => {
    const next = reduceDraft(base(), { type: 'display-many', cellIds: ids, ops: [{ path: 'label', value: 'New' }] });
    expect(next.config.overrides[0].display).toEqual({
      url: '/d/a',
      hover: { rows: [{ ...rows[0], label: 'A rows' }] },
      label: 'New',
    });
    expect(next.config.overrides[1].display).toEqual({ label: 'New' });
  });

  it('creates an override with the set leaves only, so inherited fields stay inherited', () => {
    const next = reduceDraft(base(), { type: 'display-many', cellIds: ['c'], ops: [{ path: 'label', value: 'New' }] });
    expect(next.config.overrides.find((o) => o.cellId === 'c')!.display).toEqual({ label: 'New' });
    // The pattern is untouched.
    expect(next.config.patterns[0].display).toEqual(base().config.patterns[0].display);
  });

  it('merges with the pattern: the effective display of the cell keeps the inherited rows and link binding', () => {
    const next = reduceDraft(base(), { type: 'display-many', cellIds: ['c'], ops: [{ path: 'label', value: 'New' }] });
    const cell = {
      id: 'c',
      key: 'c',
      kind: 'node' as const,
      attrs: {},
      labelText: '',
      isEdge: false,
    };
    const effective = mergeCell(next.config, cell).display;
    expect(effective.label).toBe('New');
    expect(effective.hover?.rows).toEqual(rows);
    expect(effective.link?.a2b?.binding).toEqual(linkBinding);
  });

  it('writes a leaf inside a binding without replacing the binding', () => {
    const start = reduceDraft(base(), {
      type: 'display-many',
      cellIds: ['a'],
      ops: [{ path: 'shape.binding', value: { queryId: 'q', match: { job: 'x' }, reducer: 'last' } }],
    });
    const next = reduceDraft(start, {
      type: 'display-many',
      cellIds: ['a', 'b'],
      ops: [{ path: 'shape.binding.queryId', value: 'r' }],
    });
    expect(next.config.overrides[0].display.shape?.binding).toEqual({
      queryId: 'r',
      match: { job: 'x' },
      reducer: 'last',
    });
    expect(next.config.overrides[1].display.shape).toEqual({ binding: { queryId: 'r' } });
  });

  it('removes a leaf, drops an override that holds nothing any more and creates none for a removal', () => {
    const next = reduceDraft(base(), {
      type: 'display-many',
      cellIds: ids,
      ops: [{ path: 'label', value: undefined }],
    });
    expect(next.config.overrides.map((o) => o.cellId)).toEqual(['a']);
    expect(next.config.overrides[0].display.label).toBeUndefined();
  });

  it('is no change, and no history entry, when nothing differs', () => {
    const draft = base();
    expect(
      reduceDraft(draft, { type: 'display-many', cellIds: ['b'], ops: [{ path: 'label', value: 'B label' }] })
    ).toBe(draft);
    expect(reduceDraft(draft, { type: 'display-many', cellIds: ids, ops: [] })).toBe(draft);
  });

  it('is one step in a batch with the removal of overrides', () => {
    const next = reduceDraft(base(), {
      type: 'batch',
      actions: [
        { type: 'display-many', cellIds: ['c'], ops: [{ path: 'label', value: 'N' }] },
        { type: 'remove-override', cellId: 'a' },
      ],
    });
    expect(next.config.overrides.map((o) => o.cellId)).toEqual(['b', 'c']);
  });
});

describe('items stay byte for byte', () => {
  const widget = {
    id: 'w',
    anchorCellId: 'a',
    kind: 'bar' as const,
    binding: { queryId: 'q', match: {}, reducer: 'last' as const },
    label: 'Load',
    url: '/d/x',
    unit: 'percent',
    min: 0,
    max: 100,
  };
  it('an edit of a widget label keeps its other fields, in their saved order', () => {
    const base = createDraft({
      ...saved,
      queries: [{ id: 'q', name: 'Q', source: { kind: 'panel', refId: 'A' } }],
      widgets: [widget],
    });
    const next = reduceDraft(base, { type: 'widget', widget: { ...widget, label: 'CPU' } });
    expect(JSON.stringify(next.config.widgets[0])).toBe(JSON.stringify({ ...widget, label: 'CPU' }));
  });
  it('remove-pattern drops the pattern at the saved index and returns the scope to the element', () => {
    const base = {
      ...createDraft({
        ...saved,
        patterns: [saved.patterns[0], { id: 'bad', name: 'Bad', select: null, display: {} } as never],
      }),
      scope: 'pattern' as const,
      patternId: 'bad',
      patternIndex: 1,
    };
    const next = reduceDraft(base, { type: 'remove-pattern', index: 1 });
    expect(next.config.patterns.map((p) => p.id)).toEqual(['devices']);
    expect(next.scope).toBe('element');
    expect(next.patternId).toBeUndefined();
    expect(reduceDraft(base, { type: 'remove-pattern', index: 5 })).toBe(base);
  });
});
