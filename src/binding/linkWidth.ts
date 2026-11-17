import type { LinkWidthOptions, WidthTier } from '../types';
import { parseCapValue } from './capacity';

/** The tiers in ascending order of `min`, with a positive width. A list that is not valid gives none. */
export function validTiers(tiers: readonly WidthTier[] | undefined): WidthTier[] {
  return parseTiersCheck(tiers ?? []) === undefined ? [...(tiers ?? [])] : [];
}

/** The problem of a tier list, or undefined when it is valid: ascending `min` from 0 up, each width above 0. */
export function parseTiersCheck(tiers: readonly WidthTier[]): string | undefined {
  for (let i = 0; i < tiers.length; i++) {
    const { min, width } = tiers[i];
    if (!Number.isFinite(min) || min < 0) {
      return `Tier ${i + 1}: the speed must be a number of 0 or more`;
    }
    if (!Number.isFinite(width) || width <= 0) {
      return `Tier ${i + 1}: the width must be more than 0`;
    }
    if (i > 0 && min <= tiers[i - 1].min) {
      return `Tier ${i + 1}: the speeds must go up`;
    }
  }
  return undefined;
}

/** The index of the tier of a capacity (bit/s): the highest tier whose `min` is at most the capacity, else -1. */
export function tierOf(capacity: number | undefined, tiers: readonly WidthTier[]): number {
  if (capacity === undefined || !Number.isFinite(capacity)) {
    return -1;
  }
  let found = -1;
  for (let i = 0; i < tiers.length; i++) {
    if (tiers[i].min <= capacity) {
      found = i;
    }
  }
  return found;
}

/** The width of a link half: from the load (`load` mode) or from its capacity by the tiers (`capacity` mode). */
export function halfWidth(percent: number | undefined, capacity: number | undefined, w: LinkWidthOptions): number {
  if (w.mode === 'capacity') {
    const tiers = validTiers(w.tiers);
    const i = tierOf(capacity, tiers);
    return i < 0 ? w.min : tiers[i].width;
  }
  if (percent === undefined || !Number.isFinite(percent)) {
    return w.min;
  }
  const t = Math.min(1, Math.max(0, percent / 100));
  return w.min + (w.max - w.min) * t;
}

/**
 * The range of the drawn widths, for the overlay and the label layer: `min` to `max` in `load` mode; in `capacity`
 * mode from the smallest to the largest of `min` and the tier widths.
 */
export function linkWidthRange(w: LinkWidthOptions): { min: number; max: number } {
  if (w.mode !== 'capacity') {
    return { min: w.min, max: w.max };
  }
  const widths = [w.min, ...validTiers(w.tiers).map((t) => t.width)];
  return { min: Math.min(...widths), max: Math.max(...widths) };
}

const SI: Array<[number, string]> = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
];

/** A speed in bit/s as short text for the legend (3 digits): 30M, 120M, 1G, 2.5G, 0. */
export function formatBits(bits: number): string {
  for (const [scale, suffix] of SI) {
    if (bits >= scale) {
      const n = bits / scale;
      return `${Number(n.toPrecision(3))}${suffix}`;
    }
  }
  return String(Number(bits.toPrecision(3)));
}

/**
 * A speed in bit/s as exact text for the editor: the largest suffix that keeps the value exact ("155.52M", "1G"),
 * else the plain number. The text reads back to the same value.
 */
function exactBits(bits: number): string {
  for (const [scale, suffix] of SI) {
    const n = bits / scale;
    if (n >= 1 && parseCapValue(`${n}${suffix}`) === bits) {
      return `${n}${suffix}`;
    }
  }
  return String(bits);
}

/** The tiers as text for the editor: "0: 1.5, 100M: 2.5, 1G: 4, 10G: 5.5". The text reads back to the same tiers. */
export function formatTiers(tiers: readonly WidthTier[]): string {
  return tiers.map((t) => `${exactBits(t.min)}: ${t.width}`).join(', ');
}

/** The same tiers, value by value. */
export function sameTiers(a: readonly WidthTier[] | undefined, b: readonly WidthTier[] | undefined): boolean {
  return (
    (a ?? []).length === (b ?? []).length && (a ?? []).every((t, i) => t.min === b![i].min && t.width === b![i].width)
  );
}

/** The tiers from the editor text, or the problem of the text. */
export function parseTiers(text: string): { tiers: WidthTier[] } | { error: string } {
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  const tiers: WidthTier[] = [];
  for (const [i, part] of parts.entries()) {
    const [speed, width, ...rest] = part.split(':');
    const min = parseCapValue(speed ?? '');
    const w = Number((width ?? '').trim());
    if (rest.length || min === undefined || width === undefined || !/^\s*\d+(\.\d+)?\s*$/.test(width)) {
      return {
        error: `Tier ${i + 1}: write a speed (a number with k, M, G or T) and a width, for example "100M: 2.5"`,
      };
    }
    tiers.push({ min, width: w });
  }
  if (!tiers.length) {
    return { error: 'Write at least one tier, for example "0: 1.5, 100M: 2.5, 1G: 4"' };
  }
  const problem = parseTiersCheck(tiers);
  return problem ? { error: problem } : { tiers };
}
