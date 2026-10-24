import React from 'react';
import { getDefaultTimeRange, LoadingState } from '@grafana/data';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createQueryController } from '../../query/controller';
import { PanelQueryContext, type PanelQueryService } from '../../query/panel';
import { DEFAULT_OPTIONS, type Options } from '../../types';
import type { DiagramConfigV2 } from '../../model/config';
import { diagramOf, svgOf } from '../editorHarness';
import { buttonNamed, selectStageCell } from '../testUtils';
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

  it('shows the hover card preview first in the inspector for a selected element', () => {
    mount();
    expect(screen.queryByRole('region', { name: 'Hover card preview' })).toBeNull();
    selectStageCell('a');
    const preview = screen.getByRole('region', { name: 'Hover card preview' });
    expect(preview.textContent).toContain('No card for this element');
    const inspector = screen.getByRole('complementary', { name: 'Diagram binding inspector' });
    expect(inspector.querySelector('section')).toBe(preview);
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
    fireEvent.click(buttonNamed('Cancel'));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Label template') as HTMLInputElement).value).toBe('Changed');
  });

  it('Cancel closes a clean draft at once, asks for a dirty one, and Discard closes; Revert to saved only restores', async () => {
    const { onClose } = mount();
    fireEvent.click(buttonNamed('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Discard changes?')).toBeNull();
    makeDirty();
    fireEvent.click(buttonNamed('Revert to saved'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dmap-bindings-popup')).toBeTruthy();
    expect((screen.getByLabelText('Label template') as HTMLInputElement).value).toBe('');
    makeDirty();
    fireEvent.click(buttonNamed('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });

  it('applies and closes in one step', () => {
    const { onClose, onOptionsChange } = mount();
    makeDirty();
    fireEvent.click(buttonNamed('Apply and close'));
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
    expect((buttonNamed('Apply bindings') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(buttonNamed('Overwrite'));
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
    expect((buttonNamed('Apply bindings') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Keep editing folds the conflict alert, keeps the draft and the Apply block, and Resolve brings the choices back', () => {
    const { update, onOptionsChange } = mount();
    makeDirty();
    update(optionsOf(config('Elsewhere')));
    fireEvent.click(buttonNamed('Keep editing'));
    expect(screen.queryByText(CONFLICT)).toBeNull();
    expect(screen.getByText('The saved bindings changed. Apply is blocked.')).toBeTruthy();
    expect((buttonNamed('Apply bindings') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Label template') as HTMLInputElement).value).toBe('Changed');
    expect(onOptionsChange).not.toHaveBeenCalled();
    fireEvent.click(buttonNamed('Resolve'));
    expect(screen.getByText(CONFLICT)).toBeTruthy();
  });

  it('Reload saved starts a new draft from the new saved bindings', () => {
    const { update, onOptionsChange } = mount();
    makeDirty();
    update(optionsOf(config('Elsewhere')));
    fireEvent.click(buttonNamed('Reload saved'));
    expect(screen.queryByText(CONFLICT)).toBeNull();
    expect(onOptionsChange).not.toHaveBeenCalled();
    selectStageCell('a');
    expect((screen.getByLabelText('Label template') as HTMLInputElement).value).toBe('Elsewhere');
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('keeps the focus in the dialog after Reload saved replaces the editor', async () => {
    const { update } = mount();
    makeDirty();
    update(optionsOf(config('Elsewhere')));
    buttonNamed('Reload saved').focus();
    fireEvent.click(buttonNamed('Reload saved'));
    await waitFor(() => expect(document.activeElement?.closest('[role="dialog"]')).toBeTruthy());
  });

  it('does not report a conflict after its own Apply', () => {
    const { update, onOptionsChange } = mount();
    makeDirty();
    fireEvent.click(buttonNamed('Apply bindings'));
    update(onOptionsChange.mock.calls[0][0]);
    expect(screen.queryByText(CONFLICT)).toBeNull();
  });

  describe('undo and redo', () => {
    const label = () => (screen.getByLabelText('Label template') as HTMLInputElement).value;
    const undoButton = () => buttonNamed('Undo') as HTMLButtonElement;
    const redoButton = () => buttonNamed('Redo') as HTMLButtonElement;
    const ctrl = (target: Element, key: string, extra: Record<string, boolean> = {}) =>
      fireEvent.keyDown(target, { key, ctrlKey: true, ...extra });

    it('disables the buttons at the ends and lists the shortcuts', () => {
      mount();
      expect(undoButton().disabled).toBe(true);
      expect(redoButton().disabled).toBe(true);
      expect(undoButton().getAttribute('aria-keyshortcuts')).toContain('Control+Z');
      expect(redoButton().getAttribute('aria-keyshortcuts')).toContain('Control+Shift+Z');
      makeDirty();
      expect(undoButton().disabled).toBe(false);
      expect(redoButton().disabled).toBe(true);
      fireEvent.click(undoButton());
      expect(label()).toBe('');
      expect(undoButton().disabled).toBe(true);
      expect(redoButton().disabled).toBe(false);
      fireEvent.click(redoButton());
      expect(label()).toBe('Changed');
    });

    it('undoes and redoes with the keys when the focus is on a button', () => {
      mount();
      makeDirty();
      const target = buttonNamed('Cancel');
      ctrl(target, 'z');
      expect(label()).toBe('');
      ctrl(target, 'Z', { shiftKey: true });
      expect(label()).toBe('Changed');
      ctrl(target, 'z');
      ctrl(target, 'y');
      expect(label()).toBe('Changed');
      fireEvent.keyDown(target, { key: 'z', metaKey: true });
      expect(label()).toBe('');
    });

    it('undoes with the focus on the page body while the popup is the top overlay', () => {
      mount();
      makeDirty();
      ctrl(document.body, 'z');
      expect(label()).toBe('');
    });

    it('leaves the key to a text input, a Monaco root and a nested dialog', () => {
      mount();
      makeDirty();
      ctrl(screen.getByLabelText('Label template'), 'z');
      expect(label()).toBe('Changed');
      const body = screen.getByTestId('dmap-bindings-popup');
      const monaco = document.createElement('div');
      monaco.className = 'monaco-editor';
      monaco.tabIndex = 0;
      body.appendChild(monaco);
      ctrl(monaco, 'z');
      expect(label()).toBe('Changed');
      const nested = document.createElement('div');
      nested.setAttribute('role', 'dialog');
      const inner = document.createElement('button');
      nested.appendChild(inner);
      body.appendChild(nested);
      ctrl(inner, 'z');
      expect(label()).toBe('Changed');
      monaco.remove();
      nested.remove();
    });

    it('does not undo while the discard confirmation is on top', async () => {
      mount();
      makeDirty();
      esc();
      await screen.findByText('Discard changes?');
      ctrl(document.body, 'z');
      expect(label()).toBe('Changed');
    });

    it('clears the history with Apply', () => {
      mount();
      makeDirty();
      fireEvent.click(buttonNamed('Apply bindings'));
      expect(undoButton().disabled).toBe(true);
      expect(redoButton().disabled).toBe(true);
      expect(label()).toBe('Changed');
    });
  });
});
