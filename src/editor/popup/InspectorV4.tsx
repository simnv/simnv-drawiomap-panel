import React, { useId, useState } from 'react';
import { css } from '@emotion/css';
import { formattedValueToString, getDisplayProcessor, type GrafanaTheme2 } from '@grafana/data';
import { Button, IconButton, Input, useStyles2, useTheme2 } from '@grafana/ui';
import type { BindResultV4 } from '../../binding/bindV4';
import { attrOf } from '../../binding/cellAttrs';
import { effectiveClass } from '../../binding/classes';
import type { EndContext } from '../../binding/edgeEnds';
import { linkFeeds } from '../../binding/linkFeeds';
import { createRegexCache, parseMatchBlock, resolveBlock } from '../../binding/matcher';
import { shownField, type Show } from '../../binding/rowData';
import type { Use } from '../../binding/uses';
import type { validateConfig } from '../../model/validate';
import type { Series } from '../../query/snapshot';
import type { CellIndex, CellMeta } from '../../types';

/** One write of spec 5.5: the attributes to set on one cell. `null` removes the attribute. */
export interface CellWrite {
  id: string;
  attrs: Record<string, string | null>;
}

export interface InspectorV4Props {
  /** The selected cells. The last one is the primary cell. */
  cellIds: string[];
  index: CellIndex;
  /** The edge ends of the draft diagram (spec 3.8.1), read once per diagram. */
  ends: EndContext;
  bound: BindResultV4;
  validated: ReturnType<typeof validateConfig>;
  /** The class names of the draft: the items of the bind field (spec 5.6). */
  classNames: string[];
  /** The generator made the panel (it has a build id, spec 7.3.5). */
  generated: boolean;
  /** The message of the last write that the diagram refused. */
  error?: string;
  onWrite: (cells: CellWrite[]) => void;
  onClose: () => void;
}

/** The inspector shows the first label sets of a use only (spec 5.4). */
const LABEL_SETS = 8;

const labelSet = (labels: Record<string, string>) =>
  `{${Object.entries(labels)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(', ')}}`;

/** The last value of a series, formatted with the `unit` and `decimals` of its use, as the cell shows it (spec 3.7). */
function lastValue(series: Series, show: Show, theme: GrafanaTheme2): string {
  for (let i = series.values.length - 1; i >= 0; i--) {
    const value = series.values[i];
    if (value !== null) {
      const field = shownField(series.field, show);
      return formattedValueToString((field.display ?? getDisplayProcessor({ field, theme }))(value));
    }
  }
  return 'no value';
}

/** The `unit` and `decimals` of a use: of the class `text`, or of the row or chart. */
function showOf(use: Use, text: Show | undefined): Show {
  if (use.kind === 'text') {
    return text ?? {};
  }
  const row = use.row;
  return row && row.kind !== 'metadata' && row.kind !== 'drilldown' ? row : {};
}

/** The match block of a use as the YAML holds it: `attr: matcher`, a list in brackets. */
const written = (use: Use) =>
  Object.entries(use.match)
    .map(([attr, value]) => `${attr}: ${Array.isArray(value) ? `[${value.join(', ')}]` : value}`)
    .join('; ');

/** The matchers of a use with the attributes of the cell put in (`resolved` of `resolveBlock`), or why they fail. */
function resolvedText(use: Use, meta: CellMeta, ends: EndContext): string {
  const parsed = parseMatchBlock(use.match, use.path);
  if (!parsed.ok) {
    return parsed.errors.map((e) => e.message).join('; ');
  }
  const result = resolveBlock(parsed.block, attrOf(() => ends)(meta), createRegexCache());
  if (!result.ok) {
    return result.kind === 'missing-attr' ? `Missing attribute ${result.attr}` : result.message;
  }
  return result.resolved.map((m) => `${m.label}${m.op}${JSON.stringify(m.value)}`).join(', ');
}

