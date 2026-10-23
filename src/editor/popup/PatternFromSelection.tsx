import React, { useEffect, useMemo, useState } from 'react';
import { Button, RadioButtonGroup, Select, TextArea } from '@grafana/ui';
import { matcherError } from '../../binding/select';
import type { CellMeta, CellSelector } from '../../types';
import { EditorField, EditorSection } from '../EditorLayout';
import { TextField } from '../BindingFields';
import { measure, proposeSelector, type Proposal } from '../proposeSelector';

export interface PatternFromSelectionProps {
  /** Every cell of the diagram. */
  cells: CellMeta[];
  /** The selected cells; at least two. */
  selectedIds: string[];
  /** The cells the shown selector matches without the selection holding them, and the selected cells it misses. */
  onMarks: (extra: string[], missed: string[]) => void;
  /** Create the pattern with this selector. */
  onCreate: (select: CellSelector) => void;
}

const KINDS = ['any', 'node', 'link', 'port', 'link-label', 'other'] as const;
const PROPOSAL_LABEL: Record<Proposal['kind'], string> = { attrs: 'Attributes', label: 'Label', ids: 'Element IDs' };

const formatAttrs = (attrs?: Record<string, string>) =>
  Object.entries(attrs ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
/** One `key=value` per line. The first `=` splits the line. A line without a key is ignored. */
function parseAttrs(text: string): Record<string, string> | undefined {
  const entries = text.split('\n').flatMap((line) => {
    const at = line.indexOf('=');
    const key = (at < 0 ? line : line.slice(0, at)).trim();
    return key && at >= 0 ? [[key, line.slice(at + 1).trim()] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}
const parseIds = (text: string) => {
  const ids = text
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length ? ids : undefined;
};

interface Edit {
  /** The selection and the proposal that the edit belongs to. A new selection or proposal drops the edit. */
  key: string;
  select: CellSelector;
  attrsText?: string;
  idsText?: string;
}

/**
 * "Create pattern from selection": the best selector for the selected cells in editable fields, how many cells it
 * matches, the other proposals, and the Create button. The stage marks the extra and the missed cells.
 */
export function PatternFromSelection({ cells, selectedIds, onMarks, onCreate }: PatternFromSelectionProps) {
  const selected = useMemo(() => cells.filter((cell) => selectedIds.includes(cell.id)), [cells, selectedIds]);
  const proposals = useMemo(() => proposeSelector(selected, cells), [selected, cells]);
  const [chosen, setChosen] = useState<Proposal['kind']>();
  const proposal = proposals.find((p) => p.kind === chosen) ?? proposals[0];
  const key = `${selectedIds.join('\u0000')}\u0001${proposal?.kind}`;
  const [edit, setEdit] = useState<Edit>();
  const select = edit?.key === key ? edit.select : proposal?.select;
  const change = (patch: Partial<Edit> & { select: CellSelector }) =>
    setEdit({ ...(edit?.key === key ? edit : { key, select: proposal.select }), ...patch, key });

  const counts = useMemo(
    () => (select ? measure(select, selected, cells) : { extra: [], missed: [] }),
    [select, selected, cells]
  );
  const matches = selected.length - counts.missed.length + counts.extra.length;
  const extraKey = counts.extra.join('\u0000');
  const missedKey = counts.missed.join('\u0000');
  useEffect(() => {
    onMarks(counts.extra, counts.missed);
    // The keys stand for the arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraKey, missedKey, onMarks]);
  useEffect(() => () => onMarks([], []), [onMarks]);

  if (!proposal || !select) {
    return null;
  }
  const labelError = select.label ? matcherError(select.label) : undefined;
  const attrErrors = Object.values(select.attrs ?? {}).flatMap((value) => matcherError(value) ?? []);
  const constrained =
    !!(select.kind && select.kind !== 'any') || !!select.ids?.length || !!select.label || !!select.attrs;
  const clean = (): CellSelector => ({
    ...(select.kind && select.kind !== 'any' ? { kind: select.kind } : {}),
    ...(select.ids?.length ? { ids: select.ids } : {}),
    ...(select.attrs ? { attrs: select.attrs } : {}),
    ...(select.label ? { label: select.label } : {}),
  });

  return (
    <EditorSection title="Create pattern from selection" defaultOpen>
      <section aria-label="Pattern from selection">
        {proposals.length > 1 && (
          <EditorField label="Proposal">
            <RadioButtonGroup<Proposal['kind']>
              aria-label="Proposal"
              size="sm"
              value={proposal.kind}
              onChange={(value) => setChosen(value)}
              fullWidth
              options={proposals.map((p) => ({
                value: p.kind,
                label: PROPOSAL_LABEL[p.kind],
                description: `${p.extra.length} extra, ${p.missed.length} missed`,
              }))}
            />
          </EditorField>
        )}
        <EditorField label="Proposed kind">
          <Select
            aria-label="Proposed kind"
            value={select.kind ?? 'any'}
            onChange={(option) =>
              change({ select: { ...select, kind: (option.value ?? 'any') as CellSelector['kind'] } })
            }
            options={KINDS.map((kind) => ({ value: kind, label: kind }))}
            menuShouldPortal
            maxMenuHeight={240}
          />
        </EditorField>
        <TextField
          label="Proposed element IDs"
          value={edit?.key === key && edit.idsText !== undefined ? edit.idsText : (select.ids?.join(',') ?? '')}
          onChange={(text) => change({ idsText: text, select: { ...select, ids: parseIds(text) } })}
        />
        <EditorField label="Proposed attributes">
          <TextArea
            aria-label="Proposed attributes"
            rows={Math.max(2, Object.keys(select.attrs ?? {}).length)}
            placeholder="key=value, one per line"
            value={edit?.key === key && edit.attrsText !== undefined ? edit.attrsText : formatAttrs(select.attrs)}
            onChange={(e) =>
              change({
                attrsText: e.currentTarget.value,
                select: { ...select, attrs: parseAttrs(e.currentTarget.value) },
              })
            }
          />
        </EditorField>
        <TextField
          label="Proposed label regex"
          value={select.label ?? ''}
          onChange={(text) => change({ select: { ...select, label: text || undefined } })}
        />
        {(labelError || attrErrors.length > 0) && (
          <p role="alert">{[labelError, ...attrErrors].filter(Boolean).join(' ')}</p>
        )}
        <p aria-live="polite" aria-label="Proposal match counts" data-testid="dmap-proposal-counts">
          matches {matches}, extra {counts.extra.length}, missed {counts.missed.length}
        </p>
        <Button
          variant="primary"
          size="sm"
          disabled={!constrained || !!labelError || attrErrors.length > 0}
          onClick={() => onCreate(clean())}
        >
          Create pattern
        </Button>
      </section>
    </EditorSection>
  );
}
