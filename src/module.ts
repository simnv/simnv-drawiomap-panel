import { FieldColorModeId, FieldConfigProperty, PanelPlugin, ThresholdsMode } from '@grafana/data';
import { DrawioMapPanel } from './components/DrawioMapPanel';
import { DiagramEditor } from './options/DiagramEditor';
import { RulesEditor } from './options/RulesEditor';
import { DEFAULT_OPTIONS, Options } from './types';

export const plugin = new PanelPlugin<Options>(DrawioMapPanel as never)
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
      .addTextInput({
        path: 'editorUrl',
        name: 'Editor URL',
        category: ['Diagram'],
        defaultValue: DEFAULT_OPTIONS.editorUrl,
        description: 'draw.io in embed mode. Self-hosted jgraph/drawio or https://embed.diagrams.net',
      })
      .addCustomEditor({
        id: 'rules',
        path: 'rules',
        name: 'Rules',
        category: ['Binding'],
        editor: RulesEditor,
        defaultValue: [],
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
        defaultValue: 100,
        showIf: (o) => o.zoom?.mode === 'custom',
      })
      .addBooleanSwitch({ path: 'zoom.wheel', name: 'Wheel zoom', category: ['View'], defaultValue: false })
      .addBooleanSwitch({ path: 'zoom.pan', name: 'Drag pan', category: ['View'], defaultValue: false })
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
  );
