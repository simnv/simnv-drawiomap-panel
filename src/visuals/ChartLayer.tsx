import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme2 } from '@grafana/ui';
import type { BindingPlan } from '../binding/patterns';
import { resolveBinding } from '../binding/engine';
import { resolveTemplate } from '../binding/template';
import { isAllowedUrl } from '../binding/url';
import type { NamedQuery } from '../model/config';
import { settled, type QueryContext, type QueryController, type QuerySnapshot } from '../query/types';
import { readChartAnchor, type ChartAnchor } from '../render/geometry';
import type { CellIndex } from '../types';
import { SparklineView } from './SparklineView';
import { BarGaugeView } from './BarGaugeView';
import type { QueryPreview } from '../editor/preview';
import { useHeld } from '../components/useHeld';

export interface ChartLayerProps {
  root?: SVGSVGElement;
  cells: CellIndex;
  plan: BindingPlan;
  queries: NamedQuery[];
  controller?: QueryController;
  context: QueryContext;
  viewport: HTMLElement | null;
  revision?: unknown;
  /** Namespace of the consumer ids, for example `panel:3` or `popup:3`. */
  owner: string;
  replaceVariables?: (value: string) => string;
  onPrepared?: (id: string, preview?: QueryPreview) => void;
  /**
   * The popup is open over the panel: show the last result and publish nothing. The watches stay open; the latest
   * result shows and publishes after the pause.
   */
  paused?: boolean;
}

/** Check the painted element against the panel and every clipping ancestor. */
function displayed(shape: SVGGraphicsElement, viewport: HTMLElement): boolean {
  if (!shape.isConnected || document.visibilityState === 'hidden') {
    return false;
  }
  const rect = shape.getBoundingClientRect();
  let left = Math.max(0, rect.left),
    top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right),
    bottom = Math.min(window.innerHeight, rect.bottom);
  for (let node: Element | null = shape; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.opacity === '0'
    ) {
      return false;
    }
    if (
      node === viewport ||
      /(hidden|clip|auto|scroll)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)
    ) {
      const clip = node.getBoundingClientRect();
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
  }
  return right > left && bottom > top;
}

