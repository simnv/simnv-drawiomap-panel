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

export const PANES_STORAGE_KEY = 'dmap.splitEditor.panes';

/** Below this width of the popup the three panes become the tabs Code, Diagram and Report. */
export const TABS_BELOW = 1000;
export type PopupTab = 'code' | 'stage' | 'report';
const TABS: Array<{ id: PopupTab; label: string }> = [
  { id: 'code', label: 'Code' },
  { id: 'stage', label: 'Diagram' },
  { id: 'report', label: 'Report' },
];

/** `code` is the width of the code box, `below` the height of the report pane. */
type Pane = 'code' | 'below';
const LIMITS = {
  code: { initial: 480, min: 280, max: 960 },
  below: { initial: 240, min: 120, max: 640 },
};
/** The diagram keeps at least this width when the code box grows. */
const MIN_STAGE = 240;
/** The top row (code box and diagram) keeps at least this height when the report pane grows. */
const MIN_TOP = 200;
/** Width of a handle in px. */
const HANDLE = 8;
const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

interface Sizes {
  code: number;
  below: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function readSizes(): Sizes {
  const sizes = { code: LIMITS.code.initial, below: LIMITS.below.initial };
  try {
    const stored = JSON.parse(window.localStorage.getItem(PANES_STORAGE_KEY) ?? 'null');
    for (const pane of ['code', 'below'] as const) {
      if (typeof stored?.[pane] === 'number' && Number.isFinite(stored[pane])) {
        sizes[pane] = clamp(stored[pane], LIMITS[pane].min, LIMITS[pane].max);
      }
    }
  } catch {
    // Private mode or a broken value: use the defaults.
  }
  return sizes;
}

function writeSizes(sizes: Sizes) {
  try {
    window.localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // The storage is full or blocked: the sizes last until the popup closes.
  }
}

/** The room of a pane in a container of this width and height: the diagram and the top row keep their minimum. */
const roomFor = (pane: Pane, width: number, height: number) =>
  pane === 'code' ? width - HANDLE - MIN_STAGE : height - HANDLE - MIN_TOP;

/**
 * The sizes that fit the container. A stored size can be larger than a smaller dialog: the pane shrinks, so that the
 * diagram and the top row keep their minimum. The stored sizes stay as the user set them. A size of 0 is not measured.
 */
export function fitSizes(sizes: Sizes, width: number, height: number): Sizes {
  const fit = (pane: Pane, measured: number) =>
    measured ? Math.min(sizes[pane], Math.max(roomFor(pane, width, height), 0)) : sizes[pane];
  const next = { code: fit('code', width), below: fit('below', height) };
  return next.code === sizes.code && next.below === sizes.below ? sizes : next;
}

export interface PopupLayoutProps {
  /** The YAML code box: left. */
  code: ReactNode;
  /** The live diagram: right. */
  stage: ReactNode;
  /** The match report and the inspector: below. */
  below: ReactNode;
  /** The visible pane in tab mode. Without it the layout keeps its own choice. */
  activeTab?: PopupTab;
  onTabChange?: (tab: PopupTab) => void;
}

/**
 * The split editor (spec 5.1): the code box on the left, the live diagram on the right, the report below. The two
 * handles resize the code box and the report pane. The sizes are pixels and stay in `localStorage`.
 *
 * `useSplitter` of `@grafana/ui` sizes only the second pane of a split. It would resize the code box in the wrong
 * direction, and nested splitters would change the code box when the report changes. So the layout has its own
 * handles.
 */
export function PopupLayout({ code, stage, below, activeTab, onTabChange }: PopupLayoutProps) {
  const styles = useStyles2(getStyles);
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState(readSizes);
  // The size of the container: the restored sizes must fit it at the start and after each resize.
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const measure = () =>
      setBox((old) =>
        old.width === el.clientWidth && old.height === el.clientHeight
          ? old
          : { width: el.clientWidth, height: el.clientHeight }
      );
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const shown = useMemo(() => fitSizes(sizes, box.width, box.height), [sizes, box]);
  const tabs = box.width > 0 && box.width < TABS_BELOW;
  const [ownTab, setOwnTab] = useState<PopupTab>('code');
  const tab = activeTab ?? ownTab;
  const changeTab = (next: PopupTab) => {
    setOwnTab(next);
    onTabChange?.(next);
  };
  // The ARIA tabs pattern: only the active tab is a tab stop (the `Tab` component sets no tabindex of its own), and the
  // arrow keys, Home and End move the focus and the selection together.
  const tabsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    for (const el of tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []) {
      el.tabIndex = el.id === `dmap-popup-tab-${tab}` ? 0 : -1;
    }
  }, [tab, tabs]);
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex(({ id }) => `dmap-popup-tab-${id}` === (event.target as HTMLElement).id);
    const next =
      at < 0
        ? undefined
        : event.key === 'ArrowRight'
          ? (at + 1) % TABS.length
          : event.key === 'ArrowLeft'
            ? (at + TABS.length - 1) % TABS.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? TABS.length - 1
                : undefined;
    if (next !== undefined) {
      event.preventDefault();
      changeTab(TABS[next].id);
      tabsRef.current?.querySelector<HTMLElement>(`#dmap-popup-tab-${TABS[next].id}`)?.focus();
    }
  };
  const shownRef = useRef(shown);
  useLayoutEffect(() => {
    shownRef.current = shown;
  });
  const latest = useRef(sizes);
  /** The largest size of a pane: the container keeps the minimum of the diagram and of the top row. */
  const maxFor = useCallback((pane: Pane) => {
    const el = containerRef.current;
    const room = el ? roomFor(pane, el.clientWidth, el.clientHeight) : 0;
    const limit = LIMITS[pane];
    return room > 0 ? Math.max(limit.min, Math.min(limit.max, room)) : limit.max;
  }, []);
  const resize = useCallback((pane: Pane, size: number) => {
    // The base is what the user sees (the fitted sizes), not the stored ones: a resize stores the displayed sizes.
    const next = { ...shownRef.current, [pane]: clamp(size, LIMITS[pane].min, LIMITS[pane].max) };
    latest.current = next;
    shownRef.current = next;
    setSizes(next);
  }, []);
  const commit = useCallback(() => writeSizes(latest.current), []);

  // The three panes stay mounted in both modes: the stage index and the code box keep their state. A hidden pane has
  // `display: none`. The slots keep their place, so a mode change does not remount a pane.
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
        <div ref={tabsRef} className={styles.tabs} onKeyDown={onTabKeyDown}>
          <TabsBar>
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
        </div>
      )}
      <div ref={containerRef} className={styles.container}>
        <div className={cx(styles.top, tabs && styles.tabPane)} hidden={tabs && tab === 'report'}>
          <div
            className={cx(styles.pane, styles.code, tabs && styles.tabPane)}
            style={tabs ? undefined : { flexBasis: shown.code }}
            data-testid="dmap-pane-code"
            data-pane-size={shown.code}
            {...paneProps('code')}
          >
            {code}
          </div>
          {!tabs && <Handle pane="code" value={shown.code} maxFor={maxFor} resize={resize} commit={commit} />}
          <div
            className={cx(styles.pane, styles.stage, tabs && styles.tabPane)}
            data-testid="dmap-pane-stage"
            {...paneProps('stage')}
          >
            {stage}
          </div>
        </div>
        {!tabs && <Handle pane="below" value={shown.below} maxFor={maxFor} resize={resize} commit={commit} />}
        <div
          className={cx(styles.pane, styles.below, tabs && styles.tabPane)}
          style={tabs ? undefined : { flexBasis: shown.below }}
          data-testid="dmap-pane-report"
          data-pane-size={shown.below}
          {...paneProps('report')}
        >
          {below}
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

