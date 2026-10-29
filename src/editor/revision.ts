import type { Options } from '../types';
import { sortedJson } from '../options/storedConfig';

/** The saved state that a draft started from. The popup pins it when it opens and after each Apply. */
export interface BaseRevision {
  hash?: string;
  config: string;
}

export function baseRevision(options: Pick<Options, 'diagram' | 'config'>): BaseRevision {
  return { hash: options.diagram?.hash, config: sortedJson(options.config ?? null) ?? 'null' };
}

/** True when the saved options changed since the draft started, for example in another browser tab. */
export function hasConflict(base: BaseRevision, options: Pick<Options, 'diagram' | 'config'>): boolean {
  const now = baseRevision(options);
  return now.hash !== base.hash || now.config !== base.config;
}
