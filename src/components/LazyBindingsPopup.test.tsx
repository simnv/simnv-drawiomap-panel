import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LazyBindingsPopup } from './LazyBindingsPopup';
import { PluginDialog } from '../editor/popup/PluginDialog';

const chunk = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../editor/popup', () => ({
  // A getter, so that each import reads the current behaviour of the test.
  get default() {
    return chunk.load().default;
  },
}));

const props = () => ({ onClose: vi.fn() }) as unknown as React.ComponentProps<typeof LazyBindingsPopup>;

describe('LazyBindingsPopup', () => {
  it('shows a loading modal while the chunk loads, then the popup', async () => {
    chunk.load.mockReturnValue({ default: () => <div data-testid="loaded-popup" /> });
    render(<LazyBindingsPopup {...props()} />);
    expect(screen.getByRole('status', { name: 'Loading the bindings editor' })).toBeTruthy();
    expect(await screen.findByTestId('loaded-popup')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading the bindings editor' })).toBeNull();
  });

  it('shows an error with Retry when the chunk fails, and loads on Retry', async () => {
    const onClose = vi.fn();
    chunk.load.mockImplementation(() => {
      throw new Error('chunk failed');
    });
    render(<LazyBindingsPopup {...props()} onClose={onClose} />);
    expect(await screen.findByText('The editor could not load')).toBeTruthy();
    chunk.load.mockImplementation(() => ({ default: () => <div data-testid="loaded-popup" /> }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('loaded-popup')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from the error message', async () => {
    const onClose = vi.fn();
    chunk.load.mockImplementation(() => {
      throw new Error('chunk failed');
    });
    render(<LazyBindingsPopup {...props()} onClose={onClose} />);
    await screen.findByText('The editor could not load');
    fireEvent.click(screen.getByText('Close', { selector: 'button span' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives the focus back to the opener on close, also when the chunk comes after the loading modal', async () => {
    // The real dialog of the popup: it reads the focus at its mount, after the loading modal took it.
    let ready!: () => void;
    const arrived = new Promise<void>((resolve) => (ready = resolve));
    chunk.load.mockImplementation(() => {
      throw arrived.then(() => {
        chunk.load.mockReturnValue({
          default: ({ onClose }: { onClose: () => void }) => (
            <PluginDialog title="Edit bindings" onDismiss={onClose}>
              <button>Binding</button>
            </PluginDialog>
          ),
        });
      });
    });
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Edit bindings</button>
          {open ? <LazyBindingsPopup {...props()} onClose={() => setOpen(false)} /> : null}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Edit bindings' });
    opener.focus();
    fireEvent.click(opener);
    const loading = await screen.findByRole('status', { name: 'Loading the bindings editor' });
    // The loading modal has the focus.
    loading.closest('[role="dialog"]')!.querySelector('button')!.focus();
    expect(document.activeElement).not.toBe(opener);
    await act(async () => ready());
    const binding = await screen.findByRole('button', { name: 'Binding' });
    expect(screen.queryByRole('status')).toBeNull();
    binding.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
