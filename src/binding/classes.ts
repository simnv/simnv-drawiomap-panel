import { classChain, type ClassV4, type OverrideV4, type ParsedConfig, type RowV4 } from '../model/v4';
import { yamlPath } from '../model/yamlPath';

/** A row with the YAML path of the class or the override that declares it (`classes.device.rows[0]`). */
export type ResolvedRow = RowV4 & { origin: string };
/**
 * A class after `extends` (spec 2.3). `chain` starts at the root and ends with the class. `abstract`: the class has
 * no `match` (A7). `origins` holds, for each field other than `rows`, the YAML path of the class or the override that
 * sets it (`classes.device.status`, `overrides.<cellId>.url`).
 */
export type ResolvedClass = Omit<ClassV4, 'rows'> & {
  name: string;
  chain: string[];
  rows: ResolvedRow[];
  abstract: boolean;
  origins: Record<string, string>;
};

/**
 * Apply one layer of the chain: the rows append with their origin, each other field that the layer sets replaces,
 * with the path of the layer as its origin.
 */
function applyLayer(base: ResolvedClass, layer: ClassV4 | OverrideV4, prefix: string): ResolvedClass {
  const { rows = [], ...fields } = layer;
  const set = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as OverrideV4;
  const next: ResolvedClass = {
    ...base,
    ...set,
    rows: [...base.rows, ...rows.map((row, i) => ({ ...row, origin: `${prefix}.rows[${i}]` }))],
    origins: { ...base.origins, ...Object.fromEntries(Object.keys(set).map((key) => [key, `${prefix}.${key}`])) },
  };
  next.abstract = next.match === undefined;
  return next;
}

/**
 * Resolve `extends` for each valid class (spec 2.3, 3.2 step 2). The map holds no class of `parsed.invalidClasses`
 * and no class with a chain error.
 */
export function resolveClasses(parsed: ParsedConfig): Map<string, ResolvedClass> {
  const resolved = new Map<string, ResolvedClass>();
  const classes = parsed.config?.classes ?? {};
  for (const name of Object.keys(classes)) {
    const found = parsed.invalidClasses.has(name) ? null : classChain(name, classes, parsed.invalidClasses);
    if (!found || 'error' in found) {
      continue;
    }
    const root: ResolvedClass = { name, chain: found.chain, rows: [], abstract: true, origins: {} };
    resolved.set(
      name,
      found.chain.reduce((cls, link) => applyLayer(cls, classes[link], yamlPath(['classes', link])), root)
    );
  }
  return resolved;
}

/**
 * The class of one cell after its override (D6): the override rows append, each other field replaces. The rows of
 * the override get the origin `overrides.<cellId>.rows[i]` (`overrides["<cellId>"]` for an id with a dot), so the
 * call needs the id of the cell.
 */
export function effectiveClass(cls: ResolvedClass, override: OverrideV4 | undefined, cellId: string): ResolvedClass {
  return override ? applyLayer(cls, override, yamlPath(['overrides', cellId])) : cls;
}
