# USCT-001: Reconcile the merged plan with current code and work already tracked

**Status:** proposed  
**Readiness:** ready  
**Type:** decision  
**Milestone:** M0 — Reconcile existing work and repair current trust/history failures

## What it delivers

An implementer can identify which proposed capabilities are already complete, partial, absent or superseded and select a genuine ready task.

## Blocked by

None. This is the initial ready frontier.

## Acceptance criteria

- [ ] Pin the tracker/data/related-source commits examined and inventory existing issues, PRs, schemas, workflows and published data identities.
- [ ] Inventory each new schema field against available and missing source evidence, including metadata, temporal endpoints and assertions; map gaps to relevant public/already-authorized sources and an acquisition or explicit-unknown disposition.
- [ ] Map every backlog item to existing work or an explicit new gap; retain completed capabilities and document superseded recommendations.
- [ ] Record local PostgreSQL with required lexical retrieval, optional pgvector ranking, DuckDB/Parquet, optional local Gemma, and static Astro; an HCK/ACQ executor adapter and RuleSpec export remain optional.
- [ ] Publish a reviewable decision register and dependency graph without creating external issues or changing repository policy.

## Independent validation

A second reviewer samples existing-code, existing-issue and new-gap mappings against the pinned sources; detect any recommendation that contradicts current behavior.

## Demo

Walk from an existing implemented feature and a confirmed gap to their disposition and next ready ticket.

## Evidence needed to close

- Snapshot inventory
- Existing-work mapping
- Decision register
- Reviewed blocker graph
- Schema-field-to-source coverage and acquisition-gap matrix

## Rollback notes

Revise the plan records; no product state changes.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Use the current Matt Pocock to-spec/to-tickets methods; do not run an installation or restart already settled interviews. Relevant source discovery and acquisition to resolve these gaps are already authorized under the backlog data-acquisition policy; do not restrict the schema to current repository payloads.
