# USCT-023: Search the local workbench lexically with optional vector ranking

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M4 — Provide a local research workbench and static topic views

## What it delivers

A local researcher can retrieve provisions and supporting documents using required lexical search, with evidence, version and scope visible; vector ranking is an optional evaluated enhancement.

## Blocked by

- [USCT-009](USCT-009.md)
- [USCT-011](USCT-011.md)

## Acceptance criteria

- [ ] Provide PostgreSQL lexical retrieval through the local query interface as the required baseline; exact citation and historical-version filters work without embeddings or a model.
- [ ] Evaluate pgvector ranking as an optional branch against the labeled query set. If adopted, version embedding model, chunking, normalization and index configuration and reject incompatible vector/source mixtures.
- [ ] Results return exact evidence spans, citation/version context and explicit source/date filters; retrieval relevance is not legal authority.
- [ ] Required acceptance, later core tickets and published static Astro operation do not depend on the optional vector branch, an embedding runtime or a local model.

## Independent validation

Use a small independently labeled query set with exact citation, concept, historical and out-of-scope queries. Require correct lexical behavior and source/version filtering; compare optional vector ranking only if that branch is selected.

## Demo

Run a local lexical search, filter to a historical release and inspect original evidence. If optional vectors are evaluated, show their measured difference and disable them without breaking the baseline.

## Evidence needed to close

- Labeled query set
- Required lexical retrieval results
- Version/filter correctness
- Optional vector evaluation and index manifest only if selected

## Rollback notes

Disable optional vector ranking and use the validated lexical index; rebuild any selected vectors under a new index identity rather than mixing models.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Public-law amendment verification is not a prerequisite to exact-version retrieval. Existing canonical provisions, aliases and evidence from USCT-009/011 are sufficient for this bounded slice.
