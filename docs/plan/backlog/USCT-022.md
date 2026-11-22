# USCT-022: Audit corpus coverage locally with reproducible Parquet and DuckDB queries

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M4 — Provide a local research workbench and static topic views

## What it delivers

A researcher can answer repeatable coverage and change questions offline without reading every source file or relying on the web interface.

## Blocked by

- [USCT-018](USCT-018.md)

## Acceptance criteria

- [ ] Export versioned Parquet tables from the accepted local catalog with schema, source-snapshot and artifact hashes.
- [ ] Provide bounded DuckDB query examples for changes by release/title, missing scopes, source freshness and unresolved evidence.
- [ ] Query results agree with the PostgreSQL/file fixture path and distinguish missing data from a verified zero count.
- [ ] Parquet is an analytics/export projection; it does not silently become a second conflicting source of record.

## Independent validation

Use independently calculated fixture counts and sampled rows; compare PostgreSQL and DuckDB results and reproduce exports from identical accepted inputs.

## Demo

Run an offline query showing a missing release and the exact sections changed in the completed scopes.

## Evidence needed to close

- Parquet manifest
- Independent expected counts
- Cross-engine query parity
- Reproduction transcript

## Rollback notes

Regenerate exports from the accepted catalog/source bundle or restore the previous complete export set.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
