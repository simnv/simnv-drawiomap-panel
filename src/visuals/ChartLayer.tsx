import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme2 } from '@grafana/ui';
import type { BindingPlan } from '../binding/patterns';
import { resolveBinding } from '../binding/engine';
import { resolveTemplate } from '../binding/template';
import { isAllowedUrl } from '../binding/url';
import type { NamedQuery } from '../model/config';
import type { QueryContext, QueryController, QuerySnapshot } from '../query/types';
import { readChartAnchor, type ChartAnchor } from '../render/geometry';
import type { CellIndex } from '../types';
import { SparklineView } from './SparklineView';
import { BarGaugeView } from './BarGaugeView';
import type { PanelData } from '@grafana/data';
import { previewSnapshot, type QueryPreview } from '../editor/preview';

export interface ChartLayerProps {
  root?: SVGSVGElement;
  cells: CellIndex;
  plan: BindingPlan;
  queries: NamedQuery[];
  controller?: QueryController;
  context: QueryContext;
  viewport: HTMLElement | null;
  revision?: unknown;
  replaceVariables?: (value: string) => string;
  draft?: {
    plan: BindingPlan;
    queries: NamedQuery[];
    defaultDatasource?: QueryContext['defaultDatasource'];
    data: PanelData;
    preview?: QueryPreview;
    active?: QueryPreview[];
  };
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
  presentation,
  monitorOnly = false,
  draftOnly = false,
  ...props
}: ChartLayerProps & {
  entry: BindingPlan['widgets'][number];
  presentation?: BindingPlan['widgets'][number];
  monitorOnly?: boolean;
  draftOnly?: boolean;
  onPrepared?: (id: string, preview?: QueryPreview) => void;
}) {
  const { root, cells, viewport, context, controller, queries, revision, replaceVariables, draft, onPrepared } = props;
  const { widget, scope } = presentation ?? entry;
  const cell = cells.get(entry.anchorCellId);
  const theme = useTheme2();
  const updateRef = useRef<() => void>();
  const [portal, setPortal] = useState<SVGForeignObjectElement>();
  const [geometry, setGeometry] = useState<{ anchor: ChartAnchor; visible: boolean; resolution: number }>();
  const [response, setResponse] = useState<{ key: string; snapshot: QuerySnapshot }>();
  const query = queries.find((q) => q.id === entry.widget.binding.queryId);
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
    if (!monitorOnly) {
      shape.after(region);
    }
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
  }, [root, cell, viewport, widget.id, monitorOnly]);

  useLayoutEffect(() => {
    updateRef.current?.();
  }, [revision]);

  useEffect(() => {
    if (draftOnly || !geometry?.visible || !controller || !query) {
      return;
    }
    let current = true;
    const release = controller.watch(
      {
        consumerId: `widget:${entry.widget.id}`,
        query,
        scope: entry.scope,
        context,
        maxDataPoints: geometry.resolution,
      },
      (snapshot) => {
        if (current) {
          setResponse({ key, snapshot });
          onPrepared?.(entry.widget.id, { query, cellId: entry.anchorCellId, context, snapshot });
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
    draftOnly,
    onPrepared,
  ]);

  if (monitorOnly) {
    return null;
  }
  if (!geometry) {
    return (
      <span role="status" data-dmap-widget-error={widget.id}>
        {widget.label} needs a rectangle with a valid transform.
      </span>
    );
  }
  if (!portal || !geometry || !geometry.visible) {
    return null;
  }
  const { width, height } = geometry.anchor;
  let snapshot: QuerySnapshot = !query
    ? { state: 'error', message: 'Choose a named query.' }
    : response?.key === key
      ? response.snapshot
      : { state: 'loading' };
  if (draft) {
    const shownQuery = draft.queries.find((q) => q.id === widget.binding.queryId);
    const compatible =
      !draftOnly &&
      shownQuery &&
      JSON.stringify(shownQuery) === JSON.stringify(query) &&
      JSON.stringify(draft.defaultDatasource) === JSON.stringify(context.defaultDatasource);
    const savedResult: QueryPreview[] =
      compatible && query ? [{ query, cellId: entry.anchorCellId, context, snapshot }] : [];
    snapshot = shownQuery
      ? previewSnapshot(
          shownQuery,
          draft,
          draft.data,
          widget.anchorCellId,
          draft.preview,
          [...savedResult, ...(draft.active ?? [])],
          context.generation
        )
      : { state: 'unsupported', message: 'Choose a named query.' };
    if (snapshot.state === 'idle') {
      snapshot = { state: 'unsupported', message: 'Preview query or Apply to load this draft chart.' };
    }
  }
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
            field={{ ...model.field.config, min: widget.min, max: widget.max }}
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
  const [prepared, setPrepared] = useState<Record<string, QueryPreview>>({});
  const onPrepared = useCallback((id: string, preview?: QueryPreview) => {
    setPrepared((old) => {
      const next = { ...old };
      if (preview) {
        next[id] = preview;
      } else {
        delete next[id];
      }
      return next;
    });
  }, []);
  const draft = props.draft
    ? { ...props.draft, active: [...Object.values(prepared), ...(props.draft.active ?? [])] }
    : undefined;
  const shown = props.draft?.plan.widgets;
  return (
    <>
      {props.plan.widgets.map((entry) => (
        <Region
          key={entry.widget.id}
          {...props}
          draft={draft}
          entry={entry}
          onPrepared={onPrepared}
          presentation={shown?.find(
            (next) => next.widget.id === entry.widget.id && next.anchorCellId === entry.anchorCellId
          )}
          monitorOnly={
            !!shown &&
            !shown.some((next) => next.widget.id === entry.widget.id && next.anchorCellId === entry.anchorCellId)
          }
        />
      ))}
      {shown
        ?.filter(
          (entry) =>
            !props.plan.widgets.some(
              (saved) => saved.widget.id === entry.widget.id && saved.anchorCellId === entry.anchorCellId
            )
        )
        .map((entry) => (
          <Region key={`draft:${entry.widget.id}`} {...props} draft={draft} entry={entry} draftOnly />
        ))}
    </>
  );
}
