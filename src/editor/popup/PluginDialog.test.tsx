import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { buttonNamed } from '../testUtils';
import pluginJson from '../../plugin.json';
import { PluginDialog } from './PluginDialog';
import { pop, push } from './overlayStack';

const hosts = () => document.querySelectorAll(`body > [data-plugin-sandbox="${pluginJson.id}"]`);

function mount(extra?: React.ReactNode, onDismiss = vi.fn()) {
  return {
    onDismiss,
    ...render(
      <>
        <button>opener</button>
        <PluginDialog title="Edit bindings" onDismiss={onDismiss}>
          <button>first</button>
          <input aria-label="middle" />
          <button>last</button>
          {extra}
        </PluginDialog>
      </>
    ),
  };
}

afterEach(() => {
  document.body.style.overflow = '';
});

/**
 * Takes the animation frames of the focus guard under test control. Only frames: waitFor needs the real timers.
 * Call it before the dialog mounts.
 */
function controlFrames() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

/** Runs the mutation observer callbacks and then more frames than the guard needs: a full observation window. */
const runFrames = () => act(() => vi.advanceTimersByTimeAsync(100));

describe('PluginDialog', () => {
  it('renders into a host in the body that carries the sandbox attribute, and removes it on unmount', () => {
    const view = mount();
    expect(hosts()).toHaveLength(1);
    const dialog = screen.getByRole('dialog', { name: 'Edit bindings' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(hosts()[0].contains(dialog)).toBe(true);
    view.unmount();
    expect(hosts()).toHaveLength(0);
  });

  it('keeps exactly one host through a StrictMode double mount, and none after unmount', () => {
    const view = render(
      <StrictMode>
        <PluginDialog title="Edit bindings" onDismiss={() => {}}>
          <button>first</button>
        </PluginDialog>
      </StrictMode>
    );
    expect(hosts()).toHaveLength(1);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    view.unmount();
    expect(hosts()).toHaveLength(0);
  });

  it('puts the focus into the dialog and gives it back to the opener', () => {
    const view = render(<button>opener</button>);
    const opener = screen.getByText('opener');
    opener.focus();
    const dialogView = render(
      <PluginDialog title="Edit bindings" onDismiss={() => {}}>
        <button>first</button>
      </PluginDialog>
    );
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    dialogView.unmount();
    expect(document.activeElement).toBe(opener);
    view.unmount();
  });

  it('wraps Tab and Shift+Tab inside the dialog', () => {
    mount();
    const close = buttonNamed('Close');
    const last = screen.getByText('last');
    last.focus();
    const tab = fireEvent.keyDown(last, { key: 'Tab' });
    expect(tab).toBe(false);
    expect(document.activeElement).toBe(close);
    const back = fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(back).toBe(false);
    expect(document.activeElement).toBe(last);
    // a Tab in the middle is left to the browser
    const middle = screen.getByLabelText('middle');
    middle.focus();
    expect(fireEvent.keyDown(middle, { key: 'Tab' })).toBe(true);
  });

  it('ignores the Tab of a nested dialog that is a React child but sits outside the dialog', () => {
    const view = render(
      <PluginDialog title="Edit bindings" onDismiss={() => {}}>
        <button>first</button>
      </PluginDialog>
    );
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    // a key event of an element outside the dialog does not reach its handler; the handler checks the target as well
    expect(fireEvent.keyDown(outside, { key: 'Tab' })).toBe(true);
    outside.remove();
    view.unmount();
  });

  it('marks the page outside inert, keeps the Grafana portal container usable, and restores both', () => {
    const root = document.createElement('div');
    root.id = 'reactRoot';
    const page = document.createElement('div');
    const portal = document.createElement('div');
    portal.id = 'grafana-portal-container';
    root.append(page, portal);
    document.body.appendChild(root);
    const view = mount();
    expect(page.hasAttribute('inert')).toBe(true);
    expect(portal.hasAttribute('inert')).toBe(false);
    expect(root.hasAttribute('inert')).toBe(false);
    expect(hosts()[0].hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(page.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('');
    root.remove();
  });

  it('leaves the app root usable when the portal container is a sandbox mock', () => {
    const root = document.createElement('div');
    root.id = 'reactRoot';
    const page = document.createElement('div');
    root.append(page);
    const mock = document.createElement('div');
    mock.id = 'grafana-portal-container';
    mock.dataset.grafanaPluginSandboxElement = 'true';
    document.body.append(root, mock);
    const view = mount();
    expect(root.hasAttribute('inert')).toBe(false);
    expect(page.hasAttribute('inert')).toBe(false);
    view.unmount();
    root.remove();
    mock.remove();
  });

  it('has the geometry of the draw.io dialog: 96 % of the viewport width and 94 % of its height, in the middle', () => {
    mount();
    const style = getComputedStyle(screen.getByRole('dialog', { name: 'Edit bindings' }));
    expect({ top: style.top, left: style.left, width: style.width, height: style.height }).toEqual({
      top: '3dvh',
      left: '2vw',
      width: '96vw',
      height: '94dvh',
    });
  });

  it('closes through the header button', () => {
    const { onDismiss } = mount();
    fireEvent.click(buttonNamed('Close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  describe('focus guard', () => {
    const guarded = (children: React.ReactNode) =>
      render(
        <PluginDialog title="Edit bindings" onDismiss={() => {}} overlayId="guard-test">
          {children}
        </PluginDialog>
      );
    const insideDialog = () => !!document.activeElement?.closest('[role="dialog"]');

    it('moves the focus back into the dialog when the focused element is removed', async () => {
      push('guard-test');
      function Swap() {
        const [on, setOn] = React.useState(true);
        return on ? (
          <button key="a" onClick={() => setOn(false)}>
            remove me
          </button>
        ) : (
          <button key="b">other</button>
        );
      }
      guarded(<Swap />);
      const button = screen.getByText('remove me');
      button.focus();
      fireEvent.click(button);
      expect(document.activeElement).toBe(document.body);
      await waitFor(() => expect(insideDialog()).toBe(true));
      pop('guard-test');
    });

    it('pulls a focus that lands outside the dialog back to the last focused element', async () => {
      push('guard-test');
      guarded(
        <>
          <button>one</button>
          <button>two</button>
        </>
      );
      screen.getByText('two').focus();
      const root = document.createElement('div');
      root.id = 'reactRoot';
      const outside = document.createElement('button');
      root.appendChild(outside);
      document.body.appendChild(root);
      act(() => outside.focus());
      await waitFor(() => expect(document.activeElement).toBe(screen.getByText('two')));
      root.remove();
      pop('guard-test');
    });

    it('lets the focus stay in a body-level popover of another library outside #reactRoot', async () => {
      controlFrames();
      push('guard-test');
      guarded(<button>one</button>);
      const root = document.createElement('div');
      root.id = 'reactRoot';
      document.body.appendChild(root);
      const popover = document.createElement('input');
      document.body.appendChild(popover);
      act(() => popover.focus());
      await runFrames();
      expect(document.activeElement).toBe(popover);
      popover.remove();
      root.remove();
      pop('guard-test');
    });

    it('lets the focus stay in the Grafana portal container and in another dialog', async () => {
      controlFrames();
      push('guard-test');
      guarded(<button>one</button>);
      const portal = document.createElement('div');
      portal.id = 'grafana-portal-container';
      const inner = document.createElement('button');
      portal.appendChild(inner);
      document.body.appendChild(portal);
      act(() => inner.focus());
      await runFrames();
      expect(document.activeElement).toBe(inner);
      portal.remove();
      pop('guard-test');
    });

    it('does nothing while another overlay is on top', async () => {
      controlFrames();
      push('guard-test');
      push('nested');
      guarded(<button>one</button>);
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      act(() => outside.focus());
      await runFrames();
      expect(document.activeElement).toBe(outside);
      outside.remove();
      pop('nested');
      pop('guard-test');
    });
  });
});
