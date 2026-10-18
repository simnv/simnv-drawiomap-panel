import React, { StrictMode, useContext } from 'react';
import { dateTime, LoadingState, type PanelData } from '@grafana/data';
import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PanelQueryProvider, PanelQueryContext } from './panel';
import type { QueryController } from './types';
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
