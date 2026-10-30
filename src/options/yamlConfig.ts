import { CST, Document, isNode, isScalar, LineCounter, Parser, parseDocument, visit } from 'yaml';

type Context =
  'root' | 'classes' | 'overrides' | 'class' | 'override' | 'rows' | 'row' | 'text' | 'chart' | 'capacity' | 'other';
const FIELDS = [
  'match',
  'status',
  'missing',
  'text',
  'rows',
  'chart',
  'freshness',
  'url',
  'urlTitle',
  'up',
  'down',
  'capacity',
  'linkLabel',
  'arrow',
];
const ROW = [
  'kind',
  'query',
  'up',
  'down',
  'match',
  'reduce',
  'label',
  'unit',
  'decimals',
  'min',
  'max',
  'text',
  'url',
];
const ORDER: Partial<Record<Context, string[]>> = {
  root: ['version', 'freshness', 'classes', 'overrides'],
  class: ['extends', ...FIELDS],
  override: FIELDS,
  row: ROW,
  chart: ROW,
  text: ['query', 'match', 'reduce', 'label', 'unit', 'decimals'],
  capacity: ['a2b', 'b2a'],
};

function childContext(context: Context, key: string): Context {
  if (context === 'classes') {
    return 'class';
  }
  if (context === 'overrides') {
    return 'override';
  }
  if (context === 'root' && (key === 'classes' || key === 'overrides')) {
    return key;
  }
  if (context === 'class' || context === 'override') {
    if (key === 'rows' || key === 'text' || key === 'chart' || key === 'capacity') {
      return key;
    }
  }
  return 'other';
}

/** Order schema fields, but keep record keys and array items in their stored order. */
function ordered(value: unknown, context: Context): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => ordered(item, context === 'rows' ? 'row' : 'other'));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const entries = Object.entries(value);
  const order = ORDER[context];
  if (order) {
    const rank = (key: string) => {
      const index = order.indexOf(key);
      return index < 0 ? order.length : index;
    };
    entries.sort(([a], [b]) => rank(a) - rank(b));
  }
  return Object.fromEntries(entries.map(([key, item]) => [key, ordered(item, childContext(context, key))]));
}

/** The YAML text is an editor view of the stored JSON. Comments do not survive a save. */
export function writeYaml(cfg: unknown): string {
  const doc = new Document(ordered(cfg, 'root'), { aliasDuplicateObjects: false });
  return doc.toString({ collectionStyle: 'block', lineWidth: 0 });
}

type YamlError = { line: number; message: string };
type ReadResult = { ok: true; value: unknown; doc: Document } | { ok: false; errors: YamlError[]; doc: Document };

/** Keep the partial document for editor paths, and reject references before conversion to JSON. */
export function readYaml(text: string): ReadResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { uniqueKeys: true, lineCounter, prettyErrors: false });
  const errors: YamlError[] = doc.errors.map((error) => ({
    line: lineCounter.linePos(error.pos[0]).line,
    message: error.message,
  }));

  // CST properties hold the anchor offset. A block node's range can start on the next line.
  for (const token of new Parser().parse(text)) {
    if (token.type === 'document') {
      CST.visit(token, (item) => {
        for (const part of [...item.start, ...(item.sep ?? []), item.key, item.value]) {
          if (part?.type === 'anchor' || part?.type === 'alias') {
            errors.push({
              line: lineCounter.linePos(part.offset).line,
              message: part.type === 'anchor' ? 'YAML anchors are not allowed.' : 'YAML aliases are not allowed.',
            });
          }
        }
      });
    }
  }

  visit(doc, (_key, node) => {
    if (!isNode(node)) {
      return;
    }
    // These collection tags produce Set and Map. Other non-JSON types are scalar values.
    const nonJsonCollection = node.tag === 'tag:yaml.org,2002:set' || node.tag === 'tag:yaml.org,2002:omap';
    const value: unknown = isScalar(node) ? node.value : null;
    const jsonScalar =
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value));
    if (nonJsonCollection || !jsonScalar) {
      errors.push({
        line: lineCounter.linePos(node.range?.[0] ?? 0).line,
        message: 'YAML values must be JSON-compatible: use finite numbers, strings, booleans, null, arrays or objects.',
      });
    }
  });
  return errors.length ? { ok: false, errors, doc } : { ok: true, value: doc.toJS({ maxAliasCount: 0 }), doc };
}
