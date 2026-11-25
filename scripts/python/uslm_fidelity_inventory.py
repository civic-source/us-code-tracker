"""Inventory source identity without coercing grouped sections into single units."""
from collections import Counter
import re
import unicodedata
import sys

from uslm_fidelity import local, normalized, source_locator, source_text


def nested_section(element, parents):
    while element in parents:
        element = parents[element]
        if local(element) == "section":
            return True
    return False


def source_record(element, parents, counts, title, index):
    identity = element.get("identifier")
    match = re.fullmatch(r"/us/usc/t" + re.escape(title) + r"/s([0-9]+[A-Za-z]*)", identity or "")
    state = "canonical_single" if match else "noncanonical_group_or_range" if identity else "missing_identity"
    if identity and counts[identity] != 1:
        state = "duplicate_identity"
    ancestor = element
    while ancestor in parents and local(ancestor) != "chapter":
        ancestor = parents[ancestor]
    chapter = re.fullmatch(r"/us/usc/t" + re.escape(title) + r"/(?:[A-Za-z0-9-]+/)*ch([A-Za-z0-9-]+)", ancestor.get("identifier", ""))
    if state == "canonical_single" and not chapter:
        state = "unresolved_chapter"
    section = match.group(1) if match else None
    path = f"statutes/title-{title}/chapter-{chapter.group(1)}/section-{section}.md" if state == "canonical_single" else None
    return {"index": index, "identifier": identity, "section": section, "identityState": state,
            "chapter": chapter.group(1) if chapter else None, "path": path,
            "locator": source_locator(element, parents)}


def source_inventory(source, title, release):
    if not re.fullmatch(r"[0-9]+[a-z]?", title) or not re.fullmatch(r"PL [0-9]+-[0-9]+(?:not[0-9]+)*", release):
        raise ValueError("Invalid inventory title or publisher release")
    document = source.document
    if document.tag not in {"{http://xml.house.gov/schemas/uslm/1.0}uscDoc", "{http://xml.house.gov/schemas/uslm/1.0}lawDoc"}:
        raise ValueError("Unknown source document namespace")
    metadata = [e for e in document if local(e) == "meta"]
    if len(metadata) != 1:
        raise ValueError("Source publication metadata missing or nonunique")
    editions = [e for e in metadata[0] if local(e) == "docPublicationName"]
    if len(editions) != 1 or normalized(source_text(editions[0])) != "Online@" + release[3:]:
        raise ValueError("Source publisher edition differs from requested inventory")
    titles = [e for e in document.iter() if local(e) == "title" and e.get("identifier") == "/us/usc/t" + title]
    if len(titles) != 1:
        raise ValueError("Source title identity missing or nonunique")
    parents = {child: parent for parent in document.iter() for child in parent}
    sections = [e for e in titles[0].iter() if local(e) == "section"]
    top = [e for e in sections if not nested_section(e, parents)]
    counts = Counter(e.get("identifier") for e in top)
    return {"schemaVersion": "usct.source-fidelity-inventory/v1", "source_xml_sha256": source.sha256,
            "title": title, "releaseLabel": release, "topLevelSourceRecords": len(top),
            "rawSectionNodes": len(sections), "excludedNestedSections": len(sections) - len(top),
            "normalizationUnicodeVersion": unicodedata.unidata_version,
            "pythonRuntimeVersion": ".".join(str(value) for value in sys.version_info[:3]),
            "records": [source_record(e, parents, counts, title, i) for i, e in enumerate(top)]}
