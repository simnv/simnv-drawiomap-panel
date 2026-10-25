import React from 'react';
import { createTheme, getDefaultTimeRange, LoadingState } from '@grafana/data';
import { render } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import { bindContextFor } from '../binding/context';
import type { DiagramConfig } from '../model/config';
import { createQueryController } from '../query/controller';
import { PanelQueryContext, type PanelQueryService } from '../query/panel';
import { testQueryService } from '../query/testService';
import type { Diagram } from '../types';
import { BindingEditor, type BindingEditorProps } from './BindingEditor';
import { baseRevision } from './revision';

/** An svg with these cells. Every cell is a group with a rectangle, as draw.io exports it. */
export const svgOf = (...ids: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">${ids
    .map((id, i) => `<g data-cell-id="${id}"><rect x="${i * 60}" y="10" width="50" height="30"/></g>`)
    .join('')}</svg>`;

export const diagramOf = (svg: string, hash = 'test'): Diagram => ({
  svg,
  xml: '<mxfile/>',
  hash,
  updatedAt: '2026-10-23T00:00:00Z',
});

export const emptyData = () => ({ state: LoadingState.Done, series: [], timeRange: getDefaultTimeRange() });

export const testBindContext = () =>
  bindContextFor({
    theme: createTheme(),
    timeZone: 'utc',
    replaceVariables: (text) => text,
    linkWidth: { min: 2, max: 10 },
  });

type AnyMock = Mock<(...args: any[]) => any>;

/** A query service whose controller never answers. The query pane needs a context. */
export const idleService = (): PanelQueryService =>
  testQueryService(
    createQueryController(() => () => {}),
    {
      timeRange: getDefaultTimeRange(),
      timeZone: 'utc',
      scopedVars: {},
      refreshMs: 0,
      intervalMs: 1000,
      generation: 1,
    }
  );

export interface EditorHarnessProps extends Partial<Omit<BindingEditorProps, 'config' | 'diagram'>> {
  config: DiagramConfig;
  /** The svg of the diagram; default: no cells. */
  svg?: string;
  diagram?: Diagram;
  /** The query service of the panel. Without it the editor has no query controller. */
  service?: PanelQueryService;
}

/** Render the bindings editor with the props of a panel. `onApply` is the spy that tests read as `save`. */
export function renderEditor({
  config,
  svg = svgOf(),
  diagram,
  service = idleService(),
  ...props
}: EditorHarnessProps) {
  const onApply = (props.onApply ?? vi.fn()) as AnyMock;
  const saved = diagram ?? diagramOf(svg);
  const onRequestClose = (props.onRequestClose ?? vi.fn()) as AnyMock;
  const element = (
    <BindingEditor
      config={config}
      diagram={saved}
      base={baseRevision({ config, diagram: saved })}
      data={emptyData()}
      timeZone="utc"
      bindContext={testBindContext()}
      owner="popup:1"
      {...props}
      onApply={onApply}
      onRequestClose={onRequestClose}
    />
  );
  const wrap = (child: React.ReactElement, value = service) =>
    value ? <PanelQueryContext.Provider value={value}>{child}</PanelQueryContext.Provider> : child;
  const view = render(wrap(element));
  return {
    ...view,
    save: onApply,
    close: onRequestClose,
    /** Give the same editor a new query service, as a dashboard refresh does. */
    rerenderService: (next: PanelQueryService) => view.rerender(wrap(element, next)),
  };
}
