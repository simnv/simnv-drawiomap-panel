import React, { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import pluginJson from '../plugin.json';
import { SandboxPortal } from './sandboxHost';

const hosts = () => document.querySelectorAll(`body > [data-plugin-sandbox="${pluginJson.id}"]`);

afterEach(cleanup);

describe('SandboxPortal', () => {
  it('renders into a host in the body that carries the sandbox attribute, and removes it on unmount', () => {
    const view = render(
      <SandboxPortal>
        <span data-testid="inside" />
      </SandboxPortal>
    );
    expect(hosts()).toHaveLength(1);
    expect(hosts()[0].contains(screen.getByTestId('inside'))).toBe(true);
    view.unmount();
    expect(hosts()).toHaveLength(0);
  });

  it('does not use the Grafana portal container: in the frontend sandbox it is a detached mock', () => {
    const container = document.createElement('div');
    container.id = 'grafana-portal-container';
    document.body.appendChild(container);
    render(
      <SandboxPortal>
        <span data-testid="inside" />
      </SandboxPortal>
    );
    expect(container.childElementCount).toBe(0);
    expect(screen.getByTestId('inside').isConnected).toBe(true);
    container.remove();
  });

  it('keeps exactly one host through a StrictMode double mount, and none after unmount', () => {
    const view = render(
      <StrictMode>
        <SandboxPortal>
          <span />
        </SandboxPortal>
      </StrictMode>
    );
    expect(hosts()).toHaveLength(1);
    view.unmount();
    expect(hosts()).toHaveLength(0);
  });
});
