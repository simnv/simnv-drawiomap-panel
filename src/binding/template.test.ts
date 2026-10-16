import { describe, expect, it } from 'vitest';
import { resolveTemplate } from './template';

const scope = {
  cell: { 'pg-id': 'rtr-a', capacity: '1000000000' },
  from: { node: 'wan1', port: 'pppoe' },
  to: { node: 'rtr-a', port: 'wan1' },
  labels: { job: 'node-rtr-a' },
  value: '41 Mb/s',
  percent: '41%',
};

describe('resolveTemplate', () => {
  it('resolves cell, from, to, labels, value and percent', () => {
    const r = resolveTemplate('node-${from.node} ${to.port} ${cell.pg-id} ${labels.job} ${value} · ${percent}', scope);
    expect(r.text).toBe('node-wan1 wan1 rtr-a node-rtr-a 41 Mb/s · 41%');
    expect(r.unresolved).toEqual([]);
  });
  it('reports missing keys and keeps the placeholder', () => {
    const r = resolveTemplate('${cell.nope}-${from.port}', scope);
    expect(r.text).toBe('${cell.nope}-pppoe');
    expect(r.unresolved).toEqual(['cell.nope']);
  });
  it('reports a missing scope object', () => {
    const r = resolveTemplate('${to.node}', { cell: {} });
    expect(r.unresolved).toEqual(['to.node']);
  });
  it('leaves unknown roots alone for Grafana variables', () => {
    const r = resolveTemplate('${__url_time_range} $job ${host:csv}', scope);
    expect(r.text).toBe('${__url_time_range} $job ${host:csv}');
    expect(r.unresolved).toEqual([]);
  });
  it('is a no-op without placeholders', () => {
    expect(resolveTemplate('plain', scope).text).toBe('plain');
  });
});
