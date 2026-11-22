# USCT-027: Scale historical backfill with complete scope accounting and bounded resources

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M5 — Backfill, validate, cut over and operate recoverably

## What it delivers

An operator can process the intended corpus and history in batches with a truthful completeness report and controlled storage/compute use.

## Blocked by

- [USCT-022](USCT-022.md)
- [USCT-026](USCT-026.md)

## Acceptance criteria

- [ ] Enumerate the intended source/title/release scope from verified catalogs rather than hardcoded page/display caps.
- [ ] Backfill newly introduced metadata, temporal endpoint and assertion/evidence fields across relevant public/already-authorized sources, acquiring/refetching missing documents as needed while retaining exact raw versions and provenance.
- [ ] Run resumable batches with bounded concurrency, memory, disk and retry budgets; record failures per scope.
- [ ] Measure artifact growth, ingest cost and query/export performance before setting production defaults; use Parquet/DuckDB reports to verify accounting.
- [ ] Claim completeness only for an enumerated declared scope whose required partitions are all accepted. Exclusions and unavailable data remain visible and narrow the coverage claim; they cannot satisfy a missing required partition or be counted as successful completion.
- [ ] Keep acquisition/processing completeness separate from semantic certainty: a fully processed source scope can contain explicit unknown, conditional or disputed legal facts, but unavailable required partitions cannot count as complete.

## Independent validation

Reconcile exact expected and completed identity sets, independently audit sampled titles/releases, and replay forced interruption/resource exhaustion.

## Demo

Resume a multi-batch backfill and show the shrinking incomplete-scope report with measured resource use.

## Evidence needed to close

- Scope reconciliation
- Resource benchmark
- Sample audit
- Interrupted-run recovery
- Artifact inventory
- Cross-source schema-field backfill and semantic-certainty report

## Rollback notes

Pause workers and resume from committed accepted scopes; restore a known catalog checkpoint without deleting immutable sources.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Relevant source discovery, acquisition and schema backfills are authorized, including sources absent from the current repository. Respect per-source limits and license/reuse basis. Never fabricate a date, endpoint or assertion solely to fill a schema field.
