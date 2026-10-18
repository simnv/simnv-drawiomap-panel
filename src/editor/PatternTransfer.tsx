import { Alert, Button, Select, TextArea } from '@grafana/ui';
import React, { useState } from 'react';
import type { DiagramConfigV2 } from '../model/config';
import { exportPatternDocument, previewPatternImport, type ImportDecision, type ImportResolution } from './portable';
import { TextField } from './BindingFields';
import { EditorField, EditorSection } from './EditorLayout';

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
    <EditorSection title="Portable patterns">
      <section aria-label="Portable patterns">
        <p>
          Export includes referenced query definitions, chart assignments and element overrides. Eager panel references
          require matching destination panel queries.
        </p>
        <Button
          variant="secondary"
          size="sm"
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
        </Button>
        {exported && (
          <EditorField label="Exported pattern document">
            <TextArea aria-label="Exported pattern document" readOnly value={exported} rows={5} />
          </EditorField>
        )}
        <EditorField label="Pattern document">
          <TextArea
            aria-label="Pattern document"
            value={text}
            rows={5}
            onChange={(e) => {
              setText(e.currentTarget.value);
              setDocument(undefined);
              setResolution({});
              setError('');
            }}
          />
        </EditorField>
        <Button
          variant="secondary"
          size="sm"
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
        </Button>
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
                <EditorSection title={`Resolve ${section} ${id}`} defaultOpen key={`${section}:${id}`}>
                  <Select
                    aria-label={`${section} ${id} conflict`}
                    value={choice?.action ?? ''}
                    onChange={(selection) =>
                      choose(
                        section,
                        id,
                        (selection.value ?? '') === 'new'
                          ? { action: 'new', id: `${id}-copy` }
                          : (selection.value ?? '') === 'replace'
                            ? { action: 'replace' }
                            : undefined
                      )
                    }
                    options={[
                      { value: '', label: 'Choose resolution' },
                      { value: 'replace', label: 'Replace' },
                      { value: 'new', label: 'New identity' },
                    ]}
                    menuShouldPortal
                    maxMenuHeight={240}
                  />
                  {choice?.action === 'new' && (
                    <TextField
                      label={`${section} ${id} new identity`}
                      value={choice.id}
                      onChange={(next) => choose(section, id, { action: 'new', id: next })}
                    />
                  )}
                </EditorSection>
              );
            })}
            {preview.overrides.map((override) => (
              <EditorField
                label={`${override.cellId}: ${override.applies ? 'applies' : 'element missing'}${override.conflict ? '; override conflict' : ''}`}
                key={override.cellId}
              >
                <Select
                  aria-label={`Override ${override.cellId} destination`}
                  value={
                    Object.hasOwn(resolution.overrides ?? {}, override.cellId)
                      ? (resolution.overrides![override.cellId] ?? '__skip')
                      : '__choose'
                  }
                  onChange={(selection) => {
                    const overrides = { ...resolution.overrides };
                    if ((selection.value ?? '') === '__choose') {
                      delete overrides[override.cellId];
                    } else {
                      overrides[override.cellId] =
                        (selection.value ?? '') === '__skip' ? null : (selection.value ?? '');
                    }
                    setResolution({ ...resolution, overrides });
                  }}
                  options={[
                    {
                      value: '__choose',
                      label:
                        override.applies && !override.conflict ? 'Use current element' : 'Choose destination or skip',
                    },
                    { value: '__skip', label: 'Skip override' },
                    ...cellIds.map((id) => ({ value: id, label: `${id} (replace override)` })),
                  ]}
                  menuShouldPortal
                  maxMenuHeight={240}
                />
              </EditorField>
            ))}
            {preview.anchors.map((anchor) => (
              <EditorField
                label={`Chart anchor ${anchor.cellId}: ${anchor.applies ? 'applies' : 'element missing'}`}
                key={anchor.cellId}
              >
                <Select
                  aria-label={`Chart anchor ${anchor.cellId} destination`}
                  value={resolution.anchors?.[anchor.cellId] ?? anchor.cellId}
                  onChange={(selection) =>
                    setResolution({
                      ...resolution,
                      anchors: { ...resolution.anchors, [anchor.cellId]: selection.value ?? '' },
                    })
                  }
                  options={[
                    ...(!anchor.applies ? [{ value: anchor.cellId, label: 'Choose an existing rectangle' }] : []),
                    ...cellIds.map((id) => ({ value: id, label: id })),
                  ]}
                  menuShouldPortal
                  maxMenuHeight={240}
                />
              </EditorField>
            ))}
            {preview.diagnostics.length > 0 && (
              <Alert title="Import diagnostics" severity="error">
                <ul>
                  {preview.diagnostics.map((d, i) => (
                    <li key={i}>
                      {d.path}: {d.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={!preview.config}
              onClick={() => {
                onImport(document, resolution);
                setDocument(undefined);
              }}
            >
              Import into draft
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDocument(undefined)}>
              Cancel pattern import
            </Button>
          </section>
        )}
        {error && (
          <Alert title="Pattern transfer failed" severity="error">
            {error}
          </Alert>
        )}
      </section>
    </EditorSection>
  );
}
