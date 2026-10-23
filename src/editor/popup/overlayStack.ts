import { useEffect } from 'react';

/**
 * Open overlays, bottom first. The Esc owner of an overlay acts on a key press outside its dialog
 * only when its entry is the top one.
 */
const stack: string[] = [];

export function push(id: string) {
  stack.push(id);
}

/** Remove the last entry with this id. The order of the other entries stays. */
export function pop(id: string) {
  const index = stack.lastIndexOf(id);
  if (index >= 0) {
    stack.splice(index, 1);
  }
}

export function isTop(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/** Keep an entry in the stack while the component is mounted. */
export function useOverlay(id: string) {
  useEffect(() => {
    push(id);
    return () => pop(id);
  }, [id]);
}
