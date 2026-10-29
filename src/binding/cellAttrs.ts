import type { CellMeta } from '../types';
import { endAttr, type EndContext } from './edgeEnds';

/** Create an attribute resolver with a lazy endpoint context. */
export const attrOf =
  (ends: () => EndContext) =>
  (meta: CellMeta) =>
  (name: string): string | undefined => {
    if (name.startsWith('from.') || name.startsWith('to.')) {
      const dot = name.indexOf('.');
      return endAttr(meta.id, name.slice(0, dot) as 'from' | 'to', name.slice(dot + 1), ends());
    }
    if (name === 'id') {
      return meta.id;
    }
    return Object.hasOwn(meta.attrs, name) ? meta.attrs[name] : undefined;
  };
