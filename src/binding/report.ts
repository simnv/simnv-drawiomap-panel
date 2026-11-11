import type { Labels } from '@grafana/data';

export const REPORT_KINDS = [
  'schema',
  'yaml',
  'outdated-config',
  'class-no-match',
  'class-cycle',
  'class-unknown-parent',
  'class-invalid-parent',
  'unknown-ref',
  'unknown-class',
  'unknown-override',
  'missing-attr',
  'matcher-error',
  'template-unresolved',
  'query-unavailable',
  'unmeasured-link',
  'end-ambiguous',
  'no-series',
  'many-series',
  'orphan-series',
  'many-fields',
  'invalid-series',
  'duplicate-series',
  'unit-mismatch',
  'capacity-fallback',
  'bad-cap',
  'cap-conflict',
  'no-edge-ends',
  'unused-field',
  'class-no-cells',
] as const;

export type UsePath = string;

export type ReportEntry =
  | { kind: 'schema'; path: string; message: string }
  | { kind: 'yaml'; line: number; message: string }
  | { kind: 'outdated-config'; version: unknown }
  | { kind: 'class-no-match'; cls: string; cellIds: string[] }
  | { kind: 'class-cycle' | 'class-unknown-parent' | 'class-invalid-parent'; cls: string }
  | { kind: 'unknown-ref'; cls: string; path: string; refId: string }
  | { kind: 'unknown-class'; cellIds: string[]; bind: string }
  | { kind: 'unknown-override'; cellId: string }
  | { kind: 'missing-attr'; cls: string; path: string; attr: string; cellIds: string[] }
  | { kind: 'matcher-error'; cls: string; path: string; text: string; message: string; cellIds: string[] }
  | { kind: 'template-unresolved'; cls: string; path: string; cellIds: string[] }
  | { kind: 'query-unavailable'; refId: string; state: 'error' | 'loading'; message: string }
  | { kind: 'unmeasured-link'; cls: string; attrs: string[]; cellIds: string[] }
  | { kind: 'end-ambiguous'; cls: string; cellIds: string[] }
  | { kind: 'no-series'; cls: string; use: UsePath; cellIds: string[] }
  | { kind: 'many-series'; cls: string; use: UsePath; cells: Array<{ id: string; count: number }> }
  | { kind: 'orphan-series'; refId: string; labels: Labels[]; more: number }
  | { kind: 'many-fields' | 'invalid-series'; refId: string; message: string }
  | { kind: 'duplicate-series'; refId: string; labels: Labels }
  | { kind: 'unit-mismatch'; cls: string; use: UsePath; units: string[]; cellIds: string[] }
  | { kind: 'capacity-fallback'; cls: string; reason: string; cellIds: string[] }
  | { kind: 'bad-cap'; attr: 'cap' | 'capacity'; value: string; cellIds: string[] }
  | { kind: 'cap-conflict'; cap: string; capacity: string; cellIds: string[] }
  | { kind: 'no-edge-ends'; reason: string; cellIds: string[] }
  | { kind: 'unused-field'; cls: string; field: string; cellIds: string[] }
  | { kind: 'class-no-cells'; cls: string };
