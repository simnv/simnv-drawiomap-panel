import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, TimeRange } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { BindingResolver, PlanCellPatch } from '../../binding/engine';
import { buildConfiguredCard } from '../../interact/cardModel';
import type { CardContext } from '../../types';
import { Card } from '../../interact/Card';

export interface CardPreviewProps {
  /** The bound patch of the selected cell. Without it no card exists. */
  patch?: PlanCellPatch;
  /** The live resolver of the editor: it carries the snapshots of the popup and the panel data. */
  resolve: BindingResolver;
  cardContext: CardContext;
  timeRange: TimeRange;
  timeZone: string;
  /** Width of the card in px. Without it the preview measures its container. */
  width?: number;
}

const FALLBACK_WIDTH = 320;

/**
 * The hover card of the selected element, built from the draft by the code of the panel card, with the live data.
 * It rebuilds when the draft, the resolver or the data change, with no click.
 */
export function CardPreview({ patch, resolve, cardContext, timeRange, timeZone, width }: CardPreviewProps) {
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLElement>(null);
  const [measured, setMeasured] = useState(FALLBACK_WIDTH);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || width !== undefined) {
      return;
    }
    const measure = () => setMeasured(el.clientWidth || FALLBACK_WIDTH);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  const model = useMemo(
    () => (patch ? buildConfiguredCard(patch, resolve, cardContext) : undefined),
    [patch, resolve, cardContext]
  );
  const empty = !model || (model.rows.length === 0 && model.links.length === 0);
  return (
    <section ref={ref} aria-label="Hover card preview" className={styles.section} data-testid="dmap-card-preview">
      {model && !empty ? (
        <Card
          model={model}
          cellId={patch?.cellId}
          pinned={false}
          variant="inline"
          width={width ?? measured}
          timeRange={timeRange}
          timeZone={timeZone}
        />
      ) : (
        <p className={styles.empty}>No card for this element</p>
      )}
    </section>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  section: css({ flex: 'none', minWidth: 0, overflow: 'hidden' }),
  empty: css({
    margin: 0,
    padding: theme.spacing(1),
    border: `1px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
