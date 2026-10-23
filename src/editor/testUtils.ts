import 'intersection-observer';
import { fireEvent, screen } from '@testing-library/react';

type Queries = Pick<typeof screen, 'getByRole' | 'queryByRole' | 'getByLabelText'>;

/**
 * The button with this accessible name, found by its aria-label or its text. getByRole computes the accessible name of
 * every button, and in jsdom that cost dominates a test that clicks often. Only the one exact match is trusted; any
 * other result goes to the full query, which reports the problem as before.
 */
export function buttonNamed(name: string, queries: Queries = screen): HTMLElement {
  if (queries === screen) {
    const found = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
      (el) => (el.getAttribute('aria-label') ?? el.textContent?.trim()) === name
    );
    if (found.length === 1) {
      return found[0] as HTMLElement;
    }
  }
  return queries.getByRole('button', { name });
}

function hasButton(name: string, queries: Queries): boolean {
  if (queries === screen) {
    const fast = Array.from(document.querySelectorAll('button, [role="button"]')).some(
      (el) => (el.getAttribute('aria-label') ?? el.textContent?.trim()) === name
    );
    if (fast) {
      return true;
    }
  }
  return !!queries.queryByRole('button', { name, hidden: true });
}

export function openSection(title: string, queries: Queries = screen) {
  const toggle = buttonNamed(title, queries);
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
  if (section && hasButton(section, queries)) {
    openSection(section, queries);
  }
  if (label === 'Native target JSON') {
    if (hasButton('Named queries', queries)) {
      openSection('Named queries', queries);
    }
    openSection('Import native target JSON', queries);
  }
  if (label === 'Affected binding preview') {
    openSection('Pattern match details', queries);
  }
  // getByLabelText asks every element for its labels, and jsdom answers each ask with a walk of the whole document.
  // The fields have an aria-label, so one attribute selector finds them at a fraction of the cost. Zero or several
  // matches fall back to the full query, which reports the problem as before.
  if (queries === screen) {
    const found = Array.from(document.querySelectorAll('[aria-label]')).filter(
      (el) => el.getAttribute('aria-label') === label
    );
    if (found.length === 1) {
      return found[0] as HTMLElement;
    }
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
