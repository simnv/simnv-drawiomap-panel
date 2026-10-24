import { describe, expect, it } from 'vitest';
import { displayBindings, validateConfig } from '../model/config';
import { demoL3Config, handDrawnConfig } from './demo-config';

describe('demo configs', () => {
  it.each([
    ['demo-l3', demoL3Config],
    ['hand-drawn', handDrawnConfig],
  ])('%s is a valid version 2 config whose bindings use its panel queries', (_name, build) => {
    const config = build();
    expect(validateConfig(config)).toEqual({ config, diagnostics: [] });
    const ids = new Set(config.queries.map((q) => q.id));
    for (const pattern of config.patterns) {
      for (const { binding } of displayBindings(pattern.display)) {
        expect(ids.has(binding.queryId)).toBe(true);
      }
    }
  });
  it('demo-l3 colours the node icons and gives each link a card with one combined row', () => {
    const config = demoL3Config();
    expect(config.patterns.find((p) => p.id === 'node-up')?.display.shape).toMatchObject({ target: 'icon' });
    const links = config.patterns.find((p) => p.id === 'links')!;
    expect(links.display.hover?.rows.map((r) => r.kind)).toEqual(['history']);
    expect(links.display.hover?.title).toBe('${from.node} ↔ ${to.node}');
  });
});
