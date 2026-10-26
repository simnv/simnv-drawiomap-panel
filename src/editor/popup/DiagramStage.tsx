import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { IconButton, useStyles2, useTheme2 } from '@grafana/ui';
import { cellAt } from '../../interact/hit';
import { applyPatches, type Applied } from '../../render/applier';
import { clearOwnedAttrs, setOwnedAttrs } from '../../render/cellAttrs';
import { renderLinkLabels, setLinkLabelScale } from '../../render/linkLabels';
import { renderOverlay } from '../../render/overlay';
import { applyLayout, viewBoxFor, type ViewBox } from '../../render/zoom';
import { DEFAULT_OPTIONS, type PatchMap, type ZoomOptions } from '../../types';
import { usePanZoom } from '../../components/usePanZoom';
import type { Stage } from '../../components/useStage';
import { ChartLayer, type ChartLayerProps } from '../../visuals/ChartLayer';
import { boxTargets } from './boxTargets';
import { useBoxSelect } from './useBoxSelect';

export interface StageSelection {
  /** Every selected cell. The primary one is the last. */
  selected: string[];
  /** The cell that the single-cell sections edit. */
  primary?: string;
  /** Cells that a proposed selector would match and the selection does not hold. */
  extra?: string[];
  /** Selected cells that a proposed selector would miss. */
  missed?: string[];
  /** The cells that the edited pattern or override changes. */
  affected: string[];
  /** The cells that a list row points at. */
  highlight: string[];
}

export interface DiagramStageProps {
  stage: Stage;
  /** The container that `useStage` fills with the svg root. */
  stageRef: React.MutableRefObject<HTMLDivElement | null>;
  patches: PatchMap;
  selection: StageSelection;
  /** A click or Enter. Shift toggles the cell in the selection. */
  onSelect: (cellId: string, options: { shift: boolean }) => void;
  /** A box select ended: the cells that the band touches, to add to the selection. */
  onBox?: (cellIds: string[]) => void;
  /** The chart widgets of the draft. Without it the stage shows no charts. */
  chartLayer?: Omit<ChartLayerProps, 'root' | 'cells' | 'viewport' | 'revision' | 'owner'>;
  /** Namespace of the query consumers of the charts, for example `popup:3`. */
  owner: string;
  /** The hash of the shown diagram. The stage writes it as `data-dmap-hash`, as the panel does. */
  hash?: string;
  /** The link width range of the panel: the value labels keep `linkWidth.max / 2` clear of the strokes. */
  linkWidth?: { min: number; max: number };
}

const FIT: ZoomOptions = { ...DEFAULT_OPTIONS.zoom, mode: 'fit', percent: 100, align: 'center', minScale: 0 };

/**
 * The centre pane of the bindings popup: a second instance of the diagram with the draft bindings, pan and zoom,
 * and a click to select a cell. It never touches the DOM of the panel behind the popup.
 */
