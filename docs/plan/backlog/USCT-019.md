# USCT-019: Refresh one external source without rerunning unrelated work

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M3 — Update independently and publish an exactly pinned static snapshot

## What it delivers

A new opinion, regulation or rulemaking snapshot updates its dependent views while preserving unaffected statute and annotation artifacts.

## Blocked by

- [USCT-014](USCT-014.md)
- [USCT-015](USCT-015.md)
- [USCT-016](USCT-016.md)
- [USCT-035](USCT-035.md)

## Acceptance criteria

- [ ] Use source-specific checkpoints and dependency-driven work selection for the already supported bounded source families.
- [ ] A new case can update case context without retransforming unchanged statutory XML; a failed source does not suppress successful independent work.
- [ ] Changed collection and negative-query inputs participate in invalidation, and every run reports completed, cached, partial and failed scopes.
- [ ] A clean rebuild and the incremental result produce equivalent published content for the same accepted inputs.
- [ ] Execute refresh attempts through the USCT-035 generation/lease/fencing acceptance contract; a stale refresh cannot promote artifacts after a newer generation succeeds.

## Independent validation

Inject independent statute, case and regulation changes plus one outage; compare actual work/output sets with an independently authored dependency expectation.

## Demo

Refresh a new case while the regulation source is unavailable and show a correct partial report and updated case page.

## Evidence needed to close

- Source checkpoint report
- Work-selection trace
- Artifact parity report
- Partial-run demonstration

## Rollback notes

Restore the last accepted publication and retry only failed scopes; rebuild from pinned inputs if dependency metadata is suspect.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
