# USCT-002: Show source outages and partial results without reporting false emptiness

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M0 — Reconcile existing work and repair current trust/history failures

## What it delivers

A reader and operator can distinguish no matches from an unavailable, rate-limited, malformed or partially fetched source.

## Blocked by

- [USCT-001](USCT-001.md)

## Acceptance criteria

- [ ] Replace empty-on-error paths with typed success-empty, success-nonempty, partial and failed outcomes, including source, scope and last successful observation.
- [ ] Preserve the last successful snapshot when a refresh fails; label stale evidence instead of replacing it with an empty list.
- [ ] Static artifacts and current UI consumers retain these distinctions; an HTTP error is never a zero-result legal conclusion.

## Independent validation

Replay independently authored 200-empty, 200-results, 429, 500, timeout, malformed payload and pagination-failure fixtures through the public fetch-to-render path.

## Demo

A populated page survives a simulated source outage with a visible stale/unavailable indicator and unchanged underlying evidence.

## Evidence needed to close

- Fixture outcomes
- Rendered state evidence
- Refresh report showing retained snapshot

## Rollback notes

Restore the previous validated snapshot and compatible renderer; do not delete failure evidence.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

This slice covers shared result semantics and one representative source path, then applies the same result contract to existing adapters.
