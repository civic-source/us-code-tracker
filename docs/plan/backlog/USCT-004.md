# USCT-004: Present CourtListener snippets as retrieval evidence, not holdings

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M0 — Reconcile existing work and repair current trust/history failures

## What it delivers

A reader sees what a case-search result actually establishes and can follow the opinion source.

## Blocked by

- [USCT-001](USCT-001.md)

## Acceptance criteria

- [ ] Migrate search snippets from holding-summary semantics to an explicitly labeled retrieval excerpt with source and retrieval context.
- [ ] Do not infer a holding, interpretation, invalidation or binding precedential effect from a search result alone.
- [ ] Retain separately verified annotations with their evidence/status and preserve compatibility with existing case sidecars.

## Independent validation

Replay a snippet that mentions a statute in passing and an independently reviewed opinion excerpt; verify that only the latter can carry a reviewed legal proposition.

## Demo

Compare an unreviewed search hit and a reviewed case annotation in the reader interface.

## Evidence needed to close

- Migration compatibility result
- Snippet/opinion fixtures
- Rendered labels

## Rollback notes

Retain old sidecars as source records and hide unverified propositions; do not recreate asserted holdings from snippets.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
