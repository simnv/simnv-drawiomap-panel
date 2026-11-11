import type { MatchV4 } from '../model/v4';
import type { CellMeta } from '../types';
import { endAttr, type EndContext } from './edgeEnds';
import type { UsePlan } from './uses';

/** A name that only the cell itself gives (I3). */
export function isOwnOnly(name: string): boolean {
  return ['bind', 'at', 'cap', 'capacity', 'id', 'label'].includes(name) || name.startsWith('pg-');
}

/** The cell that has an attribute and the path by which the reader found it. */
export interface AttrOrigin {
  value: string;
  cellId: string;
  via: 'own' | 'owner' | 'end';
}

function ownAttr(meta: CellMeta, name: string): AttrOrigin | undefined {
  const value = name === 'id' ? meta.id : Object.hasOwn(meta.attrs, name) ? meta.attrs[name] : undefined;
  return value === undefined ? undefined : { value, cellId: meta.id, via: 'own' };
}

function chainAttr(cellId: string, name: string, ctx: EndContext, ownOnly: boolean): AttrOrigin | undefined {
  if (name === 'id') {
    return { value: cellId, cellId, via: 'own' };
  }
  const seen = new Set<string>();
  for (let id: string | undefined = cellId; id !== undefined && !seen.has(id); id = ctx.parents.get(id)) {
    seen.add(id);
    const meta = ctx.index.get(id)?.meta;
    const origin = meta && ownAttr(meta, name);
    if (origin) {
      return { ...origin, via: id === cellId ? 'own' : 'owner' };
    }
    if (ownOnly) {
      break;
    }
  }
  return undefined;
}

/** Read the cell, then its owners; own-only names stop at the cell (I2). */
export function ownerAttr(cellId: string, name: string, ctx: EndContext): AttrOrigin | undefined {
  return chainAttr(cellId, name, ctx, isOwnOnly(name));
}

/** The sorted set of inheritable names in one parsed match block (I6). */
export function inheritableNames(requiredAttrs: readonly string[]): string[] {
  return [
    ...new Set(
      requiredAttrs.filter((name) => !name.startsWith('from.') && !name.startsWith('to.') && !isOwnOnly(name))
    ),
  ].sort();
}

/** True when a block needs no identity from an end (I6). */
export function isEndFree(meta: CellMeta, requiredAttrs: readonly string[]): boolean {
  return inheritableNames(requiredAttrs).every((name) => Object.hasOwn(meta.attrs, name));
}

/** The sorted union of the identity names of the dependent blocks (I6). */
export function identityNames(meta: CellMeta, blocks: ReadonlyArray<readonly string[]>): string[] {
  return inheritableNames(blocks.filter((block) => !isEndFree(meta, block)).flat());
}

export type EndReason = 'at' | 'own' | 'only' | 'both';
export type MeasuredEnd =
  | { end: 'source' | 'target'; reason: EndReason; cellId?: string; needs: string[] }
  | { end: 'none'; reason: 'none'; needs: string[] };

/**
 * Plan each match's feed or drop its dependent uses when unmeasured (I9, I13).
 * `blocks` maps each match used by the cell to its parsed required names.
 */
export function usePlan(meta: CellMeta, blocks: ReadonlyMap<MatchV4, readonly string[]>, end: MeasuredEnd): UsePlan {
  return (match) => {
    if (Object.hasOwn(meta.attrs, 'at')) {
      return meta.attrs.at === 'target' ? 'target' : 'source';
    }
    if (isEndFree(meta, blocks.get(match)!)) {
      return 'source';
    }
    return end.end === 'none' ? 'drop' : end.end;
  };
}

/** Select the measured end from the identity names, without reading series (I7). */
export function measuredEnd(meta: CellMeta, needs: readonly string[], ctx: () => EndContext): MeasuredEnd {
  const names = [...needs];
  if (Object.hasOwn(meta.attrs, 'at')) {
    return { end: meta.attrs.at === 'target' ? 'target' : 'source', reason: 'at', needs: names };
  }
  if (names.length === 0) {
    return { end: 'source', reason: 'own', needs: names };
  }
  const missing = names.filter((name) => !Object.hasOwn(meta.attrs, name));
  const context = ctx();
  const ends = context.ends.get(meta.id);
  const instrumented = (id: string | undefined) =>
    id !== undefined && missing.every((name) => ownerAttr(id, name, context) !== undefined);
  const source = instrumented(ends?.source);
  const target = instrumented(ends?.target);
  if (source || target) {
    const end = source ? 'source' : 'target';
    return { end, reason: source && target ? 'both' : 'only', cellId: ends?.[end], needs: names };
  }
  return names.some((name) => Object.hasOwn(meta.attrs, name))
    ? { end: 'source', reason: 'own', needs: names }
    : { end: 'none', reason: 'none', needs: names };
}

