import { screen } from '@testing-library/react';

// jsdom has no IntersectionObserver. Importing this file installs a stub that never reports, in the test files that
// import it (the old intersection-observer polyfill did the same). Other tests keep the "no IntersectionObserver" path.
if (typeof window.IntersectionObserver === 'undefined') {
  class IntersectionObserverStub {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  window.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;
}

type Queries = Pick<typeof screen, 'getByRole'>;

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
 * The one visible button whose own name is `name`: its aria-label, else its text. Undefined when the answer is not
 * certain, so the caller takes the full testing-library query: a button with aria-labelledby is never matched on its
 * own name, a <label> of a button or an aria-labelledby that gives the same name makes the answer ambiguous, and so
 * does a second visible match.
 */
function uniqueButton(name: string): HTMLElement | undefined {
  const named = (el: Element) =>
    el.hasAttribute('aria-labelledby') ? undefined : (el.getAttribute('aria-label') ?? el.textContent?.trim());
  const found = buttons().filter((el) => named(el) === name && !hidden(el));
  if (found.length !== 1) {
    return undefined;
  }
  const other =
    Array.from(document.querySelectorAll('[aria-labelledby]')).some((el) => labelledText(el) === name) ||
    Array.from(document.querySelectorAll('label')).some((l) => l.textContent?.trim() === name && namesButton(l));
  return other ? undefined : (found[0] as HTMLElement);
}

const buttons = () => Array.from(document.querySelectorAll('button, [role="button"]'));

/**
 * The button with this accessible name. getByRole computes the accessible name of every button, and in jsdom that cost
 * dominates a test that clicks often. Only a certain match is taken (see uniqueButton); any other case goes to the full
 * query, which reports the problem as before.
 */
export function buttonNamed(name: string, queries: Queries = screen): HTMLElement {
  return (
    (queries === screen ? (uniqueButton(name) ?? labelledButton(name)) : undefined) ??
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
