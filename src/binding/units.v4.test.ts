import { expect, it } from 'vitest';
import { defaultReduce, RATE_UNITS } from './units';

const rateUnits = [
  'pps',
  'bps',
  'Bps',
  'binbps',
  'binBps',
  'Kbits',
  'Mbits',
  'Gbits',
  'Tbits',
  'KBs',
  'MBs',
  'GBs',
  'TBs',
  'Kibits',
  'Mibits',
  'Gibits',
  'Tibits',
  'KiBs',
  'MiBs',
  'GiBs',
  'TiBs',
  'cps',
  'ops',
  'reqps',
  'rps',
  'wps',
  'iops',
  'eps',
  'mps',
  'recps',
  'rowsps',
  'cpm',
  'opm',
  'reqpm',
  'rpm',
  'wpm',
  'epm',
  'mpm',
  'recpm',
  'rowspm',
  'flowgpm',
  'flowcms',
  'flowcfs',
  'flowcfm',
  'litreh',
  'flowlpm',
  'flowmlpm',
];
it.each(rateUnits)('defaults %s to sum', (unit) => {
  expect(RATE_UNITS.has(unit)).toBe(true);
  expect(defaultReduce(unit)).toBe('sum');
});
it.each(['percent', 'rotrpm', 'celsius', 'unknown', '', undefined])('defaults %s to max', (unit) => {
  expect(defaultReduce(unit)).toBe('max');
});
