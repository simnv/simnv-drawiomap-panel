import React, { StrictMode, useContext, useEffect } from 'react';
import { dateTime, FieldType, LoadingState, type PanelData } from '@grafana/data';
import { render, screen, waitFor } from '@testing-library/react';
import { of } from 'rxjs';
import { expect, it, vi } from 'vitest';
import { PanelQueryProvider, PanelQueryContext } from './panel';
import { clearQuerySessions } from './session';
import type { QueryContext, QueryController, QueryDemand, QuerySnapshot } from './types';

const probeDemand = (context: QueryContext): QueryDemand => ({
  consumerId: 'probe',
  query: {
    id: 'cpu',
    name: 'CPU',
    source: {
      kind: 'datasource',
      datasource: { uid: 'prom' },
      target: Object.assign({ refId: 'D' }, { expr: 'cpu' }),
      parameters: {},
    },
  },
  scope: { cell: {} },
  context,
  maxDataPoints: 100,
});
const probeFrame = {
  refId: 'D',
  length: 1,
  fields: [
    { name: 'Time', type: FieldType.time, config: {}, values: [1000] },
    { name: 'CPU', type: FieldType.number, config: {}, values: [1] },
  ],
};
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ get }),
  getTemplateSrv: () => ({ getVariables: () => [{ name: 'site' }] }),
}));
it('provides one panel controller, raw dashboard context, eager reuse, generation changes and disposal in StrictMode', async () => {
  const range = { from: dateTime(1000), to: dateTime(2000), raw: { from: '1000', to: '2000' } };
  const data: PanelData = {
    state: LoadingState.Done,
    series: [],
    timeRange: range,
    request: {
      requestId: 'eager-1',
      app: 'dashboard',
      startTime: 0,
      range,
      timezone: 'utc',
      targets: [],
      scopedVars: { site: { value: 'stale', text: 'stale' } },
      interval: '1s',
      intervalMs: 1000,
    },
  };
  let controller: QueryController | undefined;
  const Probe = () => {
    const service = useContext(PanelQueryContext);
    controller = service?.controller;
    return (
      <span data-testid="probe">
        {service
          ? `${service.context.generation}:${service.context.scopedVars.site?.value}:${service.context.timeZone}`
          : 'waiting'}
      </span>
    );
  };
  const variables = (_: string, _scopes?: unknown, format?: string | Function) =>
    typeof format === 'function' ? format(['east', 'west']) : 'east';
  const view = render(
    <StrictMode>
      <PanelQueryProvider data={data} timeRange={range} timeZone="utc" replaceVariables={variables}>
        <Probe />
      </PanelQueryProvider>
    </StrictMode>
  );
  await waitFor(() => expect(controller).toBeDefined());
  const first = controller;
  expect(screen.getByTestId('probe').textContent).toBe('1:east,west:utc');
  expect(get).not.toHaveBeenCalled();
  view.rerender(
    <StrictMode>
      <PanelQueryProvider data={{ ...data }} timeRange={range} timeZone="utc" replaceVariables={variables}>
        <Probe />
      </PanelQueryProvider>
    </StrictMode>
  );
  expect(controller).toBe(first);
  view.rerender(
    <StrictMode>
      <PanelQueryProvider data={data} timeRange={range} timeZone="browser" replaceVariables={variables}>
        <Probe />
      </PanelQueryProvider>
    </StrictMode>
  );
  expect(screen.getByTestId('probe').textContent).toBe('2:east,west:browser');
  view.unmount();
  expect(get).not.toHaveBeenCalled();
  expect(() => first!.watch({} as never, vi.fn())).toThrow('disposed');
});

