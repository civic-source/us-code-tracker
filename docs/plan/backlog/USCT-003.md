# USCT-003: Label eCFR text matches as unverified candidates

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M0 — Reconcile existing work and repair current trust/history failures

## What it delivers

A reader no longer mistakes a regulation found by text search for a verified implementing regulation.

## Blocked by

- [USCT-001](USCT-001.md)

## Acceptance criteria

- [ ] Represent the present eCFR text-match output as a typed candidate with query, source URL, retrieval time and matching evidence.
- [ ] Remove implementation/authority labels unless a supporting authority relationship has been verified.
- [ ] Preserve existing links and content while making candidate and verified states visibly distinct.

## Independent validation

Use one exact authority citation, one incidental numeric/text mention and one unrelated match; only the independently checked authority fixture may be labeled verified.

## Demo

Open a candidate regulation card and inspect why it was retrieved and what remains unverified.

## Evidence needed to close

- Candidate schema example
- Before/after UI evidence
- False-positive fixture result

## Rollback notes

Disable candidate display while retaining evidence; never revert to an unsupported authority label.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
