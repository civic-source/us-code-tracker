# USCT-020: Carry an accepted data release into the exact deployed site manifest

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M3 — Update independently and publish an exactly pinned static snapshot

## What it delivers

An operator and reader can prove that a published site was built from the intended accepted data release.

## Blocked by

- [USCT-018](USCT-018.md)
- [USCT-033](USCT-033.md)

## Acceptance criteria

- [ ] Define one explicit sequence: validate data candidate, promote immutable data identity, update the tracker submodule/artifact pin, build from that exact pin, then deploy a manifest-bound artifact.
- [ ] A data-only promotion triggers or queues the pin update and deployment through the documented mechanism; it cannot leave the site silently on an older submodule commit.
- [ ] Record data commit/artifact digest, tracker producer commit, schema/config identities, validation result and site artifact digest in the deployment manifest.
- [ ] Reject mismatched pin/manifest or partial-required-scope promotion; source scraping and publication credentials remain separated.

## Independent validation

Use a disposable pipeline fixture to promote two distinct data releases, inject stale-pin and wrong-artifact failures, and compare deployed manifest hashes to independently captured inputs.

## Demo

Promote a data-only change and trace it from data identity through pin change to the site footer/manifest.

## Evidence needed to close

- Promotion event record
- Pin update evidence
- Build/deployment manifest
- Mismatch rejection
- Rollback rehearsal

## Rollback notes

Deploy the prior complete immutable site artifact and manifest; do not rewrite data tags or mix artifact generations.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

USCT-033 repairs the existing data-to-site handoff early. This ticket extends that working path with the complete new provenance, scope, dependency and deployment-manifest contract; it does not wait for every external enrichment adapter.
