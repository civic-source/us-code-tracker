# USCT-025: Publish a static topic and change feed backed by verified scope

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M4 — Provide a local research workbench and static topic views

## What it delivers

A reader can follow a bounded topic across law, regulation and cases and subscribe to a reproducible change feed.

## Blocked by

- [USCT-021](USCT-021.md)

## Acceptance criteria

- [ ] Provide one curated topic profile with an explicit citation/source scope and inclusion rationale.
- [ ] Generate a static topic page and RSS/JSON changes from typed relationships, preserving source dates, verification and completeness.
- [ ] Distinguish textual change, new related evidence, changed interpretation status and corrected metadata; no event claims automatic legal impact.
- [ ] Any browser-local saved filters/watchlist stay local and require no hosted account service.

## Independent validation

Manually enumerate the expected topic members/events for the fixture and compare generated page/feed entries, duplicates and ordering.

## Demo

Open the topic timeline, inspect an event evidence chain and read the feed with external APIs blocked.

## Evidence needed to close

- Curated topic profile
- Expected event ledger
- Static feed/page artifacts
- Offline reader check

## Rollback notes

Republish the prior topic/feed projection or disable the new topic; preserve all original legal documents and stable event identities.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.
