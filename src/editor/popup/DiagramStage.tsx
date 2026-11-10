import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { IconButton, useStyles2, useTheme2 } from '@grafana/ui';
import type { Badge } from '../split/cellsForPath';
import { cellAt } from '../../interact/hit';
import { highlightCells, LEGEND_ACTIVE, LEGEND_HIT, LEGEND_MEMBER } from '../../legend/highlight';
import { paintedClientBox } from '../../render/paintedBox';
import type { ViewBox } from '../../render/zoom';
import { DEFAULT_OPTIONS, type PatchMap, type ZoomOptions } from '../../types';
import { usePanZoom } from '../../stage/usePanZoom';
import type { Stage } from '../../stage/useStage';
import { useStageLayout } from '../../stage/useStageLayout';
import { useStagePaint } from '../../stage/useStagePaint';
import { ChartLayer, type ChartLayerProps } from '../../visuals/ChartLayer';
import { boxTargets } from './boxTargets';
import {
  cellFlags,
  createEditorLayer,
  isOutlined,
  tagSelection,
  type EditorLayer,
  type StageSelection,
} from './editorLayer';
import { useBoxSelect } from './useBoxSelect';

export type { StageSelection };

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
  /** The chart uses of the bind (spec 3.9). Without it the stage shows no charts. */
  chartLayer?: Omit<ChartLayerProps, 'root' | 'cells' | 'viewport' | 'revision'>;
  /** The hash of the shown diagram. The stage writes it as `data-dmap-hash`, as the panel does. */
  hash?: string;
  /** The link width range of the panel: the value labels keep `linkWidth.max / 2` clear of the strokes. */
  linkWidth?: { min: number; max: number };
  /** The count of series per cell for the path under the cursor (spec 5.3). Red for 0. */
  badges?: ReadonlyMap<string, Badge>;
  /** The live view, when the parent controls it (the split editor zooms to the highlighted cells). */
  view?: ViewBox | null;
  setView?: React.Dispatch<React.SetStateAction<ViewBox | null>>;
}

/** The place of a badge in the stage, in px from the top-left corner of the stage. */
interface BadgePlace {
  id: string;
  left: number;
  top: number;
}

/** The outline of a tagged cell: its painted box in px from the top-left corner of the stage, and its flags. */
interface OutlinePlace extends BadgePlace {
  width: number;
  height: number;
  flags: Record<string, string>;
}

const FIT: ZoomOptions = { ...DEFAULT_OPTIONS.zoom, mode: 'fit', percent: 100, align: 'center', minScale: 0 };

/** The focus shows: a keyboard focus, not the focus of a click. An engine without `:focus-visible` shows it. */
const focusVisible = (el: Element) => {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
};

