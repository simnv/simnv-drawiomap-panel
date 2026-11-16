import React from 'react';
import { createTheme } from '@grafana/data';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CornerControls } from './CornerControls';

vi.mock('@grafana/ui', () => ({
  useTheme2: () => createTheme(),
  useStyles2: (fn: (theme: ReturnType<typeof createTheme>) => unknown) => fn(createTheme()),
  Button: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  IconButton: (props: { 'aria-label'?: string; 'data-testid'?: string; onClick?: () => void }) => (
    <button aria-label={props['aria-label']} data-testid={props['data-testid']} onClick={props.onClick} />
  ),
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
const list = () => screen.queryByTestId('dmap-warning-list');
const FAILED =
  'VM is not reachable (host not found): 2 queries fail\n• up: up\n• broken (not used): rate(x[5m]\nError: no such host';

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

  it('a tap opens the pinned list and no tooltip; a second tap closes it', () => {
    const badge = setup();
    fireEvent.pointerDown(badge, { pointerType: 'touch' });
    act(() => badge.focus());
    expect(tip()).toBeNull();
    fireEvent.click(badge);
    expect(tip()).toBeNull();
    expect(list()).not.toBeNull();
    expect(badge.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(badge);
    expect(list()).toBeNull();
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

  it('the tooltip shows the short line of each warning and a hint when a warning has details', () => {
    const badge = setup([FAILED, 'up: 2 series select no cell']);
    fireEvent.pointerEnter(badge, { pointerType: 'mouse' });
    expect(tip()!.textContent).toBe(
      'VM is not reachable (host not found): 2 queries failup: 2 series select no cellClick or press Enter for details'
    );
  });

  it('a click pins the list; a line opens its details; Esc, ✕ and a pointer down outside close it', () => {
    const badge = setup([FAILED, 'up: 2 series select no cell']);
    fireEvent.pointerEnter(badge, { pointerType: 'mouse' });
    fireEvent.click(badge);
    // the pinned list takes the place of the tooltip, and it has the focus
    expect(tip()).toBeNull();
    const dialog = list()!.querySelector('[role="dialog"]');
    expect(document.activeElement).toBe(dialog);
    const items = screen.getAllByTestId('dmap-warning-item');
    expect(items).toHaveLength(2);
    // a warning without details is plain text; one with details is a closed disclosure
    expect(items[1].querySelector('button')).toBeNull();
    const toggle = items[0].querySelector('button')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('dmap-warning-details')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('dmap-warning-details').textContent).toBe(
      '• up: up\n• broken (not used): rate(x[5m]\nError: no such host'
    );
    // a pointer move onto the badge while the list is pinned shows no tooltip
    fireEvent.pointerEnter(badge, { pointerType: 'mouse' });
    expect(tip()).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(badge);

    fireEvent.keyDown(badge, { key: 'Enter' });
    expect(list()).not.toBeNull();
    fireEvent.click(screen.getByTestId('dmap-warning-close'));
    expect(list()).toBeNull();

    fireEvent.click(badge);
    fireEvent.pointerDown(document.body);
    expect(list()).toBeNull();
  });
});
