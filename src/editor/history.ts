import { draftPatternIndex, reduceDraft, type BindingDraft, type DraftAction } from './draft';
import { changedLeaves } from './leafPaths';

/** The most undo steps that the history keeps. */
export const MAX_STEPS = 200;
/** The most distinct diagram revisions that `past` and `future` hold together. Each one is a full SVG and XML. */
export const MAX_DIAGRAMS = 5;
const DEFAULT_COALESCE_MS = 800;

/**
 * The edit run that the next `display` action may join. `paths` are the leaves that the run changed: one while the run
 * edits one field, several when its first step created a value (a new binding has many leaves).
 */
interface Session {
  paths: string[];
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
/** The display that the draft edits: the override of the cell or the pattern of the scope. */
function ownDisplayOf(draft: BindingDraft) {
  return draft.scope === 'pattern'
    ? draft.config.patterns[draftPatternIndex(draft)]?.display
    : draft.config.overrides.find((o) => o.cellId === draft.cellId)?.display;
}

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

/**
 * Keep at most `MAX_DIAGRAMS` distinct diagram revisions in `past` and `future` together. Whole steps go: the oldest
 * past steps first, then the newest future steps, so that every step that stays restores its own diagram.
 */
function capDiagrams(past: BindingDraft[], future: BindingDraft[]): { past: BindingDraft[]; future: BindingDraft[] } {
  const count = (entries: BindingDraft[]) => new Set(entries.map((entry) => entry.diagram)).size;
  let kept = { past, future };
  while (count([...kept.past, ...kept.future]) > MAX_DIAGRAMS) {
    kept =
      kept.past.length > 0
        ? { past: kept.past.slice(1), future: kept.future }
        : { past: [], future: kept.future.slice(0, -1) };
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
  if (action.type === 'undo' || action.type === 'redo') {
    // Both end the edit run, also when there is nothing to undo or redo.
    const undo = action.type === 'undo';
    const target = undo ? state.past[state.past.length - 1] : state.future[0];
    if (!target) {
      return { ...state, session: undefined };
    }
    const kept = undo
      ? capDiagrams(state.past.slice(0, -1), [present, ...state.future])
      : capDiagrams([...state.past, present], state.future.slice(1));
    return { ...state, ...kept, present: restore(present, target), session: undefined };
  }
  const result = reduceDraft(present, action);
  if (action.type === 'applied' || action.type === 'reset') {
    return { ...state, past: [], present: result, future: [], session: undefined };
  }
  if (result.config === present.config && result.diagram === present.diagram) {
    // Not a step (a selection, a scope change, a rejected action). It ends the edit run.
    return { ...state, present: result, session: undefined };
  }
  // The leaves that this step changed, from a diff of the owner's display: the editor writes a whole binding or a
  // whole section for an edit of one field.
  const changed = changedLeaves(ownDisplayOf(present), ownDisplayOf(result));
  if (action.type === 'display' && state.coalesceMs > 0 && changed.length > 0) {
    const owner = ownerOf(present);
    const session = state.session;
    if (
      changed.length === 1 &&
      session &&
      session.owner === owner &&
      session.paths.includes(changed[0]) &&
      now - session.at <= state.coalesceMs &&
      state.past.length > 0
    ) {
      return { ...state, present: result, session: { owner, paths: changed, at: now } };
    }
    return push(state, result, { paths: changed, owner, at: now });
  }
  return push(state, result, undefined);
}

function push(state: HistoryState, present: BindingDraft, session: Session | undefined): HistoryState {
  const { past } = capDiagrams([...state.past, state.present].slice(-MAX_STEPS), []);
  return { ...state, past, present, future: [], session };
}
