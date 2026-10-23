import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCellIndex, mountSvg } from '../../render/svgStage';
import { boxTargets } from './boxTargets';

const demo = readFileSync(resolve(__dirname, '../../../fixtures/demo/svg/demo-l3.svg'), 'utf8');

describe('boxTargets', () => {
  const index = buildCellIndex(mountSvg(document.createElement('div'), demo));
  const targets = boxTargets(index);

  it('keeps the nodes and the links and drops the canvas, the layers, the groups and the legend', () => {
    const ids = new Set(targets.map((t) => t.id));
    expect(ids.has('pg-node~rtr-a')).toBe(true);
    expect([...ids].some((id) => id.startsWith('pg-link~'))).toBe(true);
    for (const id of ids) {
      expect(id === '0' || id === 'pg-canvas' || id.startsWith('pg-layer~') || id.startsWith('pg-group~')).toBe(false);
      expect(id.startsWith('pg-legend')).toBe(false);
    }
  });

  it('does not test a port or an icon on its own when its node covers it', () => {
    const node = index.get('pg-node~rtr-a')!.group;
    expect(targets.filter((t) => t.el === node)).toHaveLength(1);
    const nested = [...index.values()].filter(
      (entry) => entry.group.parentElement?.closest('g[data-cell-id]') === node
    );
    expect(nested.length).toBeGreaterThan(0);
    for (const entry of nested) {
      expect(targets.some((t) => t.el === entry.group)).toBe(false);
    }
  });
});
