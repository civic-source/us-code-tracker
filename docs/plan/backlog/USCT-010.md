# USCT-010: Preserve rich USLM structure in readable historical output

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M1 — Prove source-to-history-page behavior and the local catalog

## What it delivers

A reader can inspect notes, nested provisions and tables without losing legal structure during XML conversion.

## Blocked by

- [USCT-008](USCT-008.md)

## Acceptance criteria

- [ ] Preserve mixed content, subdivision order, headings, tables, notes, references, amendment/effective-date notes and appendix identifiers represented in the selected fixture.
- [ ] Keep structural anchors usable by evidence records and accessible static rendering; unsupported structures produce explicit findings.
- [ ] Differentiate source text changes from rendering/normalization changes in comparison metadata.

## Independent validation

Use an independently annotated complex USLM fixture and compare semantic text, ordering, table cells, notes and anchors; visually inspect generated pages.

## Demo

Read and compare a table-and-note-heavy section with a link from a rendered clause back to its XML evidence.

## Evidence needed to close

- Reviewed expected structure
- Fidelity report
- Accessible rendered pages
- Unsupported-element findings

## Rollback notes

Retain raw XML and previous projection versions; revert the renderer/transformer projection without rewriting source identities.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
