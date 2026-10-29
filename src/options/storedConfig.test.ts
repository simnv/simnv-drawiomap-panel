import { describe, expect, it } from 'vitest';
import { grafanaUpdate, saveOptions as save } from '../fixtures/grafanaOptions';
import { validateConfig } from '../model/validate';
import { configUpdate } from './storedConfig';

const stored = {
  version: 4,
  freshness: '3x',
  classes: {
    lan: { match: { key: 'job', value: 'lan' }, status: 'up', rows: [{ kind: 'metadata', text: 'a' }] },
    wan: { extends: 'lan', freshness: '5m' },
  },
  overrides: { 'cell-1': { status: 'up' } },
};
const options = { config: stored, zoom: { mode: 'fit' } };

/** The config that Grafana saves after the editor stores `next`. */
const saved = (next: unknown) => save(grafanaUpdate(options, 'config', configUpdate(stored, next))).config;

describe('configUpdate', () => {
  it('saves an empty class map and an empty override map as empty', () => {
    const next = { version: 4, freshness: '7m', classes: {}, overrides: {} };
    expect(saved(next)).toEqual(next);
  });

  it('removes a class, a key of a class and a top-level key', () => {
    const next = { version: 4, classes: { lan: { match: { key: 'job' } } } };
    expect(saved(next)).toEqual(next);
  });

  it('replaces a list and adds new keys', () => {
    const next = {
      version: 4,
      classes: { lan: { match: { key: 'job', value: 'lan' }, rows: [] }, core: { status: 'down' } },
      overrides: { 'cell-2': { status: 'up' } },
    };
    expect(saved(next)).toEqual(next);
  });

  it('stores the value as it is when nothing is stored', () => {
    const next = { version: 4, classes: {} };
    expect(configUpdate(undefined, next)).toEqual(next);
    expect(save(grafanaUpdate({}, 'config', configUpdate(undefined, next))).config).toEqual(next);
  });

  it('gives a live value that validates as the new config before the save', () => {
    const next = { version: 4, classes: { lan: { match: { key: 'job' } } } };
    const live = grafanaUpdate(options, 'config', configUpdate(stored, next)).config;
    const { parsed, report } = validateConfig(live);
    expect(report).toEqual([]);
    expect(Object.keys(parsed.config?.classes ?? {})).toEqual(['lan']);
    expect(parsed.config?.overrides).toEqual({});
    expect(parsed.config?.classes.lan).toEqual({ match: { key: 'job' } });
  });
});
