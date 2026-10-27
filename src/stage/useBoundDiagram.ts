import { useMemo } from 'react';
import type { PanelData } from '@grafana/data';
import { cardContextFor } from '../binding/context';
import { bindPlan, type BindingResolver, type PlanBindResult } from '../binding/engine';
import { resolvePatterns, type BindingPlan } from '../binding/patterns';
import { demandMap, demandsOf, resolverFrom } from '../binding/resolve';
import type { DiagramConfig } from '../model/config';
import type { HistoryFormat } from '../query/frames';
import type { PanelQueryService } from '../query/panel';
import type { StoreDemand } from '../query/store';
import { useBindings } from '../query/useBindings';
import type { BindContext, CardContext, CellMeta } from '../types';
import { useStaleStatus } from '../visuals/useSampleStale';

/**
 * The store groups of the demands. With `card`, the rows of the open card are a group of their own: a new open cell
 * changes the card resolver only, and the resolver of the diagram and the bind do not run again (the panel). Without
 * `card`, the hover rows join the `visible` group, and the resolver reads the frame of every group of the owner: the
 * popup stage adds its widget groups there, so a widget binding resolves at its anchor cell (the popup).
 */
export interface BindGroups {
  visible: string;
  card?: string;
}

export interface BoundDiagramInputs {
  metas: CellMeta[];
  config: DiagramConfig;
  service: PanelQueryService | undefined;
  /** The namespace of the query consumers, for example `panel:3` or `popup:3`. */
  owner: string;
  groups: BindGroups;
  maxDataPoints: number;
  data: PanelData;
  bindContext: BindContext;
  /** A memo of the caller. */
  format: HistoryFormat;
  /** The cell of the open card: the rows of its card join the demands. */
  openCellId: string | undefined;
  /** While paused the store frames are held: an emission renders nothing. */
  paused: boolean;
  /** A resolver layer over the saved one, for example the editor preview. A memo of the caller. */
  override?: (saved: BindingResolver, plan: BindingPlan) => BindingResolver;
}

export interface BoundDiagram {
  plan: BindingPlan;
  /** The resolver of the diagram. */
  resolve: BindingResolver;
  /** The resolver of the open card. */
  cardResolve: BindingResolver;
  /** The bind. It takes no clock: the diagnostics read it, because no diagnostic holds a stale state. */
  bound: PlanBindResult;
  /** The bind at the current clock: the patches to paint and the summaries to show. */
  shown: PlanBindResult;
  cardContext: CardContext;
}

const NO_DEMANDS: StoreDemand[] = [];

/**
 * The bind pipeline of the panel and of the popup: the plan, the demands of each role, the store frames, the
 * resolvers, the bind and the bind at the current clock. The two callers share the code, not the state: each has its
 * own owner in the store. The pause inputs stay with the caller.
 */
export function useBoundDiagram(inputs: BoundDiagramInputs): BoundDiagram {
  const { metas, config, service, owner, groups, maxDataPoints, data, bindContext, format, openCellId, paused } =
    inputs;
  const { override } = inputs;
  const split = groups.card !== undefined;
  const plan = useMemo(() => resolvePatterns(metas, config), [metas, config]);
  const context = service?.context;
  const visibleDemands = useMemo(
    () => demandsOf(plan, context, maxDataPoints, 'visible'),
    [plan, context, maxDataPoints]
  );
  const hoverDemands = useMemo(
    () => demandsOf(plan, context, maxDataPoints, 'hover', openCellId),
    [plan, context, maxDataPoints, openCellId]
  );
  // Only the frame of the whole owner holds the widget groups of the popup stage.
  const widgetDemands = useMemo(
    () => (split ? NO_DEMANDS : demandsOf(plan, context, maxDataPoints, 'widget')),
    [split, plan, context, maxDataPoints]
  );
  // With a card group, the visible group keeps its array when the open cell changes: the store sees no change.
  const ownDemands = useMemo(
    () => (split ? visibleDemands : [...visibleDemands, ...hoverDemands]),
    [split, visibleDemands, hoverDemands]
  );
  const frame = useBindings(service, owner, groups.visible, ownDemands, paused, split ? 'group' : 'owner');
  // Without a card group this reader has no store: it watches nothing and reads the empty frame.
  const cardFrame = useBindings(
    split ? service : undefined,
    owner,
    groups.card ?? '',
    split ? hoverDemands : NO_DEMANDS,
    paused
  );
  const identities = useMemo(() => demandMap(ownDemands, widgetDemands), [ownDemands, widgetDemands]);
  const saved = useMemo(
    () => resolverFrom([frame], identities, plan, data, format),
    [frame, identities, plan, data, format]
  );
  const resolve = useMemo(() => (override ? override(saved, plan) : saved), [override, saved, plan]);
  // The card reads its own entries first, then the visible ones: a row that reads the query of the link has its data
  // on the first render, before the card group watches.
  const cardMap = useMemo(
    () => (split ? demandMap(hoverDemands, visibleDemands) : identities),
    [split, hoverDemands, visibleDemands, identities]
  );
  const cardResolve = useMemo(() => {
    if (!split || !hoverDemands.length) {
      return resolve;
    }
    const card = resolverFrom([cardFrame, frame], cardMap, plan, data, format);
    return override ? override(card, plan) : card;
  }, [split, hoverDemands.length, resolve, cardFrame, frame, cardMap, plan, data, format, override]);
  // The bind takes no clock: a tick of the freshness clock runs the pass over the patches, never the bind.
  const bound = useMemo(() => bindPlan(plan, resolve, bindContext), [plan, resolve, bindContext]);
  const shown = useStaleStatus(bound);
  const { theme, replaceVariables, fieldThresholds } = bindContext;
  const cardContext = useMemo(
    () => cardContextFor({ theme, replaceVariables, fieldThresholds }),
    [theme, replaceVariables, fieldThresholds]
  );
  return { plan, resolve, cardResolve, bound, shown, cardContext };
}
