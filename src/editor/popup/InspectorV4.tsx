import React, { useId, useState } from 'react';
import { css } from '@emotion/css';
import { formattedValueToString, getDisplayProcessor, getValueFormat, type GrafanaTheme2 } from '@grafana/data';
import { Button, IconButton, Input, useStyles2, useTheme2 } from '@grafana/ui';
import type { BindResultV4 } from '../../binding/bindV4';
import { effectiveClass } from '../../binding/classes';
import type { EndContext } from '../../binding/edgeEnds';
import { linkFeeds } from '../../binding/linkFeeds';
import { inheritableNames, type MeasuredEnd } from '../../binding/identity';
import { parseMatchBlock } from '../../binding/matcher';
import { shownField, type Show } from '../../binding/rowData';
import { listUses, type Use } from '../../binding/uses';
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

/** The matchers of a use with the attributes of the cell put in, or why they fail: the text comes from the bind (I26). */
function resolvedText(bound: BindResultV4, cellId: string, use: Use): string {
  const resolved = bound.resolved.get(cellId)?.get(use.path);
  if (!resolved) {
    return '';
  }
  return 'problem' in resolved
    ? resolved.problem
    : resolved.matchers.map((m) => `${m.label}${m.op}${JSON.stringify(m.value)}`).join(', ');
}

/** The inheritable names that the match blocks of the uses read (I6). */
const readNames = (uses: readonly Use[]) =>
  inheritableNames(
    uses.flatMap((use) => {
      const parsed = parseMatchBlock(use.match, use.path);
      return parsed.ok ? parsed.block.requiredAttrs : [];
    })
  );

/** The names of a list in one text: `key, port`. */
const names = (list: readonly string[]) => list.join(', ');

/**
 * The line "Measured end" (I23). The names are the identity names of the link. A link with a part of an identity
 * (reason `own`, rule 5) can read a missing name from its source end: `inherited` tells which.
 */
export function measuredText(meta: CellMeta, measured: MeasuredEnd, bound: BindResultV4, uses: readonly Use[]): string {
  const { needs } = measured;
  switch (measured.reason) {
    case 'at':
      return `${measured.end}: at=${measured.end} on the link`;
    case 'only':
      return `${measured.end}: only this end gives ${names(needs)}`;
    case 'both':
      return `${measured.end}: both ends give ${names(needs)}. Set at=target to measure the target end.`;
    case 'none':
      return `none: no end gives ${names(needs)}. Put them on a port, or on the link.`;
    case 'own': {
      // Rule 2 has no dependent use: every use is end-free, so the link has all the names that its uses read.
      const read = needs.length ? needs : readNames(uses);
      if (!read.length) {
        return `${measured.end}: no use of the link needs an identity from an end`;
      }
      const own = read.filter((name) => Object.hasOwn(meta.attrs, name));
      const fromEnd = read.filter((name) => !own.includes(name) && bound.inherited.get(meta.id)?.has(name));
      const missing = read.filter((name) => !own.includes(name) && !fromEnd.includes(name));
      return [
        own.length
          ? `${measured.end}: the link has ${names(own)} itself`
          : `${measured.end}: the link has no identity itself`,
        ...(fromEnd.length ? [`the ${measured.end} end gives ${names(fromEnd)}`] : []),
        ...(missing.length ? [`${names(missing)} ${missing.length === 1 ? 'is' : 'are'} missing`] : []),
      ].join('; ');
    }
  }
}

