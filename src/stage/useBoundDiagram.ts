import { useMemo } from 'react';
import type { PanelData } from '@grafana/data';
import { bindV4, statusViewOf, type BindResultV4, type PatchV4 } from '../binding/bindV4';
import type { CardContextV4 } from '../interact/cardModel';
import { validateConfig } from '../model/validate';
import type { BindContext, CellIndex } from '../types';
import { useStaleStatusV4 } from '../visuals/useSampleStale';

export interface BoundDiagramInputs {
  index: CellIndex;
  /** the draw.io XML of the diagram: the ends of an ordinary edge come from it (spec 3.8.1) */
  xml: string | undefined;
  /** `Options.config`, as saved */
  config: unknown;
  data: PanelData;
  bindContext: BindContext;
}

export interface BoundDiagram {
  validated: ReturnType<typeof validateConfig>;
  /** The bind. It takes no clock: the report reads it, because no report entry holds a stale state. */
  bound: BindResultV4;
  /** The patches at the current clock: a status after its deadline is stale (spec 3.5). */
  patches: Map<string, PatchV4>;
  /** The inputs of the cards and the chart regions. */
  cardContext: CardContextV4;
}

/**
 * The v4 bind pipeline of the panel (spec 3.2): the validation of the config, the bind of the panel data and the
 * stale pass at the clock. A tick of the clock runs the stale pass over the patches, never the bind. The painter, the
 * band and the legend read `statusView`, so it follows the stale status.
 */
export function useBoundDiagram(inputs: BoundDiagramInputs): BoundDiagram {
  const { index, xml, config, data, bindContext } = inputs;
  const validated = useMemo(() => validateConfig(config), [config]);
  const bound = useMemo(
    () => bindV4({ index, xml, validated, data, ctx: bindContext }),
    [index, xml, validated, data, bindContext]
  );
  // the stale pass keeps each patch, or gives a copy with the stale status: the rows of the patch stay
  const stale = useStaleStatusV4(bound.patches) as Map<string, PatchV4>;
  const patches = useMemo(() => {
    if (stale === bound.patches) {
      return bound.patches;
    }
    const shown = new Map(stale);
    for (const [id, patch] of stale) {
      if (patch !== bound.patches.get(id) && patch.statusV4) {
        shown.set(id, { ...patch, statusView: statusViewOf(patch.statusV4) });
      }
    }
    return shown;
  }, [stale, bound.patches]);
  const { theme, replaceVariables, fieldThresholds } = bindContext;
  const cardContext = useMemo(
    (): CardContextV4 => ({ theme, replaceVariables, fieldThresholds, index, validated, data }),
    [theme, replaceVariables, fieldThresholds, index, validated, data]
  );
  return { validated, bound, patches, cardContext };
}

export { reportLine } from './reportView';
