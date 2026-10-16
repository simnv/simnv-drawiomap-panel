import React from 'react';
import { PanelProps } from '@grafana/data';

export function DrawioMapPanel(props: PanelProps<Record<string, unknown>>) {
  return <div className="dmap-panel">draw.io map: no diagram yet ({props.width}x{props.height})</div>;
}
