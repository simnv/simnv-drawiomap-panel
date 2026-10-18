import React, { useState } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Button, Checkbox, Field, Input, RadioButtonGroup, Select, TextArea, useTheme2 } from '@grafana/ui';
import { parseRulesYaml, rulesToYaml } from '../rules/schema';
import { targetOf } from '../binding/engine';
import { CellKind, Options, ReducerName, Rule, SeriesSelector, ShapeTarget } from '../types';

type Props = StandardEditorProps<Rule[], Record<string, never>, Options>;

const KINDS: Array<{ label: string; value: CellKind | 'any' }> = [
  { label: 'link', value: 'link' },
  { label: 'node', value: 'node' },
  { label: 'port', value: 'port' },
  { label: 'other', value: 'other' },
  { label: 'any', value: 'any' },
];
const TARGETS: Array<{ label: string; value: ShapeTarget; description: string }> = [
  { label: 'icon', value: 'icon', description: 'Colour the node icon. Without an icon: the outline' },
  { label: 'shape', value: 'shape', description: 'Fill the whole shape' },
  { label: 'stroke', value: 'stroke', description: 'Colour the outline' },
];
const REDUCERS: Array<{ label: string; value: ReducerName }> = ['last', 'mean', 'max', 'min'].map((r) => ({
  label: r,
  value: r as ReducerName,
}));

function matchToText(m?: Record<string, string>): string {
  return Object.entries(m ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}
function textToMatch(t: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of t.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) {
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function SeriesFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: SeriesSelector;
  onChange: (s?: SeriesSelector) => void;
}) {
  return (
    <Field
      label={label}
      description="refId and label matchers (key=value or key=/regex/ per line). Templates: ${from.node} ${to.port} ${cell.attr}"
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          width={8}
          placeholder="refId"
          value={value?.refId ?? ''}
          onChange={(e) => onChange({ ...value, refId: e.currentTarget.value || undefined })}
        />
        <TextArea
          rows={2}
          placeholder={'job=node-${from.node}\ndevice=${from.port}'}
          value={matchToText(value?.match)}
          onChange={(e) => onChange({ ...value, match: textToMatch(e.currentTarget.value) })}
        />
      </div>
    </Field>
  );
}

