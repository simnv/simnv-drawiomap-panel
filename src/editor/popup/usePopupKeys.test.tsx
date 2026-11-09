import React, { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Select } from '@grafana/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttonNamed } from '../testUtils';
import { pop, push } from './overlayStack';
import { usePopupKeys } from './usePopupKeys';

function Harness({
  onEscape,
  enabled = true,
  onUndo,
  onRedo,
}: {
  onEscape: () => void;
  enabled?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState<string>();
  const keys = usePopupKeys({ id: 'test', dialogRef: body, enabled, onEscape, onUndo, onRedo });
  return (
    <div role="dialog" aria-label="Own">
      <button type="button">Header</button>
      <div ref={body} data-testid="body" {...keys}>
        {/* Keep the deprecated react-select Select: usePopupKeys handles its Esc behaviour. Combobox (downshift) differs. */}
        {/* eslint-disable-next-line @typescript-eslint/no-deprecated */}
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
        <input type="checkbox" aria-label="Toggle" />
        <textarea aria-label="Area" />
        <div contentEditable suppressContentEditableWarning aria-label="Editable" role="textbox">
          x
        </div>
      </div>
      <div role="dialog" aria-label="Nested">
        <input aria-label="Nested field" />
      </div>
    </div>
  );
}

describe('usePopupKeys', () => {
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
    fireEvent.keyDown(buttonNamed('Header'), { key: 'Escape' });
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

  describe('history keys', () => {
    it('undoes and redoes outside a text field, and not in one', () => {
      push('test');
      const onUndo = vi.fn();
      const onRedo = vi.fn();
      render(<Harness onEscape={vi.fn()} onUndo={onUndo} onRedo={onRedo} />);
      const header = buttonNamed('Header');
      fireEvent.keyDown(header, { key: 'z', ctrlKey: true });
      fireEvent.keyDown(header, { key: 'z', metaKey: true, shiftKey: true });
      fireEvent.keyDown(header, { key: 'y', ctrlKey: true });
      fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Toggle' }), { key: 'z', ctrlKey: true });
      expect(onUndo).toHaveBeenCalledTimes(2);
      expect(onRedo).toHaveBeenCalledTimes(2);
      for (const name of ['Plain', 'Area', 'Nested field']) {
        fireEvent.keyDown(screen.getByRole('textbox', { name }), { key: 'z', ctrlKey: true });
      }
      fireEvent.keyDown(screen.getByLabelText('Editable'), { key: 'z', ctrlKey: true });
      expect(onUndo).toHaveBeenCalledTimes(2);
    });

    it('does nothing while another dialog is open on the page, also with the focus still in the popup', () => {
      push('test');
      const onUndo = vi.fn();
      render(<Harness onEscape={vi.fn()} onUndo={onUndo} />);
      const other = document.createElement('div');
      other.setAttribute('role', 'dialog');
      document.body.appendChild(other);
      // jsdom has no layout: the dialog counts as shown when it has client rects.
      vi.spyOn(other, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
      const header = buttonNamed('Header');
      fireEvent.keyDown(header, { key: 'z', ctrlKey: true });
      expect(onUndo).not.toHaveBeenCalled();
      other.remove();
      fireEvent.keyDown(header, { key: 'z', ctrlKey: true });
      expect(onUndo).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['display: none', (el: HTMLElement) => (el.style.display = 'none')],
      ['visibility: hidden', (el: HTMLElement) => (el.style.visibility = 'hidden')],
      ['aria-hidden on itself', (el: HTMLElement) => el.setAttribute('aria-hidden', 'true')],
      ['aria-hidden on an ancestor', (el: HTMLElement) => el.parentElement!.setAttribute('aria-hidden', 'true')],
      ['inert', (el: HTMLElement) => el.setAttribute('inert', '')],
    ])('does not count a hidden dialog (%s) as open', (_name, hide) => {
      push('test');
      const onUndo = vi.fn();
      render(<Harness onEscape={vi.fn()} onUndo={onUndo} />);
      const wrapper = document.createElement('div');
      const other = document.createElement('div');
      other.setAttribute('role', 'dialog');
      wrapper.appendChild(other);
      document.body.appendChild(wrapper);
      vi.spyOn(other, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
      hide(other);
      // `display: none` has no client rects in a browser; the spy cannot tell, so check the other cases by the key.
      if (other.style.display === 'none') {
        vi.spyOn(other, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
      }
      fireEvent.keyDown(buttonNamed('Header'), { key: 'z', ctrlKey: true });
      expect(onUndo).toHaveBeenCalledTimes(1);
      wrapper.remove();
    });

    it('ignores plain z, Alt+Z and a covered popup', () => {
      push('test');
      const onUndo = vi.fn();
      render(<Harness onEscape={vi.fn()} onUndo={onUndo} />);
      const header = buttonNamed('Header');
      fireEvent.keyDown(header, { key: 'z' });
      fireEvent.keyDown(header, { key: 'z', ctrlKey: true, altKey: true });
      push('upper');
      fireEvent.keyDown(header, { key: 'z', ctrlKey: true });
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      pop('upper');
      expect(onUndo).not.toHaveBeenCalled();
    });
  });
});