export function DiagramStage({
  stage,
  stageRef,
  patches,
  selection,
  onSelect,
  onBox,
  chartLayer,
  owner,
  hash,
  linkWidth,
}: DiagramStageProps) {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const attachStage = useCallback(
    (element: HTMLDivElement | null) => {
      stageRef.current = element;
      setViewport(element);
    },
    [stageRef]
  );
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<ViewBox | null>(null);
  const patched = useRef<Applied>();

  // A new diagram starts at the fitted view.
  const [viewRoot, setViewRoot] = useState(stage.root);
  if (viewRoot !== stage.root) {
    setViewRoot(stage.root);
    setView(null);
  }

  // The size of the pane. The fitted layout follows it.
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The colour scheme of the svg follows the Grafana theme, not the system preference. The effect sets it on the root
  // object itself: the editor attaches a new root to the container after this effect, so a lookup in the container would
  // find the old one.
  const isDark = theme.isDark;
  useLayoutEffect(() => {
    const root = stage.root;
    if (root) {
      root.style.setProperty('color-scheme', isDark ? 'dark' : 'light');
    }
  }, [stage.root, isDark]);

  // Apply the draft patches and redraw the overlay in one frame.
  useEffect(() => {
    const root = stage.root;
    if (!root) {
      return;
    }
    const id = requestAnimationFrame(() => {
      patched.current = applyPatches(stage.index, patches, patched.current, undefined, isDark);
      renderOverlay(root, stage.index, patches, { theme });
      // after the overlay, as in the panel: the preview shows the label mode while the user edits it
      renderLinkLabels(root, stage.index, patches, { theme, linkWidth: linkWidth ?? DEFAULT_OPTIONS.linkWidth });
    });
    return () => cancelAnimationFrame(id);
  }, [stage.root, stage.index, patches, theme, isDark, linkWidth]);

  // Fit the diagram into the pane. A live view (pan or zoom) changes the viewBox only.
  useEffect(() => {
    if (!stage.root || !stage.base || !size.width || !size.height) {
      return;
    }
    const layout = viewBoxFor(FIT, stage.base, size, view ?? stage.base);
    applyLayout(stage.root, layout);
    setLinkLabelScale(stage.root);
    if (stageRef.current) {
      stageRef.current.style.overflow = layout.overflow;
    }
  }, [stage.root, stage.base, size, view, stageRef]);

  const box = useBoxSelect({
    wrapperRef,
    targets: () => boxTargets(stage.index),
    onSelect: (ids) => onBox?.(Array.from(new Set(ids))),
    ignore: (target) => target instanceof Node && !!resetRef.current?.contains(target),
  });
  const panZoom = usePanZoom({
    wrapperRef,
    root: stage.root,
    base: stage.base,
    view,
    setView,
    wheel: true,
    dragPan: true,
    align: 'center',
    // A band owns the pointer: the pan does not start.
    ignore: (target) => box.active() || (target instanceof Node && !!resetRef.current?.contains(target)),
  });

  // The editor layer of the cell attributes: the patch applier does not touch it.
  const { selected, affected, highlight, primary, extra, missed } = selection;
  useEffect(() => {
    for (const [id, cell] of stage.index) {
      setOwnedAttrs(cell.group, 'editor', {
        tabindex: '0',
        role: 'button',
        'aria-label': `${id} diagram element`,
        'data-dmap-selected': selected.includes(id) ? 'true' : 'false',
        'data-dmap-primary': id === primary ? 'true' : 'false',
        'data-dmap-extra': extra?.includes(id) ? 'true' : 'false',
        'data-dmap-missed': missed?.includes(id) ? 'true' : 'false',
        'data-dmap-affected': affected.includes(id) ? 'true' : 'false',
        'data-dmap-highlight': highlight.includes(id) ? 'true' : 'false',
      });
    }
  }, [stage.index, selected, affected, highlight, primary, extra, missed]);
  useEffect(() => {
    const index = stage.index;
    return () => index.forEach((cell) => clearOwnedAttrs(cell.group, 'editor'));
  }, [stage.index]);

  const pick = (target: EventTarget | null, shift: boolean) => {
    const cell = cellAt(target, stage.index);
    if (cell) {
      onSelect(cell.meta.id, { shift });
    }
    return !!cell;
  };
  const revision = useMemo(() => `${size.width}x${size.height}${JSON.stringify(view)}`, [size, view]);

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      style={{ colorScheme: isDark ? 'dark' : 'light', touchAction: 'none', userSelect: 'none' }}
      onClick={(e) => {
        // A drag that moved the view, or a band, is not a click.
        if (box.takeClick() || panZoom.takeClick()) {
          e.stopPropagation();
          return;
        }
        pick(e.target, e.shiftKey);
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && pick(e.target, e.shiftKey)) {
          e.preventDefault();
        }
      }}
    >
      <div ref={attachStage} className={styles.stage} data-testid="dmap-popup-stage" data-dmap-hash={hash} />
      {chartLayer ? (
        <ChartLayer
          {...chartLayer}
          root={stage.root}
          cells={stage.index}
          viewport={viewport}
          revision={revision}
          owner={owner}
        />
      ) : null}
      {stage.error ? <div className={styles.empty}>{stage.error}</div> : null}
      {box.rect ? (
        <div
          className={styles.band}
          data-testid="dmap-box-select"
          style={{ left: box.rect.left, top: box.rect.top, width: box.rect.width, height: box.rect.height }}
        />
      ) : null}
      {panZoom.zoomed ? (
        <div ref={resetRef} className={styles.reset}>
          <IconButton
            name="search-minus"
            size="lg"
            tooltip="Reset zoom"
            tooltipPlacement="right"
            data-testid="dmap-popup-reset-zoom"
            onClick={() => setView(null)}
          />
        </div>
      ) : null}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    position: 'relative',
    width: '100%',
    height: '100%',
    minWidth: 0,
    overflow: 'hidden',
    background: theme.colors.background.canvas,
  }),
  stage: css({
    width: '100%',
    height: '100%',
    '& > svg': { display: 'block' },
    // Every cell can be selected: the pointer says so.
    "& [data-cell-id][role='button']": { cursor: 'pointer' },
    '& [data-dmap-affected="true"]': { outline: '2px dashed currentColor' },
    '& [data-dmap-selected="true"]': { outline: '3px solid currentColor' },
    // The last selected cell is the one that the single-cell sections edit.
    '& [data-dmap-primary="true"]': { outlineOffset: '2px' },
    // A proposed selector would also match these cells.
    '& [data-dmap-extra="true"]': { outline: `3px dashed ${theme.colors.warning.border}`, outlineOffset: '2px' },
    // The proposed selector misses these selected cells.
    '& [data-dmap-missed="true"]': { outline: `3px double ${theme.colors.error.border}`, outlineOffset: '2px' },
    '& [data-dmap-highlight="true"]': { outline: '3px dotted currentColor' },
  }),
  band: css({
    position: 'absolute',
    zIndex: 2,
    pointerEvents: 'none',
    border: `1px solid ${theme.colors.primary.border}`,
    background: theme.colors.primary.transparent,
  }),
  empty: css({ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.7 }),
  reset: css({
    position: 'absolute',
    left: theme.spacing(1),
    top: theme.spacing(1),
    zIndex: 2,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
  }),
});
