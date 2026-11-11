#!/usr/bin/env python3
"""Replaces the random id that draw.io gives the root <svg> (ge-svg-<random>) with ge-svg-<name>.

Usage: normalize-svg-id.py <file.svg> <name>
Only that exact id is replaced: the id attribute and its references (CSS selectors, url(#id)).
Other text that starts with "ge-svg-" (a cell id, a binding key, a label) stays as it is.
"""
import re
import sys


def normalize(svg: str, name: str) -> str:
    root = re.search(r"<svg\b[^>]*?\sid=\"(ge-svg-[A-Za-z0-9_-]+)\"", svg)
    if not root:
        return svg
    old = root.group(1)
    # the token must end at a character that cannot be part of an id
    return re.sub(re.escape(old) + r"(?![A-Za-z0-9_-])", "ge-svg-" + name, svg)


if __name__ == "__main__":
    path, name = sys.argv[1], sys.argv[2]
    with open(path, encoding="utf-8") as f:
        text = f.read()
    with open(path, "w", encoding="utf-8") as f:
        f.write(normalize(text, name))
