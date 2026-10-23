import type { Diagram } from '../types';
import { draftPatternIndex, reduceDraft, type BindingDraft, type DraftAction } from './draft';
import { leafPaths } from './leafPaths';

/** The most undo steps that the history keeps. */
export const MAX_STEPS = 200;
/** The most distinct diagram revisions that `past` and `future` hold together. Each one is a full SVG and XML. */
export const MAX_DIAGRAMS = 5;
const DEFAULT_COALESCE_MS = 800;

/** The edit run that the next `display` action may join: one leaf path of one owner. */
interface Session {
  path: string;
  owner: string;
  at: number;
}

export interface HistoryState {
  past: BindingDraft[];
  present: BindingDraft;
  future: BindingDraft[];
  session?: Session;
  /** Window in ms in which equal single-leaf edits join one step. 0 turns coalescing off. */
  coalesceMs: number;
}

export type HistoryAction = DraftAction | { type: 'undo' } | { type: 'redo' };

export function createHistory(draft: BindingDraft, { coalesceMs = DEFAULT_COALESCE_MS } = {}): HistoryState {
  return { past: [], present: draft, future: [], coalesceMs };
}

/** Who the draft edits right now: the override of the cell or the pattern of the scope. */
function ownerOf(draft: BindingDraft): string {
  return draft.scope === 'pattern' ? `pattern:${draftPatternIndex(draft)}` : `override:${draft.cellId ?? ''}`;
}

/**
 * Take the config and the diagram of another draft. The selection and the scope stay: undo must not move the user.
 * A pattern scope whose pattern is gone falls back to the element scope.
 */
function restore(present: BindingDraft, target: BindingDraft): BindingDraft {
  const next: BindingDraft = { ...present, config: target.config, diagram: target.diagram, diagnostics: [] };
  if (next.scope === 'pattern' && draftPatternIndex(next) < 0) {
    return { ...next, scope: 'element', patternId: undefined, patternIndex: undefined };
  }
  return next;
}

/** Drop the oldest steps while the history holds too many diagram revisions. */
function capDiagrams(past: BindingDraft[], future: BindingDraft[]): BindingDraft[] {
  const count = (entries: BindingDraft[]) => {
    const seen = new Set<Diagram | undefined>();
    for (const entry of entries) {
      seen.add(entry.diagram);
    }
    return seen.size;
  };
  let kept = past;
  while (kept.length > 0 && count([...kept, ...future]) > MAX_DIAGRAMS) {
    kept = kept.slice(1);
  }
  return kept;
}

/**
 * The draft with undo and redo. A step is an action that replaces `config` or `diagram` (compared by reference after
 * `reduceDraft`). A selection or a scope change updates the present draft without a step. `applied` and `reset`
 * clear the history: the draft starts again from the saved options.
 */
export function reduceHistory(state: HistoryState, action: HistoryAction, now = Date.now()): HistoryState {
  const { present } = state;
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1];
    return previous
      ? {
          ...state,
          past: state.past.slice(0, -1),
          present: restore(present, previous),
          future: [present, ...state.future],
          session: undefined,
        }
      : state;
  }
  if (action.type === 'redo') {
    const [next, ...rest] = state.future;
    return next
      ? { ...state, past: [...state.past, present], present: restore(present, next), future: rest, session: undefined }
      : state;
  }
  const result = reduceDraft(present, action);
  if (action.type === 'applied' || action.type === 'reset') {
    return { ...state, past: [], present: result, future: [], session: undefined };
  }
  if (result.config === present.config && result.diagram === present.diagram) {
    // Not a step (a selection, a scope change, a rejected action). It ends the edit run.
    return { ...state, present: result, session: undefined };
  }
  if (action.type === 'display' && state.coalesceMs > 0) {
    const paths = leafPaths(action.display);
    const owner = ownerOf(present);
    const session = state.session;
    if (paths.length === 1) {
      if (
        session &&
        session.path === paths[0] &&
        session.owner === owner &&
        now - session.at <= state.coalesceMs &&
        state.past.length > 0
      ) {
        return { ...state, present: result, session: { ...session, at: now } };
      }
      return push(state, result, { path: paths[0], owner, at: now });
    }
  }
  return push(state, result, undefined);
}

function push(state: HistoryState, present: BindingDraft, session: Session | undefined): HistoryState {
  const past = capDiagrams([...state.past, state.present].slice(-MAX_STEPS), []);
  return { ...state, past, present, future: [], session };
}
