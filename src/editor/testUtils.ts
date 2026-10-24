import 'intersection-observer';
import { fireEvent, screen } from '@testing-library/react';

type Queries = Pick<typeof screen, 'getByRole' | 'queryByRole' | 'getByLabelText'>;

/** True when the element, or an ancestor, is hidden from the user and from the accessibility tree. */
function hidden(el: Element): boolean {
  if (el.closest('[hidden], [aria-hidden="true"], [inert]')) {
    return true;
  }
  // getComputedStyle applies the rules of <style> elements and inline styles; display does not inherit, so test every ancestor.
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const style = getComputedStyle(cur);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
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

/** True when a <label> names a button: it wraps one, or its `for` points at one. */
function namesButton(label: Element): boolean {
  const target = label.getAttribute('for') ? document.getElementById(label.getAttribute('for')!) : null;
  return !!label.querySelector('button, [role="button"]') || !!target?.matches('button, [role="button"]');
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
  if (found.length !== 1) {
    return undefined;
  }
  const [match] = found;
  // A <label> that points at the match itself (the visible label of a field) agrees with the aria-label; only a label
  // for another element, or one without a known target, makes the answer ambiguous.
  const labelsOther = (label: Element) => {
    if (byText) {
      return label.textContent?.trim() === name && namesButton(label);
    }
    if (label.textContent?.trim() !== name) {
      return false;
    }
    const id = label.getAttribute('for');
    const target = id ? document.getElementById(id) : label.querySelector('input, select, textarea, button');
    return target !== match;
  };
  const other =
    Array.from(document.querySelectorAll('[aria-labelledby]')).some((el) => labelledText(el) === name) ||
    Array.from(document.querySelectorAll('label')).some(labelsOther);
  return other ? undefined : (match as HTMLElement);
}

const buttons = () => Array.from(document.querySelectorAll('button, [role="button"]'));

/**
 * The button with this accessible name. getByRole computes the accessible name of every button, and in jsdom that cost
 * dominates a test that clicks often. Only a certain match is taken (see uniqueNamed); any other case goes to the full
 * query, which reports the problem as before.
 */
export function buttonNamed(name: string, queries: Queries = screen): HTMLElement {
  return (
    (queries === screen ? (uniqueNamed(buttons(), name, true) ?? labelledButton(name)) : undefined) ??
    queries.getByRole('button', { name })
  );
}

/** A section toggle names itself through aria-labelledby; one visible such button of this name, and no other, is certain. */
function labelledButton(name: string): HTMLElement | undefined {
  const all = buttons();
  const referenced = all.filter((el) => el.hasAttribute('aria-labelledby') && labelledText(el) === name);
  const plain = all.some(
    (el) => !el.hasAttribute('aria-labelledby') && (el.getAttribute('aria-label') ?? el.textContent?.trim()) === name
  );
  return referenced.length === 1 && !plain && !hidden(referenced[0]) ? (referenced[0] as HTMLElement) : undefined;
}

/** False only when no button can have this name: no button or label carries the text, by content, aria-label, title or aria-labelledby. */
function noButtonCouldBeNamed(name: string): boolean {
  const flat = (text: string | null) => (text ?? '').replace(/\s+/g, ' ');
  return (
    !buttons().some((el) =>
      [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'), labelledText(el)].some((t) =>
        flat(t).includes(name)
      )
    ) && !Array.from(document.querySelectorAll('label')).some((el) => flat(el.textContent).includes(name))
  );
}

function hasButton(name: string, queries: Queries): boolean {
  if (queries === screen) {
    if (uniqueNamed(buttons(), name, true)) {
      return true;
    }
    if (noButtonCouldBeNamed(name)) {
      return false;
    }
    if (labelledButton(name)) {
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
  fireEvent.click(
    uniqueNamed(Array.from(document.querySelectorAll('[role="option"]')), option, true) ??
      screen.getByRole('option', { name: option })
  );
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
