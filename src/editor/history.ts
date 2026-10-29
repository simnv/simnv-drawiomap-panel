/** The diagram versions of one draft. The current version counts towards the limit of 50. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function history<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function pushVersion<T>(stack: History<T>, present: T): History<T> {
  return present === stack.present ? stack : { past: [...stack.past, stack.present].slice(-49), present, future: [] };
}

export function undo<T>(stack: History<T>): History<T> {
  return stack.past.length
    ? {
        past: stack.past.slice(0, -1),
        present: stack.past[stack.past.length - 1],
        future: [stack.present, ...stack.future],
      }
    : stack;
}

export function redo<T>(stack: History<T>): History<T> {
  return stack.future.length
    ? { past: [...stack.past, stack.present], present: stack.future[0], future: stack.future.slice(1) }
    : stack;
}
