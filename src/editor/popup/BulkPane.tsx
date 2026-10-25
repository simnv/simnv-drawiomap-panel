import React, { useMemo } from 'react';
import { Button } from '@grafana/ui';
import { pathRelated, type BindingPlan } from '../../binding/patterns';
import type { DiagramConfig, DisplayConfig } from '../../model/config';
import { DisplayFields } from '../BindingFields';
import type { DraftAction } from '../draft';
import { EditorSection, type FieldSourceView } from '../EditorLayout';
import { resetPathOf } from '../fieldSource';
import { diffLeaves, getLeaf, leafPaths, setLeaf, UNIT_PATHS } from '../leafPaths';

const MIXED_NOTE = 'Mixed, edit per element';

/** The paths that are one unit in a bulk edit: every array leaf (leafPaths) and a health rule. */
const units: readonly string[] = UNIT_PATHS;
const BINDING_PATHS = UNIT_PATHS.filter(
  (path) => path.endsWith('Binding') || path.endsWith('.binding')
) as readonly string[];

/**
 * The display leaves that the cells share and the leaves where they differ, over the effective displays (patterns and
 * overrides merged). A leaf is common when every cell has it with the same value. A leaf that only some cells have is
 * mixed. `hover.rows`, every other array and the health rule `status` count as one leaf each, so they are common only
 * when they are deep-equal in all cells.
 */
export function commonLeaves(
  cellIds: string[],
  plan: Pick<BindingPlan, 'cells'>
): { common: Partial<DisplayConfig>; mixedPaths: string[] } {
  const displays = cellIds.map((id) => plan.cells[id]?.display ?? {});
  const paths = Array.from(new Set(displays.flatMap((display) => leafPaths(display, units))));
  let common: Partial<DisplayConfig> = {};
  const mixedPaths: string[] = [];
  for (const path of paths) {
    // The merge gives a cell with a hover owner an empty rows list: it means the same as no rows.
    const values = displays.map((display) => {
      const value = getLeaf(display, path);
      return path === 'hover.rows' && Array.isArray(value) && value.length === 0 ? undefined : value;
    });
    if (values.every((value) => value === undefined)) {
      continue;
    }
    const first = JSON.stringify(values[0]);
    if (values[0] !== undefined && values.every((value) => JSON.stringify(value) === first)) {
      common = setLeaf(common, path, values[0]);
    } else {
      mixedPaths.push(path);
    }
  }
  return { common, mixedPaths };
}

export interface BulkPaneProps {
  /** The selected cells; at least two. */
  cellIds: string[];
  plan: BindingPlan;
  config: DiagramConfig;
  /** Field names of the panel data, for the binding fields. */
  fields: string[];
  dispatch: (action: DraftAction) => void;
}

/**
 * Edit the display of several cells at once. The fields show the values that the cells share; a field where they
 * differ shows the chip "Mixed". A change turns into leaf operations (`display-many`): it sets those leaves in the
 * override of every selected cell and touches nothing else, so inherited and unrelated fields survive.
 */
export function BulkPane({ cellIds, plan, config, fields, dispatch }: BulkPaneProps) {
  const { common, mixedPaths } = useMemo(() => commonLeaves(cellIds, plan), [cellIds, plan]);
  const isMixed = (path: string) => mixedPaths.some((mixed) => pathRelated(mixed, path) || pathRelated(path, mixed));
  // A mixed field offers a clear button: it removes the field from the override of every selected element. An untouched
  // mixed value changes nothing; only this button, or a typed value, writes.
  const sourceOf = (path: string): FieldSourceView | undefined =>
    isMixed(path) ? { owner: 'mixed', resettable: true, resetPath: resetPathOf(path), scope: 'element' } : undefined;
  const mixedBindings = mixedPaths.filter((path) => BINDING_PATHS.includes(path));
  const locked = {
    hover: mixedPaths.includes('hover.rows') ? MIXED_NOTE : undefined,
    status: mixedPaths.some((path) => path === 'status') ? MIXED_NOTE : undefined,
  };
  const overridden = cellIds.filter((id) => config.overrides.some((o) => o?.cellId === id));

  const change = (partial: Partial<DisplayConfig>) => {
    const next = { ...common, ...partial } as Partial<DisplayConfig>;
    // The editor reads an empty rows list for a section without rows and writes it back: that is no change.
    const ops = diffLeaves(common, next).filter(
      (op) => !(Array.isArray(op.value) && op.value.length === 0 && getLeaf(common, op.path) === undefined)
    );
    if (ops.length) {
      dispatch({ type: 'display-many', cellIds, ops });
    }
  };

  return (
    <EditorSection title="Bulk edit" defaultOpen>
      <section aria-label="Bulk edit">
        <p>
          A change writes that field to the override of each of the {cellIds.length} selected elements. Other fields of
          the elements stay as they are. {mixedPaths.length > 0 && 'A field marked Mixed has different values.'}
        </p>
        <DisplayFields
          value={common as DisplayConfig}
          queries={config.queries}
          fields={fields}
          sourceOf={sourceOf}
          onReset={(path) => dispatch({ type: 'display-many', cellIds, ops: [{ path, value: undefined }] })}
          mixedBindings={mixedBindings}
          locked={locked}
          onChange={change}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={overridden.length === 0}
          onClick={() =>
            dispatch({ type: 'batch', actions: overridden.map((cellId) => ({ type: 'remove-override', cellId })) })
          }
        >
          Remove overrides of the selection
        </Button>
      </section>
    </EditorSection>
  );
}
