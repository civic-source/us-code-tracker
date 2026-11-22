# US Code Tracker product specification

**Status: proposed consolidated specification · November 21, 2026**

## Problem

Researchers need to see what the U.S. Code said in a particular published release, understand how it changed, and inspect the evidence connecting a provision to legislation, regulations, opinions, or guidance. A convincing interface is insufficient if a failed fetch looks like an empty collection, a release silently loses notes, an old citation points at a new occupant of the same section number, or a site build presents a different data version from its timeline.

The existing tracker supplies useful ingestion, Markdown history, diffs, citation annotations, and a static website. The next increment must make its release and evidence boundaries explicit while preserving those assets. The earlier design discussion adds a local legal-data workbench, typed temporal relationships, incremental processing, and optional local models. The RuleSpec review contributes field-level evidence, conflict records, reverse dependency indexes, and stronger source fidelity gates.

Current implementation findings and pinned evidence are maintained in [Migration](docs/MIGRATION.md), rather than mixed into this product contract.

## Proposed solution

Build a trustworthy release pipeline and a local research workbench around immutable source artifacts, canonical provisions, versioned evidence, and explicit coverage. Publish deterministic, inspectable static releases. Allow every substantive claim to lead back to a preserved source and every published page to lead back to a publication manifest.

The system has two delivery surfaces. The public Astro site supports browsing, scoped search, comparisons, evidence inspection, source coverage, and versioned downloads. The private local workbench supports acquisition, review, graph exploration, analytical exports, and optional local model assistance. The website remains usable when the workbench, database, and model are offline.

Start with all currently supported U.S. Code content and explicitly declared historical coverage. Prove new behavior on a small official-source cohort plus difficult synthetic fixtures before expanding. Additional sources enter by bounded collection contracts; broad source counts are not a substitute for trustworthy coverage.

Acquiring additional source data needed to populate the new schemas is explicitly authorized. Implementers may discover, fetch, re-fetch, and backfill relevant public sources and already-authorized APIs, beyond the current source list or existing repository data. Maintain a field-to-source coverage map, preserve immutable originals and provenance, and distinguish successful collection from a legally settled interpretation. Follow [Data acquisition and schema backfill](docs/DATA-ACQUISITION.md).

## User stories

### Public research

1. As a reader, I can open a provision from a named publisher release and see that release's actual text.
2. I can distinguish publisher release, acquisition, enactment, effective date, applicability conditions, and site publication.
3. I can compare two explicit versions and separate source text changes from formatting or parser corrections.
4. I can follow a historical URL without being silently redirected to unrelated current text.
5. I can see source credits, statutory notes, tables, hierarchy, and meaningful labels without silent omission.
6. I can inspect the source span behind an extracted date, citation, or relationship.
7. I can see whether a relationship is a search candidate, verified extraction, or reviewed interpretation.
8. I can distinguish a statute, regulation, judicial opinion, agency guidance, and editorial material.
9. I can see unknown or disputed applicability instead of an invented effective date.
10. I can search a selected publication or release and retain that scope in the results.
11. I can see last successful collection, declared scope, partial coverage, and stale enrichment separately.
12. I can download the manifest and machine-readable evidence behind a publication.

### Maintainer and reviewer

13. As a maintainer, I can retry an earlier failed title or release after later releases succeed.
14. I can distinguish a successful empty result from a failed, partial, or uncollected source.
15. I can verify that a release contains every required partition before it becomes publishable.
16. I can reproduce a deterministic export from pinned input artifacts and producer versions.
17. I can change a parser and identify producer corrections without inventing legislative events.
18. I can review competing interpretations with their evidence, decisions, and affected outputs.
19. I can see which derived artifacts are stale after a source, resolver, review, or producer change.
20. I can add a missing citation target and refresh previously unresolved relationships.
21. I can stop, resume, and repeat work without duplicating accepted legal records or losing progress.
22. I can promote a complete candidate and verify that the deployed site exposes its exact manifest.
23. I can roll back to the preceding complete publication and restore the local catalog from backups.
24. I can preserve the attribution and license of imported third-party interpretations.

### Local researcher and operator

25. As a local researcher, I can query the legal graph independently of the processing dependency graph.
26. I can use PostgreSQL for accepted records and DuckDB for versioned analytical exports.
27. I can retrieve candidates with text search and, optionally, embeddings constrained to the requested versions and scope.
28. I can use a configured local model to propose annotations while retaining its inputs, output receipt, and review state.
29. I can disable models and still ingest, validate, build, and publish the core product.
30. I can run a representative fixture build without a production database or a corpus-sized checkout.
31. I can measure resource use and choose whether an additional worker offers enough benefit to justify its complexity.
32. I can run an optional external executor against the same immutable task contract without changing legal semantics.

## Implementation decisions

### Domain and time

Provision identity is distinct from its current citation, file path, and textual version. A version participates in one or more source snapshots. Citation assignments and transitions retain evidence. Backfilling an earlier release must not change an established identity merely because an earlier occurrence was discovered.

