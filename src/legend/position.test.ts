import { describe, expect, it } from 'vitest';
import { clampPoint, isDrag, keyMove } from './position';

describe('legend position', () => {
  const area = { width: 400, height: 300 };
  const box = { width: 100, height: 50 };
  it('keeps the box inside the area', () => {
    expect(clampPoint({ x: -20, y: -5 }, box, area)).toEqual({ x: 0, y: 0 });
    expect(clampPoint({ x: 390, y: 290 }, box, area)).toEqual({ x: 300, y: 250 });
    expect(clampPoint({ x: 120, y: 80 }, box, area)).toEqual({ x: 120, y: 80 });
  });
  it('puts a box larger than the area at the origin', () => {
    expect(clampPoint({ x: 30, y: 30 }, { width: 500, height: 400 }, area)).toEqual({ x: 0, y: 0 });
  });
  it('starts a drag at 4 px', () => {
    expect(isDrag(2, 2)).toBe(false);
    expect(isDrag(4, 0)).toBe(true);
  });
  it('moves by 10 px, or 50 px with shift', () => {
    expect(keyMove('ArrowLeft', false)).toEqual({ x: -10, y: 0 });
    expect(keyMove('ArrowDown', true)).toEqual({ x: 0, y: 50 });
    expect(keyMove('a', false)).toBeNull();
  });
});
