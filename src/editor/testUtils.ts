import 'intersection-observer';
import { fireEvent, screen } from '@testing-library/react';

type Queries = Pick<typeof screen, 'getByRole' | 'queryByRole' | 'getByLabelText'>;

export function openSection(title: string, queries: Queries = screen) {
  const toggle = queries.getByRole('button', { name: title });
  if (toggle.getAttribute('aria-expanded') === 'false') {
    fireEvent.click(toggle);
  }
}

/** Open the section a user needs before addressing its labelled control. */
export function editorField(label: string, queries: Queries = screen) {
  const section = /^Shape |^Enable shape/.test(label)
    ? 'Shape'
    : /^(A to B|B to A|Capacity|Link |Enable link)/.test(label)
      ? 'Link'
      : /^(Health|Default health|Enable health|Check sample|Expected sample|Stale after)/.test(label)
        ? 'Explicit health status'
        : /^Hover row|^Enable hover/.test(label)
          ? 'Hover rows'
          : /^(Pattern document|Exported pattern|queries .* conflict)/.test(label)
            ? 'Portable patterns'
            : /^(Query name|Named query|Default datasource|Datasource override|Panel refId)/.test(label)
              ? 'Named queries'
              : undefined;
  if (section && queries.queryByRole('button', { name: section })) {
    openSection(section, queries);
  }
  if (label === 'Native target JSON') {
    if (queries.queryByRole('button', { name: 'Named queries' })) {
      openSection('Named queries', queries);
    }
    openSection('Import native target JSON', queries);
  }
  if (label === 'Affected binding preview') {
    openSection('Pattern match details', queries);
  }
  return queries.getByLabelText(label, { exact: true });
}

export function chooseOption(label: string, option: string, queries: Queries = screen) {
  const input = editorField(label, queries);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name: option }));
}

/** Click a cell in the stage of the bindings popup, as a user does. */
export function selectStageCell(id: string, scope: { getByTestId: typeof screen.getByTestId } = screen) {
  const stage = scope.getByTestId('dmap-popup-stage');
  const group = stage.querySelector(`[data-cell-id="${id}"]`);
  if (!group) {
    throw new Error(`Cell ${id} is not in the popup stage.`);
  }
  fireEvent.click(group.querySelector('rect, path, text, image, ellipse') ?? group);
}

/** Open the query pane of a row of the list. */
export function openQueryRow(name: string, queries: Pick<typeof screen, 'getByRole'> = screen) {
  fireEvent.click(queries.getByRole('button', { name: `Edit query ${name}` }));
}

/** Type into the filter of the list pane. */
export function filterBindings(text: string, queries: Pick<typeof screen, 'getByRole'> = screen) {
  fireEvent.change(queries.getByRole('textbox', { name: 'Filter bindings' }), { target: { value: text } });
}
