# USCT-015: Attach a reviewed case proposition to exact opinion evidence

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M2 — Attach verified legal context and explicit uncertainty

## What it delivers

A reader can inspect what an opinion says about a statute and see the limits of the version alignment.

## Blocked by

- [USCT-004](USCT-004.md)
- [USCT-011](USCT-011.md)

## Acceptance criteria

- [ ] Ingest a bounded opinion fixture with stable case/opinion identity, court/date and exact supporting passage.
- [ ] Separate citation detection, proposition extraction, statute-version alignment and reviewed legal-effect classification.
- [ ] A case date alone does not prove which statutory wording the court applied; uncertainty remains visible.
- [ ] No search snippet, model output or citation count automatically establishes a holding or binding effect.
- [ ] Acquire relevant public/already-authorized opinion, docket-metadata or original court records needed for new schema fields and supporting passages; distinguish original evidence from retrieval intermediaries and preserve raw versions, provenance and license/reuse basis.

## Independent validation

Use a small independently reviewed opinion set containing an incidental mention, substantive discussion and ambiguous historical version; compare the exact expected labels.

## Demo

Open a reviewed proposition, its opinion passage and its version-alignment status.

## Evidence needed to close

- Opinion source/hash
- Independent annotated cases
- Version-alignment findings
- Static case panel
- Field-to-source gap resolution and acquisition manifest

## Rollback notes

Unpublish the derived proposition or revert to citation-only display without deleting the opinion evidence.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Source expansion is authorized where needed to fill the declared schema/evidence gaps; ordinary public/already-authorized collection does not require repeated confirmation. Apply per-source limits, retain exact raw versions and keep authoritative text distinct from summaries or interpretations.
