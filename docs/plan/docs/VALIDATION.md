# Validation and release acceptance

**Status: proposed validation plan. No tests or performance measurements described here have been executed as part of creating this plan.**

Use independent fixed fixtures, contract checks, integration tests, and a small representative static-site review. Passing a parser, schema, or compiler gate establishes software behavior; it does not establish that a legal interpretation is correct. Model output acceptance and legal-source review remain separately visible.

The gates below are initial proposed requirements, not claims about current test coverage or measured benchmarks.

## 1. Fixture policy

Maintain small official-source fixtures with publisher URL, source edition, acquisition date, checksum, scope, and redistribution basis. Supplement them with explicitly synthetic examples for rare temporal and failure scenarios. Expected outputs must be authored independently of the function being tested.

Use fixed golden assertions for meaningful text, hierarchy, notes, tables, citation identity, dates, and graph edges. Do not regenerate expectations automatically when a test fails. Every intentional update requires a source/change explanation.

Include a simple statute, a complex tax section, a benefits section with applicability notes, an alphanumeric/appendix citation, and a regulation with several authority citations. Preserve the existing project's useful historical and security fixtures.

## 2. Three mandatory difficult fixtures

### A. Delayed, retroactive, and conditional applicability

Synthetic law: enacted July 1; subsection (a) changes January 1 next year; subsection (b) applies to tax years beginning after an earlier December 31. An August publisher release incorporates both; retrieval occurs later. A source correction arrives in September.

Required results:

- As-published queries return the requested August snapshot.
- Publication, retrieval, enactment, and legal applicability remain separate.
- Subsection (b) requires tax-year context; the whole section does not inherit one effective date.
- Known-as-of queries before September exclude the later correction.
- Loading the old source today does not invent an old observed_at value.
- Earlier observations remain reproducible after correction.
- Missing applicability facts return conditional/unknown, not a fabricated definitive answer.

### B. Transfer, ambiguity, and citation reuse

Synthetic provision A transfers to B with explicit official transfer evidence. A later enactment uses citation A for unrelated text. A historical opinion cites the original A; a separate ambiguous amendment may split B into two provisions.

Required results:

- Original A and B have evidenced identity continuity; new A has a separate identity.
- The opinion stays linked to the historical target when supported.
- Decision date alone does not establish the statutory version the court analyzed.
- Ambiguous split candidates remain unresolved/reviewable.
- Current and historical links resolve without a timeless redirect that changes meaning.
- Citation text, filename movement, or similarity alone cannot merge identities.

### C. Valid bytes, missing legal content, and interrupted collection

Return HTTP 200 and syntactically valid input while omitting a subsection, note, or table cells. Separately interrupt regulation pagination after the first page.

Required results:

- Byte-integrity success does not bypass fidelity and coverage gates.
- Missing content is reported with source location and declared scope.
- The previous accepted snapshot and relationships survive.
- Partial/failed collection never becomes a successful empty result.
- Required core publication is blocked; optional enrichment is explicitly partial/stale.
- A subsequent complete retry converges with a clean complete run.

## 3. Source and normalization gates

Initial hard gates:

- Every accepted source artifact passes hash, length, and format validation.
- Every published provision version has traceable source evidence or an explicit legacy-derived limitation.
- No unexplained missing required partitions, duplicate identities, or dangling internal references.
- No silent loss of legal text, notes, tables, source credits, or meaningful hierarchy in covered fixtures.
- No network failure is interpreted as repeal or confirmed absence.
- Every exclusion has a reason and source locator.

Test namespace/version variations, nested enumerations, mixed content, hyphenation, Unicode, alphanumeric section labels, footnotes, and tables. Keep raw text available when a supported projection cannot represent a structure faithfully; require review before claiming complete fidelity.

Test hostile XML entities, oversized responses, archive path traversal, malformed source URLs, and untrusted text entering HTML. Source documents and repository content are data, never instructions to an agent.

Axiom's [release gate policy](https://github.com/TheAxiomFoundation/axiom-corpus/blob/main/docs/release-gate-policy.md) documents why hashes and row counts alone miss source-text loss. Its [source-coverage proposal](https://github.com/TheAxiomFoundation/axiom-corpus/blob/main/docs/source-coverage-check.md) is a design reference, not an implemented capability to assume.

## 4. Temporal and legal-relationship gates

Initial hard gates:

- Zero fallback from an unavailable historical request to current content.
- Zero automatic effective-date substitution from retrieval or release dates.
- Every published substantive relationship records evidence and extraction/review state.
- Unresolved and disputed claims remain distinguishable from verified facts.
- Historical source membership and historical observation are separately queryable.

Exercise open-ended intervals, unknown bounds, conditional commencement, retroactivity, different subsection dates, source corrections, and later historical backfills.

For relationships, test that:

- A citation does not become a judicial holding or constitutional invalidation.
- A case's decision date does not prove version alignment.
- A search hit does not become a confirmed implementing regulation.
- A PTOA entry retains its actual authority-citation granularity.
- A source conflict can retain both readings and their evidence.
- Guidance remains labeled as guidance even when it is official.