/**
 * The inspector of the split editor (spec 5.4, 5.5). For one cell it shows the id, `bind`, `key`, the other
 * attributes, the class chain, the override and, per use, the matchers and the series. It writes `bind` and `key`; on
 * an edge it shows the ends and sets or clears `at=target`. For a multi-select it assigns one class to all cells and
 * keeps the `key` of each cell.
 */
export function InspectorV4(props: InspectorV4Props) {
  const styles = useStyles2(getStyles);
  const { cellIds, index, onClose, error } = props;
  const listId = useId();
  const cells = cellIds.flatMap((id) => {
    const meta = index.get(id)?.meta;
    return meta ? [meta] : [];
  });
  if (!cells.length) {
    return null;
  }
  const primary = cells[cells.length - 1];
  return (
    <section className={styles.inspector} data-testid="dmap-inspector" aria-label="Cell inspector">
      <header className={styles.header}>
        <h3 className={styles.title}>{cells.length > 1 ? `${cells.length} cells selected` : 'Cell'}</h3>
        <IconButton name="times" aria-label="Close the inspector" onClick={onClose} />
      </header>
      {error ? (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      ) : null}
      <datalist id={listId}>
        {props.classNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {cells.length > 1 ? (
        <AssignClass key={cells.map((c) => c.id).join('\n')} cells={cells} listId={listId} onWrite={props.onWrite} />
      ) : (
        <CellDetails {...props} meta={primary} listId={listId} />
      )}
    </section>
  );
}

/** Write 2 of spec 5.5: one class on all selected cells. The `key` of each cell stays. */
function AssignClass(props: { cells: CellMeta[]; listId: string; onWrite: InspectorV4Props['onWrite'] }) {
  const styles = useStyles2(getStyles);
  const { cells, listId, onWrite } = props;
  const [bind, setBind] = useState('');
  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>Class</span>
        <Input
          value={bind}
          list={listId}
          data-testid="dmap-inspector-bind"
          onChange={(e) => setBind(e.currentTarget.value)}
        />
      </label>
      <Button
        size="sm"
        disabled={!bind.trim()}
        onClick={() => onWrite(cells.map(({ id }) => ({ id, attrs: { bind: bind.trim() } })))}
      >
        Assign class
      </Button>
    </div>
  );
}

