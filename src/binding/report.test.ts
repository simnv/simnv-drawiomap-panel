import type { Labels } from '@grafana/data';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { MatchV4 } from '../model/v4';
import { REPORT_KINDS, type ReportEntry, type UsePath } from './report';

describe('S4 report contract', () => {
  it('lists each report kind in S4 order', () => {
    expect(REPORT_KINDS).toEqual([
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
    ]);
  });

  it('keeps the exact fields of each S4 row', () => {
    expectTypeOf<Extract<ReportEntry, { kind: 'schema' }>>().toEqualTypeOf<{
      kind: 'schema';
      path: string;
      message: string;
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'yaml' }>>().toEqualTypeOf<{
      kind: 'yaml';
      line: number;
      message: string;
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'outdated-config' }>>().toEqualTypeOf<{
      kind: 'outdated-config';
      version: unknown;
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'class-no-match' }>>().toEqualTypeOf<{
      kind: 'class-no-match';
      cls: string;
      cellIds: string[];
    }>();
    expectTypeOf<
      Extract<ReportEntry, { kind: 'class-cycle' | 'class-unknown-parent' | 'class-invalid-parent' }>
    >().toEqualTypeOf<{ kind: 'class-cycle' | 'class-unknown-parent' | 'class-invalid-parent'; cls: string }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'unknown-ref' }>>().toEqualTypeOf<{
      kind: 'unknown-ref';
      cls: string;
      path: string;
      refId: string;
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'unknown-class' }>>().toEqualTypeOf<{
      kind: 'unknown-class';
      cellIds: string[];
      bind: string;
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'unknown-override' }>>().toEqualTypeOf<{
      kind: 'unknown-override';
      cellId: string;
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'missing-attr' }>>().toEqualTypeOf<{
      kind: 'missing-attr';
      cls: string;
      path: string;
      attr: string;
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'matcher-error' }>>().toEqualTypeOf<{
      kind: 'matcher-error';
      cls: string;
      path: string;
      text: string;
      message: string;
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'template-unresolved' }>>().toEqualTypeOf<{
      kind: 'template-unresolved';
      cls: string;
      path: string;
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'query-unavailable' }>>().toEqualTypeOf<{
      kind: 'query-unavailable';
      refId: string;
      state: 'error' | 'loading';
      message: string;
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'unmeasured-link' }>>().toEqualTypeOf<{
      kind: 'unmeasured-link';
      cls: string;
      attrs: string[];
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'end-ambiguous' }>>().toEqualTypeOf<{
      kind: 'end-ambiguous';
      cls: string;
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'no-series' }>>().toEqualTypeOf<{
      kind: 'no-series';
      cls: string;
      use: UsePath;
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'many-series' }>>().toEqualTypeOf<{
      kind: 'many-series';
      cls: string;
      use: UsePath;
      cells: Array<{ id: string; count: number }>;
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'orphan-series' }>>().toEqualTypeOf<{
      kind: 'orphan-series';
      refId: string;
      labels: Labels[];
      more: number;
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'many-fields' | 'invalid-series' }>>().toEqualTypeOf<{
      kind: 'many-fields' | 'invalid-series';
      refId: string;
      message: string;
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'duplicate-series' }>>().toEqualTypeOf<{
      kind: 'duplicate-series';
      refId: string;
      labels: Labels;
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'unit-mismatch' }>>().toEqualTypeOf<{
      kind: 'unit-mismatch';
      cls: string;
      use: UsePath;
      units: string[];
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'capacity-fallback' }>>().toEqualTypeOf<{
      kind: 'capacity-fallback';
      cls: string;
      reason: string;
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'bad-cap' }>>().toEqualTypeOf<{
      kind: 'bad-cap';
      attr: 'cap' | 'capacity';
      value: string;
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'cap-conflict' }>>().toEqualTypeOf<{
      kind: 'cap-conflict';
      cap: string;
      capacity: string;
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'no-edge-ends' }>>().toEqualTypeOf<{
      kind: 'no-edge-ends';
      reason: string;
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'unused-field' }>>().toEqualTypeOf<{
      kind: 'unused-field';
      cls: string;
      field: string;
      cellIds: string[];
    }>();
    expectTypeOf<Extract<ReportEntry, { kind: 'class-no-cells' }>>().toEqualTypeOf<{
      kind: 'class-no-cells';
      cls: string;
    }>();
    expectTypeOf<ReportEntry['kind']>().toEqualTypeOf<(typeof REPORT_KINDS)[number]>();
    expectTypeOf<UsePath>().toEqualTypeOf<string>();
    expectTypeOf<typeof REPORT_KINDS>().toExtend<readonly string[]>();
  });

  it('accepts one matcher or a list per cell attribute', () => {
    expectTypeOf<MatchV4>().toEqualTypeOf<Record<string, string | string[]>>();
  });
});
