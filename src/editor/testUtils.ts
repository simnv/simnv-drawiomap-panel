import 'intersection-observer';
import { fireEvent, screen } from '@testing-library/react';

type Queries = Pick<typeof screen, 'getByRole' | 'queryByRole' | 'getByLabelText'>;

/** True when the element, or an ancestor, is hidden from the user and from the accessibility tree. */
function hidden(el: Element): boolean {
  if (el.closest('[hidden], [aria-hidden="true"], [inert]')) {
    return true;
  }
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const style = (cur as HTMLElement).style;
    if (style?.display === 'none' || style?.visibility === 'hidden') {
      return true;
    }
  }
  return false;
}

/** The text of the elements that an aria-labelledby names. */
function labelledText(el: Element): string {
  return (el.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ')
    .trim();
}

/**
 * The one visible element in `candidates` whose own name is `name`: an aria-label, or the text when `byText` is set.
 * Undefined when the answer is not certain, so the caller takes the full testing-library query: an element with
 * aria-labelledby is never matched on its aria-label, a <label> or an aria-labelledby that gives the same name makes the
 * answer ambiguous, and so does a second visible match.
 */
function uniqueNamed(candidates: Element[], name: string, byText: boolean): HTMLElement | undefined {
  const named = (el: Element) =>
    el.hasAttribute('aria-labelledby')
      ? undefined
      : (el.getAttribute('aria-label') ?? (byText ? el.textContent?.trim() : undefined));
  const found = candidates.filter((el) => named(el) === name && !hidden(el));
  const other =
    Array.from(document.querySelectorAll('[aria-labelledby]')).some((el) => labelledText(el) === name) ||
    (!byText && Array.from(document.querySelectorAll('label')).some((el) => el.textContent?.trim() === name));
  return found.length === 1 && !other ? (found[0] as HTMLElement) : undefined;
}

const buttons = () => Array.from(document.querySelectorAll('button, [role="button"]'));

/**
 * The button with this accessible name. getByRole computes the accessible name of every button, and in jsdom that cost
 * dominates a test that clicks often. Only a certain match is taken (see uniqueNamed); any other case goes to the full
 * query, which reports the problem as before.
 */
export function buttonNamed(name: string, queries: Queries = screen): HTMLElement {
  return (queries === screen ? uniqueNamed(buttons(), name, true) : undefined) ?? queries.getByRole('button', { name });
}

function hasButton(name: string, queries: Queries): boolean {
  return (
    (queries === screen && !!uniqueNamed(buttons(), name, true)) ||
    !!queries.queryByRole('button', { name, hidden: true })
  );
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
    const found = uniqueNamed(Array.from(document.querySelectorAll('[aria-label]')), label, false);
    if (found) {
      return found;
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
