"""Bounded extraction of GPO eCFR authority evidence from retained XML bytes."""
import hashlib
import json
import os
import re
import sys
from xml.parsers import expat

MAX_SOURCE = 256 * 1024 * 1024
MAX_OUTPUT = 64 * 1024 * 1024
MAX_TEXT = 128 * 1024
AUTHORITY = {"AUTH", "SECAUTH", "PARAUTH"}


class Extractor:
    def __init__(self, title, digest):
        self.title = title
        self.digest = digest
        self.stack = []
        self.captures = []
        self.authorities = []
        self.amendments = []
        self.identity = None
        self.output_bytes = 0
        self.parser = expat.ParserCreate()
        self.parser.buffer_text = True
        self.parser.StartElementHandler = self.start
        self.parser.EndElementHandler = self.end
        self.parser.CharacterDataHandler = self.characters
        self.parser.StartDoctypeDeclHandler = self.reject_declaration
        self.parser.EntityDeclHandler = self.reject_declaration
        self.parser.ExternalEntityRefHandler = self.reject_declaration
        self.parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)

    @staticmethod
    def reject_declaration(*_args):
        raise ValueError("DTD and entity declarations are prohibited")

    def start(self, tag, attrs):
        if len(self.stack) >= 256:
            raise ValueError("XML nesting exceeds 256 levels")
        if not self.stack and tag != "DLPSTEXTCLASS":
            raise ValueError("Unexpected eCFR root element")
        siblings = self.stack[-1]["children"] if self.stack else {}
        siblings[tag] = siblings.get(tag, 0) + 1
        parent = self.stack[-1]["path"] if self.stack else ""
        frame = {"tag": tag, "attrs": attrs, "children": {}, "head": "",
                 "path": f"{parent}/{tag}[{siblings[tag]}]"}
        self.stack.append(frame)
        capture = tag in AUTHORITY or tag in {"HEAD", "AMDDATE"}
        capture = capture or (tag == "IDNO" and attrs.get("TYPE") == "title"
                              and any(item["tag"] == "HEADER" for item in self.stack))
        if capture:
            if tag in AUTHORITY and any(c["tag"] in AUTHORITY for c in self.captures):
                raise ValueError("Nested authority records are ambiguous")
            self.captures.append({"tag": tag, "depth": len(self.stack), "text": [],
                                  "size": 0, "path": frame["path"],
                                  "line": self.parser.CurrentLineNumber})

    def characters(self, value):
        for capture in self.captures:
            capture["size"] += len(value.encode("utf-8"))
            if capture["size"] > MAX_TEXT:
                raise ValueError("Captured text exceeds 128 KiB")
            capture["text"].append(value)

    def end(self, _tag):
        if self.captures and self.captures[-1]["depth"] == len(self.stack):
            capture = self.captures.pop()
            raw = "".join(capture["text"])
            text = " ".join(raw.split())
            self.accept(capture, raw, text)
        self.stack.pop()

    def accept(self, capture, raw, text):
        tag = capture["tag"]
        if tag in AUTHORITY:
            self.authority(capture, raw, text)
        elif tag == "HEAD" and len(self.stack) > 1:
            self.stack[-2]["head"] = text
        elif tag == "AMDDATE":
            volume = next((frame for frame in reversed(self.stack)
                           if frame["tag"] == "ECFRBRWS"), None)
            if volume is None:
                raise ValueError("Amendment date has no volume scope")
            if "amendment" in volume:
                if volume["amendment"] != text:
                    raise ValueError("Conflicting amendment dates within volume")
            else:
                volume["amendment"] = text
                self.amendments.append(text)
        elif tag == "IDNO":
            if not text.isdecimal() or int(text) != self.title:
                raise ValueError("Source CFR title identity mismatch")
            self.identity = int(text)

    def authority(self, capture, raw, text):
        divs = [frame for frame in self.stack if re.fullmatch(r"DIV\d+", frame["tag"])]
        if not divs or not divs[-1]["attrs"].get("TYPE"):
            raise ValueError("Authority has no typed hierarchy scope")
        part = self.nearest(divs, {"PART"})
        section = self.nearest(divs, {"SECTION"})
        agency = self.nearest(divs, {"CHAPTER", "SUBCHAP", "SUBCHAPTER"})
        record = {"cfrTitle": self.title, "sourceSha256": self.digest,
                  "ordinal": len(self.authorities) + 1, "nodePath": capture["path"],
                  "scope": divs[-1]["attrs"]["TYPE"],
                  "part": part["attrs"].get("N") if part else None,
                  "section": self.section_number(section), "heading": divs[-1]["head"],
                  "agency": agency["head"] if agency else "", "tag": capture["tag"],
                  "rawText": raw, "text": text, "sourceLine": capture["line"]}
        self.output_bytes += len(json.dumps(record, ensure_ascii=False).encode("utf-8"))
        if self.output_bytes > MAX_OUTPUT - 4096:
            raise ValueError("Extracted output exceeds 64 MiB")
        self.authorities.append(record)

    @staticmethod
    def nearest(divs, types):
        return next((frame for frame in reversed(divs) if frame["attrs"].get("TYPE") in types), None)

    @staticmethod
    def section_number(section):
        if section is None:
            return None
        value = section["attrs"].get("N", "").strip()
        return value.lstrip("§ ").strip() or None

    def extract(self, path):
        digest = hashlib.sha256()
        size = 0
        with open(path, "rb") as source:
            if os.fstat(source.fileno()).st_size > MAX_SOURCE:
                raise ValueError("Source exceeds 256 MiB")
            while chunk := source.read(65536):
                size += len(chunk)
                if size > MAX_SOURCE:
                    raise ValueError("Source exceeds 256 MiB")
                digest.update(chunk)
                self.parser.Parse(chunk, False)
        self.parser.Parse(b"", True)
        if self.identity != self.title:
            raise ValueError("Missing source CFR title identity")
        if digest.hexdigest() != self.digest:
            raise ValueError("Source SHA-256 mismatch")
        return {"schemaVersion": "usct.ecfr-bulk-title/v1", "cfrTitle": self.title,
                "sourceSha256": self.digest, "amendmentDateText": "\n".join(self.amendments) if self.amendments else None,
                "authorities": self.authorities}


def main():
    try:
        if len(sys.argv) != 4 or not re.fullmatch(r"[a-f0-9]{64}", sys.argv[3]):
            raise ValueError("Expected file path, CFR title and SHA-256")
        title = int(sys.argv[2])
        if not 1 <= title <= 50:
            raise ValueError("Invalid CFR title")
        output = Extractor(title, sys.argv[3]).extract(sys.argv[1])
        encoded = json.dumps(output, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_OUTPUT:
            raise ValueError("Extracted output exceeds 64 MiB")
        sys.stdout.write(encoded)
    except (OSError, ValueError, expat.ExpatError) as error:
        print(f"eCFR extraction failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
