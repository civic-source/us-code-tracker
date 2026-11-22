# USCT-018: Rebuild safely when content, producer, schema or configuration changes

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M3 — Update independently and publish an exactly pinned static snapshot

## What it delivers

An operator gets correct cache reuse and bounded invalidation, including changes to previously absent or collection-valued inputs.

## Blocked by

- [USCT-009](USCT-009.md)
- [USCT-012](USCT-012.md)

## Acceptance criteria

- [ ] Artifact keys include normalized input identities/hashes, producer version, schema version and relevant configuration; model/prompt/index identities are included when applicable.
- [ ] Persist a build dependency DAG distinct from legal relationships, including negative lookups and collection-membership inputs.
- [ ] Adding a previously missing citation target or a new item to a result collection invalidates dependents; unrelated retrieval timestamps do not.
- [ ] Fail incomplete dependency extraction explicitly instead of silently treating skipped inputs as an empty dependency set.

- [ ] Produce an inspectable pre-acceptance impact report listing the affected provisions, assertions, pages, search shards and exports from the recorded dependency graph.

## Independent validation

Mutate one input dimension at a time against an independent expected invalidation matrix, including absent-to-present and collection-add/remove cases; compare clean and incremental output hashes.

## Demo

Show cache hits for unchanged inputs, a required rebuild after a producer/schema change, and a newly resolved formerly missing citation.

## Evidence needed to close

- Key specification examples
- Expected invalidation matrix
- Clean/incremental parity
- Dependency coverage report

## Rollback notes

Discard affected caches and perform a clean replay from pinned sources; immutable accepted artifacts remain available.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
