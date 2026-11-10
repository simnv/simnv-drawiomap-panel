import fs from 'fs';
import path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** The input part of the shim (watchRightRelease). A file of its own: the other shim tests run the shim again. */
const SHIM = fs.readFileSync(path.join(__dirname, 'drawio-shim.js'), 'utf8');

describe('drawio-shim (lost right-button release)', () => {
  let target: HTMLElement;
  let seen: string[];
  const record = (e: Event) => {
    const m = e as MouseEvent;
    seen.push(`${e.type} ${m.button} ${m.buttons} ${m.clientX},${m.clientY}`);
  };
  const TYPES = ['mousedown', 'mousemove', 'mouseup', 'pointerdown', 'pointermove', 'pointerup', 'contextmenu'];

  // One shim for the file: its document listeners stay, and a second shim would also watch every press.
  beforeAll(() => {
    new Function(SHIM)();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    // The diagram canvas of draw.io: only presses in it are watched.
    const canvas = document.createElement('div');
    canvas.className = 'geDiagramContainer';
    target = document.createElement('div');
    canvas.appendChild(target);
    document.body.appendChild(canvas);
    seen = [];
    TYPES.forEach((t) => target.addEventListener(t, record));
  });

  afterEach(() => {
    vi.useRealTimers();
    target.parentElement!.remove();
  });

  const fire = (type: string, init: PointerEventInit) => {
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, clientX: 40, clientY: 30, ...init }));
  };

  it('ends a right press that Safari reports as released (two-finger tap): the release follows the context menu event', () => {
    // Safari on macOS: the press of a quick two-finger tap has no right-button bit, and no release follows.
    fire('pointerdown', { button: 2, buttons: 0, pointerId: 1, pointerType: 'mouse' });
    fire('mousedown', { button: 2, buttons: 0 });
    fire('contextmenu', { button: 2, buttons: 0 });
    vi.runAllTimers();
    expect(seen).toEqual([
      'pointerdown 2 0 40,30',
      'mousedown 2 0 40,30',
      'contextmenu 2 0 40,30',
      'pointerup 2 0 40,30',
      'mouseup 2 0 40,30',
    ]);
    // A late release from the browser gets no second release from the shim.
    fire('mouseup', { button: 2, buttons: 0 });
    fire('mousemove', { buttons: 0, clientX: 90 });
    vi.runAllTimers();
    expect(seen.filter((s) => s.startsWith('mouseup'))).toHaveLength(2);
  });

  it('ends a right press before the first move that shows the button up', () => {
    fire('mousedown', { button: 2, buttons: 2 });
    fire('mousemove', { buttons: 0, clientX: 90, clientY: 80 });
    fire('mousemove', { buttons: 0, clientX: 95, clientY: 85 });
    // The release has the place of the press: draw.io opens the menu there and does not pan.
    expect(seen).toEqual(['mousedown 2 2 40,30', 'mouseup 2 0 40,30', 'mousemove 0 0 90,80', 'mousemove 0 0 95,85']);
  });

  it('ends a right press that has no release before the next press', () => {
    fire('mousedown', { button: 2, buttons: 2 });
    fire('mousedown', { button: 2, buttons: 2, clientX: 60 });
    expect(seen).toEqual(['mousedown 2 2 40,30', 'mouseup 2 0 40,30', 'mousedown 2 2 60,30']);
  });

  it('releases only the press of its own context menu event', () => {
    fire('mousedown', { button: 2, buttons: 0 });
    fire('contextmenu', { button: 2, buttons: 0 });
    // A new right press before the timer: it ends the first press. The timer must not end the new one.
    fire('mousedown', { button: 2, buttons: 2, clientX: 60 });
    vi.runAllTimers();
    expect(seen).toEqual(['mousedown 2 0 40,30', 'contextmenu 2 0 40,30', 'mouseup 2 0 40,30', 'mousedown 2 2 60,30']);
  });

  it('does not end a press while another button is down (Ctrl + click in Firefox on a Mac, a chorded press)', () => {
    // Firefox on a Mac: Ctrl + click is a right press with the left button down.
    fire('mousedown', { button: 2, buttons: 1, ctrlKey: true });
    fire('contextmenu', { button: 2, buttons: 1, ctrlKey: true });
    vi.runAllTimers();
    fire('mousemove', { buttons: 1, clientX: 80 });
    fire('mouseup', { button: 2, buttons: 0, clientX: 80 });
    // A right drag with a left press in it.
    fire('mousedown', { button: 2, buttons: 2 });
    fire('mousedown', { button: 0, buttons: 3 });
    fire('mousemove', { buttons: 2, clientX: 90 });
    fire('mouseup', { button: 0, buttons: 2, clientX: 90 });
    fire('mouseup', { button: 2, buttons: 0, clientX: 90 });
    vi.runAllTimers();
    expect(seen.filter((s) => s.startsWith('mouseup'))).toEqual([
      'mouseup 2 0 80,30',
      'mouseup 0 2 90,30',
      'mouseup 2 0 90,30',
    ]);
  });

  it('does not end a right drag of the mouse for a move of another pointer', () => {
    fire('pointerdown', { button: 2, buttons: 2, pointerId: 1, pointerType: 'mouse' });
    fire('pointermove', { buttons: 0, pointerId: 7, pointerType: 'pen', clientX: 90 });
    fire('pointermove', { buttons: 2, pointerId: 1, pointerType: 'mouse', clientX: 95 });
    expect(seen.filter((s) => s.startsWith('pointerup'))).toEqual([]);
    fire('pointermove', { buttons: 0, pointerId: 1, pointerType: 'mouse', clientX: 99 });
    expect(seen.filter((s) => s.startsWith('pointerup'))).toEqual(['pointerup 2 0 40,30']);
  });

  it('adds nothing for a press outside the diagram canvas (a row of the draw.io menu)', () => {
    // A right press on a menu row, a drag out of the frame and a release outside: a release on the row would run
    // the menu item.
    const row = document.createElement('td');
    document.body.appendChild(row);
    const ups: string[] = [];
    row.addEventListener('mouseup', (e) => ups.push(e.type));
    row.addEventListener('pointerup', (e) => ups.push(e.type));
    const init = { bubbles: true, cancelable: true, button: 2, buttons: 0, clientX: 40, clientY: 30 };
    row.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerId: 1, pointerType: 'mouse' }));
    row.dispatchEvent(new MouseEvent('mousedown', init));
    row.dispatchEvent(new MouseEvent('contextmenu', init));
    vi.runAllTimers();
    row.dispatchEvent(new PointerEvent('pointermove', { ...init, button: -1, pointerId: 1, pointerType: 'mouse' }));
    row.dispatchEvent(new MouseEvent('mousemove', { ...init, button: 0 }));
    row.remove();
    expect(ups).toEqual([]);
  });

  it('adds nothing when the browser sends the release, and nothing for the left button', () => {
    fire('mousedown', { button: 2, buttons: 2 });
    fire('contextmenu', { button: 2, buttons: 2 });
    fire('mousemove', { buttons: 2, clientX: 41 });
    fire('mouseup', { button: 2, buttons: 0, clientX: 41 });
    fire('mousemove', { buttons: 0, clientX: 50 });
    fire('mousedown', { button: 0, buttons: 1 });
    fire('mousemove', { buttons: 0, clientX: 55 });
    vi.runAllTimers();
    expect(seen.filter((s) => s.startsWith('mouseup'))).toEqual(['mouseup 2 0 41,30']);
  });
});
