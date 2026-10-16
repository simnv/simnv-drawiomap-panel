import React from 'react';
import { css } from '@emotion/css';
import { FieldColorModeId, FieldType } from '@grafana/data';
import { Sparkline, useTheme2 } from '@grafana/ui';
import type { CellPatch } from '../types';
import { primaryOf } from './links';

export interface TooltipProps {
  x: number;
  y: number;
  patch: CellPatch;
  /** panel size, to keep the card inside */
  width: number;
  height: number;
}

const W = 220;

export function Tooltip({ x, y, patch, width, height }: TooltipProps) {
  const theme = useTheme2();
  const primary = primaryOf(patch);
  const spark = patch.sparkline?.series ?? primary.series;
  const timeField = spark?.frame.fields.find((f) => f.type === FieldType.time);
  const left = Math.min(x + 12, Math.max(0, width - W - 4));
  const top = Math.min(y + 12, Math.max(0, height - 120));
  const cls = css`
    position: absolute;
    left: ${left}px;
    top: ${top}px;
    width: ${W}px;
    pointer-events: none;
    z-index: 2;
    padding: ${theme.spacing(1)};
    background: ${theme.colors.background.elevated ?? theme.colors.background.secondary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z2};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.primary};
  `;
  const sparkColor =
    patch.sparkline?.color ?? patch.link?.a2b?.color ?? patch.shape?.color ?? theme.colors.text.secondary;
  const lines: string[] = [];
  const title = patch.scope.cell.label || patch.scope.cell.key || patch.cellId;
  if (patch.link?.a2b) {
    lines.push(`A→B: ${patch.link.a2b.label}`);
  }
  if (patch.link?.b2a) {
    lines.push(`B→A: ${patch.link.b2a.label}`);
  }
  if (patch.shape?.display) {
    lines.push(patch.shape.display.text);
  }
  if (primary.status !== 'ok' && !lines.length) {
    lines.push(primary.status === 'unbound' ? 'unbound (check the rule templates)' : 'no data');
  }
  return (
    <div className={cls} data-testid="dmap-tooltip">
      <div style={{ fontWeight: theme.typography.fontWeightMedium }}>{title}</div>
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
      {spark && timeField && spark.values.length > 1 ? (
        <div style={{ marginTop: 4 }}>
          <Sparkline
            width={W - 16}
            height={40}
            theme={theme}
            sparkline={{ y: spark.field, x: timeField }}
            config={{ color: { mode: FieldColorModeId.Fixed, fixedColor: sparkColor } }}
          />
        </div>
      ) : null}
      {patch.warnings.length ? <div style={{ color: theme.colors.warning.text }}>{patch.warnings[0]}</div> : null}
    </div>
  );
}
