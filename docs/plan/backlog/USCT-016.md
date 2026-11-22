# USCT-016: Render Federal Register and agency guidance context from static snapshots

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M2 — Attach verified legal context and explicit uncertainty

## What it delivers

A reader sees dated rulemaking and guidance context even when the browser has no access to external source APIs.

## Blocked by

- [USCT-013](USCT-013.md)

## Acceptance criteria

- [ ] For one bounded agency/topic, precompute Federal Register and guidance cards from documented official sources with type, publication/status and evidence.
- [ ] Distinguish proposed rule, final rule, notice, guidance and statute; publication or association does not imply legal applicability.
- [ ] Replace live browser retrieval on this path with versioned static artifacts; failed refreshes retain last-good content and explicit freshness.
- [ ] A network-denied browser can use the published content and follow ordinary external links when connectivity is restored.
- [ ] Add relevant public/already-authorized Federal Register or agency-guidance sources as metadata, temporal or assertion-evidence gaps require; prefer official bulk/API access and preserve each source version, provenance and license/reuse basis.

## Independent validation

Replay representative official records and a failed refresh; inspect output with all third-party API requests blocked.

## Demo

Browse rulemaking and guidance cards offline and inspect their separate source types and dates.

## Evidence needed to close

- Source snapshot inventory
- Offline network log
- Static card evidence
- Failure-state report
- Field-to-source gap resolution and acquisition manifest

## Rollback notes

Disable the new context panel or republish a prior snapshot; do not restore mandatory live API calls.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Source expansion is authorized where needed to fill the declared schema/evidence gaps; ordinary public/already-authorized collection does not require repeated confirmation. Apply per-source limits, retain exact raw versions and keep authoritative text distinct from summaries or interpretations.
