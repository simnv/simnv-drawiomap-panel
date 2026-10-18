import React, { useState } from 'react';
import type { DiagramConfigV2 } from '../model/config';
import { exportPatternDocument, previewPatternImport, type ImportDecision, type ImportResolution } from './portable';
import { TextField } from './BindingFields';

export function PatternTransfer({
  config,
  cellIds,
  onImport,
}: {
  config: DiagramConfigV2;
  cellIds: string[];
  onImport: (document: unknown, resolution: ImportResolution) => void;
}) {
  const [text, setText] = useState('');
  const [document, setDocument] = useState<unknown>();
  const [resolution, setResolution] = useState<ImportResolution>({});
  const [error, setError] = useState('');
  const [exported, setExported] = useState('');
  const preview = document !== undefined ? previewPatternImport(config, document, cellIds, resolution) : undefined;
  const sources =
    document && typeof document === 'object' && 'config' in document
      ? (() => {
          try {
            return exportPatternDocument((document as { config: DiagramConfigV2 }).config).config.queries;
          } catch {
            return [];
          }
        })()
      : [];
  const choose = (section: 'queries' | 'patterns' | 'widgets', id: string, value?: ImportDecision) => {
    const next = { ...resolution[section] };
    if (value) {
      next[id] = value;
    } else {
      delete next[id];
    }
    setResolution({ ...resolution, [section]: next });
  };
  return (
    <section aria-label="Portable patterns">
      <h3>Portable patterns</h3>
      <p>
        Export includes referenced query definitions, chart assignments and element overrides. Eager panel references
        require matching destination panel queries.
      </p>
      <button
        onClick={() => {
          try {
            setExported(JSON.stringify(exportPatternDocument(config), null, 2));
            setError('');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Export patterns
      </button>
      {exported && (
        <label>
          Exported pattern document
          <textarea aria-label="Exported pattern document" readOnly value={exported} rows={5} />
        </label>
      )}
      <label>
        Pattern document
        <textarea
          aria-label="Pattern document"
          value={text}
          rows={5}
          onChange={(e) => {
            setText(e.target.value);
            setDocument(undefined);
            setResolution({});
            setError('');
          }}
        />
      </label>
      <button
        onClick={() => {
          try {
            setDocument(JSON.parse(text));
            setError('');
          } catch {
            setDocument(undefined);
            setError('Pattern document must be valid JSON.');
          }
        }}
      >
        Preview pattern import
      </button>
      {preview && (
        <section aria-label="Pattern import preview">
          <p>Preview does not execute queries. Import changes the draft; Apply saves it.</p>
          {sources.map((q) => (
            <p key={q.id}>
              Query {q.id}:{' '}
              {q.source.kind === 'datasource'
                ? `datasource ${q.source.datasource?.uid}`
                : `eager panel reference ${q.source.refId}; check the destination query`}
            </p>
          ))}
          {preview.conflicts.map(({ section, id }) => {
            const choice = resolution[section]?.[id];
            return (
              <fieldset key={`${section}:${id}`}>
                <legend>
                  {section} {id} conflict
                </legend>
                <select
                  aria-label={`${section} ${id} conflict`}
                  value={choice?.action ?? ''}
                  onChange={(e) =>
                    choose(
                      section,
                      id,
                      e.target.value === 'new'
                        ? { action: 'new', id: `${id}-copy` }
                        : e.target.value === 'replace'
                          ? { action: 'replace' }
                          : undefined
                    )
                  }
                >
                  <option value="">Choose resolution</option>
                  <option value="replace">Replace</option>
                  <option value="new">New identity</option>
                </select>
                {choice?.action === 'new' && (
                  <TextField
                    label={`${section} ${id} new identity`}
                    value={choice.id}
                    onChange={(next) => choose(section, id, { action: 'new', id: next })}
                  />
                )}
              </fieldset>
            );
          })}
          {preview.overrides.map((override) => (
            <label key={override.cellId} style={{ display: 'block' }}>
              {override.cellId}: {override.applies ? 'applies' : 'element missing'}
              {override.conflict ? '; override conflict' : ''}
              <select
                aria-label={`Override ${override.cellId} destination`}
                value={
                  Object.hasOwn(resolution.overrides ?? {}, override.cellId)
                    ? (resolution.overrides![override.cellId] ?? '__skip')
                    : '__choose'
                }
                onChange={(e) => {
                  const overrides = { ...resolution.overrides };
                  if (e.target.value === '__choose') {
                    delete overrides[override.cellId];
                  } else {
                    overrides[override.cellId] = e.target.value === '__skip' ? null : e.target.value;
                  }
                  setResolution({ ...resolution, overrides });
                }}
              >
                <option value="__choose">
                  {override.applies && !override.conflict ? 'Use current element' : 'Choose destination or skip'}
                </option>
                <option value="__skip">Skip override</option>
                {cellIds.map((id) => (
                  <option key={id} value={id}>
                    {id} (replace override)
                  </option>
                ))}
              </select>
            </label>
          ))}
          {preview.anchors.map((anchor) => (
            <label key={anchor.cellId} style={{ display: 'block' }}>
              Chart anchor {anchor.cellId}: {anchor.applies ? 'applies' : 'element missing'}
              <select
                aria-label={`Chart anchor ${anchor.cellId} destination`}
                value={resolution.anchors?.[anchor.cellId] ?? anchor.cellId}
                onChange={(e) =>
                  setResolution({ ...resolution, anchors: { ...resolution.anchors, [anchor.cellId]: e.target.value } })
                }
              >
                {!anchor.applies && <option value={anchor.cellId}>Choose an existing rectangle</option>}
                {cellIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {preview.diagnostics.length > 0 && (
            <ul role="alert">
              {preview.diagnostics.map((d, i) => (
                <li key={i}>
                  {d.path}: {d.message}
                </li>
              ))}
            </ul>
          )}
          <button
            disabled={!preview.config}
            onClick={() => {
              onImport(document, resolution);
              setDocument(undefined);
            }}
          >
            Import into draft
          </button>
          <button onClick={() => setDocument(undefined)}>Cancel pattern import</button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
