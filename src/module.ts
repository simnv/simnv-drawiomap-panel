import { PanelPlugin } from '@grafana/data';
import { DrawioMapPanel } from './components/DrawioMapPanel';

export const plugin = new PanelPlugin<Record<string, unknown>>(DrawioMapPanel);
