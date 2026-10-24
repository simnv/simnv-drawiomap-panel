import React, { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { css } from '@emotion/css';
import type { FieldConfigSource, PanelData, PanelProps } from '@grafana/data';
import { ConfirmModal, useTheme2 } from '@grafana/ui';
import { bindContextFor } from '../../binding/context';
import { DEFAULT_OPTIONS, type Diagram, type Options } from '../../types';
import type { DiagramConfigV2 } from '../../model/config';
import { BindingEditor, type HistoryControls } from '../BindingEditor';
import { EMPTY_CONFIG } from '../draft';
import { baseRevision, hasConflict } from '../revision';
import { PluginDialog } from './PluginDialog';
import { useOverlay } from './overlayStack';
import type { PopupTarget } from './popupBus';
import { usePopupKeys } from './usePopupKeys';

export interface BindingsPopupProps {
  /** The panel id. The query consumers of the popup are named `popup:<id>`. */
  id: number;
  target: PopupTarget;
  /** The live options of the panel. The popup compares them with the revision that the draft started from. */
  options: Options;
  data: PanelData;
  timeZone: string;
  fieldConfig: FieldConfigSource;
  replaceVariables: PanelProps['replaceVariables'];
  onOptionsChange: (options: Options) => void;
  /** Close the popup and drop the draft. */
  onClose: () => void;
}

const OVERLAY_ID = 'bindings-popup';
/** Fields that hold no draft text: the filter of the list. */
const NOT_DRAFT = '[data-dmap-not-draft]';
const CONFIRM_ID = 'bindings-popup-confirm';
/** The focused elements that can hold typed text that is not committed yet (Monaco keeps its text in a textarea). */
const TEXT_FIELD = 'input:not([type=checkbox]):not([type=radio]), textarea, [contenteditable="true"]';

/** The bindings popup: a modal with the bindings editor, the Esc ownership, the close confirmation and the conflict check. */
export function BindingsPopup({
  id,
  target,
  options,
  data,
  timeZone,
  fieldConfig,
  replaceVariables,
  onOptionsChange,
  onClose,
}: BindingsPopupProps) {
  const theme = useTheme2();
  const styles = classes;
  const bodyRef = useRef<HTMLDivElement>(null);
  // The saved revision that the draft started from. An Apply moves it. "Reload saved" moves it and starts a new draft.
  const [base, setBase] = useState(() => baseRevision(options));
  const [session, setSession] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const dirty = useRef(false);
  // Text was typed since the last change of the draft. A field that commits on blur (the datasource code editor, a
  // parameter name) holds text that the draft does not have yet, so a close must ask, with or without a commit.
  const edited = useRef(false);
  const onDraftSettled = useCallback(() => {
    edited.current = false;
  }, []);
  const onInputCapture = useCallback((event: FormEvent<HTMLElement>) => {
    if (event.target instanceof Element && !event.target.closest(NOT_DRAFT)) {
      edited.current = true;
    }
  }, []);
  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  // Some fields (the datasource code editor, a parameter name) commit their text on blur. A close by key has no blur, so
  // a focused text field inside the popup loses its focus first; the decision then follows on the next tick, when the
  // commit has reached `dirty`. Any other close decides at once.
  const requestClose = useCallback(() => {
    const decide = () => {
      if (dirty.current || edited.current) {
        setConfirming(true);
      } else {
        onClose();
      }
    };
    const active = document.activeElement;
    if (active instanceof HTMLElement && bodyRef.current?.contains(active) && active.matches(TEXT_FIELD)) {
      active.blur();
      setTimeout(decide, 0);
    } else {
      decide();
    }
  }, [onClose]);

  useOverlay(OVERLAY_ID);
  const controls = useRef<HistoryControls | null>(null);
  const onControls = useCallback((value: HistoryControls | null) => {
    controls.current = value;
  }, []);
  const esc = usePopupKeys({
    id: OVERLAY_ID,
    dialogRef: bodyRef,
    enabled: true,
    onEscape: requestClose,
    onUndo: () => controls.current?.undo(),
    onRedo: () => controls.current?.redo(),
  });

  const linkWidth = options.linkWidth;
  const bindContext = useMemo(
    () =>
      bindContextFor({
        theme,
        fieldThresholds: fieldConfig.defaults.thresholds,
        replaceVariables,
        timeZone,
        linkWidth: { ...DEFAULT_OPTIONS.linkWidth, ...linkWidth },
      }),
    [theme, fieldConfig.defaults.thresholds, replaceVariables, timeZone, linkWidth]
  );

  const apply = useCallback(
    (config: DiagramConfigV2, diagram?: Diagram) => {
      const next = { ...options, config, diagram: diagram ?? options.diagram };
      onOptionsChange(next);
      setBase(baseRevision(next));
    },
    [options, onOptionsChange]
  );
  const reload = useCallback(() => {
    setBase(baseRevision(options));
    setSession((value) => value + 1);
  }, [options]);

  return (
    <>
      <PluginDialog title="Edit bindings" onDismiss={requestClose} overlayId={OVERLAY_ID}>
        <div
          ref={bodyRef}
          className={styles.body}
          data-testid="dmap-bindings-popup"
          onInputCapture={onInputCapture}
          {...esc}
        >
          <BindingEditor
            key={session}
            config={options.config ?? EMPTY_CONFIG}
            diagram={options.diagram}
            base={base}
            conflict={hasConflict(base, options)}
            data={data}
            timeZone={timeZone}
            bindContext={bindContext}
            owner={`popup:${id}`}
            initial={session === 0 ? target : { kind: 'none' }}
            legacyRules={options.rules?.length}
            onDirtyChange={onDirtyChange}
            onDraftSettled={onDraftSettled}
            onApply={apply}
            onRequestClose={requestClose}
            onReload={reload}
            onControls={onControls}
          />
        </div>
      </PluginDialog>
      {confirming && <DiscardConfirm onDiscard={onClose} onKeepEditing={() => setConfirming(false)} />}
    </>
  );
}

function DiscardConfirm({ onDiscard, onKeepEditing }: { onDiscard: () => void; onKeepEditing: () => void }) {
  useOverlay(CONFIRM_ID);
  return (
    <ConfirmModal
      isOpen
      title="Discard changes?"
      body="The draft has changes that you did not apply. Discard them and close the editor?"
      confirmText="Discard and close"
      dismissText="Keep editing"
      onConfirm={onDiscard}
      onDismiss={onKeepEditing}
    />
  );
}

const classes = {
  body: css`
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  `,
};
