# USCT-036: Search a selected historical release using bounded static shards

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M3 — Update independently and publish an exactly pinned static snapshot

## What it delivers

A reader can search one selected historical release and open results from that exact release while using only published static assets.

## Blocked by

- [USCT-011](USCT-011.md)
- [USCT-018](USCT-018.md)

## Acceptance criteria

- [ ] Publish bounded release/title search shards and their index manifest for a small representative historical slice, with canonical provision/version IDs and source-scope completeness.
- [ ] A query preserves the exact selected release through filters, results and navigation; current text or a different release is never silently substituted.
- [ ] Missing or incomplete historical coverage is visible instead of falling back to current results without consent; aliases resolve in the selected historical context.
- [ ] The browser requires no live source API, hosted database, embedding runtime or model; load only the selected bounded shards and preserve accessible keyboard interaction.

## Independent validation

Create two independently labeled release fixtures where a distinctive term exists only in one version, plus a renumbered citation and an absent shard. With runtime APIs blocked, verify exact expected matches, result-version links and explicit incomplete states.

## Demo

Search the distinctive term in each historical release, open a result that stays pinned to that release and show the missing-shard state without current-text leakage.

## Evidence needed to close

- Synthetic historical search fixture and expected matches
- Release/title shard manifest
- Exact-version navigation evidence
- Blocked-API browser log
- Shard size and accessibility check

## Rollback notes

Disable the historical search mode or republish the preceding coherent shard/manifest bundle; retain explicit release selection and do not silently replace results with current search.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Scope the first delivery to two releases and a bounded title slice. Corpus-wide artifact sizing is handled by USCT-027; final reader acceptance consumes this behavior through USCT-029.