function RuleCard({ rule, onChange, onRemove }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void }) {
  const theme = useTheme2();
  const isLink = !!rule.link;
  return (
    <div
      style={{
        border: `1px solid ${theme.colors.border.weak}`,
        padding: theme.spacing(1),
        marginBottom: theme.spacing(1),
      }}
    >
      <Field label="Name">
        <Input value={rule.name} onChange={(e) => onChange({ ...rule, name: e.currentTarget.value })} />
      </Field>
      <Field label="Select kind">
        <Select
          options={KINDS}
          value={rule.select.kind ?? 'any'}
          onChange={(v) => onChange({ ...rule, select: { ...rule.select, kind: v.value } })}
        />
      </Field>
      <Field label="Select attrs (key=value per line)">
        <TextArea
          rows={2}
          value={matchToText(rule.select.attrs)}
          onChange={(e) => onChange({ ...rule, select: { ...rule.select, attrs: textToMatch(e.currentTarget.value) } })}
        />
      </Field>
      {isLink ? (
        <>
          <SeriesFields
            label="A→B series"
            value={rule.link?.a2b}
            onChange={(s) => onChange({ ...rule, link: { ...rule.link, a2b: s } })}
          />
          <SeriesFields
            label="B→A series"
            value={rule.link?.b2a}
            onChange={(s) => onChange({ ...rule, link: { ...rule.link, b2a: s } })}
          />
          {typeof rule.link?.capacity === 'object' ? (
            <Field label="Capacity" description="From a series. Edit it in YAML.">
              <Input value={`series ${JSON.stringify(rule.link.capacity)}`} disabled />
            </Field>
          ) : (
            <Field
              label="Capacity (bit/s or template)"
              description="Empty: the Max of the field config (Standard options or an override) applies"
            >
              <Input
                value={String(rule.link?.capacity ?? '')}
                onChange={(e) =>
                  onChange({ ...rule, link: { ...rule.link, capacity: e.currentTarget.value || undefined } })
                }
              />
            </Field>
          )}
        </>
      ) : (
        <>
          <SeriesFields
            label="Series"
            value={rule.shape?.series}
            onChange={(s) => onChange({ ...rule, shape: { ...rule.shape, series: s } })}
          />
          <Field label="Colour target" description="What the state colour changes">
            <RadioButtonGroup<ShapeTarget>
              options={TARGETS}
              value={(() => {
                const t = targetOf(rule.shape ?? {});
                return t === 'none' ? undefined : t;
              })()}
              onChange={(v) =>
                onChange({ ...rule, shape: { ...rule.shape, target: v, fill: undefined, stroke: undefined } })
              }
            />
          </Field>
          <Checkbox
            label="Write the value into the label"
            value={!!rule.shape?.text}
            onChange={(e) => onChange({ ...rule, shape: { ...rule.shape, text: e.currentTarget.checked } })}
          />
          {rule.shape?.text ? (
            <Field label="Label template">
              <Input
                placeholder="${value}"
                value={rule.label ?? ''}
                onChange={(e) => onChange({ ...rule, label: e.currentTarget.value || undefined })}
              />
            </Field>
          ) : null}
          <div style={{ color: theme.colors.text.secondary, marginBottom: theme.spacing(1) }}>
            Hover card rows ({rule.shape?.card?.length ?? 0}): edit them in the YAML tab (shape.card).
          </div>
        </>
      )}
      <Field label="Reducer">
        <Select
          options={REDUCERS}
          value={rule.reducer ?? 'last'}
          onChange={(v) => onChange({ ...rule, reducer: v.value })}
        />
      </Field>
      <Field label="URL template">
        <Input
          value={rule.url ?? ''}
          onChange={(e) => onChange({ ...rule, url: e.currentTarget.value || undefined })}
        />
      </Field>
      <Button size="sm" variant="destructive" icon="trash-alt" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

export function RulesEditor({ value, onChange, context }: Props) {
  const rules = value ?? [];
  const [tab, setTab] = useState<'form' | 'yaml'>('form');
  const [yaml, setYaml] = useState<string>(() => rulesToYaml(rules));
  const [errors, setErrors] = useState<string[]>([]);
  const theme = useTheme2();

  const applyYaml = () => {
    const r = parseRulesYaml(yaml);
    setErrors(r.errors);
    if (r.rules) {
      onChange(r.rules);
    }
  };
  const update = (i: number, r: Rule) => {
    const next = rules.slice();
    next[i] = r;
    onChange(next);
    setYaml(rulesToYaml(next));
  };

  return (
    <div>
      <p>
        Open the panel preview in edit mode to select elements, edit named queries, and apply bindings in the side
        inspector.
      </p>
      {context.options?.config ? (
        <p>
          This panel uses V2 bindings. These legacy rules are retained for reference and are not edited by the side
          inspector.
        </p>
      ) : (
        <p>
          Legacy rules are preserved. Explicitly recreate V2 bindings in the side inspector, then Apply bindings to save
          them.
        </p>
      )}
      <RadioButtonGroup<'form' | 'yaml'>
        options={[
          { label: 'Form', value: 'form' },
          { label: 'YAML', value: 'yaml' },
        ]}
        value={tab}
        onChange={(v) => {
          if (v === 'yaml') {
            setYaml(rulesToYaml(rules));
          }
          setTab(v);
        }}
      />
      {tab === 'form' ? (
        <div style={{ marginTop: theme.spacing(1) }}>
          {rules.map((r, i) => (
            <RuleCard
              key={i}
              rule={r}
              onChange={(nr) => update(i, nr)}
              onRemove={() => {
                const next = rules.filter((_, j) => j !== i);
                onChange(next);
                setYaml(rulesToYaml(next));
              }}
            />
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              size="sm"
              icon="plus"
              onClick={() =>
                update(rules.length, { name: `links ${rules.length + 1}`, select: { kind: 'link' }, link: {} })
              }
            >
              Link rule
            </Button>
            <Button
              size="sm"
              icon="plus"
              variant="secondary"
              onClick={() =>
                update(rules.length, {
                  name: `shapes ${rules.length + 1}`,
                  select: { kind: 'node' },
                  shape: { target: 'icon' },
                })
              }
            >
              Shape rule
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: theme.spacing(1) }}>
          <TextArea
            rows={16}
            value={yaml}
            onChange={(e) => setYaml(e.currentTarget.value)}
            data-testid="dmap-rules-yaml"
            style={{ fontFamily: theme.typography.fontFamilyMonospace }}
          />
          <Button size="sm" onClick={applyYaml} style={{ marginTop: theme.spacing(1) }}>
            Apply
          </Button>
          {errors.length ? (
            <ul data-testid="dmap-rules-errors" style={{ color: theme.colors.error.text, marginTop: theme.spacing(1) }}>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
