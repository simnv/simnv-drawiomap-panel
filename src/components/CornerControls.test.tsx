import React from 'react';
import { createTheme } from '@grafana/data';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CornerControls } from './CornerControls';

vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: (theme: ReturnType<typeof createTheme>) => unknown) => fn(createTheme()),
  Button: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  IconButton: () => <button />,
}));

const WARNINGS = ['Override for cell "x" matches no cell', 'Unit "foo" is unknown'];

const corner = (warnings: string[]) => (
  <CornerControls
    bandHeight={0}
    zoomed={false}
    editing={false}
    width={600}
    warnings={warnings}
    onReset={() => {}}
    onEditBindings={() => {}}
    onRowHeight={() => {}}
  />
);

function setup(warnings = WARNINGS) {
  const view = render(corner(warnings));
  return Object.assign(screen.getByTestId('dmap-warning-badge'), { rerender: view.rerender });
}
const tip = () => screen.queryByTestId('dmap-warning-tooltip');

describe('the warning badge tooltip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('has no native title and can take the focus', () => {
    const badge = setup();
    expect(badge.hasAttribute('title')).toBe(false);
    expect(badge.tabIndex).toBe(0);
  });

  it('opens on pointerenter with no timer, closes on pointerleave', () => {
    vi.useFakeTimers();
    const badge = setup();
    fireEvent.pointerEnter(badge, { pointerType: 'mouse' });
    expect(tip()).not.toBeNull();
    expect(badge.getAttribute('aria-describedby')).toBe(tip()!.id);
    fireEvent.pointerLeave(badge, { pointerType: 'mouse' });
    expect(tip()).toBeNull();
    expect(badge.hasAttribute('aria-describedby')).toBe(false);
  });

  it('shows every warning on its own line', () => {
    const badge = setup();
    fireEvent.pointerEnter(badge, { pointerType: 'mouse' });
    const lines = Array.from(tip()!.children).map((line) => line.textContent);
    expect(lines).toEqual(WARNINGS);
  });

  it('opens on the keyboard focus', () => {
    const badge = setup();
    act(() => badge.focus());
    expect(tip()).not.toBeNull();
    act(() => badge.blur());
    expect(tip()).toBeNull();
  });

  it('a tap toggles the tooltip', () => {
    const badge = setup();
    fireEvent.pointerDown(badge, { pointerType: 'touch' });
    act(() => badge.focus());
    expect(tip()).toBeNull();
    fireEvent.click(badge);
    expect(tip()).not.toBeNull();
    fireEvent.click(badge);
    expect(tip()).toBeNull();
  });

  it('Esc closes the tooltip', () => {
    const badge = setup();
    fireEvent.pointerEnter(badge, { pointerType: 'mouse' });
    expect(tip()).not.toBeNull();
    fireEvent.keyDown(badge, { key: 'Escape' });
    expect(tip()).toBeNull();
  });

  it('does not come back with the next warnings after the badge went away under the pointer', () => {
    const badge = setup();
    fireEvent.pointerEnter(badge, { pointerType: 'mouse' });
    expect(tip()).not.toBeNull();
    // a refresh with no warnings removes the badge: React sends no pointerleave
    badge.rerender(corner([]));
    expect(tip()).toBeNull();
    badge.rerender(corner(WARNINGS));
    expect(tip()).toBeNull();
  });
});
