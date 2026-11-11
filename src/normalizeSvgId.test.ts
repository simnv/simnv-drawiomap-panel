import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function normalize(svg: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'svgid-')), 'x.svg');
  writeFileSync(file, svg);
  execFileSync('python3', [join(__dirname, '../scripts/normalize-svg-id.py'), file, 'demo']);
  return readFileSync(file, 'utf8');
}

describe('scripts/normalize-svg-id.py', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" id="ge-svg-aB3_x-9"><style>#ge-svg-aB3_x-9 { --a: 1; }</style>' +
    '<g data-cell-id="ge-svg-cell" data-meta-key="ge-svg-key"><text>ge-svg-label</text></g></svg>';

  it('replaces the id of the root svg and its references only', () => {
    const out = normalize(svg);
    expect(out).toContain('id="ge-svg-demo"');
    expect(out).toContain('#ge-svg-demo {');
    expect(out).not.toContain('aB3_x-9');
  });
  it('keeps a cell id, a key and a label that contain the prefix', () => {
    const out = normalize(svg);
    expect(out).toContain('data-cell-id="ge-svg-cell"');
    expect(out).toContain('data-meta-key="ge-svg-key"');
    expect(out).toContain('<text>ge-svg-label</text>');
  });
});