/** Read a link's own value, then its measured end; never read its container (I8). */
export function linkAttr(
  meta: CellMeta,
  name: string,
  end: MeasuredEnd,
  ctx: () => EndContext
): AttrOrigin | undefined {
  const own = ownAttr(meta, name);
  if (own || isOwnOnly(name) || end.end === 'none') {
    return own;
  }
  const context = ctx();
  const cellId = context.ends.get(meta.id)?.[end.end];
  const origin = cellId === undefined ? undefined : ownerAttr(cellId, name, context);
  return origin && { ...origin, via: 'end' };
}

/** Read the own capacity pair of the measured end cell (I14). */
export function endCap(
  meta: CellMeta,
  end: MeasuredEnd,
  ctx: EndContext
): { cellId: string; cap?: string; capacity?: string } | undefined {
  if (end.end === 'none') {
    return undefined;
  }
  const cellId = ctx.ends.get(meta.id)?.[end.end];
  const attrs = cellId === undefined ? undefined : ctx.index.get(cellId)?.meta.attrs;
  if (cellId === undefined || !attrs) {
    return undefined;
  }
  return {
    cellId,
    ...(Object.hasOwn(attrs, 'cap') ? { cap: attrs.cap } : {}),
    ...(Object.hasOwn(attrs, 'capacity') ? { capacity: attrs.capacity } : {}),
  };
}

function geometricAttr(meta: CellMeta, name: string, ctx: EndContext): AttrOrigin | undefined {
  const dot = name.indexOf('.');
  const end = name.slice(0, dot) === 'from' ? 'from' : 'to';
  const attr = name.slice(dot + 1);
  const value = endAttr(meta.id, end, attr, ctx);
  const cellId = ctx.ends.get(meta.id)?.[end === 'from' ? 'source' : 'target'];
  if (value === undefined || cellId === undefined) {
    return undefined;
  }
  // Geometric names keep endAttr's owner search, also for own-only names (I5).
  const origin = chainAttr(cellId, attr, ctx, false);
  return origin && { value, cellId: origin.cellId, via: 'end' };
}

/** The attribute resolver and measured-end memo of one bind (I17). */
export function createIdentity(ends: () => EndContext): {
  measure(meta: CellMeta, needs: readonly string[]): MeasuredEnd;
  attr(meta: CellMeta): (name: string) => string | undefined;
  inherited: Map<string, Map<string, AttrOrigin>>;
} {
  const measured = new Map<string, MeasuredEnd>();
  const inherited = new Map<string, Map<string, AttrOrigin>>();
  return {
    measure(meta, needs) {
      let end = measured.get(meta.id);
      if (!end) {
        end = measuredEnd(meta, needs, ends);
        measured.set(meta.id, end);
      }
      return end;
    },
    attr: (meta) => (name) => {
      let origin: AttrOrigin | undefined;
      if (name.startsWith('from.') || name.startsWith('to.')) {
        origin = geometricAttr(meta, name, ends());
      } else {
        // Most reads end at an own value. It needs no origin record, and the bind makes less garbage.
        if (name !== 'id' && Object.hasOwn(meta.attrs, name)) {
          return meta.attrs[name];
        }
        origin = ownAttr(meta, name);
        if (!origin && !isOwnOnly(name)) {
          origin = meta.isEdge
            ? linkAttr(meta, name, measured.get(meta.id) ?? measuredEnd(meta, [], ends), ends)
            : ownerAttr(meta.id, name, ends());
        }
      }
      if (origin && origin.via !== 'own') {
        let attrs = inherited.get(meta.id);
        if (!attrs) {
          attrs = new Map();
          inherited.set(meta.id, attrs);
        }
        attrs.set(name, origin);
      }
      return origin?.value;
    },
    inherited,
  };
}
