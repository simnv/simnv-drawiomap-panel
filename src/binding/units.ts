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
