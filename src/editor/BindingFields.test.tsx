import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DisplayConfig, QueryBinding } from '../model/config';
import { DisplayFields } from './BindingFields';

vi.hoisted(() => {
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});

const binding: QueryBinding = { queryId: 'q', match: {}, reducer: 'last' };
const fresh = { expectedIntervalMs: 1000, staleAfterMs: 5000 };
const value: DisplayConfig = {
  label: 'L',
  url: '/d/x',
  shape: { binding, text: true },
  link: { a2bBinding: binding, b2aBinding: binding, capacityBinding: binding, capacity: 10 },
  status: {
    kind: 'predicates',
    binding,
    default: { state: 'normal', reason: 'ok' },
    predicates: [{ op: 'gt', value: 1, state: 'warning', reason: 'hot' }],
    freshness: fresh,
  },
  hover: {
    rows: [
      { kind: 'metadata', label: 'M', path: 'cell.key' },
      { kind: 'drilldown', label: 'D', url: '/d/y' },
      { kind: 'value', label: 'V', binding, unit: 'bps', min: 0, max: 5, url: '/d/v', freshness: fresh },
      { kind: 'history', label: 'H', binding, height: 40 },
    ],
  },
};

describe('DisplayFields sources', () => {
  it('asks for the source of every value field and shows one chip for each', () => {
    const sourceOf = vi.fn((path: string) => ({
      owner: 'default' as const,
      resettable: false,
      resetPath: path,
      scope: 'element' as const,
    }));
    render(<DisplayFields value={value} queries={[]} onChange={() => {}} sourceOf={sourceOf} onReset={() => {}} />);
    // Open every section, including the ones that open later.
    for (let round = 0; round < 3; round++) {
      for (const toggle of screen.queryAllByRole('button', { expanded: false })) {
        fireEvent.click(toggle);
      }
    }
    const paths = new Set(sourceOf.mock.calls.map(([path]) => path));
    const expected = [
      'enabled',
      'label',
      'shape.text',
      'url',
      'shape.enabled',
      'shape.binding',
      'shape.target',
      'link.enabled',
      'link.a2bBinding',
      'link.b2aBinding',
      'link.capacityBinding',
      'link.capacity',
      'status.enabled',
      'status.binding',
      'status.kind',
      'status.default.state',
      'status.default.reason',
      'status.predicates[0].value',
      'status.predicates[0].op',
      'status.predicates[0].state',
      'status.predicates[0].reason',
      'status.freshness',
      'status.freshness.expectedIntervalMs',
      'status.freshness.staleAfterMs',
      'hover.enabled',
      'hover.rows[0]',
      'hover.rows[0].label',
      'hover.rows[0].path',
      'hover.rows[1].label',
      'hover.rows[1].url',
      'hover.rows[2].binding',
      'hover.rows[2].freshness',
      'hover.rows[2].freshness.expectedIntervalMs',
      'hover.rows[2].freshness.staleAfterMs',
      'hover.rows[2].unit',
      'hover.rows[2].min',
      'hover.rows[2].max',
      'hover.rows[2].url',
      'hover.rows[3].height',
    ];
    for (const path of expected) {
      expect(paths, path).toContain(path);
    }
    // Every request became a chip.
    expect(screen.getAllByTestId('dmap-field-source')).toHaveLength(sourceOf.mock.calls.length);
  });
});
