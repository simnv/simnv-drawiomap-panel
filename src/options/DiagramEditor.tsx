import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Button, Field, Stack, TextArea, Tooltip, useTheme2 } from '@grafana/ui';
import { contractWarning } from '../adapter/portograph';
import { DrawioModal } from '../editor/DrawioModal';
import { currentAddress, requestOpen } from '../editor/popup/popupBus';
import { Diagram, Options } from '../types';
import { fnv1a } from '../util/hash';
import { importDiagram } from './importDiagram';

type Props = StandardEditorProps<Diagram | undefined, Record<string, never>, Options>;

export function DiagramEditor({ value, onChange }: Props) {
  const theme = useTheme2();
  const [modal, setModal] = useState<'edit' | 'export-only' | null>(null);
  const [xmlForModal, setXmlForModal] = useState('');
  const [paste, setPaste] = useState('');
  const [message, setMessage] = useState<string>('');
  const [noEditor, setNoEditor] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const svg = value?.svg;
  const contract = useMemo(() => (svg ? contractWarning(svg) : undefined), [svg]);

  const save = useCallback(
    (r: { xml: string; svg: string }) => {
      onChange({ xml: r.xml, svg: r.svg, hash: fnv1a(r.svg + r.xml), updatedAt: new Date().toISOString() });
      setMessage(`Saved ${Math.round(r.svg.length / 1024)} KB SVG`);
    },
    [onChange]
  );

  const startImport = (text: string) => {
    try {
      const r = importDiagram(text);
      setMessage(r.warnings.join(' '));
      setXmlForModal(r.xml);
      setModal('export-only');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const onFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) {
      return;
    }
    f.text().then(startImport);
    ev.target.value = '';
  };

  return (
    <div>
      <p>
        Draw.io edits geometry. Use Edit bindings to write the bindings next to the live diagram. Keep cell IDs
        unchanged to retain the bindings when you replace the diagram.
      </p>
      <div
        style={{ marginBottom: theme.spacing(1) }}
        data-testid="dmap-diagram-status"
        data-dmap-hash={value?.hash ?? ''}
      >
        {value?.svg
          ? `Diagram ${value.hash}, ${Math.round(value.svg.length / 1024)} KB, saved ${value.updatedAt}`
          : 'No diagram'}
      </div>
      {contract ? (
        <div
          style={{ marginBottom: theme.spacing(1), color: theme.colors.warning.text }}
          data-testid="dmap-contract-warning"
        >
          {contract}
        </div>
      ) : null}
      {/* The options pane can be 300 px wide: the buttons wrap to the next row. */}
      <Stack direction="row" wrap="wrap" gap={1}>
        <Button
          data-testid="dmap-open-editor"
          icon="edit"
          onClick={() => {
            setXmlForModal(value?.xml ?? '');
            setModal('edit');
          }}
        >
          {value?.xml ? 'Open editor' : 'New diagram'}
        </Button>
        <Button variant="secondary" icon="upload" onClick={() => fileRef.current?.click()}>
          Import .drawio
        </Button>
        <input ref={fileRef} type="file" accept=".drawio,.xml,.svg" style={{ display: 'none' }} onChange={onFile} />
        {/* The panel of this editor session opens the popup. No panel listens: the user is not in a panel editor. */}
        <Tooltip content="Open the panel editor first" show={noEditor} placement="top">
          <span>
            <Button
              data-testid="dmap-edit-bindings-option"
              variant="secondary"
              icon="link"
              disabled={!value?.svg}
              onClick={() => setNoEditor(!requestOpen(currentAddress(), { kind: 'none' }))}
              onBlur={() => setNoEditor(false)}
            >
              Edit bindings
            </Button>
          </span>
        </Tooltip>
        {value ? (
          <Button variant="destructive" icon="trash-alt" onClick={() => onChange(undefined)}>
            Clear
          </Button>
        ) : null}
      </Stack>
      <Field
        label="Paste draw.io XML"
        description="Extras > Edit Diagram in draw.io, then Apply. The editor opens once to export the SVG."
      >
        <TextArea
          rows={3}
          value={paste}
          onChange={(e) => setPaste(e.currentTarget.value)}
          data-testid="dmap-paste-xml"
        />
      </Field>
      <Button size="sm" variant="secondary" disabled={!paste.trim()} onClick={() => startImport(paste)}>
        Apply pasted XML
      </Button>
      {message ? (
        <div
          style={{ marginTop: theme.spacing(1), color: theme.colors.text.secondary }}
          data-testid="dmap-diagram-message"
        >
          {message}
        </div>
      ) : null}
      {modal ? (
        <DrawioModal
          xml={xmlForModal}
          title="draw.io map"
          mode={modal}
          isDark={theme.isDark}
          onSave={save}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}
