# USCT-035: Reject stale local task attempts before accepting their artifacts

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M3 — Update independently and publish an exactly pinned static snapshot

## What it delivers

An operator can retry or supersede a local processing job without an older worker later publishing stale output over the new accepted generation.

## Blocked by

- [USCT-018](USCT-018.md)

## Acceptance criteria

- [ ] Implement a minimal local TaskAttempt lifecycle with stable task identity, input generation, attempt identity, lease, monotonically advancing fencing token and explicit terminal outcome.
- [ ] Accept/promote an artifact only through an atomic compare-and-swap check against the current generation, required input identities and valid attempt/fencing ownership; expired or superseded attempts cannot win.
- [ ] An identical accepted retry is idempotent; a changed input generation creates a new candidate and invalidates prior acceptance authority without rewriting immutable prior artifacts.
- [ ] Expose attempt state and rejection reason through the existing local job/report interface; ordinary local execution remains available without a distributed scheduler or orchestration service.

## Independent validation

Use a controlled two-worker fixture: worker A stalls, its lease/generation is superseded, worker B accepts the new generation, then A completes. Assert independently that only B’s artifact is current. Also exercise duplicate acceptance, lease expiry and interruption before/after the atomic acceptance commit.

## Demo

Run one small rebuild twice with a deliberate stale worker; show the new generation accepted, the old attempt fenced out and a duplicate retry safely treated as a no-op.

## Evidence needed to close

- TaskAttempt state-transition contract
- Old-worker rejection transcript
- Generation/fencing acceptance test
- Idempotency/crash-recovery results
- Accepted artifact identity report

## Rollback notes

Stop affected attempts, retain the last accepted immutable artifact and resume with a fresh generation/fencing token; do not recover by allowing stale workers to promote.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

This is a small local acceptance invariant used by USCT-019, not a distributed scheduler, queue platform or generalized workflow framework. Existing catalog/transaction facilities may supply the atomic compare-and-swap.
