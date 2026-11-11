import type { ReportEntry } from '../binding/report';
import type { ConfigV4 } from '../model/v4';
import { parsePath, yamlPath } from '../model/yamlPath';

/** The YAML place of a report entry (a path or a line) and its cells (spec 4). */
export interface EntryTarget {
  path?: string;
  line?: number;
  cells: string[];
}

/**
 * A click in the report. A count row gives a path: the editor lights the cells of the path, as a cursor move does
 * (spec 5.3). An entry gives its own cells: the editor lights them; an entry with no cells moves the cursor only.
 */
export type ReportPick = { kind: 'path'; path: string } | ({ kind: 'entry' } & EntryTarget);

const classPath = (cls: string, ...rest: string[]) => yamlPath(['classes', cls, ...rest]);

/** The YAML place and the cells of a report entry. */
export function entryTarget(entry: ReportEntry): EntryTarget {
  switch (entry.kind) {
    case 'yaml':
      return { line: entry.line, cells: [] };
    case 'schema':
    case 'unknown-ref':
      return { path: entry.path, cells: [] };
    case 'outdated-config':
      return { path: 'version', cells: [] };
    case 'class-cycle':
    case 'class-unknown-parent':
    case 'class-invalid-parent':
      return { path: classPath(entry.cls, 'extends'), cells: [] };
    case 'class-no-cells':
      return { path: classPath(entry.cls), cells: [] };
    case 'class-no-match':
      return { path: classPath(entry.cls), cells: entry.cellIds };
    case 'unknown-override':
      return { path: yamlPath(['overrides', entry.cellId]), cells: [] };
    case 'missing-attr':
    case 'matcher-error':
    case 'template-unresolved':
      return { path: entry.path, cells: entry.cellIds };
    case 'no-series':
    case 'unit-mismatch':
      return { path: entry.use, cells: entry.cellIds };
    case 'many-series':
      return { path: entry.use, cells: entry.cells.map((c) => c.id) };
    case 'capacity-fallback':
      return { path: classPath(entry.cls, 'capacity'), cells: entry.cellIds };
    case 'unused-field':
      return { path: classPath(entry.cls, entry.field), cells: entry.cellIds };
    case 'unknown-class':
    case 'bad-cap':
    case 'no-edge-ends':
      return { cells: entry.cellIds };
    case 'query-unavailable':
    case 'orphan-series':
    case 'many-fields':
    case 'invalid-series':
    case 'duplicate-series':
      return { cells: [] };
  }
}

/** The class of a path: `classes.<c>…` gives `c`. */
export function classOfPath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const [root, name] = parsePath(path);
  return root === 'classes' && typeof name === 'string' ? name : undefined;
}

export interface ReportGroup {
  cls?: string;
  entries: ReportEntry[];
  uses: Array<{ label: string; target: EntryTarget }>;
}

/** A use within its class tab. The YAML target keeps the full path. */
export function reportUse(path: string, config?: ConfigV4 | null): string {
  const parts = parsePath(path);
  const [root, name, field, index] = parts;
  if (root !== 'classes' || typeof name !== 'string') {
    return path;
  }
  const short = yamlPath(parts.slice(2)) || name;
  const label = field === 'rows' && typeof index === 'number' ? config?.classes[name]?.rows?.[index]?.label : undefined;
  return label ? `${short} (${label})` : short;
}

/**
 * Group display rows only. The bind report and its YAML markers keep every entry.
 * Every key includes kind, class and the unordered cell set. The extra cause key is:
 *
 * | Kind | Extra cause key |
 * | missing-attr | attribute |
 * | unknown-ref | refId |
 * | matcher-error | matcher text and error message |
 * | no-series, template-unresolved, unused-field, class-no-match, class-no-cells | none |
 * | many-series | unordered cell id/count pairs |
 * | unit-mismatch | unordered unit set |
 * | capacity-fallback, no-edge-ends | reason |
 * | bad-cap | value |
 * | class-cycle, class-unknown-parent, class-invalid-parent | none |
 * | unknown-class | bind name |
 * | unknown-override | cell id |
 * | schema | path and message |
 * | yaml | line and message |
 * | outdated-config | version |
 * | query-unavailable | refId, state and message |
 * | many-fields, invalid-series | refId and message |
 * | orphan-series | refId, label sets and overflow count |
 * | duplicate-series | refId and labels |
 *
 * Missing attributes, unknown refs, matcher errors and no-series rows come first, in that order.
 * Other rows keep their source order. Uses keep their source paths and source order.
 */
