"""Public gate controls; synthetic examples are test data, never statutory sources."""

import argparse
import hashlib
from pathlib import Path
import tempfile
import unittest

from uslm_fidelity import verify


XML = '<uscDoc><section identifier="/test/section"><num>1.</num><heading>Example</heading><subsection><num>(a)</num><heading>General.—</heading><chapeau>Start—</chapeau><paragraph><num>(1)</num><content>First.</content></paragraph><continuation>shall not stop.</continuation></subsection><sourceCredit>(Source.)</sourceCredit><notes><note><heading>Editorial</heading><p>Note.</p></note></notes></section></uscDoc>'
HTML = '<h1>1. Example</h1><ul><li><p><strong>(a)</strong> General.— Start—</p><ul><li><strong>(1)</strong> First.</li></ul><p>shall not stop.</p></li></ul><h2>Source Credit</h2><p>(Source.)</p><h2>Notes</h2><p>Editorial Note.</p>'


class SourceFidelityControls(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="civic-fidelity-control-")
        self.directory = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def check(self, xml=XML, html=HTML, fragment=True, expected_hash=None):
        source = self.directory / "source.xml"
        page = self.directory / "page.html"
        source.write_bytes(xml if isinstance(xml, bytes) else xml.encode("utf-8"))
        page.write_text(html)
        digest = expected_hash or hashlib.sha256(source.read_bytes()).hexdigest()
        return verify(argparse.Namespace(xml=source, html=page, section="/test/section",
                                         expected_source_sha256=digest, fragment=fragment))

    def test_valid_lanes_and_parent_paths(self):
        self.assertTrue(self.check()["accepted"])

    def test_whole_page_requires_exact_statute_root(self):
        self.assertTrue(self.check(html=f'<html><body><div id="current-statute-body">{HTML}</div></body></html>',
                                   fragment=False)["accepted"])
        with self.assertRaisesRegex(ValueError, "root is missing"):
            self.check(fragment=False)

    def test_nonunique_roots_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "nonunique"):
            self.check(html=f'<div id="current-statute-body">{HTML}</div><div id="current-statute-body"></div>',
                       fragment=False)

    def test_source_digest_is_mandatory(self):
        with self.assertRaisesRegex(ValueError, "digest mismatch"):
            self.check(expected_hash="0" * 64)

    def test_dtd_entities_are_rejected_before_parsing(self):
        with self.assertRaisesRegex(ValueError, "DTD and entity"):
            self.check(xml='<!DOCTYPE uscDoc [<!ENTITY x "injected">]>' + XML)

    def test_alternate_encoding_cannot_bypass_entity_rejection(self):
        with self.assertRaisesRegex(ValueError, "encoding must be UTF-8"):
            self.check(xml=('<!DOCTYPE uscDoc [<!ENTITY x "injected">]>' + XML).encode("utf-16"))

    def test_excessive_html_nesting_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "nesting or element count"):
            self.check(html="<div>" * 140 + HTML + "</div>" * 140)

    def test_unknown_text_is_located_and_rejected(self):
        xml = XML.replace("First.", "First.<unknown>Extra.</unknown>")
        report = self.check(xml=xml, html=HTML.replace("First.", "First.Extra."))
        self.assertFalse(report["accepted"])
        self.assertIn("/test/section/subsection[3]/paragraph[4]/content[2]/unknown[1]",
                      [row["locator"] for row in report["unknown_elements"]])

    def test_repeated_surface_text_retains_exact_source_multiplicity(self):
        continuation = "<continuation>shall not stop.</continuation>"
        paragraph = "<p>shall not stop.</p>"
        xml = XML.replace(continuation, continuation * 2)
        html = HTML.replace(paragraph, paragraph * 2)
        self.assertTrue(self.check(xml=xml, html=html)["accepted"])
        self.assertFalse(self.check(xml=xml, html=HTML)["accepted"])

    def test_duplicate_and_moved_continuations_fail(self):
        paragraph = "<p>shall not stop.</p>"
        self.assertFalse(self.check(html=HTML.replace(paragraph, paragraph * 2))["accepted"])
        moved = HTML.replace(paragraph, "").replace("<h2>Source Credit</h2>", paragraph + "<h2>Source Credit</h2>")
        report = self.check(html=moved)
        self.assertFalse(report["accepted"])
        self.assertIn("continuation_parent_or_count", [row["reason"] for row in report["issues"]])

    def test_numbered_clause_cannot_change_parent_with_identical_visible_text(self):
        xml = XML.replace("</paragraph>", "</paragraph><paragraph><num>(2)</num><content>Second.</content></paragraph>")
        html = HTML.replace("First.</li>", "First.<ul><li><strong>(2)</strong> Second.</li></ul></li>")
        self.assertFalse(self.check(xml=xml, html=html)["accepted"])

    def test_negation_case_punctuation_and_source_credit_are_significant(self):
        for old, new in [("not ", ""), ("shall", "Shall"), ("stop.", "stop!"), ("(Source.)", "")]:
            with self.subTest(old=old):
                self.assertFalse(self.check(html=HTML.replace(old, new))["accepted"])

    def test_nfc_and_presentation_whitespace_only(self):
        xml = XML.replace("First.", "Cafe\u0301.")
        html = HTML.replace("First.", "Café.\n\t")
        self.assertTrue(self.check(xml=xml, html=html)["accepted"])

    def test_editorial_content_cannot_be_substituted_for_operative(self):
        moved = HTML.replace("<p>shall not stop.</p>", "") + "<p>shall not stop.</p>"
        self.assertFalse(self.check(html=moved)["accepted"])

    def test_unqualified_table_and_footnote_structure_fail_closed(self):
        for addition in ['<table><tr><td>Extra.</td></tr></table>', '<note role="footnote">Extra.</note>']:
            with self.subTest(addition=addition):
                report = self.check(xml=XML.replace("</section>", addition + "</section>"))
                self.assertFalse(report["accepted"])
                self.assertIn("table_or_footnote_structure_not_qualified", [row["reason"] for row in report["issues"]])

    def test_nonunique_section_identity_and_malformed_html_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "nonunique"):
            self.check(xml=XML.replace("</uscDoc>", '<section identifier="/test/section" /></uscDoc>'))
        with self.assertRaisesRegex(ValueError, "Unbalanced"):
            self.check(html="<p>text</li>")


if __name__ == "__main__":
    unittest.main()
