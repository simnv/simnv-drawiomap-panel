import type { DataFrame, Labels } from '@grafana/data';
import { canonicalAttrName, isWritableCellAttr } from '../model/cellAttrNames';
import { indexSeries } from '../query/seriesIndex';
import type { CellIndex } from '../types';
import type { BindResultV4 } from './bindV4';
import type { EndContext } from './edgeEnds';
import { createIdentity, isOwnOnly } from './identity';
import { createRegexCache, parseMatchBlock, resolveBlock, type ParsedMatcher } from './matcher';
import type { UsePath } from './report';

export interface Candidate {
  use: UsePath;
  target: string;
  attr: string;
  value: string;
  labels: Labels;
  via: 'orphan' | 'any';
}

export interface CandidateContext {
  index: CellIndex;
  ends: EndContext;
}

type IndexedSeries = ReturnType<typeof indexSeries>['series'];
const queryIndexes = new WeakMap<DataFrame[], Map<string, IndexedSeries>>();
const NO_FRAMES: DataFrame[] = [];

/** Query results keep their array identity until refresh. Scan their samples once for candidate lookup. */
function candidateSeries(frames: DataFrame[], refId: string): IndexedSeries {
  let byRef = queryIndexes.get(frames);
  if (!byRef) {
    byRef = new Map();
    queryIndexes.set(frames, byRef);
  }
  let series = byRef.get(refId);
  if (!series) {
    // Copy labels before the shared index reads them. Ignore values outside the Labels contract.
    const safeFrames = frames.map((frame) => ({
      ...frame,
      fields: frame.fields.map((field) => ({
        ...field,
        state: field.state && { ...field.state },
        labels: stringLabels(field.labels),
      })),
    }));
    series = indexSeries(safeFrames, refId).series;
    byRef.set(refId, series);
  }
  return series;
}

/** Find identity repairs for one selected cell. The bind never calls this function. */
export function candidatesFor(
  cellId: string,
  result: BindResultV4,
  framesByRefId: ReadonlyMap<string, DataFrame[]>,
  ctx: CandidateContext
): Candidate[] {
  const meta = ctx.index.get(cellId)?.meta;
  if (!meta) {
    return [];
  }
  const identity = createIdentity(() => ctx.ends);
  const measured = result.measured.get(cellId);
  if (meta.isEdge && measured) {
    identity.measure(meta, measured.needs);
  }
  const attrs = identity.attr(meta);
  const cache = createRegexCache();
  const selected = new Map<string, Set<string>>();
  for (const byPath of result.series.values()) {
    for (const series of byPath.values()) {
      for (const s of series) {
        const keys = selected.get(s.refId) ?? new Set<string>();
        keys.add(labelKey(s.labels));
        selected.set(s.refId, keys);
      }
    }
  }
  const found: Candidate[] = [];
  const trialIndex = new Map(ctx.index);
  for (const use of result.uses.get(cellId) ?? []) {
    if (result.series.get(cellId)?.get(use.path)?.length !== 0) {
      continue;
    }
    const bound = result.resolved.get(cellId)?.get(use.path);
    const missing = result.report.some(
      (entry) => entry.kind === 'missing-attr' && entry.path === use.path && entry.cellIds.includes(cellId)
    );
    if (!bound || (!('matchers' in bound) && !missing)) {
      continue;
    }
    const parsed = parseMatchBlock(use.match, use.path);
    if (!parsed.ok) {
      continue;
    }
    const seriesForRef = candidateSeries(framesByRefId.get(use.refId) ?? NO_FRAMES, use.refId);
    for (const series of seriesForRef) {
      for (const matcher of parsed.block.matchers) {
        // Regex matchers do not give candidate attribute values.
        if (matcher.op !== '=') {
          continue;
        }
        if (!Object.hasOwn(series.labels, matcher.label)) {
          continue;
        }
        const repair = attributeValue(matcher, series.labels[matcher.label]);
        if (!repair || repair.value === attrs(repair.attr)) {
          continue;
        }
        const { attr, value } = repair;
        const via = selected.get(use.refId)?.has(labelKey(series.labels)) ? 'any' : 'orphan';
        const end = measured?.end;
        const geometric = attr.startsWith('from.') ? 'source' : attr.startsWith('to.') ? 'target' : undefined;
        const target = geometric
          ? ctx.ends.ends.get(cellId)?.[geometric]
          : meta.isEdge && !Object.hasOwn(meta.attrs, attr) && !isOwnOnly(attr) && end && end !== 'none'
            ? ctx.ends.ends.get(cellId)?.[end]
            : cellId;
        const writeAttr = geometric ? attr.slice(attr.indexOf('.') + 1) : attr;
        // Class and feed controls can change the use itself. They are not identity repairs.
        if (!isWritableCellAttr(writeAttr) || ['at', 'bind'].includes(canonicalAttrName(writeAttr))) {
          continue;
        }
        const original = target === undefined ? undefined : ctx.index.get(target);
        if (original && target !== undefined) {
          const canonical = canonicalAttrName(writeAttr);
          const writtenAttrs = {
            ...Object.fromEntries(
              Object.entries(original.meta.attrs).filter(([name]) => canonicalAttrName(name) !== canonical)
            ),
            [canonical]: value,
          };
          trialIndex.set(target, {
            ...original,
            meta: { ...original.meta, attrs: writtenAttrs },
          });
          const trialIdentity = createIdentity(() => ({ ...ctx.ends, index: trialIndex }));
          const reader = trialIndex.get(cellId)!.meta;
          if (reader.isEdge && measured) {
            trialIdentity.measure(reader, measured.needs);
          }
          const resolved = resolveBlock(parsed.block, trialIdentity.attr(reader), cache);
          trialIndex.set(target, original);
          if (!resolved.ok || !resolved.test(series.labels)) {
            continue;
          }
          found.push({
            use: use.path,
            target,
            attr: writeAttr,
            value,
            labels: series.labels,
            via,
          });
        }
      }
    }
  }
  const seen = new Set<string>();
  return [...found.filter((c) => c.via === 'orphan'), ...found.filter((c) => c.via === 'any')]
    .filter((c) => {
      const key = JSON.stringify([c.use, c.target, c.attr, c.value]);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function labelKey(labels: Labels): string {
  const own = stringLabels(labels);
  return JSON.stringify(
    Object.keys(own)
      .sort()
      .map((name) => [name, own[name]])
  );
}

function stringLabels(labels: Labels | undefined): Labels {
  return Object.fromEntries(
    Object.entries(labels ?? {}).filter(
      ([name, value]) => Object.hasOwn(labels ?? {}, name) && typeof value === 'string'
    )
  );
}

function attributeValue(matcher: ParsedMatcher, labelValue: string): { attr: string; value: string } | undefined {
  // More than one placeholder has no unique inverse. A fixed matcher gives no attribute to repair.
  const names = matcher.parts.filter((part) => typeof part !== 'string');
  if (names.length !== 1) {
    return undefined;
  }
  const part = names[0];
  const at = matcher.parts.indexOf(part);
  const prefix = matcher.parts.slice(0, at).join('');
  const suffix = matcher.parts.slice(at + 1).join('');
  if (
    !labelValue.startsWith(prefix) ||
    !labelValue.endsWith(suffix) ||
    labelValue.length < prefix.length + suffix.length
  ) {
    return undefined;
  }
  return { attr: part.attr, value: labelValue.slice(prefix.length, labelValue.length - suffix.length) };
}
