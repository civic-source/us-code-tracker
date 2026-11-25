"""Compare pinned USLM text and semantic lanes with an independently parsed page."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path


SOURCE_BLOCKS = {
    "section", "subsection", "paragraph", "subparagraph", "clause", "subclause",
    "num", "heading", "content", "chapeau", "continuation", "p", "table",
    "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "note",
}
SOURCE_KNOWN = SOURCE_BLOCKS | {
    "ref", "inline", "b", "i", "sup", "sub", "date", "term", "def",
    "quotedContent", "sourceCredit", "notes", "a", "span", "br",
}
HTML_BLOCKS = {
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "section", "article",
    "ul", "ol", "li", "blockquote", "table", "tr", "td", "th", "br",
}
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
STRUCTURAL = {"subsection", "paragraph", "subparagraph", "clause", "subclause"}


def normalized(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).split())


def local(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def source_text(element: ET.Element, exclude_notes: bool = False) -> str:
    tag = local(element)
    if exclude_notes and tag in {"note", "notes", "sourceCredit"}:
        return ""
    value = element.text or ""
    for child in element:
        value += source_text(child, exclude_notes) + (child.tail or "")
    return f" {value} " if tag in SOURCE_BLOCKS else value


@dataclass
class Node:
    tag: str
    attrs: dict[str, str | None] = field(default_factory=dict)
    parent: Node | None = None
    children: list[Node | str] = field(default_factory=list)


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("document")
        self.stack = [self.root]
        self.node_count = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.node_count += 1
        if len(self.stack) > 128 or self.node_count > 200_000:
            raise ValueError("HTML nesting or element count exceeds verifier limits")
        node = Node(tag, dict(attrs), self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in VOID_TAGS:
            self.stack.append(node)

    def handle_endtag(self, tag: str) -> None:
        if tag in VOID_TAGS:
            return
        if len(self.stack) < 2 or self.stack[-1].tag != tag:
            raise ValueError(f"Unbalanced HTML closing element: {tag}")
        self.stack.pop()

    def handle_data(self, data: str) -> None:
        self.stack[-1].children.append(data)


def walk(node: Node):
    yield node
    for child in node.children:
        if isinstance(child, Node):
            yield from walk(child)


def page_text(node: Node, omit_nested_lists: bool = False) -> str:
    parts = []
    for child in node.children:
        if isinstance(child, str):
            parts.append(child)
        elif child.tag not in {"script", "style"}:
            if omit_nested_lists and child.tag in {"ul", "ol"}:
                continue
            value = page_text(child, omit_nested_lists)
            parts.append(f" {value} " if child.tag in HTML_BLOCKS else value)
    return "".join(parts)


def marker(node: Node) -> str | None:
    for child in node.children:
        if not isinstance(child, Node) or child.tag in {"ul", "ol"}:
            continue
        if child.tag == "strong":
            return normalized(page_text(child))
        result = marker(child)
        if result is not None:
            return result
    return None


def marker_path(node: Node) -> list[str | None]:
    result = []
    current: Node | None = node
    while current is not None:
        if current.tag == "li":
            result.append(marker(current))
        current = current.parent
    return list(reversed(result))


def source_path(element: ET.Element, parents: dict[ET.Element, ET.Element]) -> list[str]:
    result = []
    current = element
    while current in parents:
        current = parents[current]
        if local(current) in STRUCTURAL:
            number = next((c for c in current if local(c) == "num"), None)
            result.append(normalized(source_text(number)) if number is not None else "")
    return list(reversed(result))


def source_locator(element: ET.Element, parents: dict[ET.Element, ET.Element]) -> str:
    parts = []
    while element in parents:
        parent = parents[element]
        parts.append(f"{local(element)}[{list(parent).index(element) + 1}]")
        element = parent
    return (element.get("identifier") or local(element)) + "/" + "/".join(reversed(parts))


def in_note(element: ET.Element, parents: dict[ET.Element, ET.Element]) -> bool:
    while element in parents:
        element = parents[element]
        if local(element) in {"note", "notes"}:
            return True
    return False


def source_lanes(section: ET.Element, parents: dict[ET.Element, ET.Element]) -> dict[str, str]:
    credits = [e for e in section if local(e) == "sourceCredit"]
    notes = []
    for element in section.iter():
        if local(element) != "note":
            continue
        current = element
        while current in parents and local(parents[current]) != "note":
            current = parents[current]
        if current not in parents:
            notes.append(element)
    return {
        "operative": normalized(source_text(section, True)),
        "source_credit": normalized(" ".join(source_text(e) for e in credits)),
        "editorial_notes": normalized(" ".join(source_text(e) for e in notes)),
    }


def page_lanes(root: Node) -> tuple[dict[str, str], list[Node]]:
    lanes: dict[str, list[str]] = {"operative": [], "source_credit": [], "editorial_notes": []}
    current = "operative"
    operative_nodes = []
    for child in root.children:
        if isinstance(child, str):
            lanes[current].append(child)
            continue
        label = normalized(page_text(child))
        if child.tag == "h2" and label in {"Source Credit", "Notes"}:
            current = "source_credit" if label == "Source Credit" else "editorial_notes"
            continue
        lanes[current].append(page_text(child))
        if current == "operative":
            operative_nodes.extend(walk(child))
    return {key: normalized(" ".join(values)) for key, values in lanes.items()}, operative_nodes


def compare_text(expected: str, actual: str, lane: str) -> dict[str, object] | None:
    if expected == actual:
        return None
    offset = next((i for i, pair in enumerate(zip(expected, actual)) if pair[0] != pair[1]),
                  min(len(expected), len(actual)))
    return {"lane": lane, "reason": "text_mismatch", "first_difference": offset,
            "expected": expected[max(0, offset - 40):offset + 100],
            "actual": actual[max(0, offset - 40):offset + 100]}


def collect_source_structure(section: ET.Element, parents: dict[ET.Element, ET.Element]):
    issues = []
    continuations = Counter()
    provisions = Counter()
    for element in section.iter():
        if in_note(element, parents):
            continue
        tag = local(element)
        expected = normalized(source_text(element))
        if tag in STRUCTURAL:
            number = next((c for c in element if local(c) == "num"), None)
            if number is None or not normalized(source_text(number)):
                issues.append({"reason": "unqualified_missing_source_marker", "locator": source_locator(element, parents)})
            else:
                provisions[tuple(source_path(element, parents) + [normalized(source_text(number))])] += 1
        elif tag == "continuation":
            continuations[(tuple(source_path(element, parents)), expected)] += 1
    return provisions, continuations, issues


def structural_issues(section: ET.Element, parents: dict[ET.Element, ET.Element], nodes: list[Node]) -> list[dict]:
    provisions, continuations, issues = collect_source_structure(section, parents)
    for element in section.iter():
        if local(element) == "heading" and not in_note(element, parents) and local(parents.get(element, section)) in STRUCTURAL:
            path = source_path(element, parents)
            candidates = [n for n in nodes if n.tag == "li" and marker_path(n) == path]
            if len(candidates) != 1 or normalized(source_text(element)) not in normalized(page_text(candidates[0], True)):
                issues.append({"lane": "operative", "reason": "detached_heading", "parent": path})
    for parent, count in provisions.items():
        actual = sum(n.tag == "li" and marker_path(n) == list(parent) for n in nodes)
        if actual != count:
            issues.append({"lane": "operative", "reason": "numbered_clause_parent_or_count",
                           "parent": list(parent), "expected_occurrences": count, "occurrences": actual})
    for (parent, text), count in continuations.items():
        actual = sum(n.tag == "p" and normalized(page_text(n)) == text
                     and marker_path(n) == list(parent) for n in nodes)
        if actual != count:
            issues.append({"lane": "operative", "reason": "continuation_parent_or_count",
                           "parent": list(parent), "expected_occurrences": count, "occurrences": actual})
    return issues


def read_bounded(path: Path, limit: int) -> bytes:
    if path.stat().st_size > limit:
        raise ValueError(f"Input exceeds {limit} byte limit")
    with path.open("rb") as stream:
        value = stream.read(limit + 1)
    if len(value) > limit:
        raise ValueError("Input grew beyond its byte limit")
    return value


@dataclass(frozen=True)
class PreparedSource:
    document: ET.Element
    sha256: str


def prepare_source(path: Path, expected_sha256: str) -> PreparedSource:
    xml = read_bounded(path, 128 * 1024 * 1024)
    source_sha = hashlib.sha256(xml).hexdigest()
    if source_sha != expected_sha256:
        raise ValueError("Pinned source XML digest mismatch")
    try:
        xml_text = xml.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("Source XML encoding must be UTF-8") from error
    if re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", xml_text, re.IGNORECASE):
        raise ValueError("DTD and entity declarations are prohibited")
    return PreparedSource(ET.fromstring(xml_text), source_sha)


def verify_prepared(source: PreparedSource, section_id: str, html_path: Path, fragment: bool) -> dict[str, object]:
    document = source.document
    source_sha = source.sha256
    html = read_bounded(html_path, 16 * 1024 * 1024)
    matches = [e for e in document.iter() if local(e) == "section" and e.get("identifier") == section_id]
    if len(matches) != 1:
        raise ValueError("Source section identity is missing or nonunique")
    section = matches[0]
    parents = {child: parent for parent in section.iter() for child in parent}
    parser = PageParser()
    parser.feed(html.decode("utf-8"))
    parser.close()
    if len(parser.stack) != 1:
        raise ValueError("Unclosed HTML element")
    roots = [parser.root] if fragment else [n for n in walk(parser.root) if n.attrs.get("id") == "current-statute-body"]
    if len(roots) != 1:
        raise ValueError("Rendered statute root is missing or nonunique")
    expected = source_lanes(section, parents)
    actual, nodes = page_lanes(roots[0])
    issues = [issue for lane in expected if (issue := compare_text(expected[lane], actual[lane], lane))]
    issues.extend(structural_issues(section, parents, nodes))
    unknown = [{"element": local(e), "locator": source_locator(e, parents), "text": normalized(source_text(e))[:100]}
               for e in section.iter() if local(e) not in SOURCE_KNOWN and normalized(source_text(e))]
    if unknown:
        issues.append({"reason": "unclassified_source_elements", "count": len(unknown)})
    unqualified = [{"element": local(e), "locator": source_locator(e, parents)} for e in section.iter()
                   if local(e) == "table" or (local(e) == "note" and
                   any("footnote" in value.lower() for value in e.attrib.values()))]
    if unqualified:
        issues.append({"reason": "table_or_footnote_structure_not_qualified", "nodes": unqualified})
    return {"accepted": not issues, "section": section_id, "source_xml_sha256": source_sha,
            "html_sha256": hashlib.sha256(html).hexdigest(), "normalization": "NFC-whitespace-v1",
            "normalization_unicode_version": unicodedata.unidata_version,
            "canonical_text_sha256": {lane: {
                "source": hashlib.sha256(expected[lane].encode("utf-8")).hexdigest(),
                "rendered": hashlib.sha256(actual[lane].encode("utf-8")).hexdigest()}
                for lane in expected},
            "html_kind": "renderer_fragment" if fragment else "statute_page",
            "scope": "text-lanes-and-list-placement-v1",
            "word_counts": {lane: len(value.split()) for lane, value in expected.items()},
            "unknown_elements": unknown, "issues": issues}


def verify(args: argparse.Namespace) -> dict[str, object]:
    source = prepare_source(args.xml, args.expected_source_sha256)
    return verify_prepared(source, args.section, args.html, args.fragment)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xml", type=Path, required=True)
    parser.add_argument("--html", type=Path, required=True)
    parser.add_argument("--section", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--fragment", action="store_true")
    args = parser.parse_args()
    try:
        result = verify(args)
    except (OSError, ValueError, ET.ParseError, RecursionError) as error:
        print(json.dumps({"accepted": False, "state": "inconclusive", "error": str(error)}))
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["accepted"] else 1


if __name__ == "__main__":
    sys.exit(main())
