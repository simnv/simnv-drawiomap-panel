import React, { useState, type KeyboardEvent } from 'react';
import { css } from '@emotion/css';
import { Button, IconButton, Input, useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import type { AttrOrigin } from '../../binding/identity';
import type { CellMeta } from '../../types';
import { attrNameProblem, isReservedAttr } from '../setCellAttrs';

/** One shown end cell of a link: its side, readable name, id and attributes. */
export interface EndAttrs {
  side: 'source' | 'target';
  name: string;
  id: string;
  attrs: Record<string, string>;
}

export interface AttributeListProps {
  meta: CellMeta;
  /** The attributes of the owner chain that the cell does not carry itself, in the order of the bind. */
  inherited: Array<[string, AttrOrigin & { origin: string }]>;
  /** For a link: the end cells to show read-only. */
  endCells: EndAttrs[];
  /** The generator made the panel (it has a build id, spec 7.3.5). */
  generated: boolean;
  onWrite: (attrs: Record<string, string | null>) => void;
  onSelectCell: (id: string) => void;
}

/** These names have their own controls in the inspector. The row never writes them. */
const OWN_CONTROL = new Set(['bind', 'key', 'at']);

/** The names the row can edit: not reserved, not a name with its own control, and valid. */
const editable = (name: string) => !OWN_CONTROL.has(name) && attrNameProblem(name) === undefined;

/** Why the row refuses a name (lowercase), or `undefined`. */
function addProblem(name: string, meta: CellMeta): string | undefined {
  if (name === 'bind' || name === 'key') {
    return 'Use the bind and key fields above for bind and key.';
  }
  if (name === 'at') {
    return 'Use the end buttons of the link section for at.';
  }
  const problem = attrNameProblem(name);
  if (problem) {
    return problem;
  }
  return Object.hasOwn(meta.attrs, name) ? `The cell has ${name} already. Use Edit.` : undefined;
}

/**
 * The attribute list of one cell with an edit, a remove and an add action for each attribute that is not reserved
 * (D19 is superseded). `bind`, `key` and `at` and the reserved names are read-only here.
 */
export function AttributeList(props: AttributeListProps) {
  const styles = useStyles2(getStyles);
  const { meta, inherited, endCells, generated, onWrite, onSelectCell } = props;
  const [editing, setEditing] = useState<{ name: string; value: string; base: string }>();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string>();
  const { bind: _bind, key: _key, ...others } = meta.attrs;
  void _bind;
  void _key;

  const submitAdd = () => {
    const lower = name.trim().toLowerCase();
    const found = addProblem(lower, meta);
    setProblem(found);
    if (found) {
      return;
    }
    onWrite({ [lower]: value });
    setName('');
    setValue('');
  };
  const addKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      submitAdd();
    }
  };
  /** Escape in the add group, on any control: cancel the add and keep the dialog open. */
  const addGroupKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && (name || value || problem)) {
      event.preventDefault();
      event.stopPropagation();
      setName('');
      setValue('');
      setProblem(undefined);
    }
  };
  const saveEdit = () => {
    if (editing) {
      onWrite({ [editing.name]: editing.value });
      setEditing(undefined);
    }
  };
  const editKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      saveEdit();
    }
  };
  /** Escape in the edit group, on any control: cancel the edit and keep the dialog open. */
  const editGroupKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && editing) {
      event.preventDefault();
      event.stopPropagation();
      setEditing(undefined);
    }
  };
  // Undo, Redo or another write can change the attribute under an open edit: the edit is then stale, so drop it.
  if (editing && meta.attrs[editing.name] !== editing.base) {
    // React reruns the render with the new state at once, so the stale edit never reaches the screen.
    setEditing(undefined);
  }

  return (
    <>
      <h4 className={styles.subtitle}>Attributes</h4>
      <dl className={styles.list} data-testid="dmap-inspector-attrs" onKeyDown={editGroupKeys}>
        {Object.entries(others).map(([attr, current]) => (
          <React.Fragment key={attr}>
            <dt>{attr}</dt>
            {editing?.name === attr ? (
              <>
                <dd>
                  <Input
                    autoFocus
                    aria-label={`Value of ${attr}`}
                    value={editing.value}
                    onChange={(e) => setEditing({ name: attr, value: e.currentTarget.value, base: editing.base })}
                    onKeyDown={editKeys}
                  />
                </dd>
                <dd className={styles.actions}>
                  <Button size="sm" aria-label={`Save ${attr}`} onClick={saveEdit}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Cancel the edit of ${attr}`}
                    onClick={() => setEditing(undefined)}
                  >
                    Cancel
                  </Button>
                </dd>
              </>
            ) : (
              <>
                <dd>{current}</dd>
                <dd className={styles.actions}>
                  {editable(attr) ? (
                    <>
                      <IconButton
                        name="pen"
                        size="sm"
                        aria-label={`Edit ${attr}`}
                        onClick={() => setEditing({ name: attr, value: current, base: current })}
                      />
                      <IconButton
                        name="trash-alt"
                        size="sm"
                        aria-label={`Remove ${attr}`}
                        onClick={() => onWrite({ [attr]: null })}
                      />
                    </>
                  ) : isReservedAttr(attr) ? (
                    <span className={styles.note}>reserved</span>
                  ) : null}
                </dd>
              </>
            )}
          </React.Fragment>
        ))}
        {inherited.map(([attr, origin]) => (
          <React.Fragment key={`inherited ${attr}`}>
            <dt>{attr}</dt>
            <dd data-testid="dmap-inspector-inherited">{`${origin.value} (from ${origin.origin})`}</dd>
            <dd className={styles.actions}>
              {attrNameProblem(attr) === undefined ? (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Set ${attr} here`}
                  onClick={() => onWrite({ [attr]: origin.value })}
                >
                  Set here
                </Button>
              ) : null}
            </dd>
          </React.Fragment>
        ))}
      </dl>
      <div className={styles.form} role="group" aria-label="Add an attribute" onKeyDown={addGroupKeys}>
        <label className={styles.field}>
          <span>Attribute name</span>
          <Input
            value={name}
            invalid={problem !== undefined}
            onChange={(e) => {
              setName(e.currentTarget.value);
              setProblem(undefined);
            }}
            onKeyDown={addKeys}
          />
        </label>
        <label className={styles.field}>
          <span>Attribute value</span>
          <Input value={value} onChange={(e) => setValue(e.currentTarget.value)} onKeyDown={addKeys} />
        </label>
        <Button size="sm" onClick={submitAdd}>
          Add attribute
        </Button>
      </div>
      {problem ? (
        <div role="alert" className={styles.error} data-testid="dmap-inspector-attr-error">
          {problem}
        </div>
      ) : null}
      {generated ? (
        <p className={styles.note} data-testid="dmap-inspector-attrs-generated">
          This panel is generated. The next build writes these attributes again. To keep a change, change the source of
          the generator.
        </p>
      ) : null}
      {endCells.map((end) => (
        <div key={end.side} className={styles.end} data-testid="dmap-inspector-end-attrs">
          <h4 className={styles.subtitle}>{`Attributes of the ${end.side} end (${end.name})`}</h4>
          <dl className={styles.list}>
            {Object.entries(end.attrs).map(([attr, current]) => (
              <React.Fragment key={attr}>
                <dt>{attr}</dt>
                <dd>{current}</dd>
                <dd />
              </React.Fragment>
            ))}
          </dl>
          <Button size="sm" variant="secondary" onClick={() => onSelectCell(end.id)}>
            {`Select the ${end.side} end`}
          </Button>
        </div>
      ))}
    </>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  subtitle: css({ fontSize: theme.typography.bodySmall.fontSize, fontWeight: 500, margin: theme.spacing(1, 0, 0.5) }),
  list: css({
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr max-content',
    alignItems: 'center',
    columnGap: theme.spacing(1),
    margin: 0,
    '& dt': { color: theme.colors.text.secondary },
    '& dd': { margin: 0 },
  }),
  actions: css({ display: 'flex', gap: theme.spacing(0.5), justifyContent: 'flex-end' }),
  form: css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: theme.spacing(1),
    margin: theme.spacing(1, 0),
  }),
  field: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.25), minWidth: 120, flex: 1 }),
  note: css({ color: theme.colors.text.secondary, margin: 0 }),
  error: css({ color: theme.colors.error.text, margin: theme.spacing(0.5, 0) }),
  end: css({ marginTop: theme.spacing(1) }),
});