const sameBox = (a: ViewBox | undefined, b: ViewBox | undefined) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

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
  hash,
  linkWidth,
  badges,
  ...controlled
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
  const [ownView, setOwnView] = useState<ViewBox | null>(null);
  const view = controlled.setView ? (controlled.view ?? null) : ownView;
  const setView = controlled.setView ?? setOwnView;

  // A new diagram starts at the fitted view. A new root with the same geometry (a write of a cell attribute, spec 5.5)
  // keeps the view.
  const viewRoot = useRef({ root: stage.root, base: stage.base });
  useLayoutEffect(() => {
    const old = viewRoot.current;
    if (old.root !== stage.root) {
      viewRoot.current = { root: stage.root, base: stage.base };
      if (!sameBox(old.base, stage.base)) {
        setView(null);
      }
    }
  }, [stage.root, stage.base, setView]);

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

  // The draft patches, the overlay and the value labels: the preview shows the label mode while the user edits it.
  useStagePaint(stage, patches, { theme, linkWidth: linkWidth ?? DEFAULT_OPTIONS.linkWidth });

  // Fit the diagram into the pane. A pane with no size yet keeps the layout.
  useStageLayout(stage, FIT, size.width && size.height ? size : undefined, view, stageRef);

  // The badges sit at the top-right corner of their cells. The effect runs after the layout of the view.
  const [places, setPlaces] = useState<BadgePlace[]>([]);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const next: BadgePlace[] = [];
    if (wrapper && badges?.size) {
      const origin = wrapper.getBoundingClientRect();
      for (const id of badges.keys()) {
        const group = stage.index.get(id)?.group;
        const box = group && paintedClientBox(group);
        if (box) {
          next.push({ id, left: box.x + box.width - origin.left, top: box.y - origin.top });
        }
      }
    }
    // The places come from the layout of the external SVG DOM.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaces((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, [badges, stage.index, view, size]);

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

  // The editor layer of the cell attributes: the patch applier does not touch it. The layer lives as long as the index
  // and writes only the cells that the old or the new selection tags.
  const layerRef = useRef<EditorLayer | null>(null);
  useEffect(() => {
    const layer = createEditorLayer(stage.index);
    layerRef.current = layer;
    return () => {
      layer.clear();
      layerRef.current = null;
    };
  }, [stage.index]);
  const { selected, affected, highlight, lighter, primary, extra, missed } = selection;
  useEffect(() => {
    layerRef.current?.apply({ selected, affected, highlight, lighter, primary, extra, missed });
  }, [stage.index, selected, affected, highlight, lighter, primary, extra, missed]);

  // The outlines of the tagged cells. A CSS outline on the cell group would take the box of the group, and the
  // 100% foreignObject of a draw.io HTML label makes that box the whole viewport: the outline goes around the painted
  // box (`paintedClientBox`) in an overlay. A layout effect, after the layout of the view: no frame shows it behind.
  const tagged = useMemo(
    () => tagSelection({ selected, affected, highlight, lighter, primary, extra, missed }),
    [selected, affected, highlight, lighter, primary, extra, missed]
  );
  // The cell with the keyboard focus: the focus ring of the browser would take the box of the group too.
  const [focused, setFocused] = useState<string | null>(null);
  const [outlines, setOutlines] = useState<OutlinePlace[]>([]);
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const next: OutlinePlace[] = [];
    const ids = new Set([...tagged.all].filter((id) => isOutlined(tagged, id)));
    // a group that a new root replaced loses the focus with no blur: the ring follows only the active element
    const ring = focused !== null && stage.index.get(focused)?.group === document.activeElement ? focused : null;
    if (ring !== null) {
      ids.add(ring);
    }
    if (wrapper && ids.size) {
      const origin = wrapper.getBoundingClientRect();
      for (const id of ids) {
        const group = stage.index.get(id)?.group;
        const box = group && paintedClientBox(group);
        if (box && (box.width > 0 || box.height > 0)) {
          const { x, y, width, height } = box;
          const flags = { ...cellFlags(tagged, id), 'data-dmap-focus': id === ring ? 'true' : 'false' };
          next.push({ id, left: x - origin.left, top: y - origin.top, width, height, flags });
        }
      }
    }
    // The places come from the layout of the external SVG DOM.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOutlines((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, [tagged, focused, stage.index, view, size]);
  // The cells that the highlight does not hold dim (the dimming of the legend, spec 5.3).
  useEffect(() => {
    const root = stage.root;
    if (!root) {
      return;
    }
    const hits = [...highlight, ...(lighter ?? [])];
    highlightCells(root, stage.index, [...stage.index.keys()], hits.length ? hits : null);
    return () => highlightCells(root, stage.index, [], null);
  }, [stage.root, stage.index, highlight, lighter]);

  const isDark = theme.isDark;
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
      onFocus={(e) => {
        const id = e.target.getAttribute('data-cell-id');
        setFocused(id !== null && stage.index.has(id) && focusVisible(e.target) ? id : null);
      }}
      onBlur={() => setFocused(null)}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && pick(e.target, e.shiftKey)) {
          e.preventDefault();
        }
      }}
    >
      <div ref={attachStage} className={styles.stage} data-testid="dmap-popup-stage" data-dmap-hash={hash} />
      {chartLayer ? (
        <ChartLayer {...chartLayer} root={stage.root} cells={stage.index} viewport={viewport} revision={revision} />
      ) : null}
      {stage.error ? <div className={styles.empty}>{stage.error}</div> : null}
      {outlines.map(({ id, left, top, width, height, flags }) => (
        <div
          key={id}
          className={styles.outline}
          data-testid="dmap-cell-outline"
          data-dmap-outline={id}
          {...flags}
          style={{ left, top, width, height }}
        />
      ))}
      {places.map(({ id, left, top }) => {
        const badge = badges?.get(id);
        return badge ? (
          <span
            key={id}
            className={styles.badge}
            data-testid="dmap-cell-badge"
            data-dmap-badge={id}
            data-dmap-red={badge.red ? 'true' : 'false'}
            style={{
              left,
              top,
              background: badge.red ? theme.colors.error.main : theme.colors.background.primary,
              color: badge.red ? theme.colors.error.contrastText : theme.colors.text.primary,
            }}
          >
            {badge.count}
          </span>
        ) : null;
      })}
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
    // The outline of the group would take its box (the whole viewport with an HTML label): the outlines are drawn in
    // the overlay (`outline`), the focus ring too.
    "& [data-cell-id][role='button']": { cursor: 'pointer', outline: 'none' },
    // The cells of the classes that extend the class under the cursor. Their outline is in `outline`.
    '& [data-dmap-lighter="true"]': { opacity: 0.6 },
    [`& .${LEGEND_MEMBER}`]: { transition: 'opacity 120ms' },
    [`& svg.${LEGEND_ACTIVE} .${LEGEND_MEMBER}:not(.${LEGEND_HIT}):not(:has(.${LEGEND_HIT}))`]: { opacity: 0.2 },
  }),
  // The outline of a tagged cell, on its painted box. The order of the rules is the order of precedence: a later
  // flag wins. It does not catch the pointer.
  outline: css({
    position: 'absolute',
    zIndex: 1,
    pointerEvents: 'none',
    // The keyboard focus. The flags of the selection come later and win, as they did over the focus ring.
    '&[data-dmap-focus="true"]': { outline: `2px solid ${theme.colors.primary.border}` },
    '&[data-dmap-affected="true"]': { outline: '2px dashed currentColor' },
    '&[data-dmap-selected="true"]': { outline: '3px solid currentColor' },
    // The last selected cell is the one that the single-cell sections edit.
    '&[data-dmap-primary="true"]': { outlineOffset: '2px' },
    // A proposed selector would also match these cells.
    '&[data-dmap-extra="true"]': { outline: `3px dashed ${theme.colors.warning.border}`, outlineOffset: '2px' },
    // The proposed selector misses these selected cells.
    '&[data-dmap-missed="true"]': { outline: `3px double ${theme.colors.error.border}`, outlineOffset: '2px' },
    '&[data-dmap-highlight="true"]': { outline: '3px dotted currentColor' },
    // The cells of the classes that extend the class under the cursor.
    '&[data-dmap-lighter="true"]': { outline: '2px dotted currentColor', opacity: 0.6 },
  }),
  // A badge: its centre is on the top-right corner of its cell. It does not catch the pointer.
  badge: css({
    position: 'absolute',
    zIndex: 1,
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    minWidth: 18,
    padding: '0 4px',
    borderRadius: 9,
    border: `1px solid ${theme.colors.border.medium}`,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: '16px',
    textAlign: 'center',
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
