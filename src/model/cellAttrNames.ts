export const META_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
export const RESERVED_META = /^(?:pg-.*|id|label|placeholders|xml.*)$/i;

/** True when the editor can write this cell attribute name. */
export function isWritableCellAttr(name: string): boolean {
  return META_KEY.test(name) && !RESERVED_META.test(name);
}
