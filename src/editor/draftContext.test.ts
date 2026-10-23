import { getDefaultTimeRange } from '@grafana/data';
import { describe, expect, it } from 'vitest';
import { draftQueryService } from './draftContext';
import type { PanelQueryService } from '../query/panel';
import type { QueryController } from '../query/types';

const controller = { watch: () => () => {}, setPanelData: () => {}, dispose: () => {} } as QueryController;
const service = (defaultDatasource?: { uid: string }): PanelQueryService => ({
  controller,
  context: {
    timeRange: getDefaultTimeRange(),
    timeZone: 'utc',
    scopedVars: {},
    refreshMs: 0,
    intervalMs: 1000,
    generation: 4,
    defaultDatasource,
  },
});

describe('draftQueryService', () => {
  it('has no service without a saved service', () => {
    expect(draftQueryService(undefined, { uid: 'a' })).toBeUndefined();
  });

  it('overlays the draft default datasource and keeps the controller and the rest of the context', () => {
    const saved = service({ uid: 'saved' });
    const draft = draftQueryService(saved, { uid: 'draft' })!;
    expect(draft.context.defaultDatasource).toEqual({ uid: 'draft' });
    expect(draft.controller).toBe(controller);
    expect(draft.context.generation).toBe(4);
    expect(draft.context.timeRange).toBe(saved.context.timeRange);
    // The saved context stays as it is: the panel does not see the draft value.
    expect(saved.context.defaultDatasource).toEqual({ uid: 'saved' });
  });

  it('removes the default datasource when the draft has none', () => {
    const draft = draftQueryService(service({ uid: 'saved' }), undefined)!;
    expect(draft.context.defaultDatasource).toBeUndefined();
  });

  it('returns the same object while the inputs are equal', () => {
    const saved = service({ uid: 'saved' });
    const first = draftQueryService(saved, { uid: 'draft' });
    expect(draftQueryService(saved, { uid: 'draft' })).toBe(first);
    expect(draftQueryService(saved, { uid: 'other' })).not.toBe(first);
    expect(draftQueryService(service({ uid: 'saved' }), { uid: 'draft' })).not.toBe(first);
  });

  it('returns the saved service itself when the draft value equals the saved one', () => {
    const saved = service({ uid: 'saved' });
    expect(draftQueryService(saved, { uid: 'saved' })).toBe(saved);
    const none = service();
    expect(draftQueryService(none, undefined)).toBe(none);
  });
});