export function groupReport(entries: readonly ReportEntry[], config?: ConfigV4 | null): ReportGroup[] {
  const groups = new Map<string, ReportGroup>();
  for (const entry of entries) {
    const target = entryTarget(entry);
    const cls = 'cls' in entry ? entry.cls : classOfPath(target.path);
    const key = JSON.stringify([entry.kind, cls, [...new Set(target.cells)].sort(), causeOf(entry)]);
    let group = groups.get(key);
    if (!group) {
      group = { cls, entries: [], uses: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
    if (target.path && !group.uses.some((use) => use.target.path === target.path)) {
      group.uses.push({ label: reportUse(target.path, config), target });
    }
  }
  const priority = (group: ReportGroup) => {
    const at = ['missing-attr', 'unknown-ref', 'matcher-error', 'no-series'].indexOf(group.entries[0].kind);
    return at < 0 ? 4 : at;
  };
  return [...groups.values()].sort((a, b) => priority(a) - priority(b));
}

function causeOf(entry: ReportEntry): unknown {
  switch (entry.kind) {
    case 'missing-attr':
      return entry.attr;
    case 'unknown-ref':
      return entry.refId;
    case 'matcher-error':
      return [entry.text, entry.message];
    case 'no-series':
    case 'template-unresolved':
    case 'unused-field':
    case 'class-no-match':
    case 'class-no-cells':
    case 'class-cycle':
    case 'class-unknown-parent':
    case 'class-invalid-parent':
      return null;
    case 'many-series':
      return entry.cells.map(({ id, count }) => [id, count] as const).sort(([a], [b]) => a.localeCompare(b));
    case 'unit-mismatch':
      return [...new Set(entry.units)].sort();
    case 'capacity-fallback':
    case 'no-edge-ends':
      return entry.reason;
    case 'bad-cap':
      return entry.value;
    case 'unknown-class':
      return entry.bind;
    case 'unknown-override':
      return entry.cellId;
    case 'schema':
      return [entry.path, entry.message];
    case 'yaml':
      return [entry.line, entry.message];
    case 'outdated-config':
      return entry.version;
    case 'query-unavailable':
      return [entry.refId, entry.state, entry.message];
    case 'many-fields':
    case 'invalid-series':
      return [entry.refId, entry.message];
    case 'orphan-series':
      return [entry.refId, entry.labels, entry.more];
    case 'duplicate-series':
      return [entry.refId, entry.labels];
  }
}

/** The same short cause text serves the editor row and the view-mode tooltip. */
export function reportGroupLine(group: ReportGroup, tooltip = false): string {
  const entry = group.entries[0];
  const line = entry.kind === 'schema' ? `${group.uses[0]?.label ?? entry.path}: ${entry.message}` : reportLine(entry);
  return tooltip
    ? `${group.cls ? `${group.cls}: ` : ''}${line}${group.uses.length ? ` (used by ${group.uses.map((use) => use.label).join(', ')})` : ''}`
    : line;
}

const counted = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const have = (n: number) => (n === 1 ? 'has' : 'have');

/** The line of a report entry in the warning list of the panel (spec 4: view mode shows the count). */
export function reportLine(entry: ReportEntry): string {
  switch (entry.kind) {
    case 'schema':
      return `${entry.path}: ${entry.message}`;
    case 'yaml':
      return `line ${entry.line}: ${entry.message}`;
    case 'outdated-config':
      return `This configuration has version ${String(entry.version)}. The panel reads version 4 only: write the config again as version 4.`;
    case 'query-unavailable':
      return `${entry.refId}: ${entry.message}`;
    case 'orphan-series':
      return `${entry.refId}: ${entry.labels.length + entry.more} series ${entry.labels.length + entry.more === 1 ? 'selects' : 'select'} no cell`;
    case 'many-fields':
    case 'invalid-series':
      return `${entry.refId}: ${entry.message}`;
    case 'duplicate-series':
      return `${entry.refId}: duplicate series ${JSON.stringify(entry.labels)}`;
    case 'unknown-ref':
      return `No panel query has refId ${entry.refId}`;
    case 'unknown-class':
      return `${counted(entry.cellIds.length, 'cell')} ${entry.cellIds.length === 1 ? 'binds' : 'bind'} unknown class ${entry.bind}`;
    case 'unknown-override':
      return `${yamlPath(['overrides', entry.cellId])}: the diagram has no such cell`;
    case 'class-no-cells':
      return `No cell binds this class`;
    case 'class-no-match':
      return `The class has no match`;
    case 'class-cycle':
    case 'class-unknown-parent':
    case 'class-invalid-parent':
      return entry.kind;
    case 'missing-attr':
      return `${counted(entry.cellIds.length, 'cell')} ${have(entry.cellIds.length)} no attribute \`${entry.attr}\``;
    case 'matcher-error':
      return entry.message;
    case 'template-unresolved':
      return `The template does not resolve for ${counted(entry.cellIds.length, 'cell')}`;
    case 'no-series':
      return `${counted(entry.cellIds.length, 'cell')} ${have(entry.cellIds.length)} no series`;
    case 'many-series':
      return `${counted(entry.cells.length, 'cell')} ${have(entry.cells.length)} more than one series`;
    case 'unit-mismatch':
      return `The units ${entry.units.join(', ')} do not convert`;
    case 'capacity-fallback':
      return `Capacity: ${entry.reason}`;
    case 'bad-cap':
      return `cap "${entry.value}" is not a capacity (${counted(entry.cellIds.length, 'cell')})`;
    case 'no-edge-ends':
      return `${counted(entry.cellIds.length, 'edge')} ${have(entry.cellIds.length)} no ends: ${entry.reason}`;
    case 'unused-field':
      return `Not used on ${counted(entry.cellIds.length, 'cell')} that ${entry.cellIds.length === 1 ? 'is not an edge' : 'are not edges'}`;
  }
}