The [official PTOA description](https://www.ecfr.gov/parallel-table-of-authorities/current) and [IRS guidance explanation](https://www.irs.gov/privacy-disclosure/tax-code-regulations-and-official-guidance) support these distinctions. Tests validate faithful representation; legal review evaluates interpretations.

## 5. Incremental and dependency gates

Compare a clean rebuild with an incremental rebuild from the same frozen input set. Accepted data, dependency manifests, and deterministic publication artifacts must match after excluding declared observation/run metadata.

Mandatory scenarios:

1. Identical refresh: no unnecessary parsing, model calls, or published content rewrites.
2. One source change: only its dependent outputs invalidate.
3. Parser/schema/configuration change: affected cached outputs invalidate even when input bytes do not.
4. A Git tag points to a new commit: resolved-commit identity changes; tag-name cache entries cannot hide it.
5. Previously missing target appears: unresolved references invalidate through negative/collection dependencies.
6. Resolver coverage expands or a collection becomes complete: affected absence-based conclusions are reconsidered.
7. Evidence or editorial decision changes: derived summaries and affected pages invalidate.

Test release sequence R1 success, R2 partial, R3 success. R2 remains explicitly incomplete and cannot advance a complete-history watermark. R3 may be collected independently, but the missing R2 interval stays visible and queued. On repair, recompute affected adjacent historical comparisons and membership. Do not report a continuous history while silently skipping R2.

Measure stage duration, cache hits, memory, model use, and bytes on a documented reference machine and fixed corpus. Establish performance budgets after the pilot; do not invent throughput promises. Record regressions against that measured baseline.

## 6. Job execution, leases, and acceptance

Use failure-injection integration tests against the local PostgreSQL workbench:

- Duplicate delivery of the same task.
- Worker death before output, after writing blobs, and during acceptance.
- Expired lease followed by another worker's success.
- Late completion by the original worker.
- Input generation changing while a task runs.
- Concurrent attempts producing different outputs.
- Retry after an accepted task when the response was lost.

Initial hard gates:

- At most one accepted result for a task generation/input identity.
- Acceptance requires the current fencing token and compare-and-swap predicates.
- Late workers cannot overwrite newer accepted state.
- Retrying accepted identical work is a no-op.
- Partial blobs/rows never become visible as accepted outputs.
- Orphan artifacts remain identifiable for later retention cleanup.
- DAG cycles are rejected; legal graph cycles remain valid.

The optional executor/HCK adapter must pass the same suite as the built-in runner. It cannot weaken transactional acceptance or become a prerequisite for the single-machine milestone.

## 7. Model and retrieval checks

Model outputs must carry independent receipts containing exact input versions, prompt/configuration identity, model/runtime identity, output hash, and disposition. Replaying an accepted artifact must work without rerunning the model.

Construct a retrieval fixture containing current and historical versions with similar language, plus rejected, private, and out-of-jurisdiction records. Require exact scope/version/access filters and post-retrieval identifier validation. Similarity cannot override these filters.

Require a citation for every factual claim in an accepted generated annotation. Check that cited spans exist and support the claim. Unsupported claims, invented dates, citation-only inferred holdings, and unresolved source conflicts prevent automatic acceptance. Schema-valid output alone is insufficient.

Do not use the same model's agreement with its own output as an independent correctness oracle. Use fixed expected evidence and selective human/source review. Keep optional model failures from blocking an otherwise valid deterministic statutory release.

## 8. Static publication and browser checks

Build the candidate from one PublicationManifest. Pages, search indexes, graph shards, diffs, annotations, and downloadable data must use that identity.

Initial hard gates:

- No runtime requests to PostgreSQL, local model servers, vector services, Firecrawl, CourtListener, Federal Register, or other enrichment APIs.
- No credentials, private workbench records, internal paths, or local endpoint addresses in the public bundle.
- Required assets exist and match their manifest hashes.
- Candidate data and code refs are pinned; deployment cannot independently pull newer data.
- Broken internal links and unresolved required asset references fail publication.

Browser validation runs against a plain static file server with network interception. Permit only declared same-site static assets. Exercise section browsing, search, version selection, diffs, graph neighborhoods, source evidence, coverage badges, and keyboard navigation. Check mobile layouts and accessible names/focus behavior on representative pages.

Verify that unresolved applicability, partial enrichment, and unavailable historical versions are understandable without misleading legal conclusions. External source links may navigate when clicked; rendering the page does not depend on those services.

## 9. Promotion, rollback, backup, and partial releases

Test promotion of candidate P2 while P1 is active. A failure before the promotion boundary must leave P1 usable. After promotion, all pages/data must identify P2. Roll back to P1 without recomputing legal data or inference.

Core source completeness and optional enrichment completeness are separate. Reject missing required statutory partitions. Permit intentionally scoped releases and stale/partial optional overlays only when their manifest and UI disclose exact scope and status. A release is not “complete” merely because every selected task succeeded.

Restore PostgreSQL plus required blobs/manifests into a clean environment. Verify identity registries, review history, accepted artifacts, source hashes, and publication recreation. DuckDB/Parquet exports and pgvector indexes may be rebuilt; they must not be the only copies of accepted legal data.

Test restore with a missing raw artifact: identify the affected publications and fail verified replay rather than silently refetching different current bytes. Record backup verification results and retention decisions.

## 10. Licensing and release evidence

Validate each artifact's provenance/license chain and generate attribution before promotion. Imported RuleSpec-derived content must retain its [CC BY 4.0 obligations](https://github.com/TheAxiomFoundation/rulespec-us/blob/main/NOTICE); its presence cannot silently change CC0 data representations.

Each release review bundle contains source/coverage manifests, compiler/fidelity results, temporal and relationship checks, clean-versus-incremental comparison, job-recovery results, static-browser results, license report, known limitations, and rollback identity.

Report unexecuted checks as unexecuted. Report waived findings with owner, reason, affected scope, review/expiry conditions, and linked work. Existing accepted debt may be baselined narrowly; new findings must not silently expand it. Published quality statements describe the checks actually performed, separately from the remaining uncertainty of legal interpretation.
