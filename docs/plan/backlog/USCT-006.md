# USCT-006: Protect published release identities from replacement

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M0 — Reconcile existing work and repair current trust/history failures

## What it delivers

A bookmarked or pinned release always resolves to the same published content.

## Blocked by

- [USCT-001](USCT-001.md)

## Acceptance criteria

- [ ] Remove force replacement of published release tags/identities; an existing identity with different bytes produces an explicit collision failure.
- [ ] An idempotent rerun of identical content is a no-op; corrections receive a new revision identity and a supersession link.
- [ ] Existing public links remain resolvable and a promotion log records the correction relationship.

## Independent validation

Attempt identical and conflicting re-publications against a disposable fixture repository; independently compare refs and hashes before/after.

## Demo

Show a collision rejection followed by a new correction revision while the original URL still resolves.

## Evidence needed to close

- Identity collision test
- Immutable ref/hash report
- Supersession example

## Rollback notes

Repoint only the mutable current-publication pointer to a prior immutable release; do not force-move historical tags.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
