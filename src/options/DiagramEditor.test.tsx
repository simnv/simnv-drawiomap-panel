import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiagramEditor } from './DiagramEditor';
import type { Diagram } from '../types';

// @grafana/ui reads matchMedia (uPlot) and localStorage (logger) when it loads. This jsdom setup has neither.
vi.hoisted(() => {
  if (!window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  }
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});

const diagram = (schema: string): Diagram => ({
  xml: '<mxfile/>',
  svg: `<svg><g data-cell-id="0" data-meta-label="" data-meta-pg-schema="${schema}"></g></svg>`,
  hash: 'abc',
  updatedAt: '2026-10-17T00:00:00Z',
});

function renderEditor(value?: Diagram) {
  const props = { value, onChange: vi.fn(), context: { data: [] }, item: {} } as unknown as React.ComponentProps<
    typeof DiagramEditor
  >;
  return render(<DiagramEditor {...props} />);
}

describe('DiagramEditor pg-schema warning', () => {
  it('shows a warning for a higher portograph contract version', () => {
    renderEditor(diagram('2'));
    expect(screen.getByTestId('dmap-contract-warning').textContent).toBe(
      'diagram uses portograph contract v2; panel supports 1'
    );
  });

  it('shows no warning for version 1 and without a diagram', () => {
    renderEditor(diagram('1'));
    expect(screen.queryByTestId('dmap-contract-warning')).toBeNull();
    renderEditor(undefined);
    expect(screen.queryByTestId('dmap-contract-warning')).toBeNull();
  });
});
