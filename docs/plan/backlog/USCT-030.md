# USCT-030: Cut over by immutable publication pointer and rehearse reversal

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M5 — Backfill, validate, cut over and operate recoverably

## What it delivers

Users receive the accepted new publication while historical links and an immediate rollback remain intact.

## Blocked by

- [USCT-029](USCT-029.md)

## Acceptance criteria

- [ ] Promote only the exact data/site bundle accepted by the final gate, recording deployment identity and coverage.
- [ ] Verify legacy URLs, feeds, historical release links and current-page selection after cutover.
- [ ] Rehearse switching to the prior complete immutable publication without force-moving historical refs or mixing manifests.
- [ ] Contract/remove obsolete schema paths only after all consumers have migrated and a separate reviewed cleanup proves none remain.

## Independent validation

Compare the live publication manifest to the accepted bundle and independently check a fixed old/new URL set before and after rollback rehearsal.

## Demo

Switch to the accepted publication, follow a legacy history link, then demonstrate restoration of the prior publication in a controlled environment.

## Evidence needed to close

- Cutover receipt
- Accepted/deployed manifest comparison
- URL compatibility result
- Rollback receipt
- Consumer migration inventory

## Rollback notes

Restore the previous publication pointer and complete site artifact; keep new source/data identities available for investigation.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

The plan does not authorize an actual external deployment now; execution follows the user-approved repository release process.
