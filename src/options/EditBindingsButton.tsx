import React, { useState } from 'react';
import { Button, Tooltip } from '@grafana/ui';
import { currentAddress, requestOpen } from '../editor/popup/popupBus';

/**
 * The "Edit bindings" button of the Bindings option: it opens the split editor of the panel in this editor session.
 * No panel listens when the user is not in a panel editor: then the tooltip tells the reason. Disabled without a
 * diagram.
 */
export function EditBindingsButton({ disabled }: { disabled: boolean }) {
  const [noEditor, setNoEditor] = useState(false);
  return (
    <Tooltip content="Open the panel editor first" show={noEditor} placement="top">
      <span>
        <Button
          data-testid="dmap-edit-bindings-option"
          variant="secondary"
          icon="link"
          disabled={disabled}
          onClick={() => setNoEditor(!requestOpen(currentAddress(), { kind: 'none' }))}
          onBlur={() => setNoEditor(false)}
        >
          Edit bindings
        </Button>
      </span>
    </Tooltip>
  );
}
