# USCT-026: Backfill a representative pilot while preserving current URLs and data

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M5 — Backfill, validate, cut over and operate recoverably

## What it delivers

An operator can migrate a bounded historical title/release slice through the new contracts and compare it with the existing published corpus.

## Blocked by

- [USCT-017](USCT-017.md)
- [USCT-018](USCT-018.md)

## Acceptance criteria

- [ ] Expand the new representation alongside legacy artifacts, migrate a deliberately challenging pilot and keep existing readers functional.
- [ ] Include historical gaps, renumbering, tables/notes and known source anomalies; record exact intended/completed scopes.
- [ ] Produce parity and explained-difference reports rather than silently normalizing discrepancies away.
- [ ] Resume the pilot after interruption and retain rollback-compatible legacy output until acceptance.

## Independent validation

Review a stratified sample against official raw sources and independently specified fidelity/history expectations; repeat clean and resumed runs.

## Demo

Navigate old and new pages for the pilot, inspect an explained difference and recover an interrupted backfill.

## Evidence needed to close

- Pilot scope/manifest
- Independent sample review
- Parity and differences report
- Resume/rollback evidence

## Rollback notes

Keep the old publication pointer and legacy artifacts until acceptance; discard only unpromoted derived pilot output.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
