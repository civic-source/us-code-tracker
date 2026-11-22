# USCT-034: Query publication, actual knowledge and evidence-backed applicability separately

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M2 — Attach verified legal context and explicit uncertainty

## What it delivers

A researcher can ask a bounded historical question in an explicit temporal mode and see a qualified answer with its source evidence.

## Blocked by

- [USCT-009](USCT-009.md)
- [USCT-011](USCT-011.md)
- [USCT-013](USCT-013.md)

## Acceptance criteria

- [ ] Expose three explicit modes for one representative provision family: as-published by immutable release identity, known-as-of by the tracker’s actual recorded observation/acceptance time, and applicability-on by a requested legal date and any declared necessary facts.
- [ ] A late backfill of an old publication does not fabricate earlier tracker knowledge. If actual historical observation evidence is unavailable, known-as-of returns an explicit unknown/incomplete result.
- [ ] Return evidence-backed applicability as known, conditional, disputed or unknown, preserving conditions, competing readings and evidence; never substitute release date for effective/applicability date.
- [ ] Represent each temporal endpoint with an explicit known, open, unknown or conditional state, its date precision, basis and source evidence. An absent/null date means neither an open endpoint nor ongoing validity; use open only where the evidence supports that state and retain the limits of that evidence.
- [ ] The CLI/query output and one static evidence panel expose the chosen mode, source/version identities, relevant dates, status and supporting spans without introducing a general legal decision engine.

## Independent validation

Use an independently authored fixture with delayed effectiveness, retroactive applicability, a late backfill and conflicting applicability evidence. Fix expected answers for each mode/date before running the implementation; verify the same publication can differ between publication and actual knowledge timelines. Include known endpoints with differing precision, an evidence-supported open endpoint, an unknown/null endpoint and a conditional trigger; verify null never becomes a claim of continuing validity.

## Demo

Ask the same two-version provision question in all three modes, then backfill an older source and show that its earlier known-as-of answer remains unknown.

## Evidence needed to close

- Independently reviewed temporal fixture
- Mode-by-mode expected/result matrix
- Backfill knowledge-time invariant
- Conditional/disputed/unknown examples
- Static panel and query transcript
- Endpoint state/precision/basis/evidence fixture matrix

## Rollback notes

Disable the new applicability projection or restore its prior accepted version; retain raw publication/observation history and return unknown where evidence is insufficient.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Scope this to one representative provision family and a small fixture. Mode selection and evidence-status semantics are required; a universal historical-law solver is outside this ticket. Endpoint state and overall applicability result are separate: endpoint states are known/open/unknown/conditional; applicability results remain known/conditional/disputed/unknown. Acquire relevant missing public/already-authorized source evidence where available, otherwise preserve explicit uncertainty.
