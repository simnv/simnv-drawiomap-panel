// Copied to src only by build-authoring-probe.mjs, then removed in finally.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { from } from 'rxjs';
import {
  BusEventWithPayload,
  CoreApp,
  DataSourceApi,
  DataQuery,
  DataSourcePluginContextProvider,
  FieldType,
  PanelProps,
  StandardEditorContext,
} from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { Sparkline, useTheme2 } from '@grafana/ui';
import { Options } from './types';

class SelectionProbe extends BusEventWithPayload<{ panel: number; cell: string }> {
  static type = 'drawiomap-compat-selection';
}
type ProbeOptions = Options & { __compat?: { label?: string; targets?: Record<string, DataQuery> } };

export function OptionsProbe({ context }: { context: StandardEditorContext<Options> }) {
  const [event, setEvent] = useState('none');
  useEffect(() => {
    const sub = context.eventBus
      ?.getStream(SelectionProbe)
      .subscribe((e) => setEvent(`${e.payload.panel}:${e.payload.cell}`));
    return () => sub?.unsubscribe();
  }, [context.eventBus]);
  return (
    <output data-testid="compat-editor-bus" data-context-keys={Object.keys(context).sort().join(',')}>
      {event}
    </output>
  );
}

export function PanelProbe(
  props: PanelProps<ProbeOptions> & { renderPanel: React.ComponentType<PanelProps<Options>> }
) {
  const { renderPanel: Panel, ...panelProps } = props;
  const host = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState('');
  const [realm, setRealm] = useState('unknown');
  useEffect(() => {
    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    host.current?.append(iframe);
    try {
      void iframe.contentWindow;
      setRealm('readable');
    } catch {
      setRealm('blocked');
    } finally {
      iframe.remove();
    }
  }, []);
  const [label, setLabel] = useState(props.options.__compat?.label ?? '');
  const saved = props.options.__compat;
  const choose = (target: EventTarget | null) => {
    const cell = target instanceof Element ? target.closest('[data-cell-id]')?.getAttribute('data-cell-id') : null;
    if (cell) {
      setSelected(cell);
      props.eventBus.publish(new SelectionProbe({ panel: props.id, cell }));
    }
  };
  useLayoutEffect(() => {
    if (selected) {
      heading.current?.scrollIntoView({ block: 'nearest' });
      heading.current?.focus();
    }
  }, [selected]);
  return (
    <div ref={host} data-testid={`compat-panel-${props.id}`} style={{ height: '100%', overflow: 'auto' }}>
      <div onClick={(e) => choose(e.target)} style={{ height: 260, position: 'relative', overflow: 'hidden' }}>
        <Panel {...panelProps} height={260} />
      </div>
      <PortalProbe host={host} range={props.timeRange} />
      <NativeEditor props={props} />
      <output data-testid="compat-realm">{realm}</output>
      <section aria-label="Binding inspector">
        <h3 ref={heading} tabIndex={-1}>
          {selected || 'No selection'} bindings
        </h3>
        <label>
          Binding label
          <input aria-label="Binding label" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
        </label>
        <button onClick={() => props.onOptionsChange({ ...props.options, __compat: { ...saved, label } })}>
          Apply binding
        </button>
        <output data-testid="compat-saved">{saved?.label ?? ''}</output>
        <output data-testid="compat-context">
          {props.timeRange.from.valueOf()}:{props.timeRange.to.valueOf()}:{props.replaceVariables('$site')}
        </output>
      </section>
    </div>
  );
}

const defaults: Record<string, DataQuery & Record<string, unknown>> = {
  'compat-prom': {
    refId: 'DETAIL',
    expr: 'vector(23)',
    editorMode: 'code',
    format: 'time_series',
    range: true,
    compatOpaque: { keep: ['native', 7] },
  },
  'compat-testdata': {
    refId: 'DETAIL',
    scenarioId: 'random_walk',
    alias: 'original',
    compatOpaque: { keep: ['native', 7] },
  },
};