it('a remount of the same session keeps the generation and serves the retained results without a request', async () => {
  const range = { from: dateTime(1000), to: dateTime(2000), raw: { from: '1000', to: '2000' } };
  const data: PanelData = {
    state: LoadingState.Done,
    series: [],
    timeRange: range,
    request: { requestId: 'req-1', targets: [], range, scopedVars: {}, intervalMs: 1000 } as never,
  };
  const query = vi.fn(() => of({ data: [probeFrame] }));
  get.mockResolvedValue({ query });
  const seen: QuerySnapshot[] = [];
  let generation = 0;
  const Probe = () => {
    const service = useContext(PanelQueryContext);
    generation = service?.context.generation ?? 0;
    useEffect(() => {
      if (!service?.controller) {
        return;
      }
      return service.controller.watch(probeDemand(service.context), (snapshot) => void seen.push(snapshot));
    }, [service]);
    return null;
  };
  const element = (session: string) => (
    <PanelQueryProvider session={session} data={data} timeRange={range} timeZone="utc" replaceVariables={() => ''}>
      <Probe />
    </PanelQueryProvider>
  );
  const view = render(element('dash#1'));
  await waitFor(() => expect(seen.at(-1)).toMatchObject({ state: 'ready', fromCache: false }));
  expect(query).toHaveBeenCalledTimes(1);
  expect(generation).toBe(1);
  view.unmount();
  // The panel editor mounts a new component for the same panel.
  const again = render(element('dash#1'));
  await waitFor(() => expect(seen.at(-1)).toMatchObject({ state: 'ready', fromCache: true }));
  expect(query).toHaveBeenCalledTimes(1);
  expect(generation).toBe(1);
  again.unmount();
  // Another panel has its own session.
  const other = render(element('dash#2'));
  await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  other.unmount();
  clearQuerySessions();
});

it('switching the session together with the range never exposes a disposed controller', async () => {
  const range = { from: dateTime(1000), to: dateTime(2000), raw: { from: '1000', to: '2000' } };
  const later = { from: dateTime(3000), to: dateTime(4000), raw: { from: '3000', to: '4000' } };
  const dataFor = (r: typeof range): PanelData => ({
    state: LoadingState.Done,
    series: [],
    timeRange: r,
    request: { requestId: 'req-1', targets: [], range: r, scopedVars: {}, intervalMs: 1000 } as never,
  });
  get.mockResolvedValue({ query: vi.fn(() => of({ data: [probeFrame] })) });
  const watching: QueryController[] = [];
  const Probe = () => {
    const service = useContext(PanelQueryContext);
    useEffect(() => {
      if (!service?.controller) {
        return;
      }
      watching.push(service.controller);
      return service.controller.watch(probeDemand(service.context), () => undefined);
    }, [service]);
    return null;
  };
  const element = (session: string, r: typeof range) => (
    <PanelQueryProvider session={session} data={dataFor(r)} timeRange={r} timeZone="utc" replaceVariables={() => ''}>
      <Probe />
    </PanelQueryProvider>
  );
  const view = render(element('dash#1', range));
  await waitFor(() => expect(watching).toHaveLength(1));
  expect(() => view.rerender(element('dash#2', later))).not.toThrow();
  await waitFor(() => expect(watching).toHaveLength(2));
  expect(watching[1]).not.toBe(watching[0]);
  view.unmount();
  clearQuerySessions();
});

it('in StrictMode a change, a remount and a return to an earlier state each run a new request', async () => {
  const range = { from: dateTime(1000), to: dateTime(2000), raw: { from: '1000', to: '2000' } };
  const data: PanelData = {
    state: LoadingState.Done,
    series: [],
    timeRange: range,
    request: { requestId: 'req-1', targets: [], range, scopedVars: {}, intervalMs: 1000 } as never,
  };
  const query = vi.fn(() => of({ data: [probeFrame] }));
  get.mockResolvedValue({ query });
  const generations: number[] = [];
  const Probe = () => {
    const service = useContext(PanelQueryContext);
    const generation = service?.context.generation ?? 0;
    useEffect(() => {
      if (generation && generations.at(-1) !== generation) {
        generations.push(generation);
      }
    }, [generation]);
    return null;
  };
  const element = (zone: string) => (
    <StrictMode>
      <PanelQueryProvider
        session="dash#strict"
        data={data}
        timeRange={range}
        timeZone={zone}
        replaceVariables={() => ''}
      >
        <Probe />
      </PanelQueryProvider>
    </StrictMode>
  );
  const first = render(element('a'));
  first.rerender(element('b'));
  first.unmount();
  const second = render(element('a'));
  second.rerender(element('b'));
  expect(generations).toEqual([1, 2, 3, 4]);
  second.unmount();
  clearQuerySessions();
});
