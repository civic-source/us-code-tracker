# USCT-013: Verify a section amendment against enacted law evidence

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M2 — Attach verified legal context and explicit uncertainty

## What it delivers

A reader can follow a change in a section to the enacted public law and relevant source evidence.

## Blocked by

- [USCT-010](USCT-010.md)

## Acceptance criteria

- [ ] Link one bounded representative amendment chain to official public-law/Statutes-at-Large evidence, retaining enactment and effective/applicability distinctions.
- [ ] Treat source-credit citations and legislative summaries as separate evidence types; a summary is not the enacted text.
- [ ] Expose uncodified or note-based applicability evidence when present, and unresolved amendment mappings when verification is incomplete.
- [ ] Discover and acquire additional relevant public/already-authorized enacted-law, amendment or note sources when required metadata/temporal/assertion fields lack evidence; prefer official bulk/API records and preserve raw versions, provenance and license/reuse basis.

## Independent validation

Manually reconcile a known section change against the official enacted-law text and an independent expected evidence map, including a delayed-effective-date case.

## Demo

From a historical diff, open the enacted-law evidence and the separate applicability note.

## Evidence needed to close

- Official source snapshot/hash
- Reviewed amendment mapping
- Date evidence
- Static section-to-law view
- Field-to-source gap resolution and acquisition manifest

## Rollback notes

Disable or supersede the incorrect relationship while leaving the source snapshot and underlying statute history intact.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Source expansion is authorized where needed to fill the declared schema/evidence gaps; ordinary public/already-authorized collection does not require repeated confirmation. Apply per-source limits, retain exact raw versions and keep authoritative text distinct from summaries or interpretations.
