import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    const close = screen.getByRole('button', { name: 'Close' });
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

  it('closes through the header button', () => {
    const { onDismiss } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
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
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      act(() => outside.focus());
      await waitFor(() => expect(document.activeElement).toBe(screen.getByText('two')));
      outside.remove();
      pop('guard-test');
    });

    it('lets the focus stay in the Grafana portal container and in another dialog', async () => {
      push('guard-test');
      guarded(<button>one</button>);
      const portal = document.createElement('div');
      portal.id = 'grafana-portal-container';
      const inner = document.createElement('button');
      portal.appendChild(inner);
      document.body.appendChild(portal);
      act(() => inner.focus());
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(document.activeElement).toBe(inner);
      portal.remove();
      pop('guard-test');
    });

    it('does nothing while another overlay is on top', async () => {
      push('guard-test');
      push('nested');
      guarded(<button>one</button>);
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      act(() => outside.focus());
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(document.activeElement).toBe(outside);
      outside.remove();
      pop('nested');
      pop('guard-test');
    });
  });
});
