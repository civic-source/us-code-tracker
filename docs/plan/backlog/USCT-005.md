# USCT-005: Resume historical imports across a failed middle release

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M0 — Reconcile existing work and repair current trust/history failures

## What it delivers

An operator can recover a failed release without silently losing it when later releases succeed.

## Blocked by

- [USCT-001](USCT-001.md)

## Acceptance criteria

- [ ] Persist completion by exact source release and title/scope, not by a single latest-success cursor.
- [ ] For R1 success, R2 failure and R3 success, resume retries R2 while retaining R1 and R3; duplicate retries do not create duplicate identities.
- [ ] The run remains incomplete while R2 is missing; comparisons spanning the gap declare that gap rather than implying adjacent complete history.
- [ ] Interrupted writes cannot mark an incomplete transformation complete.

## Independent validation

Run the three-release failure scenario with independently specified expected state, including process interruption before/after output promotion.

## Demo

Resume a run containing a failed middle release and show the repaired historical page without reimporting completed releases.

## Evidence needed to close

- Checkpoint ledger before/after
- Recovery transcript
- No-duplicate identity report
- Gap display

## Rollback notes

Restore the preceding checkpoint ledger and immutable artifacts; failed or partial work stays retryable.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
