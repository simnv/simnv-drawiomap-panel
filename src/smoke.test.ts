import { describe, expect, it } from 'vitest';

describe('vitest', () => {
  it('runs in jsdom', () => {
    const el = document.createElement('div');
    el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="a"/></svg>';
    expect(el.querySelector('[data-cell-id="a"]')).not.toBeNull();
  });
});
