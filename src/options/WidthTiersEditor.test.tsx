import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StandardEditorProps } from '@grafana/data';
import type { WidthTier } from '../types';
import { WidthTiersEditor } from './WidthTiersEditor';

const tiers: WidthTier[] = [
  { min: 0, width: 1.5 },
  { min: 155.52e6, width: 3 },
];

function editor(value: WidthTier[], onChange = vi.fn()) {
  const props = { value, onChange, item: {}, context: {} } as unknown as StandardEditorProps<WidthTier[]>;
  const r = render(<WidthTiersEditor {...props} />);
  return { ...r, onChange, input: screen.getByLabelText('Link speed tiers') as HTMLInputElement, props };
}

describe('WidthTiersEditor', () => {
  it('shows the saved tiers exactly, and a blur with no edit saves nothing', () => {
    const { input, onChange } = editor(tiers);
    expect(input.value).toBe('0: 1.5, 155.52M: 3');
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('saves a valid edit once, and keeps the saved tiers for a text that is not valid', () => {
    const { input, onChange } = editor(tiers);
    fireEvent.change(input, { target: { value: '0: 1.5, 1G: 4' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      { min: 0, width: 1.5 },
      { min: 1e9, width: 4 },
    ]);
    fireEvent.change(input, { target: { value: '1G: 4, 100M: 2' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Tier 2: the speeds must go up')).toBeTruthy();
  });

  it('takes a new saved value (an undo) in place of the text', () => {
    const { input, rerender, props } = editor(tiers);
    fireEvent.change(input, { target: { value: 'bad' } });
    rerender(<WidthTiersEditor {...props} value={[{ min: 0, width: 2 }]} />);
    expect(input.value).toBe('0: 2');
  });
});
