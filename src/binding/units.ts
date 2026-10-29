/** Factor from a Grafana data-rate unit id to bit/s. */
const TO_BITS: Record<string, number> = {};
const SI = ['', 'K', 'M', 'G', 'T', 'P'];
const BIN = ['', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi'];
SI.forEach((p, i) => {
  TO_BITS[p ? `${p}bits` : 'bps'] = 1000 ** i;
  TO_BITS[p ? `${p}Bs` : 'Bps'] = 8 * 1000 ** i;
});
BIN.forEach((p, i) => {
  TO_BITS[p ? `${p}bits` : 'binbps'] = 1024 ** i;
  TO_BITS[p ? `${p}Bs` : 'binBps'] = 8 * 1024 ** i;
});

export interface BitRate {
  bits: number;
  /** set when the unit is not a known data-rate unit; `bits` is then the raw value */
  unknownUnit?: string;
}

/** Converts a value in a Grafana data-rate unit to bit/s. No unit: the value is bit/s. */
export function toBitsPerSecond(value: number, unit: string | undefined): BitRate {
  if (!unit) {
    return { bits: value };
  }
  const f = TO_BITS[unit];
  return f === undefined ? { bits: value, unknownUnit: unit } : { bits: value * f };
}

/** Grafana rate units use sum as the default cross-series reduce. */
export const RATE_UNITS: ReadonlySet<string> = new Set([
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
]);

export function defaultReduce(unit: string | undefined): 'sum' | 'max' {
  return unit !== undefined && RATE_UNITS.has(unit) ? 'sum' : 'max';
}
