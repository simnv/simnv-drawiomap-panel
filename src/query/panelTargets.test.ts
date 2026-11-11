import { afterEach, describe, expect, it } from 'vitest';
import { toDataFrame, type PanelData } from '@grafana/data';
import { editedRefIds, publishEditedRefIds, refIdsOf } from './panelTargets';

const data = (over: object) => ({ series: [], ...over }) as unknown as PanelData;

describe('refIdsOf', () => {
  it('reads the targets of the request, also those with no frame', () => {
    const d = data({
      request: { targets: [{ refId: 'up' }, { refId: 'tx' }, { refId: 'up' }] },
      series: [toDataFrame({ refId: 'tx', fields: [] })],
    });
    expect(refIdsOf(d)).toEqual(['up', 'tx']);
  });
  it('falls back to the frames without a request', () => {
    expect(refIdsOf(data({ series: [toDataFrame({ refId: 'A', fields: [] }), toDataFrame({ fields: [] })] }))).toEqual([
      'A',
    ]);
  });
});

describe('the published refIds', () => {
  afterEach(() => publishEditedRefIds(undefined));
  it('keeps what the panel published until it clears them', () => {
    expect(editedRefIds()).toBeUndefined();
    publishEditedRefIds(['up']);
    expect(editedRefIds()).toEqual(['up']);
  });
});
