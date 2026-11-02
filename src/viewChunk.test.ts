import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localImports, SRC } from './importGraph';

// View mode must not load editor code. Webpack puts every static import of module.ts in the main chunk;
// an import() starts a lazy chunk. This walk follows the static value imports the same way.
const EDITOR_ONLY = [
  // the bindings popup and its dialog
  'editor/popup/PopupLayout.tsx',
  'editor/popup/DiagramStage.tsx',
  'editor/popup/SplitEditor.tsx',
  'editor/popup/PluginDialog.tsx',
  'editor/popup/usePopupKeys.ts',
  'editor/popup/overlayStack.ts',
  'editor/split/yamlPath.ts',
  // the draw.io modal behind the Diagram option
  'editor/DrawioModal.tsx',
  'editor/protocol.ts',
  'editor/target.ts',
  'editor/availability.ts',
  'editor/files.ts',
  'editor/decode.ts',
  // the option editors
  'options/DiagramEditor.tsx',
  'options/importDiagram.ts',
  'options/IconRadioEditor.tsx',
  'options/LazyConfigYamlEditor.tsx',
  'options/EditBindingsButton.tsx',
  'options/ConfigYamlEditor.tsx',
  'options/yamlConfig.ts',
  'options/storedConfig.ts',
];

/** Each file of the main chunk, with the import chain from module.ts that reaches it. */
function mainChunk(): Map<string, string[]> {
  const entry = join(SRC, 'module.ts');
  const chains = new Map<string, string[]>([[entry, [entry]]]);
  const queue = [entry];
  for (let file = queue.shift(); file; file = queue.shift()) {
    for (const next of localImports(file, { types: false, dynamic: false })) {
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
  it('names editor-only modules that exist', () => {
    // a renamed module would make the next check pass for no reason
    expect(EDITOR_ONLY.filter((file) => !existsSync(join(SRC, file)))).toEqual([]);
  });
  it('holds no editor-only module', () => {
    const chunk = mainChunk();
    expect(EDITOR_ONLY.filter((file) => chunk.has(file)).map((file) => chunk.get(file)!.join(' > '))).toEqual([]);
  });
});
