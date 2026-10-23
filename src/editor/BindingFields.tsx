import { Button, Input, Select, Switch } from '@grafana/ui';
import React, { useId, useState } from 'react';
import type {
  DisplayConfig,
  FreshnessPolicy,
  HoverRow,
  NamedQuery,
  QueryBinding,
  StatusCondition,
  StatusRule,
} from '../model/config';
import type { ReducerName } from '../types';
import { EditorField, EditorSection, sourceFor, SourceRow, type SourceProps } from './EditorLayout';

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  path,
  ...sources
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  /** The display path of the field. With `sourceOf` the field shows its source. */
  path?: string;
} & SourceProps) {
  return (
    <EditorField label={label} source={sourceFor(sources, path)}>
      <Input aria-label={label} type={type} value={value} onChange={(e) => onChange(e.currentTarget.value)} />
    </EditorField>
  );
}
export const newBinding = (queryId = ''): QueryBinding => ({ queryId, match: {}, reducer: 'last' });

/** '' is no bound, a keyword (for example "auto") when the field allows it, else a finite number; null is not valid. */
function parseBound(text: string, keywords: readonly string[]): number | string | undefined | null {
  const t = text.trim();
  if (t === '') {
    return undefined;
  }
  if (keywords.includes(t)) {
    return t;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
/** A Y range bound. The text stays editable while it is not valid (for example "au"); valid text is applied. */
export function BoundField<T extends number | string>({
  label,
  value,
  onChange,
  auto = false,
  keywords = auto ? ['auto'] : [],
  path,
  ...sources
}: {
  label: string;
  value?: T;
  onChange: (value?: T) => void;
  /** the field also takes "auto" */
  auto?: boolean;
  /** the words that the field takes besides numbers; default: "auto" when auto is set */
  keywords?: readonly string[];
  path?: string;
} & SourceProps) {
  const shown = value === undefined ? '' : String(value);
  const [text, setText] = useState(shown);
  // a new value from outside (cancel, import) replaces the text, unless the text already means that value
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (parseBound(text, keywords) !== value) {
      setText(shown);
    }
  }
  return (
    <TextField
      label={label}
      path={path}
      {...sources}
      value={text}
      onChange={(next) => {
        setText(next);
        const bound = parseBound(next, keywords);
        if (bound !== null) {
          onChange(bound as T | undefined);
        }
      }}
    />
  );
}
export function FreshnessFields({
  label,
  value,
  onChange,
  path,
  ...sources
}: {
  label: string;
  value?: FreshnessPolicy;
  onChange: (value?: FreshnessPolicy) => void;
  path?: string;
} & SourceProps) {
  return (
    <EditorSection title={`${label} sample freshness`} defaultOpen>
      <EditorField label={`${label} check sample freshness`} source={sourceFor(sources, path)}>
        <Switch
          aria-label={`${label} check sample freshness`}
          value={!!value}
          onChange={(e) =>
            onChange(e.currentTarget.checked ? { expectedIntervalMs: 15000, staleAfterMs: 45000 } : undefined)
          }
        />
      </EditorField>
      <p>Without a policy, sample age does not imply stale data.</p>
      {value && (
        <>
          <TextField
            label={`${label} expected sample interval ms`}
            type="number"
            value={value.expectedIntervalMs}
            onChange={(v) => onChange({ ...value, expectedIntervalMs: Number(v) })}
          />
          <TextField
            label={`${label} stale after ms`}
            type="number"
            value={value.staleAfterMs}
            onChange={(v) => onChange({ ...value, staleAfterMs: Number(v) })}
          />
        </>
      )}
    </EditorSection>
  );
}
export function BindingFields({
  label,
  value,
  queries,
  fields = [],
  onChange,
  path,
  ...sources
}: {
  label: string;
  value?: QueryBinding;
  queries: NamedQuery[];
  fields?: string[];
  onChange: (value?: QueryBinding) => void;
  /** The display path of the binding, for example `link.a2bBinding`. */
  path?: string;
} & SourceProps) {
  const fieldListId = useId();
  const source = sourceFor(sources, path);
  return (
    <EditorSection title={`${label} metric`} defaultOpen>
      {source && <SourceRow label={`${label} metric`} source={source} />}
      <EditorField label={`${label} query`}>
        <Select
          aria-label={`${label} query`}
          value={value?.queryId ?? ''}
          onChange={(selection) =>
            onChange(
              (selection.value ?? '') ? { ...(value ?? newBinding()), queryId: selection.value ?? '' } : undefined
            )
          }
          options={[{ value: '', label: 'Inherit / unset' }, ...queries.map((q) => ({ value: q.id, label: q.name }))]}
          menuShouldPortal
          maxMenuHeight={240}
        />
      </EditorField>
      {value && (
        <>
          <EditorField label={`${label} result field`}>
            <Input
              aria-label={`${label} result field`}
              list={fieldListId}
              value={value.field ?? ''}
              onChange={(e) => onChange({ ...value, field: e.currentTarget.value || undefined })}
            />
          </EditorField>
          <datalist id={fieldListId}>
            {fields.map((field) => (
              <option key={field} value={field} />
            ))}
          </datalist>
          <EditorField label={`${label} reducer`}>
            <Select
              aria-label={`${label} reducer`}
              value={value.reducer}
              onChange={(selection) => onChange({ ...value, reducer: (selection.value ?? '') as ReducerName })}
              options={['last', 'mean', 'min', 'max'].map((r) => ({ value: r, label: r }))}
              menuShouldPortal
              maxMenuHeight={240}
            />
          </EditorField>
          {Object.entries(value.match).map(([key, match]) => (
            <div key={key}>
              <TextField
                label={`${label} match ${key}`}
                value={match}
                onChange={(v) => onChange({ ...value, match: { ...value.match, [key]: v } })}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const next = { ...value.match };
                  delete next[key];
                  onChange({ ...value, match: next });
                }}
              >
                Remove {label} match {key}
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              let n = 1;
              while (`label${n}` in value.match) {
                n++;
              }
              onChange({ ...value, match: { ...value.match, [`label${n}`]: '${cell.key}' } });
            }}
          >
            Add {label} matcher
          </Button>
          {Object.keys(value.match).map((key) => (
            <EditorField label={`${label} label name ${key}`} key={key}>
              <Input
                aria-label={`${label} label name ${key}`}
                defaultValue={key}
                onBlur={(e) => {
                  const name = e.currentTarget.value;
                  if (name === key || Object.hasOwn(value.match, name)) {
                    return;
                  }
                  const next = { ...value.match };
                  const match = next[key];
                  delete next[key];
                  next[name] = match;
                  onChange({ ...value, match: next });
                }}
              />
            </EditorField>
          ))}
        </>
      )}
    </EditorSection>
  );
}
const states = ['normal', 'warning', 'critical', 'down'] as const;
function ConditionFields({
  label,
  condition,
  onChange,
}: {
  label: string;
  condition: StatusCondition;
  onChange: (c: StatusCondition) => void;
}) {
  return (
    <>
      <EditorField label={`${label} state`}>
        <Select
          aria-label={`${label} state`}
          value={condition.state}
          onChange={(selection) =>
            onChange({ ...condition, state: (selection.value ?? '') as StatusCondition['state'] })
          }
          options={states.map((s) => ({ value: s, label: s }))}
          menuShouldPortal
          maxMenuHeight={240}
        />
      </EditorField>
      <TextField
        label={`${label} reason`}
        value={condition.reason}
        onChange={(reason) => onChange({ ...condition, reason })}
      />
    </>
  );
}
export function DisplayFields({
  value,
  queries,
  fields,
  onChange,
  sourceOf,
  onReset,
}: {
  value: DisplayConfig;
  queries: NamedQuery[];
  fields?: string[];
  onChange: (display: Partial<DisplayConfig>) => void;
} & SourceProps) {
  const src: SourceProps = { sourceOf, onReset };
  const first = queries[0]?.id ?? '';
  const rows = value.hover?.rows ?? [];
  const setRows = (next: HoverRow[]) => onChange({ hover: { ...value.hover, rows: next } });
  const setRow = (i: number, row: HoverRow) => setRows(rows.map((old, j) => (i === j ? row : old)));
  const status = value.status;
  const setStatus = (next: StatusRule) => onChange({ status: next });
  return (
    <>
      <EditorSection title="General" defaultOpen>
        <EditorField label="Enable element" source={sourceFor(src, 'enabled')}>
          <Switch
            aria-label="Enable element"
            value={value.enabled !== false}
            onChange={(e) => onChange({ enabled: e.currentTarget.checked })}
          />
        </EditorField>
        <TextField
          label="Label template"
          path="label"
          {...src}
          value={value.label ?? ''}
          onChange={(label) => onChange({ label })}
        />
        <EditorField label="Write value to shape label" source={sourceFor(src, 'shape.text')}>
          <Switch
            aria-label="Write value to shape label"
            value={!!value.shape?.text}
            onChange={(e) => onChange({ shape: { ...value.shape, text: e.currentTarget.checked } })}
          />
        </EditorField>
        <TextField
          label="Drilldown URL"
          path="url"
          {...src}
          value={value.url ?? ''}
          onChange={(url) => onChange({ url })}
        />
      </EditorSection>
      <EditorSection title="Shape">
        <EditorField label="Enable shape binding" source={sourceFor(src, 'shape.enabled')}>
          <Switch
            aria-label="Enable shape binding"
            value={value.shape?.enabled !== false}
            onChange={(e) => onChange({ shape: { ...value.shape, enabled: e.currentTarget.checked } })}
          />
        </EditorField>
        <BindingFields
          label="Shape"
          path="shape.binding"
          {...src}
          value={value.shape?.binding}
          queries={queries}
          fields={fields}
          onChange={(binding) => onChange({ shape: { ...value.shape, binding } })}
        />
        <EditorField label="Shape colour target" source={sourceFor(src, 'shape.target')}>
          <Select
            aria-label="Shape colour target"
            value={value.shape?.target ?? 'icon'}
            onChange={(selection) =>
              onChange({ shape: { ...value.shape, target: (selection.value ?? '') as 'icon' | 'shape' | 'stroke' } })
            }
            options={['icon', 'shape', 'stroke'].map((v) => ({ value: v, label: v }))}
            menuShouldPortal
            maxMenuHeight={240}
          />
        </EditorField>
      </EditorSection>
      <EditorSection title="Link">
        <EditorField label="Enable link binding" source={sourceFor(src, 'link.enabled')}>
          <Switch
            aria-label="Enable link binding"
            value={value.link?.enabled !== false}
            onChange={(e) => onChange({ link: { ...value.link, enabled: e.currentTarget.checked } })}
          />
        </EditorField>
        {(['a2bBinding', 'b2aBinding', 'capacityBinding'] as const).map((key, i) => (
          <BindingFields
            key={key}
            label={['A to B', 'B to A', 'Capacity'][i]}
            path={`link.${key}`}
            {...src}
            value={value.link?.[key]}
            queries={queries}
            fields={fields}
            onChange={(binding) => onChange({ link: { ...value.link, [key]: binding } })}
          />
        ))}
        <TextField
          label="Link capacity"
          path="link.capacity"
          {...src}
          type="number"
          value={typeof value.link?.capacity === 'number' ? value.link.capacity : ''}
          onChange={(v) => onChange({ link: { ...value.link, capacity: v ? Number(v) : undefined } })}
        />
      </EditorSection>
      <EditorSection title="Explicit health status">
        {!status ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setStatus({
                kind: 'mapping',
                binding: newBinding(first),
                default: { state: 'normal', reason: 'Health check passed' },
                mappings: [{ value: 0, state: 'down', reason: 'Health check failed' }],
              })
            }
          >
            Add health rule
          </Button>
        ) : (
          <>
            <EditorField label="Enable health status" source={sourceFor(src, 'status.enabled')}>
              <Switch
                aria-label="Enable health status"
                value={status.enabled !== false}
                onChange={(e) => setStatus({ ...status, enabled: e.currentTarget.checked })}
              />
            </EditorField>
            <BindingFields
              label="Health"
              path="status.binding"
              {...src}
              queries={queries}
              fields={fields}
              value={status.binding}
              onChange={(binding) => setStatus({ ...status, binding: binding ?? newBinding() })}
            />
            <EditorField label="Health rule type" source={sourceFor(src, 'status.kind')}>
              <Select
                aria-label="Health rule type"
                value={status.kind}
                onChange={(selection) => {
                  const { binding, default: fallback, enabled, freshness } = status;
                  setStatus(
                    (selection.value ?? '') === 'mapping'
                      ? {
                          kind: 'mapping',
                          binding,
                          default: fallback,
                          enabled,
                          freshness,
                          mappings: [{ value: 0, state: 'down', reason: 'Health check failed' }],
                        }
                      : {
                          kind: 'predicates',
                          binding,
                          default: fallback,
                          enabled,
                          freshness,
                          predicates: [
                            { op: 'gt', value: 80, state: 'warning', reason: 'Configured threshold exceeded' },
                          ],
                        }
                  );
                }}
                options={[
                  { value: 'mapping', label: 'Explicit value mapping' },
                  { value: 'predicates', label: 'Opt-in thresholds' },
                ]}
                menuShouldPortal
                maxMenuHeight={240}
              />
            </EditorField>
            <ConditionFields
              label="Default health"
              condition={status.default}
              onChange={(fallback) => setStatus({ ...status, default: fallback })}
            />
            {(status.kind === 'mapping' ? status.mappings : status.predicates).map((c, i) => (
              <div key={i}>
                <TextField
                  label={`Health condition ${i + 1} value`}
                  type="number"
                  value={c.value}
                  onChange={(v) => {
                    if (status.kind === 'mapping') {
                      setStatus({
                        ...status,
                        mappings: status.mappings.map((old, j) => (i === j ? { ...old, value: Number(v) } : old)),
                      });
                    } else {
                      setStatus({
                        ...status,
                        predicates: status.predicates.map((old, j) => (i === j ? { ...old, value: Number(v) } : old)),
                      });
                    }
                  }}
                />
                {status.kind === 'predicates' && (
                  <EditorField label={`Health condition ${i + 1} operator`}>
                    <Select
                      aria-label={`Health condition ${i + 1} operator`}
                      value={status.predicates[i].op}
                      onChange={(selection) =>
                        setStatus({
                          ...status,
                          predicates: status.predicates.map((old, j) =>
                            i === j ? { ...old, op: (selection.value ?? '') as 'gt' } : old
                          ),
                        })
                      }
                      options={['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].map((op) => ({ value: op, label: op }))}
                      menuShouldPortal
                      maxMenuHeight={240}
                    />
                  </EditorField>
                )}
                <ConditionFields
                  label={`Health condition ${i + 1}`}
                  condition={c}
                  onChange={(next) => {
                    if (status.kind === 'mapping') {
                      setStatus({
                        ...status,
                        mappings: status.mappings.map((old, j) => (i === j ? { ...old, ...next } : old)),
                      });
                    } else {
                      setStatus({
                        ...status,
                        predicates: status.predicates.map((old, j) => (i === j ? { ...old, ...next } : old)),
                      });
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    status.kind === 'mapping'
                      ? setStatus({ ...status, mappings: status.mappings.filter((_, j) => i !== j) })
                      : setStatus({ ...status, predicates: status.predicates.filter((_, j) => i !== j) })
                  }
                >
                  Remove health condition {i + 1}
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                status.kind === 'mapping'
                  ? setStatus({
                      ...status,
                      mappings: [...status.mappings, { value: 1, state: 'warning', reason: 'Configured warning' }],
                    })
                  : setStatus({
                      ...status,
                      predicates: [
                        ...status.predicates,
                        { op: 'gt', value: 90, state: 'critical', reason: 'Configured threshold exceeded' },
                      ],
                    })
              }
            >
              Add health condition
            </Button>
            <EditorField label="Check sample freshness">
              <Switch
                aria-label="Check sample freshness"
                value={!!status.freshness}
                onChange={(e) =>
                  setStatus({
                    ...status,
                    freshness: e.currentTarget.checked ? { expectedIntervalMs: 15000, staleAfterMs: 45000 } : undefined,
                  })
                }
              />
            </EditorField>
            {status.freshness && (
              <>
                <TextField
                  label="Expected sample interval ms"
                  type="number"
                  value={status.freshness.expectedIntervalMs}
                  onChange={(v) =>
                    setStatus({ ...status, freshness: { ...status.freshness!, expectedIntervalMs: Number(v) } })
                  }
                />
                <TextField
                  label="Stale after ms"
                  type="number"
                  value={status.freshness.staleAfterMs}
                  onChange={(v) =>
                    setStatus({ ...status, freshness: { ...status.freshness!, staleAfterMs: Number(v) } })
                  }
                />
              </>
            )}
          </>
        )}
      </EditorSection>
      <EditorSection title="Hover rows">
        <EditorField label="Enable hover rows" source={sourceFor(src, 'hover.enabled')}>
          <Switch
            aria-label="Enable hover rows"
            value={value.hover?.enabled !== false}
            onChange={(e) => onChange({ hover: { ...value.hover, rows, enabled: e.currentTarget.checked } })}
          />
        </EditorField>
        {rows.map((row, i) => (
          <div key={i}>
            <EditorField label={`Hover row ${i + 1} kind`} source={sourceFor(src, `hover.rows[${i}]`)}>
              <Select
                aria-label={`Hover row ${i + 1} kind`}
                value={row.kind}
                onChange={(selection) => {
                  const kind = selection.value ?? '';
                  const label = row.label;
                  setRow(
                    i,
                    kind === 'metadata'
                      ? { kind, label, path: 'cell.key' }
                      : kind === 'drilldown'
                        ? { kind, label, url: '/d/' }
                        : kind === 'history'
                          ? { kind, label, binding: newBinding(first) }
                          : { kind: 'value', label, binding: newBinding(first) }
                  );
                }}
                options={['metadata', 'value', 'history', 'drilldown'].map((k) => ({ value: k, label: k }))}
                menuShouldPortal
                maxMenuHeight={240}
              />
            </EditorField>
            <TextField
              label={`Hover row ${i + 1} label`}
              path={`hover.rows[${i}].label`}
              {...src}
              value={row.label}
              onChange={(label) => setRow(i, { ...row, label })}
            />
            {row.kind === 'metadata' ? (
              <TextField
                label={`Hover row ${i + 1} path`}
                value={row.path}
                onChange={(path) => setRow(i, { ...row, path })}
              />
            ) : row.kind === 'drilldown' ? (
              <TextField
                label={`Hover row ${i + 1} URL`}
                value={row.url}
                onChange={(url) => setRow(i, { ...row, url })}
              />
            ) : (
              <>
                {'series' in row ? (
                  row.series.map((s, j) => (
                    <BindingFields
                      key={s.direction}
                      label={`Hover row ${i + 1} ${s.direction}`}
                      path={`hover.rows[${i}].series[${j}].binding`}
                      {...src}
                      queries={queries}
                      fields={fields}
                      value={s.binding}
                      onChange={(binding) =>
                        setRow(i, {
                          ...row,
                          series: row.series.map((old, k) =>
                            k === j ? { ...old, binding: binding ?? newBinding() } : old
                          ),
                        })
                      }
                    />
                  ))
                ) : (
                  <BindingFields
                    label={`Hover row ${i + 1}`}
                    path={`hover.rows[${i}].binding`}
                    {...src}
                    queries={queries}
                    fields={fields}
                    value={row.binding}
                    onChange={(binding) => setRow(i, { ...row, binding: binding ?? newBinding() })}
                  />
                )}
                <FreshnessFields
                  label={`Hover row ${i + 1}`}
                  value={row.freshness}
                  onChange={(freshness) => setRow(i, { ...row, freshness })}
                />
                <TextField
                  label={`Hover row ${i + 1} unit`}
                  value={row.unit ?? ''}
                  onChange={(unit) => setRow(i, { ...row, unit })}
                />
                <BoundField
                  label={`Hover row ${i + 1} minimum`}
                  auto
                  value={row.min}
                  onChange={(min) => setRow(i, { ...row, min })}
                />
                {'series' in row ? (
                  <BoundField
                    label={`Hover row ${i + 1} maximum`}
                    keywords={['auto', 'capacity']}
                    value={row.max}
                    onChange={(max) => setRow(i, { ...row, max })}
                  />
                ) : (
                  <BoundField
                    label={`Hover row ${i + 1} maximum`}
                    value={row.max}
                    onChange={(max) => setRow(i, { ...row, max })}
                  />
                )}
                {row.kind === 'history' ? (
                  <BoundField
                    label={`Hover row ${i + 1} height`}
                    value={row.height}
                    onChange={(height) => setRow(i, { ...row, height })}
                  />
                ) : null}
                <TextField
                  label={`Hover row ${i + 1} URL`}
                  value={row.url ?? ''}
                  onChange={(url) => setRow(i, { ...row, url })}
                />
              </>
            )}
            <Button variant="secondary" size="sm" onClick={() => setRows(rows.filter((_, j) => i !== j))}>
              Remove hover row {i + 1}
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRows([...rows, { kind: 'metadata', label: 'Identity', path: 'cell.key' }])}
        >
          Add hover row
        </Button>
      </EditorSection>
    </>
  );
}
