# Migration: trustworthy releases, temporal evidence, and static publication

## Purpose and verified baseline

Migrate the existing application incrementally into the planned local legal-data workbench. Preserve the TypeScript monorepo, the Python citation adapter, published URLs, and historical content. Use local PostgreSQL for durable working state and graph queries, DuckDB for analytical workloads, and optional Gemma enrichment. Publish a complete static site. HCK, ACQ kits, additional machines, and alternative schedulers are optional integrations, not migration prerequisites.

M0 repairs to the existing site can ship immediately after their acceptance gates. The new representation first runs as a separate preview/shadow publication while the existing primary site remains available. Its primary-site migration cutover occurs at USCT-030, after the declared-scope backfill in USCT-027 and final acceptance in USCT-029.

The following are **read-only source and GitHub API observations from November 21, 2026**. No production pipeline, deployment, or migration was executed. Repository commit dates do not establish the legal currency or completeness of their contents.

| Repository | Inspected default-branch commit | Observed boundary |
|---|---|---|
| `civic-source/us-code-tracker` | [`822d2a5f904a874f107bcdf4c99f0e1fda4f5d51`](https://github.com/civic-source/us-code-tracker/tree/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51), October 28 | Ingestion, transformation, annotation, diffs, and Astro publication code. |
| `civic-source/us-code` | [`b61a5431487ab20d9b447516dcac2d01b2d81762`](https://github.com/civic-source/us-code/tree/b61a5431487ab20d9b447516dcac2d01b2d81762), April 4 | Existing Markdown and annotation history. API-reported repository size approximately 1.64 GB; this is not a measured checkout or artifact size. |
| `civic-source/cap-citation-pipeline` | [`a23bc150eea35ed3a4d195515467340932aad3db`](https://github.com/civic-source/cap-citation-pipeline/tree/a23bc150eea35ed3a4d195515467340932aad3db), April 4 | Legacy Python CourtListener search-to-YAML producer. |

Tracker's committed submodule points to `us-code` commit `8c0b1974c0d1df151739a4a054205e6bb77d6a36`, distinct from that repository's current main. The [deployment workflow](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/.github/workflows/deploy-site.yml) fetches history and tags but does not advance the pinned checkout. The [sync workflow](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/.github/workflows/sync-law.yml) writes the data repository without an observed step promoting its commit into the site. Establishing an explicit validated-data-to-deployment path is the first operational priority.

## Compatibility and ownership map

The following target locations describe responsibilities; final table and directory names belong to the implementation contracts.

| Existing surface | Additive target | Compatibility requirement |
|---|---|---|
| `packages/types/src/index.ts` | Versioned source, release, provision, evidence, relation, task, and publication schemas | Read existing sidecars through explicit version adapters. |
| `packages/fetcher` and `scripts/import-history.ts` | Shared acquisition contract, immutable source artifacts, per-source work ledger | Preserve accepted sources and historical inputs; eliminate divergent completeness rules. |
| `packages/transformer` | Canonical structured provisions plus Markdown rendering | Keep legacy Markdown and URL mappings while comparing semantic fidelity. |
| `us-code/statutes/title-*/chapter-*/section-*.md` | Existing renderings plus provision/version records and release membership | Retain old paths and Git history; chapter location is not permanent provision identity. |
| `us-code/annotations` and Python `extract.py` | Evidence-bearing citation records plus compatible YAML exports | Preserve legacy records and distinguish candidates from verified relationships. |
| `apps/web/src/content.config.ts` | Validated publication-bundle readers | Consume existing regulations/history collections through adapters before removing legacy readers. |
| `scripts/generate-diffs.ts` and Pagefind | Versioned, reproducible derived artifacts | Preserve comparison links; invalidate on both input and producer changes. |
| `apps/web/content-data` | Exact accepted data commit or immutable artifact manifest | Retain the submodule delivery method initially; never deploy a moving branch implicitly. |
| Local PostgreSQL/DuckDB | Operational ledger, temporal/evidence graph, analytical projections | Keep file fixtures and deterministic exports usable without production-scale infrastructure. |

The legal graph records relationships and supporting evidence. The processing DAG records artifact dependencies and execution. They share immutable identifiers but remain separate models. Raw source records, interpretations, and external RuleSpec derivatives retain their own provenance and licensing; a CC0 data destination must not erase third-party attribution requirements.

## Expand: introduce contracts without replacing history

### Immutable identity and time

Separate four concepts: stable provision identity, source-document/version identity, source release, and published site release. Retain source-provided identifiers and maintain aliases for legacy paths and citations. Transfers, renumbering, splits, and merges become explicit relationships; never infer identity solely from matching text or a chapter pathname.

Preserve the complete provider release identifier, including exclusions, amendments to a release, and correction revisions. Store the original locator, retrieved-byte digest, and structured exclusions alongside it. Numeric Congress/law fields are useful attributes, not sufficient keys. The current [historical release parser](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/scripts/lib/release-points.ts) and [tag parser](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/scripts/lib/pl-tags.ts) accept numeric identities, while the [fetcher](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/packages/fetcher/src/fetcher.ts) recognizes exclusion-bearing paths. Reconcile these before additional backfills.

Record retrieval/observation, publication, enactment, legal effect, and applicability separately, each with evidence and precision. Unknown dates remain unknown. A Git commit date or approximate Congress year cannot substitute for an effective date. Preserve corrections as new versions with explicit relationships; do not display parser improvements as legislative amendments.

**Never rewrite published Git history or move existing tags.** The current [import helper](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/scripts/lib/import-helpers.ts) uses `git tag -f`; replace that behavior for new publication identities. Inventory and freeze legacy tag-to-commit mappings, then retain them as compatibility aliases.

### Legacy evidence and source artifacts

Import existing content as `legacy-derived`, preserving its repository, commit, path, content digest, and available provenance. Missing source bytes, retrieval dates, extractor versions, or review evidence stay missing. Do not manufacture metadata from migration time or upgrade historical search snippets into verified holdings.

Acquire original documents where available and retain their exact bytes separately from normalized representations. Compare newly regenerated output with legacy content and classify discrepancies: source change, formatting, producer correction, extraction loss, or unresolved. Preserve both versions until adjudicated. A successful refetch does not prove what an earlier producer originally retrieved.

## Migrate: reliable processing and publication

### Per-source ledger and completeness

Use a ledger keyed by source, full release identity, scope, and producer version, with individual attempts and explicit `pending`, `running`, `succeeded`, `absent`, `partial`, `failed`, and `quarantined` outcomes. Track discovered, ingested, validated, and published positions separately. A single global high watermark is insufficient.

The [historical importer](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/scripts/import-history.ts) continues after a failed release; a later success can advance the shared resume cursor beyond that gap. It also commits/tags before checking aggregate failures. The new ledger must make failed earlier work independently retryable even when later work succeeds.

Stage each scope, validate its expected inventory and references, then accept it transactionally. A legitimately absent publication requires source evidence; network errors and malformed responses are failures. Required scopes cannot publish incompletely. Independently complete scopes may advance only when the publication manifest explicitly represents their distinct currency and coverage. Optional enrichment failures retain last-good evidence with stale/unavailable status.

### Publication promotion

Produce one immutable manifest identifying accepted source versions, exclusions, coverage, toolchain/configuration digests, schema versions, derived artifacts, and validation results. Build the site from that exact manifest. Promote the accepted data commit into the submodule pin, or explicitly select the equivalent artifact release, before dispatching deployment.

All text, timelines, evidence, diffs, search indexes, and coverage indicators must describe that publication. Display latest-discovered and latest-published separately. A build failure leaves the preceding publication available. Make promotion idempotent and verify the deployed manifest after deployment. Do not let a Git push alone imply successful ingestion, validation, or publication.

### Citation and enrichment parity

The [CAP script](https://github.com/civic-source/cap-citation-pipeline/blob/a23bc150eea35ed3a4d195515467340932aad3db/extract.py) currently queries CourtListener search, labels results `interpretation`, and stores snippets as `holdingSummary`. It collapses retrieval failures to empty results, classifies courts using name substrings, and assumes numeric titles. Preserve its outputs as legacy evidence while moving production through a shared adapter contract.

Run Python and TypeScript adapters against fixed responses and a bounded approved live sample. Compare case identifiers, court classification, citation variants, pagination/coverage, errors, Unicode, appendix titles, and serialization. Document intentional differences. Replace name heuristics with stable provider identifiers where available; keep search hits as citation candidates until evidence supports stronger classifications. Retire duplicate writers only after parity and review.

Apply the same distinction to [eCFR extraction](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/scripts/extract-regulations.ts): its full-text search is candidate discovery, not verified authority extraction. Populate and connect the already-defined regulatory and legislative collections before inventing replacement storage. Snapshot Federal Register and guidance evidence during processing so the published site does not require live retrieval or inference.

### Diff, search, and dependency invalidation

Key artifacts on input digests, producer/schema versions, relevant configuration, and required dependency manifests. Keep execution timestamps outside semantic hashes. The current [diff generator](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/scripts/generate-diffs.ts) reuses tag-name pairs; isolate new caches from that legacy namespace.

Rebuild or invalidate diff artifacts when either endpoint, canonicalization, comparison algorithm, rendering contract, or alias resolution changes. Rebuild search indexes when searchable content, metadata, URL mapping, indexing configuration, or index producer changes. Do not mix an old search index with new page identities. Initially prefer complete index rebuilding when incremental correctness is unproven; optimize after measurement.

New case or regulatory evidence can refresh annotations without a statute edit. Changed statutes invalidate their actual dependent evidence and interpretations. Optional Gemma outputs record model/configuration/input identities, remain distinguishable from source facts, and cannot bypass validation. Core migration and publication must succeed with model enrichment disabled.

## Migration gates

These migration gates are local acceptance checkpoints. The overarching M0–M6 milestones and their dependencies live in the master plan and backlog.

| Migration gate | Work and exit evidence |
|---|---|
| **MIG-A: Baseline and expansion** | Inventory current pins, tags, URLs, sources, sizes, tests, and quality gaps. Add schema/version adapters and representative file fixtures. Prove legacy pages still render; preserve a recoverable baseline. |
| **MIG-B: Reliable releases** | Implement source ledger, immutable artifacts, full release identity, staged completeness, and publication promotion. Simulate R1 success → R2 title failure → R3 success: R2 remains retryable and unpublished as complete. Exclusion and corrected releases remain distinct. |
| **MIG-C: Dual-run workbench** | Run legacy and new transforms on the same frozen cohort; compare canonical text, hierarchy, notes, references, statuses, sidecars, and date evidence. Populate PostgreSQL and DuckDB projections; require every unexplained loss or mismatch to block cohort acceptance. Wire orchestration-script tests into CI. |
| **MIG-D: Bounded preview** | Publish an explicitly scoped test candidate at a separate preview location, retaining the existing primary site. Verify compatible URLs, consistent diffs/search, visible coverage, and operation without model/runtime services. Exercise deployment verification and rollback within the preview environment. |
| **MIG-E: Backfill, final cutover, and contract** | Complete the declared-scope backfill under USCT-027 in measured title/release cohorts, reconcile exceptions, and document cost and quality. After USCT-029 acceptance, perform the primary-site cutover and rollback rehearsal under USCT-030. Retire duplicate writers/readers only after parity and the agreed observation period; preserve compatibility exports and legacy aliases for their stated support period. |

Use a small title for end-to-end mechanics and additional fixtures for long/deeply nested provisions, appendices, transfers, exceptions, and complex notes. Acceptance requires meaningful behavior, not matching total record counts alone. Include malformed responses, source outages, unknown dates, evidence conflicts, producer upgrades, and interrupted publication.

## Reversible cutover, rollback, and measured scale

Follow **expand → migrate → contract**. Add new tables/fields/readers first; backfill without replacing originals; validate the bounded pilot through a separate preview/shadow publication; then select the accepted publication manifest for the primary-site cutover at USCT-030. The preview does not bypass USCT-027 declared-scope backfill or USCT-029 final acceptance. M0 repairs remain independently shippable on the existing site. Remove obsolete code only after an agreed observation period and documented parity. Avoid destructive database migrations during initial cutover. Keep backups and verify restore procedures.

Rollback selects the preceding complete site/data manifest and its matching indexes. Suspend the new promoter, retain failed-run artifacts for diagnosis, and resume the ledger idempotently after repair. Do not force-reset the public data repository or replay partially accepted work into production. Database rollback must preserve the evidence needed to understand later attempts, using restore or compatible schema/application rollback as appropriate.

Measure current working-tree size, Git history size, raw-source bytes, artifact growth, database/index size, per-title CPU/RAM/time, and publication size separately. Start with API/tree inventory and selective checkouts; avoid an unnecessary complete history rewrite of the approximately 1.64 GB repository. Deduplicate raw bytes and canonical artifacts by digest, retain compact manifests, and make retention decisions explicit. Move large immutable artifacts to a suitable artifact store only after measurement; preserve stable source IDs and reproducible manifests across storage changes. No large-corpus throughput or storage target is considered verified until the representative benchmark and backfill measurements exist.
