import { describe, expect, it } from 'vitest';
import type { DiagramConfigV2 } from '../model/config';
import { commitDraft, createDraft, reduceDraft } from './draft';

export const saved: DiagramConfigV2 = {
  version: 2,
  queries: [],
  overrides: [],
  widgets: [],
  patterns: [{ id: 'devices', name: 'Devices', select: { kind: 'node' }, display: { label: 'Shared' } }],
};

describe('binding draft', () => {
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
