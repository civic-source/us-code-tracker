"""Public prepared-source and batch controls; literals are synthetic test inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from uslm_fidelity import verify
from test_uslm_fidelity import XML, HTML


class PreparedSourceControls(unittest.TestCase):
    def test_batch_cli_preserves_positive_and_negative_standalone_reports(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            xml = root / "source.xml"
            xml.write_text(XML)
            digest = hashlib.sha256(xml.read_bytes()).hexdigest()
            checks = []
            expected = []
            for number, value in enumerate([HTML, HTML.replace("Note.", "")]):
                html = root / f"{number}.html"
                html.write_text(value)
                checks.append({"id": str(number), "section": "/test/section", "html": html.name, "fragment": True})
                expected.append(verify(argparse.Namespace(xml=xml, html=html, section="/test/section",
                                                          expected_source_sha256=digest, fragment=True)))
            manifest = root / "checks.json"
            manifest.write_text(json.dumps({"schemaVersion": "usct.fidelity-batch/v1", "checks": checks}))
            result = subprocess.run([sys.executable, "-B", str(Path(__file__).with_name("uslm_fidelity_batch.py")),
                                     "--xml", str(xml), "--expected-source-sha256", digest, "--manifest", str(manifest)],
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            value = json.loads(result.stdout)
            self.assertEqual([item["result"] for item in value["checks"]], expected)
            self.assertEqual([item["exitCode"] for item in value["checks"]], [0, 1])

    def test_inventory_exposes_grouped_identities_and_excludes_nested_quote_sections(self):
        xml_text = '<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0"><meta><docPublicationName>Online@119-142</docPublicationName></meta><main><title identifier="/us/usc/t18"><chapter identifier="/us/usc/t18/ch1"><section identifier="/us/usc/t18/s1"><num>1.</num><quotedContent><section identifier="/quoted/section"><num>99.</num></section></quotedContent></section><section identifier="/us/usc/t18/s2...3"><num>2–3.</num></section></chapter></title></main></uscDoc>'
        with tempfile.TemporaryDirectory() as temporary:
            xml = Path(temporary) / "source.xml"
            xml.write_text(xml_text)
            digest = hashlib.sha256(xml.read_bytes()).hexdigest()
            result = subprocess.run([sys.executable, "-B", str(Path(__file__).with_name("uslm_fidelity_batch.py")),
                                     "--xml", str(xml), "--expected-source-sha256", digest, "--inventory",
                                     "--title", "18", "--release", "PL 119-142"], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report["topLevelSourceRecords"], 2)
            self.assertEqual(report["excludedNestedSections"], 1)
            self.assertEqual([item["identityState"] for item in report["records"]],
                             ["canonical_single", "noncanonical_group_or_range"])
            self.assertEqual(report["records"][0]["path"], "statutes/title-18/chapter-1/section-1.md")
            self.assertIsNone(report["records"][1]["path"])

    def test_batch_manifest_cannot_read_html_outside_its_transport_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            xml = root / "source.xml"
            xml.write_text(XML)
            secret = root / "outside.html"
            secret.write_text("<p>PRIVATE_BOUNDARY_SENTINEL</p>")
            work = root / "transport"
            work.mkdir()
            manifest = work / "checks.json"
            (work / "nested").symlink_to(root, target_is_directory=True)
            for unsafe in ["../outside.html", str(secret), "nested/outside.html"]:
                with self.subTest(path=unsafe):
                    manifest.write_text(json.dumps({"schemaVersion": "usct.fidelity-batch/v1", "checks": [
                        {"id": "outside", "section": "/test/section", "html": unsafe, "fragment": True}]}))
                    result = subprocess.run([sys.executable, "-B", str(Path(__file__).with_name("uslm_fidelity_batch.py")),
                                             "--xml", str(xml), "--expected-source-sha256", hashlib.sha256(xml.read_bytes()).hexdigest(),
                                             "--manifest", str(manifest)], capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                    self.assertNotIn("PRIVATE_BOUNDARY_SENTINEL", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