function CellDetails(props: InspectorV4Props & { meta: CellMeta; listId: string }) {
  const styles = useStyles2(getStyles);
  const { meta, ends, bound, validated, listId, onWrite } = props;
  const { bind, key, ...others } = meta.attrs;
  const cls = bind !== undefined ? validated.classes.get(bind) : undefined;
  const override = validated.parsed.config?.overrides[meta.id];
  const text = cls && effectiveClass(cls, override, meta.id).text;
  const uses = bound.uses.get(meta.id) ?? [];
  return (
    <>
      <dl className={styles.list}>
        <dt>Id</dt>
        <dd data-testid="dmap-inspector-id">{meta.id}</dd>
        <dt>Class chain</dt>
        <dd data-testid="dmap-inspector-chain">
          {cls ? cls.chain.join(' → ') : bind === undefined ? 'no bind' : 'unknown class'}
        </dd>
        {override ? (
          <>
            <dt>Override</dt>
            <dd data-testid="dmap-inspector-override">
              {`overrides.${meta.id}: `}
              {Object.entries(override)
                .map(([name, value]) => `${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
                .join('; ')}
            </dd>
          </>
        ) : validated.parsed.invalidOverrides.has(meta.id) ? (
          <>
            <dt>Override</dt>
            <dd data-testid="dmap-inspector-override">{`overrides.${meta.id} is not valid`}</dd>
          </>
        ) : null}
      </dl>
      <BindKey key={`${meta.id}\n${bind}\n${key}`} meta={meta} listId={listId} onWrite={onWrite} />
      {meta.isEdge ? <EdgeEnds {...props} /> : null}
      <h4 className={styles.subtitle}>Attributes</h4>
      <dl className={styles.list} data-testid="dmap-inspector-attrs">
        {Object.entries(others).map(([name, value]) => (
          <React.Fragment key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {uses.map((use) => (
        <UseDetails
          key={use.path}
          use={use}
          resolved={resolvedText(use, meta, ends)}
          series={bound.series.get(meta.id)?.get(use.path) ?? []}
          show={showOf(use, text)}
        />
      ))}
    </>
  );
}

/** Write 1 of spec 5.5: `bind` and `key` of one cell. An empty field removes the attribute. */
function BindKey(props: { meta: CellMeta; listId: string; onWrite: InspectorV4Props['onWrite'] }) {
  const styles = useStyles2(getStyles);
  const { meta, listId, onWrite } = props;
  const [bind, setBind] = useState(meta.attrs.bind ?? '');
  const [key, setKey] = useState(meta.attrs.key ?? '');
  const value = (text: string) => text.trim() || null;
  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>bind</span>
        <Input
          value={bind}
          list={listId}
          data-testid="dmap-inspector-bind"
          onChange={(e) => setBind(e.currentTarget.value)}
        />
      </label>
      <label className={styles.field}>
        <span>key</span>
        <Input value={key} data-testid="dmap-inspector-key" onChange={(e) => setKey(e.currentTarget.value)} />
      </label>
      <Button size="sm" onClick={() => onWrite([{ id: meta.id, attrs: { bind: value(bind), key: value(key) } }])}>
        Set bind and key
      </Button>
    </div>
  );
}

const oneLine = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/**
 * A readable name for the cell at one end of an edge: `node · port` for a portograph port (the labels, else
 * `pg-node` and `pg-port`), the label for any other cell, else the cell id.
 */
export function endName(id: string | undefined, ends: EndContext): string | undefined {
  if (id === undefined) {
    return undefined;
  }
  const meta = ends.index.get(id)?.meta;
  if (!meta) {
    return id;
  }
  if (meta.kind === 'port') {
    const parent = ends.parents.get(id);
    const nodeCell = parent !== undefined ? ends.index.get(parent)?.meta : undefined;
    const node = oneLine(nodeCell?.labelText) || meta.attrs['pg-node'] || '';
    const port = oneLine(meta.labelText) || meta.attrs['pg-port'] || '';
    return [node, port].filter(Boolean).join(' · ') || id;
  }
  return oneLine(meta.labelText) || id;
}

/** The ends of an edge, the end that the key names and the feed of each half (spec 3.8, 5.4). Write 3 of spec 5.5. */
function EdgeEnds(props: InspectorV4Props & { meta: CellMeta }) {
  const styles = useStyles2(getStyles);
  const { meta, ends, validated, generated, onWrite } = props;
  const at = meta.attrs.at;
  const cls = meta.attrs.bind !== undefined ? validated.classes.get(meta.attrs.bind) : undefined;
  const eff = cls && effectiveClass(cls, validated.parsed.config?.overrides[meta.id], meta.id);
  const feeds = linkFeeds(at, 'tx', 'rx');
  const half = (direction: string) => `${direction} (${(direction === 'tx' ? eff?.up : eff?.down) ?? 'no query'})`;
  const end = ends.ends.get(meta.id);
  const atTarget = at === 'target';
  const sourceName = endName(end?.source, ends);
  const targetName = endName(end?.target, ends);
  // Two ends with one name: the cell id tells them apart, as visible text.
  const same = sourceName !== undefined && sourceName === targetName;
  const keyedName = atTarget ? targetName : sourceName;
  return (
    <>
      <h4 className={styles.subtitle}>Link</h4>
      <dl className={styles.list}>
        <dt>Source end (a)</dt>
        <dd data-testid="dmap-inspector-source" title={end?.source}>
          {sourceName ?? 'unknown'}
          {same && end?.source ? <span className={styles.note}> ({end.source})</span> : null}
        </dd>
        <dt>Target end (b)</dt>
        <dd data-testid="dmap-inspector-target" title={end?.target}>
          {targetName ?? 'unknown'}
          {same && end?.target ? <span className={styles.note}> ({end.target})</span> : null}
        </dd>
      </dl>
      <p className={styles.line} data-testid="dmap-inspector-keyed">
        {`The key names the ${atTarget ? 'target' : 'source'} end${keyedName ? ` (${keyedName})` : ''}.`}
      </p>
      <p className={styles.line} data-testid="dmap-inspector-a2b">{`a → b: ${half(feeds.a2b)}`}</p>
      <p className={styles.line} data-testid="dmap-inspector-b2a">{`b → a: ${half(feeds.b2a)}`}</p>
      <div className={styles.form}>
        <Button
          size="sm"
          variant="secondary"
          data-testid="dmap-inspector-at"
          onClick={() => onWrite([{ id: meta.id, attrs: { at: atTarget ? null : 'target' } }])}
        >
          {atTarget ? 'Use the source end' : 'Use the target end'}
        </Button>
        {generated ? (
          <span className={styles.note} data-testid="dmap-inspector-generated">
            This panel is generated. The next build writes <code>at</code> from the source of the link: the catalogue
            family (mode A) or the source generator (mode B). To change it, change that source.
          </span>
        ) : null}
      </div>
    </>
  );
}

function UseDetails(props: { use: Use; resolved: string; series: Series[]; show: Show }) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const { use, resolved, series, show } = props;
  const more = series.length - LABEL_SETS;
  return (
    <section className={styles.use} data-testid="dmap-inspector-use" data-dmap-use={use.path}>
      <h4 className={styles.subtitle}>{use.path}</h4>
      <dl className={styles.list}>
        <dt>Query</dt>
        <dd data-testid="dmap-inspector-refid">{use.refId}</dd>
        <dt>Match</dt>
        <dd data-testid="dmap-inspector-written">{written(use)}</dd>
        <dt>Resolved</dt>
        <dd data-testid="dmap-inspector-resolved">{resolved}</dd>
        <dt>Series</dt>
        <dd data-testid="dmap-inspector-count" className={series.length ? undefined : styles.zero}>
          {`${series.length} series`}
        </dd>
      </dl>
      {series.length ? (
        <ul className={styles.series}>
          {series.slice(0, LABEL_SETS).map((s, i) => (
            <li key={i} data-testid="dmap-inspector-series">
              <span>{labelSet(s.labels)}</span> <span>{lastValue(s, show, theme)}</span>
            </li>
          ))}
          {more > 0 ? <li>+{more} more</li> : null}
        </ul>
      ) : null}
    </section>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  inspector: css({
    padding: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    overflowWrap: 'anywhere',
  }),
  header: css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }),
  title: css({ fontSize: theme.typography.h6.fontSize, margin: 0 }),
  subtitle: css({ fontSize: theme.typography.bodySmall.fontSize, fontWeight: 500, margin: theme.spacing(1, 0, 0.5) }),
  list: css({
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    columnGap: theme.spacing(1),
    margin: 0,
    '& dt': { color: theme.colors.text.secondary },
    '& dd': { margin: 0 },
  }),
  form: css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: theme.spacing(1),
    margin: theme.spacing(1, 0),
  }),
  field: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.25), minWidth: 120, flex: 1 }),
  line: css({ margin: 0 }),
  note: css({ color: theme.colors.text.secondary, flex: '1 1 200px' }),
  error: css({ color: theme.colors.error.text, margin: theme.spacing(0.5, 0) }),
  use: css({ borderTop: `1px solid ${theme.colors.border.weak}`, marginTop: theme.spacing(1) }),
  // a count of 0 is a problem: the use has no series for the cell
  zero: css({ color: theme.colors.error.text }),
  series: css({
    listStyle: 'none',
    margin: theme.spacing(0.5, 0, 0),
    padding: 0,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
});
