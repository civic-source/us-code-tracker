# USCT-029: Verify the complete static reader and local workbench before cutover

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M5 — Backfill, validate, cut over and operate recoverably

## What it delivers

Reviewers can accept the complete required experience using independently checked legal data, browser behavior and operational evidence.

## Blocked by

- [USCT-025](USCT-025.md)
- [USCT-027](USCT-027.md)
- [USCT-028](USCT-028.md)
- [USCT-036](USCT-036.md)

## Acceptance criteria

- [ ] Run end-to-end journeys for browse, current and exact-release historical search, historical comparison, citation continuity, explicit temporal query modes, evidence inspection, topic feed and local query/export.
- [ ] Verify keyboard/screen-reader behavior, meaningful focus, responsive layouts and bounded page/shard sizes on representative real pages.
- [ ] Block all browser API/model requests during the static-reader check; only published assets and optional user-followed links are needed.
- [ ] Review spec fidelity, repository standards, security/data handling and evidence/temporal correctness independently; unresolved required failures block cutover.

## Independent validation

Use held-out independently reviewed pages/queries and an exact build/deployment manifest; do not validate only against snapshots produced by the implementation itself.

## Demo

Perform the required user journeys from a clean offline-capable static deployment and a restored local workbench.

## Evidence needed to close

- Acceptance journey results
- Accessibility/performance measurements
- Network log
- Separate review reports
- Verified manifest

## Rollback notes

Keep the previous production publication active and return failing capabilities to their owning tickets; no cutover occurs.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
