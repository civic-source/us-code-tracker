# USCT-032: Optionally export an attributed RuleSpec-compatible evidence slice

**Status:** proposed  
**Readiness:** blocked  
**Type:** optional  
**Milestone:** M6 — Evaluate optional compute and RuleSpec interoperability

## What it delivers

An external consumer can inspect a small clearly scoped RuleSpec-compatible export or backlink without changing the authoritative tracker corpus.

## Blocked by

- [USCT-030](USCT-030.md)

## Acceptance criteria

- [ ] Verify the current upstream schema/toolchain and export one reviewed provision/evidence slice with stable identity/version mappings.
- [ ] Keep primary-law data, Axiom CC BY annotations and Apache-licensed tooling attribution separate; do not relabel imported encodings as CC0.
- [ ] Include explicit coverage, unsupported constructs, provenance and interpretation status; no executable encoding is accepted solely because its schema validates.
- [ ] Expose the export as an optional artifact/backlink and preserve the tracker static reader and local workbench when the integration is disabled.

## Independent validation

Independently compare the exported evidence and time semantics to the accepted source fixture, then validate against a pinned upstream reader without assuming legal correctness from a passing parser.

## Demo

Open the export manifest, inspect its evidence/attribution and follow its backlink to the exact tracker version.

## Evidence needed to close

- Pinned upstream contract
- Reviewed export fixture
- License/attribution manifest
- Compatibility and unsupported-scope report

## Rollback notes

Withdraw the optional export/backlink while retaining source records and attributed imported material in its separate layer.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Rulespec-us is a reference/interoperability target, not a substitute authoritative corpus or a required runtime.
