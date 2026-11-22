# USCT-033: Repair the existing validated data-to-site publication handoff

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M0 — Reconcile existing work and repair current trust/history failures

## What it delivers

A validated data-only change reaches a site built from that exact accepted data identity without waiting for the new enrichment architecture.

## Blocked by

- [USCT-002](USCT-002.md)
- [USCT-006](USCT-006.md)

## Acceptance criteria

- [ ] Use the current data/artifact validation seam to accept a bounded data update, then explicitly update the tracker submodule or equivalent artifact pin before building.
- [ ] Document and exercise the data-promotion-to-pin-update-to-site-build trigger or queue; do not rely on a data-repository push automatically advancing a pinned submodule.
- [ ] Record the accepted data commit/digest, tracker build commit and deployed site identity in a minimal publication receipt; reject an unvalidated candidate or stale/mismatched pin.
- [ ] Keep historical refs immutable and retain the prior complete publication for reversal. This repair does not require new case, regulation, guidance, graph, database or model features.

## Independent validation

Against disposable repositories/pipeline fixtures, promote a validated data-only update, capture its exact identity independently, and verify the resulting pin and site receipt. Inject a failed candidate and a stale pin and verify neither is reported as successfully deployed.

## Demo

Promote a small accepted data correction and show the updated page, exact data pin and site publication receipt; demonstrate restoration of the prior site.

## Evidence needed to close

- Current handoff map
- Validated data promotion receipt
- Exact pin update
- Site identity comparison
- Rejected failed/stale-pinned candidates
- Rollback receipt

## Rollback notes

Republish the previous complete site artifact and data pin; do not force-move historical release refs or claim success from a failed data candidate.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

USCT-001 is inherited through USCT-002/006. This is the minimal repair to the existing publication path; USCT-020 later adds the richer provenance/coverage/cache contract. Current deploy-site checks out submodules, while its path-filtered push trigger does not by itself establish the data-only promotion handoff.

## Observed source references

- [Current data sync workflow](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/.github/workflows/sync-law.yml)
- [Current site checkout, trigger and deployment workflow](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/.github/workflows/deploy-site.yml)