/**
 * A separator. The handle of the code box is vertical: a drag to the right grows the code box. The handle of the
 * report is horizontal: a drag up grows the report.
 */
function Handle({ pane, value, maxFor, resize, commit }: HandleProps) {
  const styles = useStyles2(getStyles);
  const drag = useRef<{ at: number; size: number; max: number }>();
  const limit = LIMITS[pane];
  const vertical = pane === 'code';
  const sign = vertical ? 1 : -1;
  const at = (e: PointerEvent<HTMLDivElement>) => (vertical ? e.clientX : e.clientY);
  const [less, more] = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowDown', 'ArrowUp'];
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={vertical ? 'Resize code pane' : 'Resize report pane'}
      aria-valuemin={limit.min}
      aria-valuemax={limit.max}
      aria-valuenow={value}
      tabIndex={0}
      className={cx(styles.handle, vertical ? styles.vertical : styles.horizontal)}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        drag.current = { at: at(e), size: value, max: maxFor(pane) };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (start) {
          resize(pane, Math.min(start.max, start.size + sign * (at(e) - start.at)));
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
        if (e.key === less || e.key === more) {
          e.preventDefault();
          resize(pane, Math.min(maxFor(pane), value + (e.key === more ? 1 : -1) * step));
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
    flexDirection: 'column',
    width: '100%',
    minHeight: 0,
    overflow: 'hidden',
  }),
  top: css({ flex: '1 1 0', display: 'flex', flexDirection: 'row', minHeight: 0, minWidth: 0 }),
  // Tab mode: the visible pane takes the whole size. `hidden` is display none (the stylesheet default) unless a class
  // sets display, so the class must not set it for a hidden pane.
  tabPane: css({ flex: '1 1 auto', width: '100%', maxWidth: 'none', '&[hidden]': { display: 'none' } }),
  pane: css({ display: 'flex', flexDirection: 'column', position: 'relative', minHeight: 0 }),
  // min-width 0: the content of the code box must not widen it beyond its size.
  code: css({ flexGrow: 0, flexShrink: 0, minWidth: 0 }),
  stage: css({ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }),
  below: css({ flexGrow: 0, flexShrink: 0, minHeight: 0, overflow: 'auto' }),
  handle: css({
    flex: `0 0 ${HANDLE}px`,
    touchAction: 'none',
    position: 'relative',
    '&::after': {
      content: '""',
      position: 'absolute',
      background: theme.colors.border.weak,
    },
    '&:hover::after, &:focus-visible::after': { background: theme.colors.primary.border },
    '&:focus-visible': { outline: 'none' },
  }),
  vertical: css({
    cursor: 'col-resize',
    '&::after': { top: 0, bottom: 0, left: HANDLE / 2 - 1, width: 2 },
  }),
  horizontal: css({
    cursor: 'row-resize',
    '&::after': { left: 0, right: 0, top: HANDLE / 2 - 1, height: 2 },
  }),
});
