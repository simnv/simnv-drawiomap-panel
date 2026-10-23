import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LazyBindingsPopup } from './LazyBindingsPopup';

const chunk = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../editor/popup', () => ({
  // A getter, so that each import reads the current behaviour of the test.
  get default() {
    return chunk.load().default;
  },
}));

const props = () =>
  ({ id: 1, target: { kind: 'none' }, onClose: vi.fn() }) as unknown as React.ComponentProps<typeof LazyBindingsPopup>;

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
});
