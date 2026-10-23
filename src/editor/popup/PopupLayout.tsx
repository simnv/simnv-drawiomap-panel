import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Tab, TabsBar, useStyles2 } from '@grafana/ui';

export const PANES_STORAGE_KEY = 'dmap.bindingsPopup.panes';

/** Below this width of the popup the three panes become the tabs List, Diagram and Inspector. */
export const TABS_BELOW = 1000;
export type PopupTab = 'list' | 'stage' | 'inspector';
const TABS: Array<{ id: PopupTab; label: string }> = [
  { id: 'list', label: 'List' },
  { id: 'stage', label: 'Diagram' },
  { id: 'inspector', label: 'Inspector' },
];

type Pane = 'list' | 'inspector';
const LIMITS = {
  list: { initial: 280, min: 200, max: 520 },
  inspector: { initial: 400, min: 300, max: 720 },
};
/** The centre pane keeps at least this width when a side pane grows. */
const MIN_CENTRE = 240;
/** Width of a handle in px. */
const HANDLE = 8;
const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

interface Sizes {
  list: number;
  inspector: number;
}

/** The share of the popup that the inspector takes by default while a query is open: a datasource editor needs room. */
const WIDE_INSPECTOR = '45%';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function readSizes(): Sizes {
  const sizes = { list: LIMITS.list.initial, inspector: LIMITS.inspector.initial };
  try {
    const stored = JSON.parse(window.localStorage.getItem(PANES_STORAGE_KEY) ?? 'null');
    if (typeof stored?.list === 'number' && Number.isFinite(stored.list)) {
      sizes.list = clamp(stored.list, LIMITS.list.min, LIMITS.list.max);
    }
    if (typeof stored?.inspector === 'number' && Number.isFinite(stored.inspector)) {
      sizes.inspector = clamp(stored.inspector, LIMITS.inspector.min, LIMITS.inspector.max);
    }
  } catch {
    // Private mode or a broken value: use the defaults.
  }
  return sizes;
}

/** The user has set the inspector width in an earlier session. */
function hasStoredInspector(): boolean {
  try {
    return typeof JSON.parse(window.localStorage.getItem(PANES_STORAGE_KEY) ?? 'null')?.inspector === 'number';
  } catch {
    return false;
  }
}

function writeSizes(sizes: Sizes) {
  try {
    window.localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // The storage is full or blocked: the sizes last until the popup closes.
  }
}

/**
 * The sizes that fit the container. A stored size can be wider than a smaller dialog: the side panes shrink in proportion,
 * so that the centre keeps its minimum. The stored sizes stay as the user set them.
 */
export function fitSizes(sizes: Sizes, width: number): Sizes {
  const room = width - 2 * HANDLE - MIN_CENTRE;
  const sum = sizes.list + sizes.inspector;
  if (!width || sum <= room) {
    return sizes;
  }
  const scale = Math.max(room, 0) / sum;
  return { list: Math.floor(sizes.list * scale), inspector: Math.floor(sizes.inspector * scale) };
}

export interface PopupLayoutProps {
  list: ReactNode;
  stage: ReactNode;
  inspector: ReactNode;
  /** The inspector shows a wide editor (a query): it takes a larger share until the user sets a size. */
  wideInspector?: boolean;
  /** The visible pane in tab mode. Without it the layout keeps its own choice. */
  activeTab?: PopupTab;
  onTabChange?: (tab: PopupTab) => void;
}

/**
 * Three panes in a row: the list on the left, the diagram stage in the centre, the inspector on the right.
 * The two handles resize the side panes. The sizes are pixels and stay in `localStorage`.
 *
 * `useSplitter` of `@grafana/ui` sizes only the second pane of a split. It would resize the left pane in the wrong
 * direction, and nested splitters would change the list when the inspector changes. So the layout has its own handles.
 */