Expose three query modes with distinct contracts: **as published**, **legally applicable**, and **known as of**. The first is a reproducible snapshot lookup. The second returns known, conditional, disputed, or unknown results, scoped as finely as the evidence permits. The third reflects what this installation actually recorded; a historical document imported today does not create historical system knowledge.

Keep legal relationships separate from the processing DAG. Legal citations can form cycles. Processing dependencies must be acyclic and include collection membership, unresolved-target searches, policies, and producer identity as well as direct matched inputs.

### Data and interfaces

Use containerized PostgreSQL for accepted catalog state, stable identity registry, legal assertions, review decisions, task acceptance, and publication state. Preserve immutable original bytes and canonical versioned exports outside the database. Export the registry and acceptance/review records as part of replay manifests so rebuilding does not invent identities or lose editorial decisions. DuckDB/Parquet are analytical projections. pgvector is optional.

Retain the existing TypeScript/Astro workspace and compatible source adapters. Python can serve the existing citation adapter and analytical workloads. Cross-language contracts are versioned JSON/JSONL plus digest-addressed artifacts, not undocumented database writes. Use narrow domain interfaces; a separate service or repository requires a concrete operational need.

Keep the public build detached from live enrichment. The publication manifest pins text, evidence, diffs, indexes, coverage, toolchain, and licensing. No browser secret, local model, local database, or live legal-data API is required to read a published release.

### Sources and evidence

Official sources supply underlying text and publisher metadata wherever available. Third-party discovery tools and curated datasets can identify useful sources or interpretations, but retain their own provenance. RuleSpec is optional structured enrichment; it is not the canonical representation of the whole U.S. Code.

Search hits establish candidates. Direct citations can establish citation relationships at their actual granularity. Holdings, treatment, invalidation, and effective-date conclusions require separately supported evidence. Model confidence, reviewer acceptance, source authority, and extraction correctness remain independent fields.

Keep disagreement explicit. A conflict record contains alternatives, the precise question, source evidence, reviewer rationale, adopted interpretation if any, status, and impacted artifacts. Editorial resolution never masquerades as a court ruling.

### Reliability and compatibility

Stage acquisition, normalization, validation, and publication separately. Required incompleteness blocks acceptance. Optional enrichment may remain stale or partial only when the manifest and UI identify it. Preserve the last accepted data through refresh failures.

Execution is at least once, with idempotent acceptance. A logical task differs from an execution attempt. Multiple workers require leases and fenced compare-and-swap acceptance. Start with one executor; do not build a scheduler merely to support a future possibility.

Use expand–migrate–contract. Freeze legacy mappings, preserve Git history and URLs, shadow-run on frozen inputs, compare meaningfully, cut over a bounded cohort, and retire duplicate producers only after parity. Historical legacy output lacking original bytes remains explicitly legacy-derived.

## Acceptance and testing

The normative checks are in [Validation](docs/VALIDATION.md). Each ticket adds independently authored expected behavior at the public module seam. A source-derived golden fixture is not automatically regenerated to match the implementation.

The core release cannot pass until these demonstrations work:

- A failed middle release remains retryable after a later release succeeds.
- Exclusion-bearing and corrected publisher releases remain distinct; new published identities cannot be moved.
- A delayed and conditionally retroactive amendment returns different as-published and applicability results without fabricated dates.
- A transferred provision and a reused citation remain correctly distinguished.
- HTTP success with missing legal text or incomplete pagination fails the relevant content/coverage gate.
- A changed source and a newly discovered citation target invalidate exactly the required deterministic products; a clean rebuild and incremental run agree.
- An older worker cannot overwrite a newer accepted generation.
- Every page, diff, search index, and evidence panel belongs to one publication manifest.
- The published fixture site works without live enrichment endpoints or credentials.
- Rollback and restoration produce the expected prior publication and preserve audit evidence.

Measure corpus and host performance before setting production budgets. Initial correctness gates are strict; numeric latency, throughput, storage, and cost limits are proposed during the benchmark ticket, then recorded as explicit acceptance budgets.

## Out of scope for the core release

Full state and local law; universal case-law coverage; a complete tax/benefits calculation engine; automatic legal advice or a definitive citator; proving all legal interpretations in Lean/SMT; a custom distributed scheduler; mandatory HCK/ACQ/Slurm/Temporal infrastructure; a public runtime LLM; replacing the entire repository stack; and rewriting published data history.

These exclusions do not prevent small evaluated interoperability experiments after core acceptance. A future capability must demonstrate source quality, resource fit, and a bounded user benefit before entering the release path.

## Delivery notes

The backlog is a proposed dependency graph, not a claim of implemented work. Resolve current repository changes before starting. Hardware assumptions from earlier assistant suggestions are not verified equipment. Exact timelines depend on a representative pilot, upstream source behavior, and the amount of human evidence review required.
