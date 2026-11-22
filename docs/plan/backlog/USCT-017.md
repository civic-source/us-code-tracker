# USCT-017: Expose unresolved evidence and shrinking quality exceptions

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M2 — Attach verified legal context and explicit uncertainty

## What it delivers

A reviewer can find and resolve an ambiguous citation, source discrepancy or unsupported structure without hiding it from coverage reporting.

## Blocked by

- [USCT-012](USCT-012.md)
- [USCT-014](USCT-014.md)
- [USCT-034](USCT-034.md)

## Acceptance criteria

- [ ] Create a typed finding register with evidence, affected scopes, owner, issue/reference, fingerprint, status and expiry where appropriate.
- [ ] Keep conflicting readings and their adopters separate from authoritative law; project review is never labeled an official ruling.
- [ ] New unapproved exceptions and stale fixed exceptions fail the selected quality gate; unavailable sources remain explicit failures, not waivers by default.
- [ ] Resolve one real fixture finding and update its reader-visible status and coverage.

- [ ] Expose a bounded private review inbox over the finding register, showing source changes, affected published outputs and unresolved identity/applicability decisions without exporting private reviewer notes.

## Independent validation

Seed known findings from independent fixtures, introduce one new gap and fix one existing gap; verify both directions of the exception ratchet.

## Demo

Follow a page warning to its evidence, record a reviewed resolution and show the superseding status.

## Evidence needed to close

- Finding register
- Ratchet demonstration
- Resolution evidence
- Coverage update

## Rollback notes

Reopen/supersede a finding with its evidence trail intact; never erase a disagreement to make the gate green.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Temporal findings consume the bounded mode/status contract from USCT-034 so a publication-time observation, conditional applicability and disputed reading cannot collapse into one undifferentiated warning.
