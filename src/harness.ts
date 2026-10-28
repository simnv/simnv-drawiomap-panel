import { createRegexCache, parseMatchBlock, resolveBlock } from './binding/matcher';
import type { Use } from './binding/uses';
import { chartRowV4 } from './interact/cardModel';

export { validateConfig } from './model/validate';
export { bindV4 as bind } from './binding/bindV4';
export { buildCellIndex, cellMetas, mountSvg } from './render/svgStage';
export { sanitizeSvg } from './render/sanitize';
export { buildCardV4 as buildCard } from './interact/cardModel';
export { buildLegendV4 as buildLegend } from './legend/model';
export { fnv1a } from './util/hash';

/** Parse a v4 match block, then resolve its cell attributes with the shared matcher. */
export function compileMatcher(
  block: Parameters<typeof parseMatchBlock>[0],
  attrs: Parameters<typeof resolveBlock>[1],
  path = 'match',
  cache = createRegexCache()
) {
  const parsed = parseMatchBlock(block, path);
  return parsed.ok ? resolveBlock(parsed.block, attrs, cache) : parsed;
}

/** Read one bound use as a history row with the same rules as the v4 card. */
export function historyOf(
  cellId: string,
  use: Use,
  bound: Parameters<typeof chartRowV4>[1],
  ctx: Parameters<typeof chartRowV4>[2]
) {
  return chartRowV4({ cellId, path: use.path, chart: { kind: 'history', query: use.refId } }, bound, ctx);
}
