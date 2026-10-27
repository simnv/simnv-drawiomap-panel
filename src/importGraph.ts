import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';

// The import walk of the tests that guard the module graph (viewChunk.test.ts, importCycles.test.ts).
// No production code imports this file.
export const SRC = __dirname;

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

/**
 * The local files that the import and export declarations of `file` name. A lazy `import()` is not a declaration:
 * it starts a chunk. With `types: false` a declaration that the compiler drops does not count.
 */
export function localImports(file: string, { types }: { types: boolean }): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
  const found: string[] = [];
  for (const node of source.statements) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('.') &&
      (types || !typeOnly(node))
    ) {
      const target = resolveImport(file, node.moduleSpecifier.text);
      if (target) {
        found.push(target);
      }
    }
  }
  return found;
}

/** Every .ts and .tsx file below `dir`, tests included. */
export function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}
