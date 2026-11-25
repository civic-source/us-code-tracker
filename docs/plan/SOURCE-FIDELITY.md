# Scoped source-to-page fidelity checks

`scripts/python/uslm_fidelity.py` independently parses pinned USLM XML and a rendered HTML page using Python's standard library. It does not call the production transformer or use its output as the source oracle. Acquisition provenance must independently establish the publisher and release; a matching digest proves byte identity.

```bash
python3 scripts/python/uslm_fidelity.py \
  --xml /path/to/pinned/usc18.xml \
  --expected-source-sha256 d7cee2875371e43ada68ec936bc43fe5e8be62b86fa8175cabd8c80c261232c2 \
  --html /path/to/built/statute/title-18/chapter-7/section-111/index.html \
  --section /us/usc/t18/s111
```

The digest above identifies the `usc18.xml` member of the official PL 119-142 Title 18 ZIP (`14d9cf0ecaeb557246546fb837d2fa2e0871ae0d73e27ab8ea954d0f1de57836`). Keep the retained archive, member digest, release identity and acquisition record with the check. Select the actual matching source for a different release.

The default page root is exactly one `#current-statute-body`. `--fragment` checks a standalone renderer fragment; it does not establish a completed site build. Run the default mode against final built HTML before accepting that publication, and re-fetch the same page and publication receipt for deployment verification.

The JSON result names the exact source and HTML hashes, section identity, normalization version, checked scope, word counts, unknown source nodes and first mismatches. Exit codes are:

- `0`: the declared text and placement scope passes.
- `1`: an observed mismatch or an unqualified structure rejects acceptance.
- `2`: missing or ambiguous inputs, digest mismatch, unsupported encoding, prohibited DTD/entities, malformed HTML/XML or resource limits prevent comparison.

Every nonzero exit blocks acceptance for the affected scope. Source input must be UTF-8, at most 128 MiB; HTML is capped at 16 MiB, 128 levels and 200,000 elements. DTD and entity declarations are rejected before XML parsing, including alternate-encoding attempts.

Normalization performs NFC and presentation whitespace collapsing only. It preserves case, punctuation, signs and negation. Operative text, source credits and editorial notes compare separately; notes cannot satisfy a missing operative clause. Numbered provisions and continuations must retain their source parent marker paths and exact multiplicity. Subsection headings must remain in that parent's own content. Unknown text-bearing nodes are counted with member-relative locators and reject acceptance. Tables and footnote structures explicitly remain unqualified by this initial checker, even if their plain text matches; they need additional structural witnesses.

This scope does not certify citation-target resolution, table spans, footnote target identity, applicability, legal conclusions, full-title coverage or source-offset mappings. Track those acceptance conditions separately. The corresponding producer and data revision must still pass the protected review, candidate-data, build, browser and publication receipt gates. A passing renderer fixture or an engineering consensus vote cannot replace those gates.

Regression commands:

```bash
python3 -m unittest discover -s scripts/python -p test_uslm_fidelity.py
pnpm --filter @civic-source/web exec vitest run src/__tests__/operative-continuations.test.ts
```

The browser-independent renderer regressions invoke the real CLI on pinned official sections 19, 111 and 1001. They also invoke it on ten corrupted page variants. Separate synthetic controls cover repeated text, provenance, semantic lanes, source encodings, parser limits and unqualified structures. Synthetic controls are test data and are never published as statutory sources.
