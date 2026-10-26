# O7: the sanitized SVG is computed once per diagram

- Status: draft 2026-10-27. Design first; tests and code follow on the same branch.
- Scope: `src/render/sanitize.ts` (the cache), `src/render/sanitize.test.ts`, `docs/security.md`.
- Reads: `docs/security.md` (the sanitizer path), `CODING_STANDARDS.md` ("The SVG sanitiser output is idempotent").

## 1. Current cost

`sanitizeSvg(text)` parses the text, runs the structural pass, runs DOMPurify, and serializes twice. It runs again
on the same string each time:

- a panel mounts (`useStage` in `DrawioMapPanel.tsx`; `useMemo` keeps the result only for one mount);
- the bindings popup mounts (`useStage` in `BindingEditor.tsx`; the popup stage `DiagramStage` only shows this stage);
- a dashboard is entered again, or a panel is mounted again (view, edit, move between rows);
- the geometry editor saves (`BindingEditor.tsx`, on a new string, so no gain there).

So one edit session on one diagram runs it at least twice on the same string (panel and popup).

Measured before the change (vitest, jsdom, median of 10 runs; a browser is faster, but the ratio is the same):

| Input                        | Size (chars) | `sanitizeSvg` (ms) |
| ---------------------------- | ------------ | ------------------ |
| `demo-l3.svg`                | 71,894       | 17.3               |
| `demo-l1.svg`                | 101,316      | 29.4               |
| `legacy-html-labels.svg`     | 386,094      | 31.7               |
| synthetic, 2,000 cells       | 294,340      | 166.7              |

## 2. Design

A module-level cache inside `sanitize.ts`. `sanitizeSvg` is the cached function. The old body becomes
`sanitizeSvgUncached`, which stays exported so tests can compare the two.

1. The cache stores the result as strings and numbers only: the output SVG string, the counts and the warnings. It
   never stores a DOM node. Each caller parses its own copy with `mountSvg`.
2. The key is the exact input string, with a prefix `SANITIZER_VERSION + "\n"`. The Map compares keys by full string
   equality, so no hash can collide into the output of another diagram. The panel sanitizer options
   (`PURIFY_CONFIG`) and the theme variable step (`extractThemeVars`) are constants of the module; a change to any of
   them must change `SANITIZER_VERSION`. A test pins a digest of `PURIFY_CONFIG` so that a change to the options without
   a version change fails the test.
3. A hit returns a fresh object: the `removed` object and the `warnings` array are copied. A caller that changes its
   result cannot change the cache.
4. Bounds: at most 8 entries and at most 8 MB in total (2 bytes per character of key and of output). The least recently
   used entry goes first (a hit moves the entry to the end of the Map). An entry that alone is larger than the cap is
   not stored.
5. An input that throws (not an SVG) is not stored. The error path runs again each time.

## 3. Limits

- The cache saves only the second and later runs on the same string, in the same page session. The first run costs as
  before.
- A hash of the diagram is not the key. The panel can have a stale hash for a changed string; the string is the truth.
- The key holds the input string, so the cache keeps up to 8 MB of diagram text in memory. A page reload clears it.

## 4. Tests

- A cached call returns a value deep-equal to `sanitizeSvgUncached` for the demo SVGs and the adversarial inputs.
- A different input never hits: two inputs that differ by one character give two different outputs.
- A hit is a hit: the second call does not run the sanitizer (a counter on the uncached function).
- The LRU: the 9th distinct input evicts the oldest; a hit keeps an entry alive; the byte cap evicts; an entry above
  the cap is not stored.
- A caller that changes the returned `removed` and `warnings`, or mounts the SVG and changes the DOM, does not change the
  next result.
- The digest of `PURIFY_CONFIG` test above.
- A synthetic diagram with 2,000 cells: the second call is faster than 5% of the first (the figures go into the report).

## 5. Result

Measured in the same jsdom run with the 2,000 cell diagram: miss 176.5 ms, hit 0.02 ms. A hit costs one string-keyed
Map lookup and a copy of two small objects. The panel still parses the string once per mount (`mountSvg`).
