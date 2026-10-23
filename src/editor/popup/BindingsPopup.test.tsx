import React from 'react';
import { getDefaultTimeRange, LoadingState } from '@grafana/data';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createQueryController } from '../../query/controller';
import { PanelQueryContext, type PanelQueryService } from '../../query/panel';
import { DEFAULT_OPTIONS, type Options } from '../../types';
import type { DiagramConfigV2 } from '../../model/config';
import { diagramOf, svgOf } from '../editorHarness';
import { selectStageCell } from '../testUtils';
import { BindingsPopup } from './BindingsPopup';

const service = (): PanelQueryService => ({
  controller: createQueryController(() => () => {}),
  context: {
    timeRange: getDefaultTimeRange(),
    timeZone: 'utc',
    scopedVars: {},
    refreshMs: 0,
    intervalMs: 1000,
    generation: 1,
  },
});

const config = (label = ''): DiagramConfigV2 => ({
  version: 2,
  queries: [],
  widgets: [],
  patterns: [],
  overrides: label ? [{ cellId: 'a', display: { label } }] : [],
});

const optionsOf = (c: DiagramConfigV2 = config()): Options => ({
  ...DEFAULT_OPTIONS,
  rules: [],
  config: c,
  diagram: diagramOf(svgOf('a', 'b')),
});

function mount(initial: Options = optionsOf()) {
  const onClose = vi.fn();
  const onOptionsChange = vi.fn();
  const svc = service();
  const element = (options: Options) => (
    <PanelQueryContext.Provider value={svc}>
      <BindingsPopup
        id={1}
        target={{ kind: 'none' }}
        options={options}
        data={{ state: LoadingState.Done, series: [], timeRange: getDefaultTimeRange() }}
        timeZone="utc"
        fieldConfig={{ defaults: {}, overrides: [] }}
        replaceVariables={(text) => text}
        onOptionsChange={onOptionsChange}
        onClose={onClose}
      />
    </PanelQueryContext.Provider>
  );
  const view = render(element(initial));
  return { ...view, onClose, onOptionsChange, update: (options: Options) => view.rerender(element(options)) };
}

const esc = (target: Element = screen.getByTestId('dmap-bindings-popup')) =>
  fireEvent.keyDown(target, { key: 'Escape' });

function makeDirty() {
  selectStageCell('a');
  fireEvent.change(screen.getByLabelText('Label template'), { target: { value: 'Changed' } });
}

const CONFLICT = 'The saved bindings changed while you edited';

describe('BindingsPopup', () => {
  it('shows a modal with the editor', () => {
    mount();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId('dmap-bindings-editor')).toBeTruthy();
  });

  it('closes on Esc when the draft is clean', () => {
    const { onClose } = mount();
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before it drops a dirty draft; Esc in the confirmation keeps editing, Discard closes', async () => {
    const { onClose } = mount();
    makeDirty();
    esc();
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('Discard changes?')).toBeTruthy();
    // Esc while the confirmation is on top closes only the confirmation.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Discard changes?')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('dmap-bindings-popup')).toBeTruthy();
    esc();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the dirty draft when the user chooses Keep editing', async () => {
    const { onClose } = mount();
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: 'Close bindings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Label template') as HTMLInputElement).value).toBe('Changed');
  });

  it('applies and closes in one step', () => {
    const { onClose, onOptionsChange } = mount();
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: 'Apply and close' }));
    expect(onOptionsChange).toHaveBeenCalledTimes(1);
    expect(onOptionsChange.mock.calls[0][0].config.overrides).toContainEqual({
      cellId: 'a',
      display: { label: 'Changed' },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('warns when the saved bindings changed, blocks Apply, and Overwrite saves the draft', () => {
    const { update, onOptionsChange } = mount();
    makeDirty();
    expect(screen.queryByText(CONFLICT)).toBeNull();
    update(optionsOf(config('Elsewhere')));
    expect(screen.getByText(CONFLICT)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));
    expect(onOptionsChange.mock.calls[0][0].config.overrides).toContainEqual({
      cellId: 'a',
      display: { label: 'Changed' },
    });
  });

  it('warns when the saved diagram changed while a geometry draft or bindings draft is open', () => {
    const { update } = mount();
    makeDirty();
    update({ ...optionsOf(), diagram: diagramOf(svgOf('a', 'b', 'c'), 'replacement') });
    expect(screen.getByText(CONFLICT)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply bindings' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Reload saved starts a new draft from the new saved bindings', () => {
    const { update, onOptionsChange } = mount();
    makeDirty();
    update(optionsOf(config('Elsewhere')));
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved' }));
    expect(screen.queryByText(CONFLICT)).toBeNull();
    expect(onOptionsChange).not.toHaveBeenCalled();
    selectStageCell('a');
    expect((screen.getByLabelText('Label template') as HTMLInputElement).value).toBe('Elsewhere');
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('does not report a conflict after its own Apply', () => {
    const { update, onOptionsChange } = mount();
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    update(onOptionsChange.mock.calls[0][0]);
    expect(screen.queryByText(CONFLICT)).toBeNull();
  });
});