export function PopupLayout({
  list,
  stage,
  inspector,
  wideInspector = false,
  activeTab,
  onTabChange,
}: PopupLayoutProps) {
  const styles = useStyles2(getStyles);
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState(readSizes);
  const [inspectorSet, setInspectorSet] = useState(hasStoredInspector);
  // The width of the container: the restored sizes must fit it at the start and after each resize.
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const shown = useMemo(() => fitSizes(sizes, width), [sizes, width]);
  const tabs = width > 0 && width < TABS_BELOW;
  const [ownTab, setOwnTab] = useState<PopupTab>('list');
  const tab = activeTab ?? ownTab;
  const changeTab = (next: PopupTab) => {
    setOwnTab(next);
    onTabChange?.(next);
  };
  const shownRef = useRef(shown);
  useLayoutEffect(() => {
    shownRef.current = shown;
  });
  const latest = useRef(sizes);
  /** The largest size of a pane: the container keeps the minimum of the centre and the other pane. */
  const maxFor = useCallback((pane: Pane) => {
    const width = containerRef.current?.clientWidth || 0;
    const other = pane === 'list' ? shownRef.current.inspector : shownRef.current.list;
    const limit = LIMITS[pane];
    return width ? Math.max(limit.min, Math.min(limit.max, width - other - MIN_CENTRE - 2 * HANDLE)) : limit.max;
  }, []);
  const resize = useCallback((pane: Pane, size: number) => {
    // The base is what the user sees (the fitted sizes), not the stored ones: a resize stores the displayed sizes.
    const next = { ...shownRef.current, [pane]: clamp(size, LIMITS[pane].min, LIMITS[pane].max) };
    latest.current = next;
    shownRef.current = next;
    setSizes(next);
    if (pane === 'inspector') {
      setInspectorSet(true);
    }
  }, []);
  const commit = useCallback(() => writeSizes(latest.current), []);

  // The three panes stay mounted in both modes: the stage index and the editors keep their state. A hidden pane has
  // `display: none`. The slots of the optional elements keep their place, so a mode change does not remount a pane.
  const paneProps = (id: PopupTab) =>
    tabs
      ? {
          id: `dmap-popup-pane-${id}`,
          role: 'tabpanel',
          'aria-labelledby': `dmap-popup-tab-${id}`,
          hidden: tab !== id,
        }
      : {};
  return (
    <div className={styles.root} data-testid="dmap-popup-layout" data-dmap-layout={tabs ? 'tabs' : 'panes'}>
      {tabs && (
        <TabsBar className={styles.tabs}>
          {TABS.map(({ id, label }) => (
            <Tab
              key={id}
              id={`dmap-popup-tab-${id}`}
              aria-controls={`dmap-popup-pane-${id}`}
              label={label}
              active={tab === id}
              onChangeTab={() => changeTab(id)}
            />
          ))}
        </TabsBar>
      )}
      <div ref={containerRef} className={styles.container}>
        <div
          className={cx(styles.pane, styles.side, tabs && styles.tabPane)}
          style={tabs ? undefined : { flexBasis: shown.list }}
          data-testid="dmap-pane-list"
          data-pane-size={shown.list}
          {...paneProps('list')}
        >
          {list}
        </div>
        {!tabs && <Handle pane="list" value={shown.list} maxFor={maxFor} resize={resize} commit={commit} />}
        <div
          className={cx(styles.pane, styles.centre, tabs && styles.tabPane)}
          data-testid="dmap-pane-stage"
          {...paneProps('stage')}
        >
          {stage}
        </div>
        {!tabs && <Handle pane="inspector" value={shown.inspector} maxFor={maxFor} resize={resize} commit={commit} />}
        <div
          className={cx(styles.pane, styles.side, tabs && styles.tabPane)}
          style={tabs ? undefined : { flexBasis: wideInspector && !inspectorSet ? WIDE_INSPECTOR : shown.inspector }}
          data-testid="dmap-pane-inspector"
          data-pane-size={shown.inspector}
          {...paneProps('inspector')}
        >
          {inspector}
        </div>
      </div>
    </div>
  );
}

interface HandleProps {
  pane: Pane;
  value: number;
  maxFor: (pane: Pane) => number;
  resize: (pane: Pane, size: number) => void;
  commit: () => void;
}

/** A vertical separator. Dragging to the right grows the left pane and shrinks the right pane. */
function Handle({ pane, value, maxFor, resize, commit }: HandleProps) {
  const styles = useStyles2(getStyles);
  const drag = useRef<{ x: number; size: number; max: number }>();
  const limit = LIMITS[pane];
  const sign = pane === 'list' ? 1 : -1;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={pane === 'list' ? 'Resize list pane' : 'Resize inspector pane'}
      aria-valuemin={limit.min}
      aria-valuemax={limit.max}
      aria-valuenow={value}
      tabIndex={0}
      className={styles.handle}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        drag.current = { x: e.clientX, size: value, max: maxFor(pane) };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (start) {
          resize(pane, Math.min(start.max, start.size + sign * (e.clientX - start.x)));
        }
      }}
      onPointerUp={(e: PointerEvent<HTMLDivElement>) => {
        if (drag.current) {
          drag.current = undefined;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          commit();
        }
      }}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          resize(pane, Math.min(maxFor(pane), value + sign * (e.key === 'ArrowRight' ? 1 : -1) * step));
          commit();
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          resize(pane, e.key === 'Home' ? limit.min : maxFor(pane));
          commit();
        }
      }}
      onDoubleClick={() => {
        resize(pane, limit.initial);
        commit();
      }}
    />
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }),
  tabs: css({ flex: 'none' }),
  container: css({
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'row',
    width: '100%',
    minHeight: 0,
    overflow: 'hidden',
  }),
  // Tab mode: the visible pane takes the whole width. `hidden` is display none (the stylesheet default) unless a class
  // sets display, so the class must not set it for a hidden pane.
  tabPane: css({ flex: '1 1 auto', width: '100%', maxWidth: 'none', '&[hidden]': { display: 'none' } }),
  pane: css({ display: 'flex', flexDirection: 'column', position: 'relative', minHeight: 0 }),
  side: css({ flexGrow: 0, flexShrink: 0, maxWidth: LIMITS.inspector.max }),
  centre: css({ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }),
  handle: css({
    flex: `0 0 ${HANDLE}px`,
    cursor: 'col-resize',
    touchAction: 'none',
    position: 'relative',
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: HANDLE / 2 - 1,
      width: 2,
      background: theme.colors.border.weak,
    },
    '&:hover::after, &:focus-visible::after': { background: theme.colors.primary.border },
    '&:focus-visible': { outline: 'none' },
  }),
});
