import { buttonNamed, editorField } from './testUtils';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { getDefaultTimeRange, LoadingState, type PanelData, type DataQueryRequest } from '@grafana/data';
import { QueryEditor } from './QueryEditor';
import { validateConfig, type NamedQuery } from '../model/config';
vi.hoisted(() => {
  if (!window.localStorage) {
    Object.defineProperty(window, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
  }
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});
vi.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({
    get: async (uid: string) => ({
      uid,
      components: {
        QueryEditor:
          uid === 'unsupported'
            ? undefined
            : ({ query, onChange, onRunQuery }: any) => (
                <>
                  <button onClick={() => onChange({ ...query, expr: 'changed' })}>Native edit</button>
                  <button onClick={() => onChange({ refId: query.refId, expr: 'new', datasource: undefined })}>
                    Native replacement
                  </button>
                  <button onClick={() => onChange({ expr: 'without identity' })}>Native edit without identity</button>
                  <button onClick={onRunQuery}>Native run</button>
                </>
              ),
      },
    }),
    getInstanceSettings: () => ({ uid: 'prom', type: 'prometheus', name: 'Prometheus', meta: {} }),
  }),
}));
const context = {
  timeRange: getDefaultTimeRange(),
  timeZone: 'utc',
  scopedVars: {},
  refreshMs: 0,
  intervalMs: 1000,
  generation: 1,
};
const data: PanelData = { state: LoadingState.Done, series: [], timeRange: context.timeRange };
const native: NamedQuery = {
  id: 'cpu',
  name: 'CPU',
  source: {
    kind: 'datasource',
    datasource: { uid: 'prom' },
    target: { refId: 'D', expr: 'original', opaque: { nested: [7, 'retain'] } } as any,
    parameters: {},
  },
};
describe('named query editor', () => {
  it('preserves opaque native fields and never runs from mount, edits, or native Run', async () => {
    const change = vi.fn();
    const preview = vi.fn();
    render(<QueryEditor query={native} context={context} data={data} onChange={change} onPreview={preview} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Native edit' }));
    expect(change.mock.calls[0][0].source.target).toEqual({
      refId: 'D',
      expr: 'changed',
      opaque: { nested: [7, 'retain'] },
    });
    fireEvent.click(buttonNamed('Native run'));
    expect(preview).not.toHaveBeenCalled();
    fireEvent.click(buttonNamed('Preview query'));
    expect(preview).toHaveBeenCalledTimes(1);
  });
  it('accepts complete native replacements without restoring deleted fields', async () => {
    const change = vi.fn();
    const target = { refId: 'D', expr: 'old', obsoleteMode: true };
    const query: NamedQuery = {
      ...native,
      source: { kind: 'datasource', datasource: { uid: 'prom' }, parameters: {}, target },
    };
    render(<QueryEditor query={query} context={context} data={data} onChange={change} onPreview={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Native replacement' }));
    expect(change.mock.calls[0][0].source.target).toEqual({ refId: 'D', expr: 'new' });
    expect(
      validateConfig({ version: 3, queries: [change.mock.calls[0][0]], patterns: [], overrides: [], widgets: [] })
        .diagnostics
    ).toEqual([]);
    fireEvent.click(buttonNamed('Native edit without identity'));
    expect(change.mock.calls[1][0].source.target).toEqual({ refId: 'D', expr: 'without identity' });
  });
  it('converts the complete eager target and keeps its warning until removal is verified', () => {
    const target = { refId: 'A', datasource: { uid: 'prom' }, expr: 'native', opaque: { keep: true } };
    const request = { targets: [target] } as unknown as DataQueryRequest;
    const change = vi.fn();
    const props = { context, data: { ...data, request }, onChange: change, onPreview: vi.fn() };
    const query: NamedQuery = { id: 'hover', name: 'Hover', source: { kind: 'panel', refId: 'A' } };
    const view = render(<QueryEditor {...props} query={query} />);
    expect(screen.getByText(/Eager panel reference/)).toBeTruthy();
    fireEvent.click(buttonNamed('Convert to hover-only query'));
    const converted = change.mock.calls[0][0];
    expect(converted.source.target).toEqual(target);
    view.rerender(<QueryEditor {...props} query={converted} />);
    expect(screen.getByText(/Lazy loading is not verified/)).toBeTruthy();
    view.rerender(
      <QueryEditor
        {...props}
        query={converted}
        data={{ ...data, request: { targets: [] } as unknown as DataQueryRequest }}
      />
    );
    expect(screen.queryByText(/Lazy loading is not verified/)).toBeNull();
    view.rerender(<QueryEditor {...props} query={converted} data={data} />);
    expect(screen.getByText(/Lazy loading is not verified/)).toBeTruthy();
  });
  it('validates explicit native JSON imports and reports invalid targets', () => {
    const change = vi.fn();
    const validity = vi.fn();
    render(
      <QueryEditor
        query={native}
        context={context}
        data={data}
        onChange={change}
        onValidity={validity}
        onPreview={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Import native target JSON'));
    fireEvent.change(editorField('Native target JSON'), { target: { value: '{"expr":"missing-refId"}' } });
    fireEvent.click(buttonNamed('Import native target'));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('refId');
    fireEvent.change(editorField('Native target JSON'), {
      target: { value: '{"refId":"X","opaque":{"keep":[1,2]}}' },
    });
    fireEvent.click(buttonNamed('Import native target'));
    expect(change.mock.calls[0][0].source.target).toEqual({ refId: 'X', opaque: { keep: [1, 2] } });
    expect(validity).toHaveBeenLastCalledWith('');
  });
  it('explains unsupported datasource editors and allows native JSON with the panel default', async () => {
    const query: NamedQuery = { ...native, source: { kind: 'datasource', target: { refId: 'X' }, parameters: {} } };
    const change = vi.fn();
    render(
      <QueryEditor
        query={query}
        context={{ ...context, defaultDatasource: { uid: 'unsupported' } }}
        data={data}
        onChange={change}
        onPreview={vi.fn()}
      />
    );
    expect(await screen.findByText(/No supported native query editor/)).toBeTruthy();
    expect(screen.getByText('Effective datasource: unsupported')).toBeTruthy();
    fireEvent.click(screen.getByText('Import native target JSON'));
    fireEvent.change(editorField('Native target JSON'), {
      target: { value: '{"refId":"X","custom":{"query":["native",1]}}' },
    });
    fireEvent.click(buttonNamed('Import native target'));
    expect(change.mock.calls[0][0].source.target.custom).toEqual({ query: ['native', 1] });
  });
});
