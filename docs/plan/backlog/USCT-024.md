# USCT-024: Optionally draft evidence-bound research notes with local Gemma

**Status:** proposed  
**Readiness:** blocked  
**Type:** optional  
**Milestone:** M4 — Provide a local research workbench and static topic views

## What it delivers

A researcher can request a bounded local draft that cites retrieved evidence and declines unsupported claims.

## Blocked by

- [USCT-017](USCT-017.md)
- [USCT-018](USCT-018.md)
- [USCT-023](USCT-023.md)

## Acceptance criteria

- [ ] Make the local Gemma-compatible enrichment adapter opt-in, with pinned model/runtime/config, prompt identity, context limits and output schema.
- [ ] Enforce explicit token/time/memory or job budgets, cancellation and deterministic input/output artifact recording; no model call runs in the published site.
- [ ] Require every material draft claim to reference provided evidence; unsupported or conflicting points remain unknown/unresolved.
- [ ] Store generated text as a derived draft with review status; do not promote it to authoritative text or rely on rerunning the model for byte reproducibility.

## Independent validation

Use a held-out independently reviewed evidence set with missing, conflicting and adversarial source text; measure unsupported-claim behavior and budget enforcement.

## Demo

Generate a local research draft, inspect each citation, hit a configured budget and show safe cancellation without losing accepted data.

## Evidence needed to close

- Model/prompt/runtime manifest
- Evaluation set and results
- Budget/cancellation record
- Reviewed draft artifact

## Rollback notes

Disable the optional adapter and remove its draft projection from publication; preserve the immutable source and accepted non-model artifacts.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

This ticket blocks no required core milestone and does not authorize downloading models or provisioning hardware during planning.
