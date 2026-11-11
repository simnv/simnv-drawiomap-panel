import type { Diagram } from '../types';

/** What the starter reads: the kind of diagram, its edges and the refIds of the panel targets. */
export interface StarterInput {
  /** The diagram has a `pg-schema` (a portograph export). */
  portograph: boolean;
  /** The diagram has at least one edge. */
  edges: boolean;
  refIds: readonly string[];
}

const tokensOf = (refId: string): string[] =>
  refId
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const hasToken = (refId: string, words: readonly string[]) => tokensOf(refId).some((t) => words.includes(t));
const hasPart = (refId: string, part: string) => refId.toLowerCase().includes(part);

/** The pairs of names of the transmit and the receive counter. Each test is on one refId. */
const PAIRS: ReadonlyArray<[(refId: string) => boolean, (refId: string) => boolean]> = [
  [(r) => hasPart(r, 'tx'), (r) => hasPart(r, 'rx')],
  [(r) => hasToken(r, ['out']), (r) => hasToken(r, ['in'])],
  [(r) => hasToken(r, ['up']), (r) => hasToken(r, ['down'])],
];

/** The refIds of the two halves of a link, or undefined when no pair of names fits. */
function linkPair(refIds: readonly string[]): { up: string; down: string } | undefined {
  for (const [isUp, isDown] of PAIRS) {
    const up = refIds.find(isUp);
    const down = refIds.find((r) => r !== up && isDown(r));
    if (up !== undefined && down !== undefined) {
      return { up, down };
    }
  }
  return undefined;
}

/** The refId for the status of a node: the first one that looks like up or state, else the first one. */
function statusRefId(refIds: readonly string[]): string | undefined {
  return refIds.find((r) => hasToken(r, ['up', 'state', 'status'])) ?? refIds[0];
}

/**
 * A starter config (version 4) for a diagram and the targets of the panel. The result has no `schema` entry in
 * `validateConfig`. The cells have no `bind` yet, so the report shows `class-no-cells` until the user binds them.
 */
export function buildStarter({ portograph, edges, refIds }: StarterInput): Record<string, unknown> {
  const status = statusRefId(refIds);
  const classes: Record<string, unknown> = {
    node: { match: { key: 'job' }, ...(status === undefined ? {} : { status }) },
  };
  if (portograph || edges) {
    const pair = linkPair(refIds);
    classes.link = {
      match: portograph ? { key: 'job', port: 'device' } : { key: 'job' },
      ...(pair ?? {}),
    };
  }
  return { version: 4, freshness: '3x', classes };
}

/** True for a config with no `version` and no classes: nothing, `{}` or an empty text. */
export function isEmptyConfig(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const config = value as Record<string, unknown>;
  const classes = config.classes;
  const noClasses =
    classes === undefined ||
    classes === null ||
    (typeof classes === 'object' && Object.keys(classes as object).length === 0);
  return config.version === undefined && noClasses;
}

/**
 * The kind of a diagram, read from the text of its XML and SVG, with no parse. A compressed XML page (a diagram that a
 * plugin version before 1.5.3 stored) shows no edges: then the starter assumes that edges exist.
 */
export function starterFacts(diagram: Pick<Diagram, 'xml' | 'svg'>): Pick<StarterInput, 'portograph' | 'edges'> {
  const root = /<g\b[^>]*\sdata-cell-id="0"[^>]*>/.exec(diagram.svg)?.[0] ?? '';
  const portograph = /\sdata-meta-pg-schema="[^"]*"/.test(root);
  const readable = diagram.xml.includes('<mxCell');
  return { portograph, edges: readable ? /\sedge="1"/.test(diagram.xml) : true };
}

/** The text of the notice that stands above an empty config. */
export const STARTER_NOTICE = 'Then give cells `bind` (node or link), `key` on nodes and `port` on measured ports.';
