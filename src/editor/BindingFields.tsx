import { Button, Input, Select, Switch } from '@grafana/ui';
import React, { useId, useState } from 'react';
import type {
  DisplayConfig,
  FreshnessPolicy,
  HoverRow,
  LinkLabelMode,
  NamedQuery,
  QueryBinding,
  StatusCondition,
  StatusRule,
} from '../model/config';
import type { ReducerName } from '../types';
import { targetOf } from '../binding/engine';
import { EditorField, EditorSection, sourceFor, SourceRow, type SourceProps } from './EditorLayout';

/** The value label beside each link half (README "Link value labels"). */
const LINK_LABEL_OPTIONS: Array<{ value: LinkLabelMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'percent', label: 'Percent of capacity' },
  { value: 'value', label: 'Value' },
];

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
            path={path && `${path}.expectedIntervalMs`}
            {...sources}
            type="number"
            value={value.expectedIntervalMs}
            onChange={(v) => onChange({ ...value, expectedIntervalMs: Number(v) })}
          />
          <TextField
            label={`${label} stale after ms`}
            path={path && `${path}.staleAfterMs`}
            {...sources}
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
  mixed,
  ...sources
}: {
  label: string;
  value?: QueryBinding;
  queries: NamedQuery[];
  fields?: string[];
  onChange: (value?: QueryBinding) => void;
  /** The display path of the binding, for example `link.a2b.binding`. */
  path?: string;
  /** A bulk edit of bindings that differ: the section shows the chip and no field, so no partial binding is built. */
  mixed?: boolean;
} & SourceProps) {
  const fieldListId = useId();
  const source = sourceFor(sources, path);
  if (mixed) {
    return (
      <EditorSection title={`${label} metric`} defaultOpen>
        {source && <SourceRow label={`${label} metric`} source={source} />}
        <p>Mixed, edit per element</p>
      </EditorSection>
    );
  }
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
  path,
  ...sources
}: {
  label: string;
  condition: StatusCondition;
  onChange: (c: StatusCondition) => void;
  /** The display path of the condition, for example `status.default`. */
  path?: string;
} & SourceProps) {
  return (
    <>
      <EditorField label={`${label} state`} source={sourceFor(sources, path && `${path}.state`)}>
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
        path={path && `${path}.reason`}
        {...sources}
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
  locked,
  mixedBindings = [],
}: {
  value: DisplayConfig;
  queries: NamedQuery[];
  fields?: string[];
  onChange: (display: Partial<DisplayConfig>) => void;
  /** A section that cannot be edited here shows this note instead of its fields (a bulk edit of different rows). */
  locked?: { hover?: string; status?: string };
  /** Binding paths whose values differ between the selected elements: the binding shows "Mixed", no fields. */
  mixedBindings?: readonly string[];
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
          mixed={mixedBindings.includes('shape.binding')}
          {...src}
          value={value.shape?.binding}
          queries={queries}
          fields={fields}
          onChange={(binding) => onChange({ shape: { ...value.shape, binding } })}
        />
        <EditorField label="Shape colour target" source={sourceFor(src, 'shape.target')}>
          <Select
            aria-label="Shape colour target"
            value={targetOf(value.shape ?? {})}
            onChange={(selection) =>
              onChange({
                shape: { ...value.shape, target: (selection.value ?? 'icon') as 'icon' | 'shape' | 'stroke' | 'none' },
              })
            }
            options={['icon', 'shape', 'stroke', 'none'].map((v) => ({ value: v, label: v }))}
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
        {(['a2b', 'b2a'] as const).map((direction, i) => (
          <BindingFields
            key={direction}
            label={['A to B', 'B to A'][i]}
            path={`link.${direction}.binding`}
            mixed={mixedBindings.includes(`link.${direction}.binding`)}
            {...src}
            value={value.link?.[direction]?.binding}
            queries={queries}
            fields={fields}
            onChange={(binding) =>
              onChange({ link: { ...value.link, [direction]: { ...value.link?.[direction], binding } } })
            }
          />
        ))}
        <BindingFields
          label="Capacity"
          path="link.capacityBinding"
          mixed={mixedBindings.includes('link.capacityBinding')}
          {...src}
          value={value.link?.capacityBinding}
          queries={queries}
          fields={fields}
          onChange={(binding) => onChange({ link: { ...value.link, capacityBinding: binding } })}
        />
        <TextField
          label="Link capacity"
          path="link.capacity"
          {...src}
          type="number"
          value={typeof value.link?.capacity === 'number' ? value.link.capacity : ''}
          onChange={(v) => onChange({ link: { ...value.link, capacity: v ? Number(v) : undefined } })}
        />
        <EditorField label="Link label" source={sourceFor(src, 'link.label')}>
          <Select
            aria-label="Link label"
            value={value.link?.label?.mode ?? 'none'}
            onChange={(selection) =>
              onChange({ link: { ...value.link, label: { mode: (selection.value ?? 'none') as LinkLabelMode } } })
            }
            options={LINK_LABEL_OPTIONS}
            menuShouldPortal
            maxMenuHeight={240}
          />
        </EditorField>
      </EditorSection>
      <EditorSection title="Explicit health status">
        {locked?.status ? (
          <p>{locked.status}</p>
        ) : !status ? (
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
              path="status.default"
              {...src}
              condition={status.default}
              onChange={(fallback) => setStatus({ ...status, default: fallback })}
            />
            {(status.kind === 'mapping' ? status.mappings : status.predicates).map((c, i) => {
              const at = `status.${status.kind === 'mapping' ? 'mappings' : 'predicates'}[${i}]`;
              return (
                <div key={i}>
                  <TextField
                    label={`Health condition ${i + 1} value`}
                    path={`${at}.value`}
                    {...src}
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
                    <EditorField label={`Health condition ${i + 1} operator`} source={sourceFor(src, `${at}.op`)}>
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
                    path={at}
                    {...src}
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
              );
            })}
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
            <EditorField label="Check sample freshness" source={sourceFor(src, 'status.freshness')}>
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
                  path="status.freshness.expectedIntervalMs"
                  {...src}
                  type="number"
                  value={status.freshness.expectedIntervalMs}
                  onChange={(v) =>
                    setStatus({ ...status, freshness: { ...status.freshness!, expectedIntervalMs: Number(v) } })
                  }
                />
                <TextField
                  label="Stale after ms"
                  path="status.freshness.staleAfterMs"
                  {...src}
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
        {locked?.hover ? (
          <p>{locked.hover}</p>
        ) : (
          <>
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
                            : kind === 'combined'
                              ? { kind, label, series: [{ binding: newBinding(first), direction: 'up' }] }
                              : kind === 'history'
                                ? { kind, label, binding: newBinding(first) }
                                : { kind: 'value', label, binding: newBinding(first) }
                      );
                    }}
                    options={['metadata', 'value', 'history', 'combined', 'drilldown'].map((k) => ({
                      value: k,
                      label: k,
                    }))}
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
                    path={`hover.rows[${i}].path`}
                    {...src}
                    value={row.path}
                    onChange={(path) => setRow(i, { ...row, path })}
                  />
                ) : row.kind === 'drilldown' ? (
                  <TextField
                    label={`Hover row ${i + 1} URL`}
                    path={`hover.rows[${i}].url`}
                    {...src}
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
                      path={`hover.rows[${i}].freshness`}
                      {...src}
                      value={row.freshness}
                      onChange={(freshness) => setRow(i, { ...row, freshness })}
                    />
                    <TextField
                      label={`Hover row ${i + 1} unit`}
                      path={`hover.rows[${i}].unit`}
                      {...src}
                      value={row.unit ?? ''}
                      onChange={(unit) => setRow(i, { ...row, unit })}
                    />
                    <BoundField
                      label={`Hover row ${i + 1} minimum`}
                      path={`hover.rows[${i}].min`}
                      {...src}
                      auto
                      value={row.min}
                      onChange={(min) => setRow(i, { ...row, min })}
                    />
                    {'series' in row ? (
                      <BoundField
                        label={`Hover row ${i + 1} maximum`}
                        path={`hover.rows[${i}].max`}
                        {...src}
                        keywords={['auto', 'capacity']}
                        value={row.max}
                        onChange={(max) => setRow(i, { ...row, max })}
                      />
                    ) : (
                      <BoundField
                        label={`Hover row ${i + 1} maximum`}
                        path={`hover.rows[${i}].max`}
                        {...src}
                        value={row.max}
                        onChange={(max) => setRow(i, { ...row, max })}
                      />
                    )}
                    {row.kind === 'history' || row.kind === 'combined' ? (
                      <BoundField
                        label={`Hover row ${i + 1} height`}
                        path={`hover.rows[${i}].height`}
                        {...src}
                        value={row.height}
                        onChange={(height) => setRow(i, { ...row, height })}
                      />
                    ) : null}
                    <TextField
                      label={`Hover row ${i + 1} URL`}
                      path={`hover.rows[${i}].url`}
                      {...src}
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
          </>
        )}
      </EditorSection>
    </>
  );
}
