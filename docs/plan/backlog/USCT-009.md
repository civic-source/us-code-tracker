# USCT-009: Load and query the canonical fixture in the local PostgreSQL workbench

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M1 — Prove source-to-history-page behavior and the local catalog

## What it delivers

A researcher can ingest the same fixture locally, query its provisions and evidence, and export the same static page inputs.

## Blocked by

- [USCT-008](USCT-008.md)

## Acceptance criteria

- [ ] Provide an opt-in local PostgreSQL catalog with migrations and constrained provision/version/evidence relationships; retain a file-backed fixture/replay path.
- [ ] A public CLI/query interface retrieves the selected provision from an explicit as-published release snapshot and separately reports actual recorded source-observation and processing timestamps; it does not equate a publication date with when the tracker first knew the content.
- [ ] Exported static artifacts agree with the file-fixture path; PostgreSQL is not required to view or host the published Astro site.
- [ ] Repeat ingestion is idempotent, and a failed transaction leaves no half-published version.

## Independent validation

Load the independently reviewed fixture in a disposable database and the file replay path; compare query results and exported artifact hashes.

## Demo

Query a selected as-published historical release locally, inspect its separate actual observation timestamp and build the static page from that pinned snapshot.

## Evidence needed to close

- Migration and replay transcript
- Database constraints result
- File/database parity report
- Static export

## Rollback notes

Restore a tested local database backup or rebuild from immutable source bundles; keep prior artifact readers compatible.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

USCT-009 proves catalog/replay parity and explicit publication versus observation fields. USCT-034 owns the complete bounded temporal query modes and evidence-backed applicability result contract.
