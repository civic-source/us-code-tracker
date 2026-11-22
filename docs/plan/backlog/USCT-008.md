# USCT-008: Trace one source release through a canonical historical section page

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M1 — Prove source-to-history-page behavior and the local catalog

## What it delivers

A reader can inspect a selected historical section and follow its version, source bytes, citation and date evidence end to end.

## Blocked by

- [USCT-002](USCT-002.md)
- [USCT-005](USCT-005.md)
- [USCT-006](USCT-006.md)
- [USCT-007](USCT-007.md)

## Acceptance criteria

- [ ] Preserve source bundle hash, provision identity, provision-version identity, citation aliases and exact source evidence anchors for a bounded representative fixture.
- [ ] Fetch or refetch relevant public/already-authorized source documents when the canonical fixture lacks required schema evidence, preferring official bulk/API paths and preserving each raw version with source identity, hash, observation time and license/reuse basis.
- [ ] Separate release/source-as-of, observed/processed, enacted and effective/applicability dates; unsupported dates remain unknown.
- [ ] Produce a static Astro history page and comparison from the same canonical fixture without a runtime database or model.
- [ ] Changing only a retrieval timestamp does not invent a new legal content version.

## Independent validation

A manually reviewed two-version USLM fixture has explicit expected text, IDs, evidence anchors and dates; compare the page and machine-readable artifacts against those expectations.

## Demo

Select an older version, inspect its evidence panel and compare it with the next observed version.

## Evidence needed to close

- Fixture source bundle and hash
- Canonical records
- Rendered history/comparison
- Date provenance review
- Source acquisition/refetch manifest and preserved raw-version inventory

## Rollback notes

Keep legacy readers and artifacts available during expansion; withdraw the new projection without changing source history.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Ordinary in-scope acquisition and refetches are already authorized. Use per-source limits and resumable collection; preserve previous raw versions instead of overwriting them. This ticket still demonstrates a bounded fixture before larger backfill.
