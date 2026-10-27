import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localImports, sourceFiles, SRC } from './importGraph';

// The layers import downwards only: a file cycle is a layer cycle. A type import counts, as in
// `madge --circular`: it ties the two files together for a reader even when the compiler drops it.

/** Each cycle once, as the chain of files from the first file that closes it, e.g. "a.ts > b.ts". */
function cycles(): string[] {
  const graph = new Map(sourceFiles().map((file) => [file, localImports(file, { types: true })]));
  const done = new Set<string>();
  const path: string[] = [];
  const found: string[] = [];
  const visit = (file: string) => {
    const at = path.indexOf(file);
    if (at >= 0) {
      found.push(
        path
          .slice(at)
          .map((f) => relative(SRC, f))
          .join(' > ')
      );
      return;
    }
    if (done.has(file)) {
      return;
    }
    path.push(file);
    for (const next of graph.get(file) ?? []) {
      visit(next);
    }
    path.pop();
    done.add(file);
  };
  for (const file of graph.keys()) {
    visit(file);
  }
  return found;
}

describe('import cycles', () => {
  it('reads the import graph', () => {
    // an empty walk would make the next check pass for no reason
    expect(localImports(`${SRC}/module.ts`, { types: true }).length).toBeGreaterThan(0);
  });
  it('finds no file cycle in src', () => {
    expect(cycles()).toEqual([]);
  });
});
