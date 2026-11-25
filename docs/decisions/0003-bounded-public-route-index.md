# ADR 0003: Publication-pinned section routes and explicit navigation gaps

Status: accepted for source implementation

## Context

A citation identifies a title and section but the site's section URLs also contain
a chapter. Ranked, bounded full-text search is not a complete exact-route lookup.
Section-only matching can select another title, and constructing a title fragment
cannot establish that the requested section exists. Numeric coercion also loses
appendix and alphanumeric identifiers.

## Decision

Derive a static `usct.route-index/v1` document per collected title from the same
accepted Astro collection entry IDs used to build the section pages. Its identity
contains publication ID, accepted data commit, release ID and title ID. Entries
retain the section literal, exact relative section path and existing disposition.
The index has no statutory text, inferred legal relationships or authority to
accept source data. Duplicate section identities remain explicit candidates.

Fetch only the requested title and cache under the complete identity. Enforce a
2 MiB response limit before JSON parsing, strict field/path validation and exact
publication/data/release/title agreement. The build checks the actual clean Git
commit, including refusal of untracked source files. HTTP limits apply to decoded
bytes; compressed wire lengths are not compared to decoded JSON lengths. Paths must remain relative to the same
site's configured base. Malformed, mismatched, missing and ambiguous inputs never
produce a guessed chapter or silently substitute a different edition.

Current navigation uses the current publication's index. Historical navigation
uses only retained historical records allowed by the withdrawal boundary; current
collection entries never generate historical content or coverage. Missing records
retain the requested edition and expose an availability explanation and recovery
links. Pinpoints stay in the destination URL. A missing local subsection anchor
means unavailable in this representation, not that the law lacks that subsection.
Standalone section rendering uses the same sanitized Markdown processor with a
structural anchor plugin before notes headings. Only the cloned rendered HTML
changes; accepted body text and source-withdrawal predicates remain untouched.
Chapter rollups receive no subsection IDs, preserving uniqueness per document.
Exact citation lookup remains usable when full-text search assets are unavailable.

Keep title and chapter identifiers as strings. Known appendices or reserved titles
without collected pages have explicit unavailable labels rather than invented
routes. A route's availability does not establish its source fidelity or legal
status. Official chapter headings need an edition-specific publisher witness;
otherwise the label is generic and any example provision is identified as such.

Directory subject aliases are reviewed presentation aids, separate from official
title names. Query/category filters are shareable URL state with browser Back
restoration; display mode remains a local preference.

## Verification and publication boundary

Exercise public filter/link journeys and the resolver API. Require malformed and
oversized payload refusals, pin mismatches, cross-title collisions, duplicate
ambiguity and missing historical inputs. Check every emitted route-index path
against actual static output, and verify subsection navigation at the real DOM.

This adds no dependencies, services, CI changes or accepted corpus mutations.
Source-text fidelity and constructed-history withdrawal remain independent gates.
A model vote chooses the engineering approach and cannot authorize a legal claim
or publication. The actual seven-role Nexus vote selected the bounded index
unanimously (`vote-1795567824902-g65hmki`); serving identities were unmeasured.
