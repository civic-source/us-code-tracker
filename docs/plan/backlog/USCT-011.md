# USCT-011: Follow a provision through citation changes and uncertain continuity

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M1 — Prove source-to-history-page behavior and the local catalog

## What it delivers

A reader following an old citation can find its historical target and understand renumbering, transfer or unresolved continuity.

## Blocked by

- [USCT-008](USCT-008.md)

## Acceptance criteria

- [ ] Keep stable provision identities separate from citation aliases and versioned location labels.
- [ ] Represent renumbered, transferred, repealed/reserved and split/merged candidates explicitly with evidence and review status.
- [ ] Do not infer continuity solely from similar wording; ambiguous mappings remain unresolved and old URLs remain usable.

## Independent validation

Use independently labeled renumbering, repeal, split and same-number-different-context fixtures; assert exact or ambiguous resolutions through the citation resolver.

## Demo

Follow an old citation to the correct historical version and inspect a transfer notice; show an unresolved split rather than a guessed redirect.

## Evidence needed to close

- Identity/alias fixture set
- Resolver results
- Old-link compatibility evidence

## Rollback notes

Remove an incorrect alias/relationship by superseding it with an evidence-bearing correction; preserve the original assertion and historical URLs.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
