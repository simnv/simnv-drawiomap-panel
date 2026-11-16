import { createTheme } from '@grafana/data';
import { cellMetaFromAttrs } from '../adapter/portograph';
import { renderOverlay } from '../render/overlay';
import type { CellIndex, CellPatch, PatchMap } from '../types';

/** A test stage: links with the path `d` each, and nodes with a rect each, all drawn by the overlay. */
export function nearStage(links: Record<string, string>, nodes: Record<string, string> = {}) {
  const host = document.createElement('div');
  const parts = [
    ...Object.entries(nodes).map(([id, rect]) => `<g data-cell-id="${id}"><rect ${rect}/></g>`),
    ...Object.entries(links).map(
      ([id, d]) => `<g data-cell-id="${id}"><g><path d="${d}" fill="none" stroke="#333"/></g></g>`
    ),
  ];
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><g>${parts.join('')}</g></svg>`;
  document.body.appendChild(host);
  const root = host.querySelector('svg') as SVGSVGElement;
  const index: CellIndex = new Map();
  const patches: PatchMap = new Map();
  for (const id of Object.keys(nodes)) {
    const group = root.querySelector(`[data-cell-id="${id}"]`) as SVGGElement;
    index.set(id, {
      meta: cellMetaFromAttrs(id, {}, false, id),
      group,
      shape: group.querySelector('rect')!,
      arrows: [],
      original: {},
    });
    patches.set(id, { cellId: id, scope: { cell: {} }, urls: [] });
  }
  const half = { status: 'ok', color: '#00ff00', width: 1, label: '', stepIndex: 0 } as const;
  for (const id of Object.keys(links)) {
    const group = root.querySelector(`[data-cell-id="${id}"]`) as SVGGElement;
    index.set(id, {
      meta: cellMetaFromAttrs(id, {}, true),
      group,
      line: group.querySelector('path')!,
      arrows: [],
      original: {},
    });
    const patch: CellPatch = { cellId: id, scope: { cell: {} }, urls: [], link: { a2b: half, b2a: half } };
    patches.set(id, patch);
  }
  renderOverlay(root, index, patches, { theme: createTheme(), maxWidth: 10 });
  return { host, root, index, patches };
}
