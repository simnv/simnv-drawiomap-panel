import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localImports, sourceFiles, SRC } from './importGraph';

// The layers import downwards only: a file cycle is a layer cycle. A type import counts, as in
// `madge --circular`: it ties the two files together for a reader even when the compiler drops it. A literal
// `import()` counts too: a lazy chunk that imports its parent back is still a cycle.

/** Each cycle once, as the chain of files from the first file that closes it, e.g. "a.ts > b.ts". */
function cycles(dir = SRC): string[] {
  const graph = new Map(sourceFiles(dir).map((file) => [file, localImports(file, { types: true, dynamic: true })]));
  const done = new Set<string>();
  const path: string[] = [];
  const found: string[] = [];
  const visit = (file: string) => {
    const at = path.indexOf(file);
    if (at >= 0) {
      found.push(
        path
          .slice(at)
          .map((f) => relative(dir, f))
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
    expect(localImports(`${SRC}/module.ts`, { types: true, dynamic: true }).length).toBeGreaterThan(0);
  });
  it('finds no file cycle in src', () => {
    expect(cycles()).toEqual([]);
  });
  it('rejects a file that dynamic-imports a file that imports it back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'import-cycles-'));
    try {
      mkdirSync(join(dir, 'x'));
      writeFileSync(join(dir, 'a.ts'), "export const load = () => import('./x/b');\n");
      writeFileSync(join(dir, 'x', 'b.ts'), "import { load } from '../a';\nexport const b = load;\n");
      expect(cycles(dir)).toEqual(['a.ts > x/b.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
