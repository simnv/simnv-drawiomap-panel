export const META_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
export const RESERVED_META = /^(?:pg-.*|id|label|placeholders|xml.*)$/i;

/** Fold ASCII letters only, so a non-ASCII name cannot become a valid ASCII name. */
export function canonicalAttrName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/** The attributes that the panel or draw.io own: the inspector shows them and never writes them. */
export const isReservedAttr = (name: string) => RESERVED_META.test(name);

/** Explain an invalid cell attribute name, or return undefined. Give the name in lowercase. */
export function attrNameProblem(name: string): string | undefined {
  if (!name) {
    return 'Enter a name.';
  }
  if (name === '__proto__') {
    return 'The name __proto__ is not allowed.';
  }
  if (!META_KEY.test(name)) {
    return 'Use a letter or _ first, then letters, digits, _ or -.';
  }
  if (isReservedAttr(name)) {
    return `The name ${name} is reserved. The panel or draw.io owns it.`;
  }
  return undefined;
}

/** True when the editor can write this cell attribute name. */
export function isWritableCellAttr(name: string): boolean {
  return META_KEY.test(name) && attrNameProblem(canonicalAttrName(name)) === undefined;
}
