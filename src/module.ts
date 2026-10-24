import {
  FieldColorModeId,
  FieldConfigProperty,
  PanelPlugin,
  type SelectFieldConfigSettings,
  ThresholdsMode,
} from '@grafana/data';
import { DrawioMapPanel } from './components/DrawioMapPanel';
import { DiagramEditor } from './options/DiagramEditor';
import { DEFAULT_OPTIONS, type HoverKind, Options } from './types';

export const plugin = new PanelPlugin<Options>(DrawioMapPanel)
  .setNoPadding()
  .useFieldConfig({
    standardOptions: {
      [FieldConfigProperty.Unit]: { defaultValue: 'bps' },
      [FieldConfigProperty.Decimals]: {},
      [FieldConfigProperty.Min]: {},
      [FieldConfigProperty.Max]: {},
      [FieldConfigProperty.Mappings]: {},
      [FieldConfigProperty.Links]: {},
      [FieldConfigProperty.Color]: {
        settings: { byValueSupport: true },
        defaultValue: { mode: FieldColorModeId.Thresholds },
      },
      [FieldConfigProperty.Thresholds]: {
        defaultValue: {
          mode: ThresholdsMode.Absolute,
          steps: [
            { value: -Infinity, color: 'green' },
            { value: 60, color: 'yellow' },
            { value: 85, color: 'red' },
          ],
        },
      },
    },
  })
  .setPanelOptions((builder) =>
    builder
      .addCustomEditor({
        id: 'diagram',
        path: 'diagram',
        name: 'Diagram',
        category: ['Diagram'],
        editor: DiagramEditor,
      })
      .addRadio({
        path: 'zoom.mode',
        name: 'Zoom',
        category: ['View'],
        defaultValue: DEFAULT_OPTIONS.zoom.mode,
        settings: {
          options: [
            { value: 'fit', label: 'Fit' },
            { value: 'fit-width', label: 'Fit width' },
            { value: 'original', label: 'Original' },
            { value: 'custom', label: 'Custom' },
          ],
        },
      })
      .addNumberInput({
        path: 'zoom.percent',
        name: 'Zoom %',
        category: ['View'],
        defaultValue: DEFAULT_OPTIONS.zoom.percent,
        showIf: (o) => o.zoom?.mode === 'custom',
      })
      .addNumberInput({
        path: 'zoom.minScale',
        name: 'Minimum scale',
        description: 'Do not shrink below this scale in Fit modes; the panel scrolls instead. 1 = 100%.',
        category: ['View'],
        defaultValue: 0,
        settings: { min: 0, step: 0.1 },
        showIf: (o) => ['fit', 'fit-width'].includes(o.zoom?.mode ?? 'fit'),
      })
      .addRadio({
        path: 'zoom.align',
        name: 'Align',
        description: 'Where the fitted diagram goes when the panel has a different shape',
        category: ['View'],
        defaultValue: DEFAULT_OPTIONS.zoom.align,
        settings: {
          options: [
            { value: 'top', label: 'Top' },
            { value: 'center', label: 'Center' },
          ],
        },
        showIf: (o) => (o.zoom?.mode ?? 'fit') === 'fit',
      })
      .addBooleanSwitch({
        path: 'zoom.wheel',
        name: 'Wheel zoom',
        category: ['View'],
        defaultValue: DEFAULT_OPTIONS.zoom.wheel,
      })
      .addBooleanSwitch({
        path: 'zoom.pan',
        name: 'Drag pan',
        category: ['View'],
        defaultValue: DEFAULT_OPTIONS.zoom.pan,
      })
      .addNumberInput({
        path: 'linkWidth.min',
        name: 'Link width min',
        category: ['View'],
        defaultValue: DEFAULT_OPTIONS.linkWidth.min,
      })
      .addNumberInput({
        path: 'linkWidth.max',
        name: 'Link width max',
        category: ['View'],
        defaultValue: DEFAULT_OPTIONS.linkWidth.max,
      })
      .addMultiSelect<HoverKind, SelectFieldConfigSettings<HoverKind>>({
        path: 'hover.kinds',
        name: 'Hover kinds',
        description:
          'The cells that open a hover or pinned card. A cell opens a card only when the card has rows or links.',
        category: ['View'],
        // the builder types defaultValue as one option value; a multi-select stores an array
        defaultValue: DEFAULT_OPTIONS.hover!.kinds as unknown as HoverKind,
        settings: {
          options: [
            { value: 'node', label: 'Node' },
            { value: 'link', label: 'Link' },
            { value: 'port', label: 'Port' },
            { value: 'link-label', label: 'Link label' },
            { value: 'group', label: 'Group' },
            { value: 'canvas', label: 'Canvas' },
            { value: 'legend', label: 'Legend' },
            { value: 'other', label: 'Other' },
          ],
        },
      })
      .addNumberInput({
        path: 'summary.maxRows',
        name: 'Status summary rows',
        description:
          'The band above the diagram shows one row for each status cause. More causes go into a "+N more" row. 0 hides the band.',
        category: ['View'],
        defaultValue: DEFAULT_OPTIONS.summary!.maxRows,
        settings: { min: 0, integer: true },
      })
      .addBooleanSwitch({
        path: 'legend.show',
        name: 'Show legend',
        description: 'The colours of the bound cells and their thresholds, from the field config and the status rules.',
        category: ['Legend'],
        defaultValue: DEFAULT_OPTIONS.legend!.show,
      })
      .addRadio({
        path: 'legend.corner',
        name: 'Corner',
        category: ['Legend'],
        defaultValue: DEFAULT_OPTIONS.legend!.corner,
        settings: {
          options: [
            { value: 'top-left', label: 'Top left' },
            { value: 'top-right', label: 'Top right' },
            { value: 'bottom-left', label: 'Bottom left' },
            { value: 'bottom-right', label: 'Bottom right' },
          ],
        },
        showIf: (o) => o.legend?.show !== false,
      })
      .addNumberInput({
        path: 'legend.maxBlocks',
        name: 'Maximum scales',
        description: 'More colour scales go into a "+N more" line.',
        category: ['Legend'],
        defaultValue: DEFAULT_OPTIONS.legend!.maxBlocks,
        settings: { min: 1, integer: true },
        showIf: (o) => o.legend?.show !== false,
      })
      .addBooleanSwitch({
        path: 'legend.collapsed',
        name: 'Start collapsed',
        description: 'The legend starts as a small chip. Click the chip to open it. Drag it to move it.',
        category: ['Legend'],
        defaultValue: DEFAULT_OPTIONS.legend!.collapsed,
        showIf: (o) => o.legend?.show !== false,
      })
  );
