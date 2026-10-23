import { ownersOfPath, type DisplayOwner, type DisplayProvenance } from '../binding/patterns';
import type { DiagramConfigV2, DisplayConfig } from '../model/config';

/** Where the effective value of a field comes from, and what a reset would remove. */
export interface FieldSource {
  /** The owner of the effective value. `default` means that no pattern and no override sets it. */
  owner: 'pattern' | 'override' | 'default';
  /** The name of the pattern when `owner` is `pattern`. */
  name?: string;
  /** The edited owner's own display has a value at `resetPath`: a reset would remove it. */
  resettable: boolean;
  /**
   * The path that a reset removes. Arrays replace whole when displays merge, and a health rule is one unit, so a path
   * inside `hover.rows[i]` resets `hover.rows` and a path inside `status` resets `status`.
   */
  resetPath: string;
}

/** Fields that merge as one unit: a reset removes the whole unit, never one leaf of it. */
export function resetPathOf(path: string): string {
  const array = path.replace(/\[\d+\].*$/, '');
  if (array !== path) {
    return array;
  }
  // A health rule is replaced as a whole when the kind changes, and its schema needs the binding and the default.
  return path === 'status' || path.startsWith('status.') ? 'status' : path;
}

/** The value of a dotted path (with `[i]` indexes) in a display, or `undefined`. */
export function valueAtPath(display: unknown, path: string): unknown {
  let at: unknown = display;
  for (const part of path.split(/\.|(?=\[)/).filter(Boolean)) {
    if (typeof at !== 'object' || at === null) {
      return undefined;
    }
    const index = /^\[(\d+)\]$/.exec(part);
    at = (at as Record<string, unknown>)[index ? index[1] : part];
  }
  return at;
}

/** The own display of the edited owner. */
export function ownDisplay(config: DiagramConfigV2, editing: DisplayOwner): Partial<DisplayConfig> | undefined {
  return editing.kind === 'pattern'
    ? config.patterns[editing.index]?.display
    : config.overrides.find((o) => o.cellId === editing.cellId)?.display;
}

/**
 * The owners that set this field, or an array above it. `ownersOfPath` also climbs to an ancestor when nothing sets the
 * path; a field that nobody sets is a default, not the owner of its section, so this lookup does not climb.
 */
function ownersAt(provenance: DisplayProvenance, path: string): DisplayOwner[] {
  const target = path.replace(/\[\d+\].*$/, '');
  const related = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || a.startsWith(`${b}[`);
  const set = Array.from(provenance.keys()).some((key) => related(target, key) || related(key, target));
  return set ? ownersOfPath(provenance, target) : [];
}

/**
 * The source of a field. The effective source comes from the merge provenance: the override beats every pattern, and
 * a later pattern beats an earlier one. The reset eligibility is computed apart, from the edited owner's own display.
 */
export function fieldSourceOf(
  provenance: DisplayProvenance,
  path: string,
  editing: DisplayOwner,
  config: DiagramConfigV2
): FieldSource {
  const owners = ownersAt(provenance, path);
  const override = owners.find((owner) => owner.kind === 'override');
  const patterns = owners.filter(
    (owner): owner is Extract<DisplayOwner, { kind: 'pattern' }> => owner.kind === 'pattern'
  );
  const last = patterns.length ? patterns.reduce((a, b) => (b.index > a.index ? b : a)) : undefined;
  const resetPath = resetPathOf(path);
  const resettable = valueAtPath(ownDisplay(config, editing), resetPath) !== undefined;
  if (override) {
    return { owner: 'override', resettable, resetPath };
  }
  if (last) {
    return { owner: 'pattern', name: config.patterns[last.index]?.name, resettable, resetPath };
  }
  return { owner: 'default', resettable, resetPath };
}

/** The chip text: "Pattern Core routers", "Override" or "Default". */
export function sourceText(source: FieldSource): string {
  return source.owner === 'pattern'
    ? `Pattern ${source.name ?? ''}`.trim()
    : source.owner === 'override'
      ? 'Override'
      : 'Default';
}

const UNIT_NAMES: Record<string, string> = { 'hover.rows': 'hover rows', status: 'health rule' };

/** The accessible name of the reset button: "Reset Label template to pattern", "Reset hover rows to pattern". */
export function resetLabel(label: string, source: FieldSource, scope: 'element' | 'pattern'): string {
  return `Reset ${UNIT_NAMES[source.resetPath] ?? label} to ${scope === 'pattern' ? 'default' : 'pattern'}`;
}