function Region({
  entry,
  ...props
}: ChartLayerProps & {
  entry: BindingPlan['widgets'][number];
}) {
  const { root, cells, viewport, context, controller, queries, revision, replaceVariables, onPrepared, owner } = props;
  const paused = !!props.paused;
  const { widget, scope } = entry;
  const cell = cells.get(entry.anchorCellId);
  const theme = useTheme2();
  const updateRef = useRef<() => void>();
  const [portal, setPortal] = useState<SVGForeignObjectElement>();
  const [geometry, setGeometry] = useState<{ anchor: ChartAnchor; visible: boolean; resolution: number }>();
  const [response, setResponse] = useState<{ key: string; match: string; preview: QueryPreview }>();
  /** The last result that is not loading, for the same query, scope and default datasource. */
  const last = useRef<{ match: string; preview: QueryPreview }>();
  const shown = useHeld(response, paused);
  // The watch callback reads the flag when it runs. A change of the flag must not restart the watch.
  const pending = useRef<{ key: string; match: string; preview: QueryPreview }>();
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const query = queries.find((q) => q.id === entry.widget.binding.queryId);
  const match = JSON.stringify([query, entry.scope, context.defaultDatasource]);
  const key = JSON.stringify([query, entry.scope, context, geometry?.resolution]);

  useLayoutEffect(() => {
    const shape = cell?.shape;
    const parent = shape?.parentElement as unknown as SVGGraphicsElement;
    if (!root || !cell || !shape || !parent || !viewport) {
      return;
    }
    const region = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    let intersecting = typeof IntersectionObserver === 'undefined';
    region.setAttribute('data-dmap-widget', widget.id);
    region.style.overflow = 'hidden';
    region.style.pointerEvents = 'none';
    shape.after(region);
    // The portal target belongs to the external SVG DOM and exists only after attachment.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortal(region);
    const update = () => {
      const anchor = readChartAnchor(cell, parent);
      if (!anchor) {
        setGeometry(undefined);
        return;
      }
      const { matrix: m } = anchor;
      const attrs = {
        x: anchor.x,
        y: anchor.y,
        width: anchor.width,
        height: anchor.height,
        transform: `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`,
      };
      for (const [name, value] of Object.entries(attrs)) {
        if (region.getAttribute(name) !== String(value)) {
          region.setAttribute(name, String(value));
        }
      }
      const next = {
        anchor,
        visible: intersecting && displayed(shape, viewport),
        resolution: Math.max(1, Math.ceil(shape.getBoundingClientRect().width)),
      };
      setGeometry((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    updateRef.current = update;
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      subtree: true,
      attributeFilter: ['viewBox', 'transform', 'style', 'class', 'x', 'y', 'width', 'height', 'display', 'visibility'],
    });
    // Ancestor visibility and panel clipping can change without an SVG mutation.
    for (let node: Element | null = viewport; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    resize?.observe(viewport);
    const intersection =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver((entries) => {
            intersecting = entries.some((entry) => entry.isIntersecting);
            update();
          });
    intersection?.observe(shape);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      resize?.disconnect();
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      updateRef.current = undefined;
      region.remove();
    };
  }, [root, cell, viewport, widget.id]);

  useLayoutEffect(() => {
    updateRef.current?.();
  }, [revision]);

  // After the pause the widget shows, and the parent gets, the latest result that the watch received meanwhile. An
  // emission while paused went to the `pending` ref: no state update, no render.
  useEffect(() => {
    const received = pending.current;
    if (!paused && received) {
      pending.current = undefined;
      setResponse(received);
      if (received.key === key) {
        onPrepared?.(entry.widget.id, received.preview);
      }
    }
    // Only the end of a pause applies the pending result; the watch callback applies every other one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  useEffect(() => {
    // an unavailable widget shows its reason and runs no query
    if (!geometry?.visible || !controller || !query || entry.unavailable) {
      return;
    }
    let current = true;
    const release = controller.watch(
      {
        consumerId: `${owner}:widget:${entry.widget.id}`,
        query,
        scope: entry.scope,
        context,
        maxDataPoints: geometry.resolution,
      },
      (received) => {
        if (current) {
          // A refresh or a resize starts a new request. Until it has a result, show the last result.
          // The kept result keeps its own context: reuse for the new context needs a new result.
          let preview: QueryPreview = { query, cellId: entry.anchorCellId, context, snapshot: received };
          if (settled(received)) {
            last.current = { match, preview };
          } else if (last.current?.match === match) {
            const kept = last.current.preview;
            preview = {
              ...kept,
              kept: true,
              snapshot:
                kept.snapshot.state === 'ready' || kept.snapshot.state === 'empty'
                  ? { ...kept.snapshot, fromCache: true }
                  : kept.snapshot,
            };
          }
          if (pausedRef.current) {
            pending.current = { key, match, preview };
          } else {
            setResponse({ key, match, preview });
            onPrepared?.(entry.widget.id, preview);
          }
        }
      }
    );
    return () => {
      current = false;
      release();
      onPrepared?.(entry.widget.id);
    };
  }, [
    controller,
    query,
    entry.scope,
    entry.widget.id,
    entry.anchorCellId,
    context,
    geometry?.visible,
    geometry?.resolution,
    key,
    match,
    onPrepared,
    owner,
    entry.unavailable,
  ]);

  if (!geometry) {
    return (
      <span role="status" data-dmap-widget-error={widget.id}>
        {widget.label} needs a rectangle with a valid transform.
      </span>
    );
  }
  if (entry.unavailable) {
    // admitted with a reason (an unusable query, an invalid range or freshness): the text instead of the chart
    return portal && geometry.visible
      ? createPortal(
          <div
            data-testid="dmap-widget"
            role="status"
            data-dmap-widget-unavailable={widget.id}
            aria-label={widget.label}
            style={{
              width: geometry.anchor.width,
              height: geometry.anchor.height,
              overflow: 'hidden',
              fontSize: 12,
              fontFamily: theme.typography.fontFamily,
              color: theme.colors.text.secondary,
              background: theme.colors.background.primary,
            }}
          >
            {widget.label}: {entry.unavailable}
          </div>,
          portal
        )
      : null;
  }
  if (!portal || !geometry || !geometry.visible) {
    return null;
  }
  const { width, height } = geometry.anchor;
  // Until the effect watches a new key, show the last result of the same query and scope.
  const snapshot: QuerySnapshot = !query
    ? { state: 'error', message: 'Choose a named query.' }
    : shown && (shown.key === key || (shown.match === match && settled(shown.preview.snapshot)))
      ? shown.preview.snapshot
      : { state: 'loading' };
  const model = resolveBinding(snapshot, widget.binding, scope, {
    theme,
    unit: widget.unit,
    timeZone: context.timeZone,
  });
  const resolvedUrl = widget.url ? resolveTemplate(widget.url, scope, encodeURIComponent) : undefined;
  const href =
    resolvedUrl && !resolvedUrl.unresolved.length
      ? (replaceVariables?.(resolvedUrl.text) ?? resolvedUrl.text)
      : undefined;
  return createPortal(
    <div
      data-testid="dmap-widget"
      aria-label={widget.label}
      style={{
        width,
        height,
        overflow: 'hidden',
        fontSize: 12,
        fontFamily: theme.typography.fontFamily,
        lineHeight: 'normal',
        color: theme.colors.text.primary,
        background: theme.colors.background.primary,
        position: 'relative',
        visibility: geometry.visible ? 'visible' : 'hidden',
      }}
    >
      {widget.kind === 'bar' && model.state === 'ready' && model.latestDisplayValue ? (
        <>
          <div>{widget.label}</div>
          <BarGaugeView
            value={model.latestDisplayValue}
            field={{ ...model.field.config, min: widget.min === 'auto' ? undefined : widget.min, max: widget.max }}
            width={width}
            height={Math.max(1, height - 22)}
            sampleAt={model.sampleAt}
            freshness={widget.freshness}
          />
        </>
      ) : (
        <SparklineView
          model={model}
          width={width}
          height={height}
          label={widget.label}
          timeRange={context.timeRange}
          freshness={widget.freshness}
          min={widget.min}
          max={widget.max}
        />
      )}
      {href && isAllowedUrl(href) ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            pointerEvents: 'auto',
            position: 'absolute',
            top: 0,
            right: 0,
            background: theme.colors.background.primary,
          }}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          Open {widget.label}
        </a>
      ) : null}
    </div>,
    portal
  );
}

export function ChartLayer(props: ChartLayerProps) {
  return (
    <>
      {props.plan.widgets.map((entry) => (
        <Region key={entry.widget.id} {...props} entry={entry} />
      ))}
    </>
  );
}
