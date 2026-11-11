import type { Diagram } from '../types';

/** What the starter reads: the kind of diagram, its edges and the refIds of the panel targets. */
export interface StarterInput {
  /** The diagram has a `pg-schema` (a portograph export). */
  portograph: boolean;
  /** The diagram has at least one edge. */
  edges: boolean;
  refIds: readonly string[];
  /** When no refId looks like up or state, use the first refId (default). Else leave `status` out. */
  guessStatus?: boolean;
}

const tokensOf = (refId: string): string[] =>
  refId
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const hasToken = (refId: string, words: readonly string[]) => tokensOf(refId).some((t) => words.includes(t));

/** The pairs of names of the transmit and the receive counter (the up half first). */
const PAIRS: ReadonlyArray<[string, string]> = [
  ['tx', 'rx'],
  ['out', 'in'],
  ['up', 'down'],
];

/**
 * The refIds of the two halves of a link, or undefined when no pair of names fits. A whole token (`lan_tx`) wins over a
 * fragment (`txbytes`); the fragment counts only for `tx` and `rx` and only when no refId has the token.
 */
function linkPair(refIds: readonly string[]): { up: string; down: string } | undefined {
  for (const [upWord, downWord] of PAIRS) {
    const fragment = upWord === 'tx';
    const find = (word: string, skip?: string) =>
      refIds.find((r) => r !== skip && hasToken(r, [word])) ??
      (fragment ? refIds.find((r) => r !== skip && r.toLowerCase().includes(word)) : undefined);
    const up = find(upWord);
    const down = up === undefined ? undefined : find(downWord, up);
    if (up !== undefined && down !== undefined) {
      return { up, down };
    }
  }
  return undefined;
}

/** The refId for the status of a node: the first one that looks like up or state, else the first one. */
function statusRefId(refIds: readonly string[], guess: boolean): string | undefined {
  return refIds.find((r) => hasToken(r, ['up', 'state', 'status'])) ?? (guess ? refIds[0] : undefined);
}

/**
 * A starter config (version 4) for a diagram and the targets of the panel. The result has no `schema` entry in
 * `validateConfig`. The cells have no `bind` yet, so the report shows `class-no-cells` until the user binds them.
 */
export function buildStarter({ portograph, edges, refIds, guessStatus = true }: StarterInput): Record<string, unknown> {
  const status = statusRefId(refIds, guessStatus);
  const classes: Record<string, unknown> = {
    node: { match: { key: 'job' }, ...(status === undefined ? {} : { status }) },
  };
  if (portograph || edges) {
    const pair = linkPair(refIds);
    classes.link = {
      match: { key: 'job', port: 'device' },
      ...(pair ?? {}),
    };
  }
  return { version: 4, freshness: '3x', classes };
}

/**
 * True for a config with nothing authored: no value, `{}`, or only an empty `classes` or `overrides`. A `version`, an
 * override, a `build` or any other field makes it not empty, so the starter never replaces existing work.
 */
export function isEmptyConfig(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([key, item]) =>
      (key === 'classes' || key === 'overrides') &&
      (item === undefined ||
        item === null ||
        (typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 0))
  );
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
