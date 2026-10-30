import React from 'react';
import type { IconName, StandardEditorProps } from '@grafana/data';
import { RadioButtonGroup } from '@grafana/ui';
import type { LegendCorner, ZoomAlign, ZoomMode } from '../types';

/** One button: an icon or a small picture, a name for the screen reader, and a tooltip. */
export interface IconOption<T> {
  value: T;
  ariaLabel: string;
  description: string;
  icon?: IconName;
  component?: React.ComponentType;
}

export interface IconRadioSettings<T> {
  /** The name of the group for the screen reader. */
  ariaLabel: string;
  options: Array<IconOption<T>>;
}

/**
 * A radio group of icons with tooltips: it fits the narrowest options pane. A custom editor and not `addRadio`: the
 * radio editor of Grafana 13 drops the description of an option, so the icons had no tooltip.
 */
export function IconRadioEditor<T>({ value, onChange, item }: StandardEditorProps<T, IconRadioSettings<T>>) {
  return (
    <RadioButtonGroup<T>
      aria-label={item.settings?.ariaLabel}
      options={item.settings?.options ?? []}
      value={value}
      onChange={onChange}
    />
  );
}

/** A small panel outline with a filled box in one corner. */
function corner(top: boolean, left: boolean) {
  return function CornerGlyph() {
    return (
      <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden focusable="false" style={{ display: 'block' }}>
        <rect x="0.5" y="0.5" width="17" height="13" rx="1.5" fill="none" stroke="currentColor" />
        <rect x={left ? 2.5 : 9.5} y={top ? 2.5 : 7.5} width="6" height="4" rx="0.5" fill="currentColor" />
      </svg>
    );
  };
}

export const ZOOM_MODES: IconRadioSettings<ZoomMode> = {
  ariaLabel: 'Zoom',
  options: [
    {
      value: 'fit',
      icon: 'expand-arrows',
      ariaLabel: 'Fit',
      description: 'Fit: the whole diagram fits in the panel',
    },
    {
      value: 'fit-width',
      icon: 'arrows-h',
      ariaLabel: 'Fit width',
      description: 'Fit width: the diagram has the panel width, the panel scrolls',
    },
    {
      value: 'original',
      icon: 'square-shape',
      ariaLabel: 'Original',
      description: 'Original: the diagram has its original size',
    },
    {
      value: 'custom',
      icon: 'percentage',
      ariaLabel: 'Custom',
      description: 'Custom: the size that you set in Zoom %',
    },
  ],
};

export const ZOOM_ALIGNS: IconRadioSettings<ZoomAlign> = {
  ariaLabel: 'Align',
  options: [
    {
      value: 'top',
      icon: 'vertical-align-top',
      ariaLabel: 'Top',
      description: 'Top: when the panel is taller than the diagram, the diagram is at the top',
    },
    {
      value: 'center',
      icon: 'vertical-align-center',
      ariaLabel: 'Center',
      description: 'Center: when the panel is taller than the diagram, the diagram is in the middle',
    },
  ],
};

export const LEGEND_CORNERS: IconRadioSettings<LegendCorner> = {
  ariaLabel: 'Legend corner',
  options: [
    { value: 'top-left', ariaLabel: 'Top left', description: 'Top left', component: corner(true, true) },
    { value: 'top-right', ariaLabel: 'Top right', description: 'Top right', component: corner(true, false) },
    { value: 'bottom-left', ariaLabel: 'Bottom left', description: 'Bottom left', component: corner(false, true) },
    { value: 'bottom-right', ariaLabel: 'Bottom right', description: 'Bottom right', component: corner(false, false) },
  ],
};
