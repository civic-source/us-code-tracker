# USCT-028: Operate source refreshes and recover from corruption or credential failure

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M5 — Backfill, validate, cut over and operate recoverably

## What it delivers

An operator can monitor freshness, recover local state and restore a publication without improvising during a failed refresh.

## Blocked by

- [USCT-019](USCT-019.md)
- [USCT-020](USCT-020.md)
- [USCT-023](USCT-023.md)
- [USCT-026](USCT-026.md)

## Acceptance criteria

- [ ] Provide runbooks and observable reports for stale sources, rate limits, corrupt downloads/artifacts, catalog restore, expired credentials and failed publication.
- [ ] Test backup/restore of the local PostgreSQL catalog and replay from immutable sources; separate secrets from public exports and logs.
- [ ] Apply scheduled complete validation as a backstop to incremental checks; track exception ownership/expiry and failure alarms without creating duplicate noise.
- [ ] Document which jobs are optional and retain an ordinary local-runner recovery path.

## Independent validation

Conduct table-top and bounded fault-injection drills with independently specified recovery outcomes and no live credential disclosure.

## Demo

Corrupt a disposable artifact, restore the catalog from backup and republish the prior validated static release.

## Evidence needed to close

- Operations runbook
- Recovery drill records
- Freshness/coverage report
- Secret-redaction check
- Backup restore receipt

## Rollback notes

Stop refresh/promotion, restore the prior catalog/publication bundle and replay accepted immutable inputs; keep incident evidence.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Operational acceptance includes the independent source-refresh behavior delivered by USCT-019. Its failure, checkpoint and partial-scope handling must be exercised in the recovery drills before final cutover.
