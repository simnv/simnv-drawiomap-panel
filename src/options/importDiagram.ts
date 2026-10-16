/** Normalise pasted or uploaded draw.io content to an <mxfile> string. */
export function importDiagram(text: string): { xml: string; warnings: string[] } {
  const t = text.trim();
  const warnings: string[] = [];
  if (t.startsWith('<svg') || (t.startsWith('<?xml') && t.includes('<svg'))) {
    const m = /\scontent="([^"]*)"/.exec(t);
    if (!m) {
      throw new Error('This SVG has no embedded draw.io diagram. Export it with "Include a copy of my diagram".');
    }
    const ta = document.createElement('textarea');
    ta.innerHTML = m[1];
    return importDiagram(ta.value);
  }
  if (t.startsWith('<mxGraphModel')) {
    return { xml: `<mxfile><diagram id="page-1" name="Page-1">${t}</diagram></mxfile>`, warnings };
  }
  if (t.includes('<mxfile')) {
    const pages = (t.match(/<diagram[\s>]/g) ?? []).length;
    if (pages > 1) {
      warnings.push(`${pages} pages found. The panel renders page 1 only.`);
    }
    return { xml: t, warnings };
  }
  throw new Error('Not a draw.io file. Paste the XML from Extras > Edit Diagram or upload a .drawio file.');
}
