import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { getDisplayProcessor, LinkModel, PanelProps } from '@grafana/data';
import { ContextMenu, MenuItem, useTheme2 } from '@grafana/ui';
import { bind } from '../binding/engine';
import { extractSeries } from '../binding/series';
import { patchAt } from '../interact/hit';
import { primaryOf, resolveLinks } from '../interact/links';
import { Tooltip } from '../interact/Tooltip';
import { applyPatches } from '../render/applier';
import { renderOverlay } from '../render/overlay';
import { cellMetas } from '../render/svgStage';
import { applyLayout, clientToViewBox, pan, viewBoxFor, ViewBox, zoomAt } from '../render/zoom';
import { CellPatch, DEFAULT_OPTIONS, Options, SeriesInfo } from '../types';
import { useStage } from './useStage';

const styles = {
  wrapper: css`
    position: relative;
    width: 100%;
    height: 100%;
  `,
  stage: css`
    width: 100%;
    height: 100%;
    & > svg {
      display: block;
    }
  `,
  empty: css`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    opacity: 0.7;
  `,
  badge: css`
    position: absolute;
    right: 4px;
    top: 4px;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    z-index: 1;
  `,
};

interface MenuState {
  x: number;
  y: number;
  links: LinkModel[];
}

export function DrawioMapPanel({
  options,
  data,
  width,
  height,
  fieldConfig,
  replaceVariables,
  timeZone,
}: PanelProps<Options>) {
  const theme = useTheme2();
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    zoom: { ...DEFAULT_OPTIONS.zoom, ...options.zoom },
    linkWidth: { ...DEFAULT_OPTIONS.linkWidth, ...options.linkWidth },
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const stage = useStage(containerRef, opts.diagram?.svg, opts.diagram?.hash);
  const patchedRef = useRef<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; patch: CellPatch } | null>(null);
  const [view, setView] = useState<ViewBox | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const zoomMode = opts.zoom.mode;
  const zoomPercent = opts.zoom.percent;
  const wheelZoom = opts.zoom.wheel;

  // Reset the custom view and close the menu when the diagram changes (state adjustment during render).
  const hash = opts.diagram?.hash;
  const [viewHash, setViewHash] = useState(hash);
  if (viewHash !== hash) {
    setViewHash(hash);
    setView(null);
    setMenu(null);
  }

  const series = useMemo(() => extractSeries(data.series), [data.series]);
  // Grafana attaches field.display (effective config incl. overrides) to panel data; fall back for tests.
  const display = useCallback(
    (s: SeriesInfo, v: number) => (s.field.display ?? getDisplayProcessor({ field: s.field, theme, timeZone }))(v),
    [theme, timeZone]
  );
  const result = useMemo(
    () =>
      bind(opts.rules ?? [], cellMetas(stage.index), series, {
        theme,
        fieldThresholds: fieldConfig.defaults.thresholds,
        replaceVariables,
        display,
        linkWidth: opts.linkWidth,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      opts.rules,
      stage.index,
      series,
      theme,
      fieldConfig.defaults.thresholds,
      replaceVariables,
      display,
      opts.linkWidth.min,
      opts.linkWidth.max,
    ]
  );

  // Apply patches and redraw the overlay once per frame.
  useEffect(() => {
    if (!stage.root) {
      return;
    }
    const root = stage.root;
    const id = requestAnimationFrame(() => {
      patchedRef.current = applyPatches(stage.index, result.patches, patchedRef.current);
      renderOverlay(root, stage.index, result.patches, { theme });
    });
    return () => cancelAnimationFrame(id);
  }, [stage.root, stage.index, result, theme]);

  // Zoom layout.
  useEffect(() => {
    if (!stage.root || !stage.base) {
      return;
    }
    const layout = viewBoxFor({ ...DEFAULT_OPTIONS.zoom, mode: zoomMode, percent: zoomPercent }, view ?? stage.base, {
      width,
      height,
    });
    applyLayout(stage.root, layout);
    if (containerRef.current) {
      containerRef.current.style.overflow = layout.overflow;
    }
  }, [stage.root, stage.base, zoomMode, zoomPercent, width, height, view]);

  // Wheel zoom. React adds wheel listeners as passive, so preventDefault needs a native listener.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const root = stage.root;
    const base = stage.base;
    if (!wheelZoom || !wrapper || !root || !base) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = clientToViewBox(root, e.clientX, e.clientY);
      setView((v) => zoomAt(v ?? base, e.deltaY > 0 ? 1.1 : 1 / 1.1, c.x, c.y));
    };
    wrapper.addEventListener('wheel', onWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', onWheel);
  }, [wheelZoom, stage.root, stage.base]);

  const onClick = (e: React.MouseEvent) => {
    const wrapper = containerRef.current;
    const patch = wrapper ? patchAt(e.target, wrapper, result.patches) : undefined;
    if (!patch) {
      setMenu(null);
      return;
    }
    // Resolve the links first, then open the menu with them in state: the first click must show the right items.
    const links = resolveLinks(patch, primaryOf(patch), replaceVariables);
    setMenu(links.length ? { x: e.clientX, y: e.clientY, links } : null);
  };
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    if (opts.zoom.pan && stage.root) {
      drag.current = clientToViewBox(stage.root, e.clientX, e.clientY);
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (drag.current && stage.root) {
      const c = clientToViewBox(stage.root, e.clientX, e.clientY);
      const d = drag.current;
      setView((v) => pan(v ?? stage.base!, c.x - d.x, c.y - d.y));
      return;
    }
    const wrapper = containerRef.current;
    if (!wrapper) {
      return;
    }
    const patch = patchAt(e.target, wrapper, result.patches);
    if (!patch) {
      setHover(null);
      return;
    }
    const r = wrapper.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, patch });
  };
  const onMouseUp = () => (drag.current = null);

  if (!opts.diagram?.svg) {
    return (
      <div className={styles.empty} data-testid="dmap-empty">
        No diagram. Edit the panel and open the draw.io editor or import a .drawio file.
      </div>
    );
  }

  const warnings = [...stage.warnings, ...result.warnings];

  return (
    <div
      className={styles.wrapper}
      ref={wrapperRef}
      data-testid="dmap-panel"
      data-dmap-cells={stage.index.size}
      data-dmap-patched={result.patches.size}
      data-dmap-warnings={warnings.length}
      data-dmap-hash={opts.diagram.hash}
      style={{ colorScheme: theme.isDark ? 'dark' : 'light' }}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        setHover(null);
        drag.current = null;
      }}
    >
      <div ref={containerRef} className={styles.stage} />
      {stage.error ? <div className={styles.empty}>{stage.error}</div> : null}
      {warnings.length ? (
        <div
          className={styles.badge}
          style={{ background: theme.colors.warning.main, color: theme.colors.warning.contrastText }}
          title={warnings.join('\n')}
          data-testid="dmap-warning-badge"
        >
          {warnings.length} warning{warnings.length > 1 ? 's' : ''}
        </div>
      ) : null}
      {hover && !menu ? <Tooltip x={hover.x} y={hover.y} patch={hover.patch} width={width} height={height} /> : null}
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          renderMenuItems={() =>
            menu.links.map((l, i) => (
              <MenuItem
                key={`${i}-${l.href}`}
                label={l.title}
                url={l.href}
                target={l.target}
                onClick={l.onClick ? (ev) => l.onClick!(ev) : undefined}
              />
            ))
          }
        />
      ) : null}
    </div>
  );
}