/** The capacity of one geometric direction with its source (I14, I25). */
function capacityText(
  capacity: { amount?: number; source: string; cellId?: string },
  meta: CellMeta,
  ends: EndContext
) {
  if (capacity.amount === undefined) {
    return 'none';
  }
  const amount = formattedValueToString(getValueFormat('bps')(capacity.amount));
  if (capacity.source === 'series') {
    return `${amount} (capacity query)`;
  }
  return capacity.cellId === undefined || capacity.cellId === meta.id
    ? `${amount} (cap of the link)`
    : `${amount} (cap of ${endName(capacity.cellId, ends)})`;
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
  const inherited = [...(bound.inherited.get(meta.id) ?? [])].filter(([name]) => !Object.hasOwn(meta.attrs, name));
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
        {inherited.map(([name, origin]) => (
          <React.Fragment key={`inherited ${name}`}>
            <dt>{name}</dt>
            <dd data-testid="dmap-inspector-inherited">
              {`${origin.value} (from ${originName(origin.cellId, ends)})`}
            </dd>
          </React.Fragment>
        ))}
      </dl>
      {uses.map((use) => (
        <UseDetails
          key={use.path}
          use={use}
          resolved={resolvedText(bound, meta.id, use)}
          feed={feedText(use, meta)}
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

/** The origin of an inherited value: the label of the giving cell, else its id (I23). */
function originName(cellId: string, ends: EndContext): string {
  return oneLine(ends.index.get(cellId)?.meta.labelText) || cellId;
}

/** The end of a directional use and where it comes from (I13, I23). */
function feedText(use: Use, meta: CellMeta): string | undefined {
  if (use.end === undefined) {
    return undefined;
  }
  const own = Object.hasOwn(meta.attrs, 'at');
  if (own) {
    return `${use.end} end (at=${meta.attrs.at} on the ${meta.isEdge ? 'link' : 'cell'})`;
  }
  return use.end === 'target' ? 'target end (inferred)' : 'source end';
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

/** The capacity of each direction with its source, from the bind (I25), or nothing for a link with none. */
function CapacityLine({ meta, bound, ends }: { meta: CellMeta; bound: BindResultV4; ends: EndContext }) {
  const styles = useStyles2(getStyles);
  const capacity = bound.capacity.get(meta.id);
  if (!capacity) {
    return null;
  }
  return (
    <p className={styles.line} data-testid="dmap-inspector-capacity">
      {`Capacity: a → b ${capacityText(capacity.a2b, meta, ends)}, b → a ${capacityText(capacity.b2a, meta, ends)}`}
    </p>
  );
}

/** The ends of an edge, the measured end and the feed of each half (spec 3.8, 5.4, I23). Write 3 of spec 5.5. */
function EdgeEnds(props: InspectorV4Props & { meta: CellMeta }) {
  const styles = useStyles2(getStyles);
  const { meta, ends, bound, validated, generated, onWrite } = props;
  const hasAt = Object.hasOwn(meta.attrs, 'at');
  const cls = meta.attrs.bind !== undefined ? validated.classes.get(meta.attrs.bind) : undefined;
  const eff = cls && effectiveClass(cls, validated.parsed.config?.overrides[meta.id], meta.id);
  const uses = bound.uses.get(meta.id) ?? [];
  const measured = bound.measured.get(meta.id);
  // The end of the `up` and `down` uses (Use.end); the measured end, else the own `at`, when the link has none.
  const feedEnd =
    uses.find((use) => use.kind === 'up')?.end ??
    uses.find((use) => use.kind === 'down')?.end ??
    (measured ? (measured.end === 'target' ? 'target' : 'source') : meta.attrs.at === 'target' ? 'target' : 'source');
  const feeds = linkFeeds(feedEnd, 'tx', 'rx');
  const half = (direction: string) => `${direction} (${(direction === 'tx' ? eff?.up : eff?.down) ?? 'no query'})`;
  const end = ends.ends.get(meta.id);
  const sourceName = endName(end?.source, ends);
  const targetName = endName(end?.target, ends);
  // Two ends with one name: the cell id tells them apart, as visible text.
  const same = sourceName !== undefined && sourceName === targetName;
  const measuredEnd = measured ? measured.end : feedEnd;
  const keyedName = measuredEnd === 'target' ? targetName : sourceName;
  // The dependent uses of an unmeasured link are not in its list: show them as the YAML has them.
  const notMeasured =
    measured?.end === 'none' && cls && eff
      ? listUses(meta, eff).filter((use) => !uses.some((kept) => kept.path === use.path))
      : [];
  // The button writes the other end. With an inferred end it writes the end that the bind does not measure.
  const otherEnd = hasAt
    ? meta.attrs.at === 'target'
      ? null
      : 'target'
    : measuredEnd === 'target'
      ? 'source'
      : 'target';
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
      {measured ? (
        <p className={styles.line} data-testid="dmap-inspector-measured">
          {measuredText(meta, measured, bound, uses)}
        </p>
      ) : null}
      {measuredEnd !== 'none' ? (
        <p className={styles.line} data-testid="dmap-inspector-keyed">
          {`The key names the ${measuredEnd} end${keyedName ? ` (${keyedName})` : ''}.`}
        </p>
      ) : null}
      <p className={styles.line} data-testid="dmap-inspector-a2b">{`a → b: ${half(feeds.a2b)}`}</p>
      <p className={styles.line} data-testid="dmap-inspector-b2a">{`b → a: ${half(feeds.b2a)}`}</p>
      <CapacityLine meta={meta} bound={bound} ends={ends} />
      {notMeasured.length ? (
        <>
          <h4 className={styles.subtitle}>Not measured</h4>
          <ul className={styles.series} data-testid="dmap-inspector-not-measured">
            {notMeasured.map((use) => (
              <li key={use.path}>{`${use.path}: ${written(use)}`}</li>
            ))}
          </ul>
        </>
      ) : null}
      <div className={styles.form}>
        <Button
          size="sm"
          variant="secondary"
          data-testid="dmap-inspector-at"
          onClick={() => onWrite([{ id: meta.id, attrs: { at: otherEnd } }])}
        >
          {otherEnd === null ? 'Use the source end' : `Use the ${otherEnd} end`}
        </Button>
        {hasAt ? (
          <Button
            size="sm"
            variant="secondary"
            data-testid="dmap-inspector-infer"
            onClick={() => onWrite([{ id: meta.id, attrs: { at: null } }])}
          >
            Infer the end
          </Button>
        ) : null}
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

function UseDetails(props: { use: Use; resolved: string; feed?: string; series: Series[]; show: Show }) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const { use, resolved, feed, series, show } = props;
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
        {feed ? (
          <>
            <dt>Feed</dt>
            <dd data-testid="dmap-inspector-feed">{feed}</dd>
          </>
        ) : null}
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