function NativeEditor({ props }: { props: PanelProps<ProbeOptions> }) {
  const [uid, setUid] = useState('compat-prom');
  const [datasource, setDatasource] = useState<DataSourceApi>();
  const [targets, setTargets] = useState<Record<string, DataQuery>>(props.options.__compat?.targets ?? defaults);
  const [status, setStatus] = useState('idle');
  const query = targets[uid];
  useEffect(() => {
    let current = true;
    getDataSourceSrv()
      .get(uid)
      .then((ds) => {
        if (current) setDatasource(ds);
      })
      .catch((e) => setStatus(String(e)));
    return () => {
      current = false;
    };
  }, [uid]);
  const settings = getDataSourceSrv().getInstanceSettings(uid);
  const Editor = datasource?.uid === uid ? datasource.components?.QueryEditor : undefined;
  const filtered = { ...props.data, series: props.data.series.filter((frame) => frame.refId === query.refId) };
  const preview = () => {
    if (!datasource) return;
    setStatus('loading');
    from(
      datasource.query({
        requestId: `compat-${props.id}`,
        interval: '5s',
        intervalMs: 5000,
        range: props.timeRange,
        scopedVars: {},
        targets: [{ ...query, datasource: { uid, type: settings?.type } }],
        maxDataPoints: 80,
        timezone: props.timeZone,
        app: CoreApp.Dashboard,
        startTime: Date.now(),
      })
    ).subscribe({ next: (r) => setStatus(`frames:${r.data.length}`), error: (e) => setStatus(`error:${String(e)}`) });
  };
  return (
    <section data-testid="compat-native-editor" aria-label="Native datasource editor">
      <button onClick={() => setUid('compat-prom')}>Prometheus editor</button>
      <button onClick={() => setUid('compat-testdata')}>TestData editor</button>
      <output data-testid="compat-native-target">{JSON.stringify(query)}</output>
      <div data-testid="compat-installed-editor">
        {Editor && settings ? (
          <DataSourcePluginContextProvider instanceSettings={settings}>
            <Editor
              datasource={datasource!}
              query={query}
              range={props.timeRange}
              data={filtered}
              queries={[query]}
              app={CoreApp.Dashboard}
              onChange={(next) => setTargets((old) => ({ ...old, [uid]: { ...old[uid], ...next } }))}
              onRunQuery={() => setStatus('Preview required')}
            />
          </DataSourcePluginContextProvider>
        ) : (
          <span>Loading public query editor</span>
        )}
      </div>
      <button
        onClick={() => props.onOptionsChange({ ...props.options, __compat: { ...props.options.__compat, targets } })}
      >
        Save native targets
      </button>
      <button onClick={preview}>Preview native query</button>
      <output data-testid="compat-preview-status">{status}</output>
    </section>
  );
}

function PortalProbe({
  host,
  range,
}: {
  host: React.RefObject<HTMLDivElement>;
  range: PanelProps<Options>['timeRange'];
}) {
  const [portal, setPortal] = useState<SVGForeignObjectElement>();
  const [diagnostic, setDiagnostic] = useState('not mounted');
  const theme = useTheme2();
  useEffect(() => {
    const anchor = host.current?.querySelector<SVGRectElement>('[data-cell-id="chart-1"] rect');
    const parent = anchor?.parentElement as unknown as SVGGraphicsElement | null;
    if (!anchor || !parent) {
      setDiagnostic(`host:${!!host.current};anchor:${!!anchor};parent:${!!parent}`);
      return;
    }
    const parentCTM = parent.getCTM();
    const anchorCTM = anchor.getCTM();
    if (!parentCTM || !anchorCTM) {
      setDiagnostic('missing CTM');
      return;
    }
    const matrix = parentCTM.inverse().multiply(anchorCTM);
    const bounds = anchor.getBBox();
    const region = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    for (const key of ['x', 'y', 'width', 'height'] as const) region.setAttribute(key, String(bounds[key]));
    region.setAttribute('transform', `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
    region.setAttribute('data-testid', 'compat-portal');
    region.style.overflow = 'visible';
    anchor.after(region);
    setPortal(region);
    return () => region.remove();
  }, [host]);
  if (!portal) return <output data-testid="compat-portal-diagnostic">{diagnostic}</output>;
  const from = range.from.valueOf();
  const to = range.to.valueOf();
  return createPortal(
    <div
      data-testid="compat-sparkline"
      data-theme={theme.isDark ? 'dark' : 'light'}
      style={{
        width: 180,
        height: 70,
        fontSize: 12,
        fontFamily: theme.typography.fontFamily,
        color: theme.colors.text.primary,
        background: theme.colors.background.primary,
        position: 'relative',
      }}
    >
      <Sparkline
        width={180}
        height={70}
        theme={theme}
        config={{ custom: { lineWidth: 2, fillOpacity: 15 } }}
        sparkline={{
          x: {
            name: 'Time',
            type: FieldType.time,
            config: {},
            values: [from, from + (to - from) / 3, from + (2 * (to - from)) / 3, to],
          },
          y: {
            name: 'Traffic',
            type: FieldType.number,
            config: {},
            state: { range: { min: 10, max: 40, delta: 30 } },
            values: [10, 30, 15, 40],
          },
          timeRange: range,
        }}
      />
      <span
        data-testid="compat-overflow"
        style={{ position: 'absolute', left: 176, top: 20, width: 50, height: 20, background: 'lime' }}
      />
    </div>,
    portal
  );
}
