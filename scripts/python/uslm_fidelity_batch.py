"""Bounded public batches reuse the standalone oracle's prepared source and rules."""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

from uslm_fidelity import prepare_source, read_bounded, verify_prepared
from uslm_fidelity_inventory import source_inventory


def require_regular(path: Path) -> None:
    info = path.lstat()
    if path.is_symlink() or not path.is_file() or info.st_nlink != 1:
        raise ValueError("Batch transport must use regular single-link files")


def transport_html(directory: Path, relative: str) -> Path:
    current = directory
    for part in [None] + relative.split("/")[:-1]:
        if part is not None:
            current = current / part
        info = current.lstat()
        if current.is_symlink() or not current.is_dir() or info.st_uid != os.getuid() or info.st_mode & 0o022:
            raise ValueError("Batch HTML ancestry must remain in its owned transport directory")
    path = current / relative.split("/")[-1]
    require_regular(path)
    return path


def batch_checks(source, manifest: Path) -> dict:
    require_regular(manifest)
    value = json.loads(read_bounded(manifest, 1024 * 1024))
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "checks"}:
        raise ValueError("Invalid fidelity batch envelope")
    checks = value["checks"]
    if value["schemaVersion"] != "usct.fidelity-batch/v1" or not isinstance(checks, list) or not 1 <= len(checks) <= 200:
        raise ValueError("Batch requires 1–200 checks for at most 100 source sections")
    ids = set()
    sections = set()
    for item in checks:
        if not isinstance(item, dict) or set(item) != {"id", "section", "html", "fragment"}:
            raise ValueError("Invalid fidelity check envelope")
        if any(not isinstance(item[key], str) or not 0 < len(item[key]) <= 4096 for key in ["id", "section", "html"]):
            raise ValueError("Invalid fidelity check identity or path")
        if not isinstance(item["fragment"], bool) or item["id"] in ids:
            raise ValueError("Duplicate check identity or invalid fragment flag")
        if (not re.fullmatch(r"[A-Za-z0-9_./-]+", item["html"]) or item["html"].startswith("/")
                or any(part in {"", ".", ".."} for part in item["html"].split("/"))):
            raise ValueError("Batch HTML paths must stay inside the manifest transport directory")
        ids.add(item["id"])
        sections.add(item["section"])
    if len(sections) > 100:
        raise ValueError("Batch exceeds 100 selected source sections")
    return {"schemaVersion": "usct.fidelity-batch-result/v1", "source_xml_sha256": source.sha256,
            "checks": [check_page(source, item, manifest.parent) for item in checks]}


def check_page(source, item: dict, directory: Path) -> dict:
    try:
        path = transport_html(directory, item["html"])
        result = verify_prepared(source, item["section"], path, item["fragment"])
        if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > 2 * 1024 ** 2:
            raise ValueError("Independent witness exceeds 2 MiB")
        code = 0 if result["accepted"] else 1
    except (OSError, ValueError, ET.ParseError, RecursionError) as error:
        result = {"accepted": False, "state": "inconclusive", "error": str(error)}
        code = 2
    return {"id": item["id"], "exitCode": code, "result": result}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xml", type=Path, required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument("--manifest", type=Path)
    operation.add_argument("--inventory", action="store_true")
    parser.add_argument("--title")
    parser.add_argument("--release")
    args = parser.parse_args()
    try:
        require_regular(args.xml)
        source = prepare_source(args.xml, args.expected_source_sha256)
        if args.inventory:
            if not args.title or not args.release:
                raise ValueError("Inventory requires explicit title and release")
            result = source_inventory(source, args.title, args.release)
        else:
            result = batch_checks(source, args.manifest)
        raw = json.dumps(result, ensure_ascii=False, sort_keys=True)
        if len(raw.encode("utf-8")) > 32 * 1024 ** 2:
            raise ValueError("Fidelity batch result exceeds 32 MiB")
    except (OSError, ValueError, ET.ParseError, RecursionError) as error:
        print(json.dumps({"accepted": False, "state": "inconclusive", "error": str(error)}))
        return 2
    print(raw)
    return 0 if args.inventory else max(item["exitCode"] for item in result["checks"])


if __name__ == "__main__":
    sys.exit(main())
