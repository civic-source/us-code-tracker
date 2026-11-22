# USCT-012: Publish per-scope completeness and source freshness beside the text

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M1 — Prove source-to-history-page behavior and the local catalog

## What it delivers

Readers can tell precisely which titles, releases and annotation families are complete, partial, stale or unavailable.

## Blocked by

- [USCT-008](USCT-008.md)

## Acceptance criteria

- [ ] Generate a manifest that declares intended and completed source/title/release scopes, failures, skipped inputs and freshness.
- [ ] A complete statute slice cannot mask a failed case/regulation slice, and a fresh retrieval does not imply fresh legal content.
- [ ] Historical pages and machine-readable exports expose the relevant scope state without requiring live source calls.

## Independent validation

Build a fixture with one complete title, one missing release and one failed annotation source; compare displayed badges and manifest scopes to an independent expected matrix.

## Demo

Inspect two pages with different coverage states and drill into the exact missing source/release.

## Evidence needed to close

- Expected coverage matrix
- Manifest schema/result
- Rendered completeness evidence

## Rollback notes

Restore the last validated manifest together with its artifact bundle; never publish a newer success claim over older incomplete data.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
