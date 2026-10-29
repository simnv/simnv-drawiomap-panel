import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LazyConfigYamlEditor } from './LazyConfigYamlEditor';
import { currentAddress, subscribe } from '../editor/popup/popupBus';
import type { Diagram, Options } from '../types';

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

// The YAML editor loads Monaco: a plain element stands in for it.
vi.mock('./ConfigYamlEditor', () => ({ default: () => <div data-testid="yaml-editor" /> }));

const diagram: Diagram = { xml: '<mxfile/>', svg: '<svg/>', hash: 'abc', updatedAt: '2026-10-17T00:00:00Z' };

function renderEditor(options: Partial<Options>) {
  const props = {
    value: undefined,
    onChange: vi.fn(),
    context: { data: [], options },
    item: {},
  } as unknown as React.ComponentProps<typeof LazyConfigYamlEditor>;
  return render(<LazyConfigYamlEditor {...props} />);
}

describe('Bindings option: Edit bindings button', () => {
  const button = () => screen.getByTestId('dmap-edit-bindings-option') as HTMLButtonElement;

  it('stands above the YAML editor', async () => {
    renderEditor({ diagram });
    const yaml = await screen.findByTestId('yaml-editor');
    expect(button().textContent).toBe('Edit bindings');
    expect(button().compareDocumentPosition(yaml) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is disabled without a diagram', () => {
    renderEditor({});
    expect(button().disabled).toBe(true);
  });

  it('names the reason when no panel editor listens', async () => {
    renderEditor({ diagram });
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    expect((await screen.findAllByText('Open the panel editor first')).length).toBeGreaterThan(0);
  });

  it('opens the popup of the panel that listens', () => {
    const open = vi.fn();
    const unsubscribe = subscribe(currentAddress(), open);
    renderEditor({ diagram });
    fireEvent.click(button());
    unsubscribe();
    expect(open).toHaveBeenCalledWith({ kind: 'none' });
    expect(screen.queryByText('Open the panel editor first')).toBeNull();
  });
});
