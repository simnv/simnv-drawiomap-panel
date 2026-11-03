/** A part of a YAML path: a map key or a list index. */
export type PathPart = string | number;

/**
 * A map key that a path writes after a dot: not empty, and no character of the path syntax. Each other key goes in
 * brackets as a JSON string.
 */
const PLAIN_KEY = /^[^.[\]"]+$/;
/** One part at the start of a path: `.key` (the first with no dot), `[2]` or `["a.b"]`. */
const PART = /^(?:\.?([^.[\]"]+)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\])/;

/**
 * The one format of a diagnostic path, as the issue paths of the config check read: `classes.lan.rows[2].query`. A list index is `[2]`.
 * A key with a character of this syntax (`.`, `[`, `]`, `"`), for example a cell id with a dot, or an empty key goes
 * in brackets as a JSON string, so each path names one place: `overrides["sw.1"].status`. `base` is a path that the
 * parts continue.
 */
export function yamlPath(parts: readonly PathPart[], base = ''): string {
  return parts.reduce<string>(
    (path, part) =>
      typeof part === 'number'
        ? `${path}[${part}]`
        : !PLAIN_KEY.test(part)
          ? `${path}[${JSON.stringify(part)}]`
          : path
            ? `${path}.${part}`
            : part,
    base
  );
}

/** The parts of a path of `yamlPath`. A text that is not such a path gives the parts up to the first bad part. */
export function parsePath(path: string): PathPart[] {
  const parts: PathPart[] = [];
  let rest = path;
  for (let m = PART.exec(rest); rest && m; m = PART.exec(rest)) {
    parts.push(m[1] ?? (m[2] !== undefined ? Number(m[2]) : (JSON.parse(m[3]) as string)));
    rest = rest.slice(m[0].length);
  }
  return parts;
}
