import React, { useEffect, useState } from 'react';
import { CoreApp, DataSourcePluginContextProvider, type DataSourceApi, type PanelData } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { validateConfig, type NamedQuery } from '../model/config';
import type { QueryContext } from '../query/types';
import { EMPTY_CONFIG } from './draft';
export interface QueryEditorProps {
  query: NamedQuery;
  context: QueryContext;
  data: PanelData;
  onChange: (query: NamedQuery) => void;
  onPreview: () => void;
  onValidity?: (message: string) => void;
}
export function QueryEditor({ query, context, data, onChange, onPreview, onValidity }: QueryEditorProps) {
  const source = query.source;
  const ref = source.kind === 'datasource' ? (source.datasource ?? context.defaultDatasource) : undefined;
  const uid = ref?.uid;
  const [loaded, setLoaded] = useState<{ uid: string; datasource: DataSourceApi }>();
  const [failedUid, setFailedUid] = useState<string>();
  const [notice, setNotice] = useState('');
  const [json, setJson] = useState(() => (source.kind === 'datasource' ? JSON.stringify(source.target, null, 2) : ''));
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (uid) {
      getDataSourceSrv()
        .get(uid)
        .then((datasource) => {
          if (active) {
            setLoaded({ uid, datasource });
          }
        })
        .catch(() => {
          if (active) {
            setFailedUid(uid);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [uid]);
  const datasource = loaded?.uid === uid ? loaded?.datasource : undefined;
  const settings = uid ? getDataSourceSrv().getInstanceSettings(uid) : undefined;
  const Editor = datasource?.components?.QueryEditor;
  const loadingEditor = !!uid && loaded?.uid !== uid && failedUid !== uid;
  const targets = data.request?.targets;
  const eager =
    source.kind === 'panel' ||
    (source.kind === 'datasource' && (!targets || targets.some((t) => t.refId === source.target.refId)));
  const convert = () => {
    if (source.kind !== 'panel') {
      return;
    }
    const target = targets?.find((t) => t.refId === source.refId);
    if (!target) {
      setNotice('The eager target is unavailable. Open the Grafana Queries tab and copy its native JSON definition.');
      return;
    }
    onChange({
      ...query,
      source: {
        kind: 'datasource',
        datasource: target.datasource ?? context.defaultDatasource,
        target: JSON.parse(JSON.stringify(target)),
        parameters: {},
      },
    });
  };
  return (
    <section aria-label={`Query ${query.name}`}>
      <label>
        Query name
        <input
          aria-label="Query name"
          value={query.name}
          onChange={(e) => onChange({ ...query, name: e.target.value })}
        />
      </label>
      <p>Query identity: {query.id}</p>
      {eager && (
        <p role="status">
          {source.kind === 'panel'
            ? 'Eager panel reference. Grafana loads this target even while hover is closed.'
            : "Lazy loading is not verified. If this native target is also in Grafana's Queries tab, remove its eager copy and run the panel to verify removal."}
        </p>
      )}
      {source.kind === 'panel' ? (
        <>
          <label>
            Panel refId
            <input
              aria-label="Panel refId"
              value={source.refId}
              onChange={(e) => onChange({ ...query, source: { ...source, refId: e.target.value } })}
            />
          </label>
          <button onClick={convert}>Convert to hover-only query</button>
        </>
      ) : (
        <>
          <label>
            Datasource override UID
            <input
              aria-label="Datasource override UID"
              placeholder="Use panel default"
              value={source.datasource?.uid ?? ''}
              onChange={(e) =>
                onChange({
                  ...query,
                  source: { ...source, datasource: e.target.value ? { uid: e.target.value } : undefined },
                })
              }
            />
          </label>
          <p>Effective datasource: {uid ?? 'Choose a panel default or query override'}</p>
          {Editor && settings && datasource ? (
            <DataSourcePluginContextProvider instanceSettings={settings}>
              <Editor
                datasource={datasource}
                query={source.target}
                range={context.timeRange}
                data={{ ...data, series: data.series.filter((frame) => frame.refId === source.target.refId) }}
                queries={[source.target]}
                app={CoreApp.Dashboard}
                onChange={(next) =>
                  onChange({
                    ...query,
                    source: {
                      ...source,
                      target: {
                        // Native editors may include undefined optional properties; JSON omits them.
                        ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)),
                        refId: next.refId || source.target.refId,
                      },
                    },
                  })
                }
                onRunQuery={() => setNotice('Use Preview query to execute this draft.')}
              />
            </DataSourcePluginContextProvider>
          ) : loadingEditor ? (
            <p>Loading native query editor…</p>
          ) : (
            <p>No supported native query editor is available. Import a datasource-native target JSON object below.</p>
          )}
          <details>
            <summary>Import native target JSON</summary>
            <textarea aria-label="Native target JSON" value={json} onChange={(e) => setJson(e.target.value)} />
            <button
              onClick={() => {
                let message = '';
                try {
                  const target: unknown = JSON.parse(json);
                  const candidate = { ...query, source: { ...source, target } };
                  const checked = validateConfig({
                    ...EMPTY_CONFIG,
                    defaultDatasource: context.defaultDatasource,
                    queries: [candidate],
                  });
                  if (!checked.config) {
                    message = checked.diagnostics.map((d) => d.message).join(' ');
                  } else {
                    onChange(checked.config.queries[0]);
                  }
                } catch {
                  message = 'Invalid native target JSON. Supply a JSON object with a nonempty refId.';
                }
                setError(message);
                onValidity?.(message);
              }}
            >
              Import native target
            </button>
          </details>
          <fieldset>
            <legend>Parameter mapping</legend>
            {Object.entries(source.parameters).map(([name, path]) => (
              <div key={name}>
                <label>
                  Parameter name
                  <input
                    aria-label={`${name} parameter name`}
                    defaultValue={name}
                    onBlur={(e) => {
                      const nextName = e.target.value;
                      if (nextName === name) {
                        return;
                      }
                      if (nextName in source.parameters) {
                        setError(`Parameter ${nextName} already exists.`);
                        onValidity?.(`Parameter ${nextName} already exists.`);
                        return;
                      }
                      const parameters = { ...source.parameters };
                      delete parameters[name];
                      parameters[nextName] = path;
                      setError('');
                      onValidity?.('');
                      onChange({ ...query, source: { ...source, parameters } });
                    }}
                  />
                </label>
                <label>
                  {name} semantic path
                  <input
                    aria-label={`${name} semantic path`}
                    value={path}
                    onChange={(e) =>
                      onChange({
                        ...query,
                        source: { ...source, parameters: { ...source.parameters, [name]: e.target.value } },
                      })
                    }
                  />
                </label>
                <button
                  onClick={() => {
                    const parameters = { ...source.parameters };
                    delete parameters[name];
                    onChange({ ...query, source: { ...source, parameters } });
                  }}
                >
                  Remove {name}
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                let i = 1;
                while (`dm_parameter${i}` in source.parameters) {
                  i++;
                }
                onChange({
                  ...query,
                  source: { ...source, parameters: { ...source.parameters, [`dm_parameter${i}`]: 'cell.key' } },
                });
              }}
            >
              Add parameter
            </button>
            <p>Use $dm_parameter1 in the native target. The datasource handles variable escaping.</p>
          </fieldset>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <button onClick={onPreview}>Preview query</button>
    </section>
  );
}
