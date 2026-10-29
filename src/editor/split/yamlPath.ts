import { isMap, isScalar, isSeq, type Document, type Node } from 'yaml';
import type { ReportEntry } from '../../binding/report';
import { yamlPath, type PathPart } from '../../model/yamlPath';
import { readYaml } from '../../options/yamlConfig';

export type YamlEntry = Extract<ReportEntry, { kind: 'yaml' }>;

/**
 * Parse the draft of the code box (spec 5.3). `doc` is the partial tree also while the text has a parse error;
 * `entries` holds a `yaml` entry for each syntax error, duplicate key, anchor and alias.
 */
export function readDraft(text: string): { doc: Document; entries: YamlEntry[] } {
  const read = readYaml(text);
  const entries = read.ok
    ? []
    : read.errors.map((e): YamlEntry => ({ kind: 'yaml', line: e.line, message: e.message }));
  return { doc: read.doc, entries };
}

/** The start of a list item: its `-` when only spaces come between the dash and the item, else the item. */
function itemStart(text: string, start: number): number {
  let i = start - 1;
  while (i >= 0 && text[i] === ' ') {
    i--;
  }
  return text[i] === '-' ? i : start;
}

/**
 * The path in `value` at the offset. The text before the first child of a collection (the `: ` after a key, the `- `
 * of an item) gives the path of the value itself. Null when the offset is in a gap of a collection.
 */
function into(value: unknown, parts: PathPart[], offset: number, text: string): PathPart[] | null {
  if (!isMap(value) && !isSeq(value)) {
    return parts;
  }
  if (!value.range || offset < value.range[0]) {
    return parts;
  }
  if (isMap(value)) {
    for (const pair of value.items) {
      const key = pair.key;
      if (!isScalar(key) || !key.range) {
        continue;
      }
      const [start, keyEnd] = key.range;
      const end = (pair.value as Node | null)?.range?.[1] ?? keyEnd;
      if (offset >= start && offset <= end) {
        const path = [...parts, String(key.value)];
        return offset <= keyEnd ? path : into(pair.value, path, offset, text);
      }
    }
    return null;
  }
  for (const [i, item] of value.items.entries()) {
    const range = (item as Node | null)?.range;
    if (range && offset >= itemStart(text, range[0]) && offset <= range[1]) {
      return into(item, [...parts, i], offset, text);
    }
  }
  return null;
}

/** Each pair of the tree with the offset of its key and its path, in the order of the text. */
function pairsOf(node: unknown, parts: PathPart[], out: Array<{ start: number; path: PathPart[] }> = []) {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (isScalar(pair.key) && pair.key.range) {
        const path = [...parts, String(pair.key.value)];
        out.push({ start: pair.key.range[0], path });
        pairsOf(pair.value, path, out);
      }
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, i) => pairsOf(item, [...parts, i], out));
  }
  return out;
}

const columnOf = (text: string, offset: number) => offset - text.lastIndexOf('\n', offset - 1) - 1;

/**
 * The YAML path at an offset of the text (spec 5.3 "The path at an offset"), in the format of `yamlPath`.
 *
 * 1. The deepest pair whose range, from the start of its key to the end of its value, holds the offset. On the key
 *    the path is the path of the pair; on the value the path goes into the value. An incomplete value (`query:`)
 *    gives the path of its key.
 * 2. Elsewhere (a blank line, the white space after a value, a comment): the nearest pair above, the pair on the
 *    same line included, whose key is at the column of the offset or to its left.
 *
 * `doc` is the tree of `readDraft(text)`, also a partial tree while the text has a parse error. Null when no pair
 * applies.
 */
export function pathAt(doc: Document, text: string, offset: number): string | null {
  const found = into(doc.contents, [], offset, text);
  if (found?.length) {
    return yamlPath(found);
  }
  const column = columnOf(text, offset);
  let best: PathPart[] | null = null;
  for (const pair of pairsOf(doc.contents, [])) {
    if (pair.start <= offset && columnOf(text, pair.start) <= column) {
      best = pair.path;
    }
  }
  return best && yamlPath(best);
}
