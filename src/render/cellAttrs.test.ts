import { describe, expect, it } from 'vitest';
import { clearOwnedAttrs, setOwnedAttrs } from './cellAttrs';

const group = (attrs: Record<string, string> = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};

describe('owned cell attributes', () => {
  it('shows the editor layer over the applier layer, in any write order', () => {
    const a = group();
    setOwnedAttrs(a, 'applier', { 'aria-label': 'rtr-a' });
    setOwnedAttrs(a, 'editor', { 'aria-label': 'rtr-a diagram element', role: 'button' });
    const b = group();
    setOwnedAttrs(b, 'editor', { 'aria-label': 'rtr-a diagram element', role: 'button' });
    setOwnedAttrs(b, 'applier', { 'aria-label': 'rtr-a' });
    for (const el of [a, b]) {
      expect(el.getAttribute('aria-label')).toBe('rtr-a diagram element');
      expect(el.getAttribute('role')).toBe('button');
    }
  });

  it('clears only the layer of the owner', () => {
    const el = group();
    setOwnedAttrs(el, 'editor', { tabindex: '0', role: 'button' });
    setOwnedAttrs(el, 'applier', { tabindex: '0', role: 'button', 'aria-label': 'x' });
    clearOwnedAttrs(el, 'applier');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('role')).toBe('button');
    expect(el.hasAttribute('aria-label')).toBe(false);
    clearOwnedAttrs(el, 'editor');
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
  });

  it('gives back the diagram value when no layer has the attribute', () => {
    const el = group({ 'aria-label': 'from draw.io' });
    setOwnedAttrs(el, 'applier', { 'aria-label': 'a' });
    setOwnedAttrs(el, 'editor', { 'aria-label': 'e' });
    clearOwnedAttrs(el, 'editor');
    expect(el.getAttribute('aria-label')).toBe('a');
    setOwnedAttrs(el, 'applier', {});
    expect(el.getAttribute('aria-label')).toBe('from draw.io');
    // a later layer captures the diagram value again
    setOwnedAttrs(el, 'editor', { 'aria-label': 'e' });
    clearOwnedAttrs(el, 'editor');
    expect(el.getAttribute('aria-label')).toBe('from draw.io');
  });
});
