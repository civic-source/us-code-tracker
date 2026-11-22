# USCT-014: Promote a regulation candidate only with verified authority evidence

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M2 — Attach verified legal context and explicit uncertainty

## What it delivers

A reader can distinguish a supported regulatory authority link from a merely related search hit.

## Blocked by

- [USCT-003](USCT-003.md)
- [USCT-008](USCT-008.md)

## Acceptance criteria

- [ ] For one bounded CFR/agency family, ingest official dated regulation text and authority/citation evidence.
- [ ] Record typed, directed and version-aware relationships such as cites or authority-for; reserve stronger implementation labels for explicitly supported reviewed cases.
- [ ] Keep ambiguous candidates visible as candidates and retain competing or outdated evidence.
- [ ] Add relevant public/already-authorized dated regulation, authority-table or agency-source records when the new fields or a candidate relationship need evidence; prefer official bulk/API paths and preserve raw versions, provenance and license/reuse basis.

## Independent validation

Independently label true authority, incidental citation, broad chapter reference and superseded-version fixtures; verify promotion decisions and displayed labels.

## Demo

Inspect a verified regulation relationship with its exact authority evidence and an unpromoted neighboring candidate.

## Evidence needed to close

- Dated regulation snapshot
- Reviewed relationship fixture
- Promotion evidence
- Reader view
- Field-to-source gap resolution and acquisition manifest

## Rollback notes

Revoke the derived verification status through a superseding assertion; preserve candidate/source records.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Source expansion is authorized where needed to fill the declared schema/evidence gaps; ordinary public/already-authorized collection does not require repeated confirmation. Apply per-source limits, retain exact raw versions and keep authoritative text distinct from summaries or interpretations.
