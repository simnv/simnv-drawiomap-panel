import 'intersection-observer';
import React, { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Select } from '@grafana/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pop, push } from './overlayStack';
import { useEscOwner } from './useEscOwner';

function Harness({ onEscape, enabled = true }: { onEscape: () => void; enabled?: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState<string>();
  const keys = useEscOwner({ id: 'test', dialogRef: body, enabled, onEscape });
  return (
    <div role="dialog" aria-label="Own">
      <button type="button">Header</button>
      <div ref={body} data-testid="body" {...keys}>
        <Select
          aria-label="Choice"
          options={[
            { label: 'One', value: 'one' },
            { label: 'Two', value: 'two' },
          ]}
          value={value}
          onChange={(option) => setValue(option.value)}
        />
        <input aria-label="Plain" />
      </div>
      <div role="dialog" aria-label="Nested">
        <input aria-label="Nested field" />
      </div>
    </div>
  );
}

describe('useEscOwner', () => {
  afterEach(() => pop('test'));

  it('closes an open Select menu first and calls onEscape on the next Esc', () => {
    push('test');
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    const combobox = screen.getByRole('combobox', { name: 'Choice' });
    combobox.focus();
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(combobox.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(combobox, { key: 'Escape' });
    expect(combobox.getAttribute('aria-expanded')).toBe('false');
    expect(onEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(combobox, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('calls onEscape once for an Esc in a plain field and stops the event at the React root', () => {
    push('test');
    const onEscape = vi.fn();
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    render(<Harness onEscape={onEscape} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Plain' }), { key: 'Escape' });
    document.removeEventListener('keydown', outside);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
  });

  it('acts on an Esc with focus on body only when the overlay is the top one', () => {
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
    push('test');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    push('upper');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    pop('upper');
  });

  it('acts on an Esc with focus on the header', () => {
    push('test');
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Header' }), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an Esc inside a nested dialog', () => {
    push('test');
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nested field' }), { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('does nothing for an Esc whose target is a sandbox mock of a Grafana element', () => {
    push('test');
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    const mock = document.createElement('div');
    mock.dataset.grafanaPluginSandboxElement = 'true';
    document.body.appendChild(mock);
    fireEvent.keyDown(mock, { key: 'Escape' });
    mock.remove();
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('ignores an Esc that another handler already handled', () => {
    push('test');
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    const plain = screen.getByRole('textbox', { name: 'Plain' });
    plain.addEventListener('keydown', (event) => event.preventDefault());
    fireEvent.keyDown(plain, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('ignores other keys and a disabled owner', () => {
    push('test');
    const onEscape = vi.fn();
    const view = render(<Harness onEscape={onEscape} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Plain' }), { key: 'Enter' });
    view.rerender(<Harness onEscape={onEscape} enabled={false} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Plain' }), { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
  });
});
