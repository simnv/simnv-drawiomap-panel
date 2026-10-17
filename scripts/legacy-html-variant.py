"""Writes an html=1 variant of a portograph .drawio file.

The panel must also read draw.io SVG with HTML labels (<switch><foreignObject/>...</switch>).
This script gives every labelled cell html=1 and merges each node description into the node
label as a second <div> line, so the export has multi-line HTML labels.

Usage: python3 scripts/legacy-html-variant.py <in.drawio> <out.drawio>
"""
import html
import sys
import xml.etree.ElementTree as ET


def add_html(cell: ET.Element) -> None:
    style = cell.get("style", "")
    if "html=1" not in style:
        cell.set("style", "html=1;" + style)


def main(src: str, dst: str) -> None:
    tree = ET.parse(src)
    root = tree.getroot().find(".//root")
    descriptions = {}
    for el in list(root):
        cid = el.get("id", "")
        if el.tag == "mxCell" and cid.startswith("pg-nodeDescription~"):
            descriptions[cid.split("~", 1)[1]] = el.get("value", "")
            root.remove(el)
    for el in root:
        if el.tag == "object":
            cell = el.find("mxCell")
            label = el.get("label", "")
            node = el.get("pg-id") if el.get("pg-kind") == "node" else None
            if node in descriptions:
                lines = [label, descriptions[node]]
                el.set("label", "".join(f"<div>{html.escape(line)}</div>" for line in lines))
            if cell is not None and label:
                add_html(cell)
        elif el.tag == "mxCell" and el.get("value"):
            add_html(el)
    tree.write(dst, encoding="UTF-8", xml_declaration=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
