# USCT-021: Explore verified legal relationships in a bounded static reader view

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M3 — Update independently and publish an exactly pinned static snapshot

## What it delivers

A reader can follow typed relationships from a section without downloading the entire corpus or confusing evidence with certainty.

## Blocked by

- [USCT-014](USCT-014.md)
- [USCT-015](USCT-015.md)
- [USCT-016](USCT-016.md)
- [USCT-018](USCT-018.md)

## Acceptance criteria

- [ ] Export bounded neighborhood/relationship shards with IDs, direction, type, source-version context and verification status.
- [ ] Offer accessible list/table navigation with an optional graph view; unresolved or candidate edges remain distinguishable.
- [ ] Load only the requested shard and preserve deep links, keyboard operation and a no-model static runtime.
- [ ] A changed relationship rebuilds the relevant neighborhoods through the build DAG.

## Independent validation

Compare a manually enumerated small legal graph against exported neighborhoods and browser navigation; verify that unrelated shards remain unchanged.

## Demo

Navigate section to public law, regulation and case evidence using both keyboard list view and optional graph view.

## Evidence needed to close

- Expected relationship graph
- Shard/index evidence
- Browser accessibility checks
- Incremental shard comparison

## Rollback notes

Disable the graph visualization while retaining the accessible list and stable evidence links; republish prior shards as a coherent bundle.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
