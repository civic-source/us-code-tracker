"""Public prepared-source equivalence; literals are synthetic test inputs."""
import argparse
import hashlib
from pathlib import Path
import tempfile
import unittest

from uslm_fidelity import prepare_source, verify, verify_prepared
from test_uslm_fidelity import XML, HTML


class PreparedSourceControls(unittest.TestCase):
    def test_prepared_checks_equal_standalone_for_positive_and_all_lane_negative_controls(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            xml = root / "source.xml"
            html = root / "page.html"
            xml.write_text(XML)
            digest = hashlib.sha256(xml.read_bytes()).hexdigest()
            prepared = prepare_source(xml, digest)
            for value in [HTML, HTML.replace("not ", ""), HTML.replace("(Source.)", ""), HTML.replace("Note.", "")]:
                html.write_text(value)
                args = argparse.Namespace(xml=xml, html=html, section="/test/section", expected_source_sha256=digest, fragment=True)
                self.assertEqual(verify(args), verify_prepared(prepared, "/test/section", html, True))


if __name__ == "__main__":
    unittest.main()
