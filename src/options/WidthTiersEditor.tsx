import React, { useState } from 'react';
import type { StandardEditorProps } from '@grafana/data';
import { Field, Input } from '@grafana/ui';
import { formatTiers, parseTiers, sameTiers } from '../binding/linkWidth';
import type { WidthTier } from '../types';

/**
 * The link speed tiers as one line of text: "0: 1.5, 100M: 2.5, 1G: 4, 10G: 5.5" (speed in bit/s with k, M, G or T,
 * then the width). The option changes only when the text is valid; a text that is not valid shows its problem and
 * keeps the saved tiers.
 */
export function WidthTiersEditor({ value, onChange }: StandardEditorProps<WidthTier[]>) {
  const saved = formatTiers(value ?? []);
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | undefined>(undefined);
  // a new saved value (an undo, another editor) replaces the text
  const [shown, setShown] = useState(saved);
  if (shown !== saved) {
    setShown(saved);
    setText(saved);
    setError(undefined);
  }
  const commit = () => {
    const parsed = parseTiers(text);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(undefined);
    // an unchanged text saves nothing: the panel does not bind again and the dashboard keeps its state
    if (!sameTiers(parsed.tiers, value)) {
      onChange(parsed.tiers);
    }
  };
  return (
    <Field invalid={!!error} error={error}>
      <Input
        value={text}
        aria-label="Link speed tiers"
        placeholder="0: 1.5, 100M: 2.5, 1G: 4"
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
          }
        }}
      />
    </Field>
  );
}
