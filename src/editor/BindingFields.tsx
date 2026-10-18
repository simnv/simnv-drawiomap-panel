import React, { useId } from 'react';
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

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label style={{ display: 'block' }}>
      {label}
      <input aria-label={label} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
export const newBinding = (queryId = ''): QueryBinding => ({ queryId, match: {}, reducer: 'last' });
export function FreshnessFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: FreshnessPolicy;
  onChange: (value?: FreshnessPolicy) => void;
}) {
  return (
    <fieldset>
      <legend>{label} sample freshness</legend>
      <label>
        {label} check sample freshness
        <input
          type="checkbox"
          aria-label={`${label} check sample freshness`}
          checked={!!value}
          onChange={(e) => onChange(e.target.checked ? { expectedIntervalMs: 15000, staleAfterMs: 45000 } : undefined)}
        />
      </label>
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
    </fieldset>
  );
}
export function BindingFields({
  label,
  value,
  queries,
  fields = [],
  onChange,
}: {
  label: string;
  value?: QueryBinding;
  queries: NamedQuery[];
  fields?: string[];
  onChange: (value?: QueryBinding) => void;
}) {
  const fieldListId = useId();
  return (
    <fieldset>
      <legend>{label}</legend>
      <label>
        {label} query
        <select
          aria-label={`${label} query`}
          value={value?.queryId ?? ''}
          onChange={(e) =>
            onChange(e.target.value ? { ...(value ?? newBinding()), queryId: e.target.value } : undefined)
          }
        >
          <option value="">Inherit / unset</option>
          {queries.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
      </label>
      {value && (
        <>
          <label>
            {label} result field
            <input
              aria-label={`${label} result field`}
              list={fieldListId}
              value={value.field ?? ''}
              onChange={(e) => onChange({ ...value, field: e.target.value || undefined })}
            />
          </label>
          <datalist id={fieldListId}>
            {fields.map((field) => (
              <option key={field} value={field} />
            ))}
          </datalist>
          <label>
            {label} reducer
            <select
              aria-label={`${label} reducer`}
              value={value.reducer}
              onChange={(e) => onChange({ ...value, reducer: e.target.value as ReducerName })}
            >
              {['last', 'mean', 'min', 'max'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          {Object.entries(value.match).map(([key, match]) => (
            <div key={key}>
              <TextField
                label={`${label} match ${key}`}
                value={match}
                onChange={(v) => onChange({ ...value, match: { ...value.match, [key]: v } })}
              />
              <button
                onClick={() => {
                  const next = { ...value.match };
                  delete next[key];
                  onChange({ ...value, match: next });
                }}
              >
                Remove {label} match {key}
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              let n = 1;
              while (`label${n}` in value.match) {
                n++;
              }
              onChange({ ...value, match: { ...value.match, [`label${n}`]: '${cell.key}' } });
            }}
          >
            Add {label} matcher
          </button>
          {Object.keys(value.match).map((key) => (
            <label key={key}>
              {label} label name {key}
              <input
                aria-label={`${label} label name ${key}`}
                defaultValue={key}
                onBlur={(e) => {
                  const name = e.target.value;
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
            </label>
          ))}
        </>
      )}
    </fieldset>
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
      <label>
        {label} state
        <select
          aria-label={`${label} state`}
          value={condition.state}
          onChange={(e) => onChange({ ...condition, state: e.target.value as StatusCondition['state'] })}
        >
          {states.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
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
}: {
  value: DisplayConfig;
  queries: NamedQuery[];
  fields?: string[];
  onChange: (display: Partial<DisplayConfig>) => void;
}) {
  const first = queries[0]?.id ?? '';
  const rows = value.hover?.rows ?? [];
  const setRows = (next: HoverRow[]) => onChange({ hover: { ...value.hover, rows: next } });
  const setRow = (i: number, row: HoverRow) => setRows(rows.map((old, j) => (i === j ? row : old)));
  const status = value.status;
  const setStatus = (next: StatusRule) => onChange({ status: next });
  return (
    <>
      <label>
        Enable shape binding
        <input
          aria-label="Enable shape binding"
          type="checkbox"
          checked={value.shape?.enabled !== false}
          onChange={(e) => onChange({ shape: { ...value.shape, enabled: e.target.checked } })}
        />
      </label>
      <label>
        Enable link binding
        <input
          aria-label="Enable link binding"
          type="checkbox"
          checked={value.link?.enabled !== false}
          onChange={(e) => onChange({ link: { ...value.link, enabled: e.target.checked } })}
        />
      </label>
      <label>
        Enable element
        <input
          aria-label="Enable element"
          type="checkbox"
          checked={value.enabled !== false}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
      </label>
      <TextField label="Label template" value={value.label ?? ''} onChange={(label) => onChange({ label })} />
      <label>
        Write value to shape label
        <input
          aria-label="Write value to shape label"
          type="checkbox"
          checked={!!value.shape?.text}
          onChange={(e) => onChange({ shape: { ...value.shape, text: e.target.checked } })}
        />
      </label>
      <TextField label="Drilldown URL" value={value.url ?? ''} onChange={(url) => onChange({ url })} />
      <BindingFields
        label="Shape"
        value={value.shape?.binding}
        queries={queries}
        fields={fields}
        onChange={(binding) => onChange({ shape: { ...value.shape, binding } })}
      />
      <label>
        Shape colour target
        <select
          aria-label="Shape colour target"
          value={value.shape?.target ?? 'icon'}
          onChange={(e) =>
            onChange({ shape: { ...value.shape, target: e.target.value as 'icon' | 'shape' | 'stroke' } })
          }
        >
          {['icon', 'shape', 'stroke'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {(['a2bBinding', 'b2aBinding', 'capacityBinding'] as const).map((key, i) => (
        <BindingFields
          key={key}
          label={['A to B', 'B to A', 'Capacity'][i]}
          value={value.link?.[key]}
          queries={queries}
          fields={fields}
          onChange={(binding) => onChange({ link: { ...value.link, [key]: binding } })}
        />
      ))}
      <TextField
        label="Link capacity"
        type="number"
        value={typeof value.link?.capacity === 'number' ? value.link.capacity : ''}
        onChange={(v) => onChange({ link: { ...value.link, capacity: v ? Number(v) : undefined } })}
      />
      <fieldset>
        <legend>Explicit health status</legend>
        {!status ? (
          <button
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
          </button>
        ) : (
          <>
            <label>
              Enable health status
              <input
                type="checkbox"
                aria-label="Enable health status"
                checked={status.enabled !== false}
                onChange={(e) => setStatus({ ...status, enabled: e.target.checked })}
              />
            </label>
            <BindingFields
              label="Health"
              queries={queries}
              fields={fields}
              value={status.binding}
              onChange={(binding) => setStatus({ ...status, binding: binding ?? newBinding() })}
            />
            <label>
              Health rule type
              <select
                aria-label="Health rule type"
                value={status.kind}
                onChange={(e) => {
                  const { binding, default: fallback, enabled, freshness } = status;
                  setStatus(
                    e.target.value === 'mapping'
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
              >
                <option value="mapping">Explicit value mapping</option>
                <option value="predicates">Opt-in thresholds</option>
              </select>
            </label>
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
                  <label>
                    Health condition {i + 1} operator
                    <select
                      aria-label={`Health condition ${i + 1} operator`}
                      value={status.predicates[i].op}
                      onChange={(e) =>
                        setStatus({
                          ...status,
                          predicates: status.predicates.map((old, j) =>
                            i === j ? { ...old, op: e.target.value as 'gt' } : old
                          ),
                        })
                      }
                    >
                      {['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].map((op) => (
                        <option key={op}>{op}</option>
                      ))}
                    </select>
                  </label>
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
                <button
                  onClick={() =>
                    status.kind === 'mapping'
                      ? setStatus({ ...status, mappings: status.mappings.filter((_, j) => i !== j) })
                      : setStatus({ ...status, predicates: status.predicates.filter((_, j) => i !== j) })
                  }
                >
                  Remove health condition {i + 1}
                </button>
              </div>
            ))}
            <button
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
            </button>
            <label>
              Check sample freshness
              <input
                type="checkbox"
                aria-label="Check sample freshness"
                checked={!!status.freshness}
                onChange={(e) =>
                  setStatus({
                    ...status,
                    freshness: e.target.checked ? { expectedIntervalMs: 15000, staleAfterMs: 45000 } : undefined,
                  })
                }
              />
            </label>
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
      </fieldset>
      <fieldset>
        <legend>Hover rows</legend>
        <label>
          Enable hover rows
          <input
            aria-label="Enable hover rows"
            type="checkbox"
            checked={value.hover?.enabled !== false}
            onChange={(e) => onChange({ hover: { ...value.hover, rows, enabled: e.target.checked } })}
          />
        </label>
        {rows.map((row, i) => (
          <div key={i}>
            <label>
              Hover row {i + 1} kind
              <select
                aria-label={`Hover row ${i + 1} kind`}
                value={row.kind}
                onChange={(e) => {
                  const kind = e.target.value;
                  const label = row.label;
                  setRow(
                    i,
                    kind === 'metadata'
                      ? { kind, label, path: 'cell.key' }
                      : kind === 'drilldown'
                        ? { kind, label, url: '/d/' }
                        : { kind: kind as 'value' | 'history', label, binding: newBinding(first) }
                  );
                }}
              >
                {['metadata', 'value', 'history', 'drilldown'].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <TextField
              label={`Hover row ${i + 1} label`}
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
                <BindingFields
                  label={`Hover row ${i + 1}`}
                  queries={queries}
                  fields={fields}
                  value={row.binding}
                  onChange={(binding) => setRow(i, { ...row, binding: binding ?? newBinding() })}
                />
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
                <TextField
                  label={`Hover row ${i + 1} URL`}
                  value={row.url ?? ''}
                  onChange={(url) => setRow(i, { ...row, url })}
                />
              </>
            )}
            <button onClick={() => setRows(rows.filter((_, j) => i !== j))}>Remove hover row {i + 1}</button>
          </div>
        ))}
        <button onClick={() => setRows([...rows, { kind: 'metadata', label: 'Identity', path: 'cell.key' }])}>
          Add hover row
        </button>
      </fieldset>
    </>
  );
}
