#!/usr/bin/env node
// Prints a synthetic draw.io-style SVG with N cells (default 2000) to stdout. Use it to measure the stage build time.
// About three quarters of the cells are nodes with a label; the rest are links between neighbours.
// Usage: node scripts/gen-synthetic-svg.mjs [cells] > /tmp/synthetic.svg
const total = Number(process.argv[2] ?? 2000);
const nodes = Math.floor(total * 0.75);
const links = total - nodes;
const columns = 50;
const cellW = 110;
const cellH = 60;
const width = columns * cellW + 40;
const rows = Math.ceil(nodes / columns);
const height = rows * cellH + 40;
const out = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  '<g data-cell-id="0" data-meta-pg-schema="1"><g transform="translate(20 20)">',
];
for (let i = 0; i < nodes; i += 1) {
  const x = (i % columns) * cellW;
  const y = Math.floor(i / columns) * cellH;
  out.push(
    `<g data-cell-id="n${i}" data-meta-pg-id="n${i}" data-meta-pg-kind="node" data-meta-pg-schema="1" data-meta-device="dev-${i}" transform="translate(${x} ${y})">` +
      `<rect width="90" height="36" rx="4" fill="#d5e8d4" stroke="#82b366" style="fill: light-dark(rgb(213,232,212), rgb(40,60,40));"/>` +
      `<text x="8" y="22" font-size="12">Device ${i}</text></g>`
  );
}
for (let i = 0; i < links; i += 1) {
  const a = i % (nodes - 1);
  const x = (a % columns) * cellW + 90;
  const y = Math.floor(a / columns) * cellH + 18;
  out.push(
    `<g data-cell-id="l${i}" data-meta-pg-id="l${i}" data-meta-pg-kind="link" data-meta-pg-schema="1" data-meta-pg-from="n${a}:p" data-meta-pg-to="n${a + 1}:p">` +
      `<path d="M${x} ${y} L${x + 20} ${y}" fill="none" stroke="#888" pointer-events="stroke"/>` +
      `<path d="M${x + 15} ${y - 4} L${x + 20} ${y} L${x + 15} ${y + 4}" fill="none" stroke="#888" pointer-events="all"/></g>`
  );
}
out.push('</g></g></svg>');
process.stdout.write(out.join('\n'));
