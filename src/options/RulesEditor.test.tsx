import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RulesEditor } from './RulesEditor';

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

const base = {
  item: { id: 'rules', name: 'Rules', settings: {} },
  context: { data: [], options: undefined },
} as unknown as React.ComponentProps<typeof RulesEditor>;

describe('RulesEditor YAML tab', () => {
  it('parses valid YAML and calls onChange', () => {
    const onChange = vi.fn();
    render(<RulesEditor {...base} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText('YAML'));
    const ta = screen.getByTestId('dmap-rules-yaml');
    fireEvent.change(ta, { target: { value: '- name: a\n  select: { kind: node }\n' } });
    fireEvent.click(screen.getByText('Apply'));
    expect(onChange).toHaveBeenCalledWith([{ name: 'a', select: { kind: 'node' } }]);
  });
  it('shows errors and does not call onChange for invalid YAML', () => {
    const onChange = vi.fn();
    render(<RulesEditor {...base} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText('YAML'));
    fireEvent.change(screen.getByTestId('dmap-rules-yaml'), { target: { value: '- name: a\n  reducer: median\n' } });
    fireEvent.click(screen.getByText('Apply'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('dmap-rules-errors').textContent).toMatch(/select|reducer/);
  });
});

describe('RulesEditor form', () => {
  it('sets the colour target of a shape rule and drops the old fill flag', () => {
    const onChange = vi.fn();
    const rule = { name: 'n', select: { kind: 'node' as const }, shape: { fill: true } };
    render(<RulesEditor {...base} value={[rule]} onChange={onChange} />);
    expect((screen.getByLabelText('shape') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('icon'));
    expect(onChange).toHaveBeenCalledWith([{ ...rule, shape: { target: 'icon', fill: undefined, stroke: undefined } }]);
  });
});
