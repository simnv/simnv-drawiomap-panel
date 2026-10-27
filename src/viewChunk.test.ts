import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// View mode must not load editor code. Webpack puts every static import of module.ts in the main chunk;
// an import() starts a lazy chunk. This walk follows the static value imports the same way.
const SRC = __dirname;
const EDITOR_ONLY = ['editor/draft.ts', 'editor/portable.ts', 'editor/leafPaths.ts'];

function resolveImport(from: string, specifier: string): string | undefined {
  const base = join(dirname(from), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(
    (file) => /\.tsx?$/.test(file) && existsSync(file)
  );
}

/** True when the compiler drops the declaration: `import type`, `export type` or only `type` specifiers. */
function typeOnly(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) {
    return (
      node.isTypeOnly ||
      (!!node.exportClause &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.every((e) => e.isTypeOnly))
    );
  }
  const clause = node.importClause;
  if (!clause) {
    return false;
  }
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
    return true;
  }
  const named = clause.namedBindings;
  return (
    !clause.name &&
    !!named &&
    ts.isNamedImports(named) &&
    named.elements.length > 0 &&
    named.elements.every((e) => e.isTypeOnly)
  );
}

function staticImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
  const found: string[] = [];
  for (const node of source.statements) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('.') &&
      !typeOnly(node)
    ) {
      const target = resolveImport(file, node.moduleSpecifier.text);
      if (target) {
        found.push(target);
      }
    }
  }
  return found;
}

/** Each file of the main chunk, with the import chain from module.ts that reaches it. */
function mainChunk(): Map<string, string[]> {
  const entry = join(SRC, 'module.ts');
  const chains = new Map<string, string[]>([[entry, [entry]]]);
  const queue = [entry];
  for (let file = queue.shift(); file; file = queue.shift()) {
    for (const next of staticImports(file)) {
      if (!chains.has(next)) {
        chains.set(next, [...chains.get(file)!, next]);
        queue.push(next);
      }
    }
  }
  return new Map([...chains].map(([file, chain]) => [relative(SRC, file), chain.map((f) => relative(SRC, f))]));
}

describe('view chunk', () => {
  it('reaches the components from module.ts', () => {
    expect(mainChunk().has('components/DrawioMapPanel.tsx')).toBe(true);
  });
  it('holds no editor-only module', () => {
    const chunk = mainChunk();
    expect(EDITOR_ONLY.filter((file) => chunk.has(file)).map((file) => chunk.get(file)!.join(' > '))).toEqual([]);
  });
});
