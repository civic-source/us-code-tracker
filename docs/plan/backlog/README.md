# US Code Tracker implementation backlog

This is a proposed backlog for the merged improvement plan. It contains 36 scoped tickets and creates no external issues. Every ticket remains **proposed**; readiness records prerequisite state, not implementation approval or completion.

## How to use it

1. Start with [USCT-001](USCT-001.md) to reconcile current code, issues and PRs. This backlog is based on a pinned inspection and must not duplicate work completed afterward.
2. Work only tickets whose blockers are satisfied. Independent tickets in the ready frontier can run in parallel in isolated worktrees.
3. Demonstrate the listed user/operator outcome, collect independent evidence and review against the merged spec before closing a ticket.
4. Use the project’s existing issue and PR process when execution is authorized. No issue-creation script is included.
5. Keep optional work separate: pgvector ranking, local Gemma, an HCK/ACQ executor adapter and RuleSpec interoperability do not gate required delivery.

## Accepted architecture

The local workbench uses PostgreSQL with required lexical search and a file-backed fixture/replay path. pgvector ranking is an optional evaluated enhancement, not a prerequisite to local retrieval or core delivery. DuckDB/Parquet provide reproducible analytics and export projections. Optional local Gemma produces reviewable derived drafts. The published reader remains a static Astro site with no required runtime database, model or third-party API. The legal relationship graph and processing dependency DAG are distinct.

## Authorized source acquisition and schema backfill

Relevant source discovery, acquisition/refetch and cross-source backfills needed for the new schemas are authorized for public sources and sources the user is already authorized to access. Ordinary in-scope collection does not need repeated confirmation. The plan is not constrained to data already in the repository: USCT-001 maps schema fields to available/missing source evidence; USCT-008 and USCT-013–016 can acquire the missing documents; USCT-027 backfills metadata, temporal and assertion/evidence fields across sources.

Prefer official bulk downloads and documented APIs. Preserve immutable raw versions, source/retrieval identities, hashes, observation times, provenance and license/reuse basis, and respect per-source limits. Acquisition/processing completeness and semantic certainty remain separate: unknown or disputed legal facts stay explicit, while missing required source partitions cannot count as complete. USCT-034 records endpoint state, date precision, basis and evidence; a null date never implies an open endpoint or ongoing validity.

This authorization does not add permission for paid services, new restricted-account access or broad deployment. These changes update the plan; they do not start production implementation.

## Ticket graph and status

[`backlog.json`](backlog.json) is the machine-readable source for dependency inspection and contains an explicit `topological_order`. The initial ready frontier is **USCT-001**. All other tickets are proposed and blocked until their listed prerequisites are complete or reconciliation proves them already satisfied. IDs are stable references, not execution order: **USCT-033** was added during review as an early M0 repair; **USCT-034–036** add explicit delivery ownership for temporal modes, local attempt acceptance and static historical search. The graph lists minimal direct blockers; transitive prerequisites are inherited. **USCT-024, USCT-031 and USCT-032 are optional.** USCT-023 requires lexical search only; its vector branch is optional.

## Scheduling and optional work

The JSON contains a combined `topological_order` plus separate `required_topological_order` and `optional_topological_order` lists. Suggested selection prioritizes earlier milestones, then ticket ID **among currently ready nodes**. It does not add dependencies or force independent tickets to run serially. The first suggested sequence is USCT-001 through USCT-007, then **USCT-033**, before the M1 proof. USCT-033 can run as soon as its blockers are satisfied; a ready-peer listing is not a reason to delay it.

Optional tickets are excluded from the required sequence. Their place in the combined order shows possible eligibility only; it never obligates execution or delays a required milestone. Run an optional experiment only if selected. The optional vector branch inside USCT-023 is likewise unnecessary for required lexical acceptance.

Every required ticket is now a dependency ancestor of the USCT-030 cutover gate. In particular, source-refresh delivery USCT-019 feeds operational recovery USCT-028, so it cannot remain an unaccepted leaf while cutover proceeds. This property, acyclicity and optional nonblocking behavior were checked against the machine-readable graph.

## Early publication repair

[USCT-033](USCT-033.md) repairs the existing validated data-promotion → exact pin update → site publication path after the source-result and immutable-identity repairs. It does not wait for the new enrichment, catalog or model architecture. [USCT-020](USCT-020.md) later extends the working path with the full provenance, completeness and artifact contract.

## Explicit ownership of the final scope gaps

[USCT-034](USCT-034.md) implements bounded temporal modes: immutable as-published release, actual recorded known-as-of state, and evidence-backed applicability with known/conditional/disputed/unknown results. The finding register consumes that contract. A late backfill never fabricates earlier tracker knowledge.

[USCT-035](USCT-035.md) implements a minimal local TaskAttempt generation, lease, fencing and compare-and-swap acceptance path. Independent refreshes consume it so a stale worker cannot promote after a newer generation wins. This is not a distributed scheduler.

[USCT-036](USCT-036.md) delivers bounded release/title search shards that keep historical result navigation pinned to the exact selected release, with no live API or model. Final static-reader acceptance depends on it. Each first demonstration uses a small independently specified fixture.

The graph contains **33 required tickets and 3 optional tickets**. All 32 other required tickets are ancestors of the USCT-030 cutover gate; optional work remains outside that gate.

## Release-catalog observation and proposed regression fixtures

At the pinned snapshot, [DiffViewer](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/apps/web/src/components/DiffViewer.svelte) loads static manifest pairs first; its API fallback requests one page of tags with `per_page=100`. [getFileHistory](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/apps/web/src/lib/github.ts) requests one page of commits with `per_page=50`. The eight-item commit preview is presentation behavior. No 60-release cap was verified. USCT-007 proposes synthetic fixtures with **103 release identities** and **53 file-history commits** to cross the observed fallback page sizes; these are test-design choices, not measured production corpus totals.

## Milestones

| Milestone | Outcome | Tickets |
| --- | --- | --- |
| M0 | Reconcile existing work and repair current trust/history failures | USCT-001, USCT-002, USCT-003, USCT-004, USCT-005, USCT-006, USCT-007, USCT-033 |
| M1 | Prove source-to-history-page behavior and the local catalog | USCT-008, USCT-009, USCT-010, USCT-011, USCT-012 |
| M2 | Attach verified legal context and explicit uncertainty | USCT-013, USCT-014, USCT-015, USCT-016, USCT-017, USCT-034 |
| M3 | Update independently and publish an exactly pinned static snapshot | USCT-018, USCT-019, USCT-020, USCT-021, USCT-035, USCT-036 |
| M4 | Provide a local research workbench and static topic views | USCT-022, USCT-023, USCT-024, USCT-025 |
| M5 | Backfill, validate, cut over and operate recoverably | USCT-026, USCT-027, USCT-028, USCT-029, USCT-030 |
| M6 | Evaluate optional compute and RuleSpec interoperability | USCT-031, USCT-032 |

## Ticket index

| ID | Proposed outcome | Type | Blocked by |
| --- | --- | --- | --- |
| [USCT-001](USCT-001.md) | Reconcile the merged plan with current code and work already tracked | decision | None |
| [USCT-002](USCT-002.md) | Show source outages and partial results without reporting false emptiness | delivery | USCT-001 |
| [USCT-003](USCT-003.md) | Label eCFR text matches as unverified candidates | delivery | USCT-001 |
| [USCT-004](USCT-004.md) | Present CourtListener snippets as retrieval evidence, not holdings | delivery | USCT-001 |
| [USCT-005](USCT-005.md) | Resume historical imports across a failed middle release | delivery | USCT-001 |
| [USCT-006](USCT-006.md) | Protect published release identities from replacement | delivery | USCT-001 |
| [USCT-007](USCT-007.md) | Preserve complete release catalogs and paginate API fallbacks | delivery | USCT-001 |
| [USCT-033](USCT-033.md) | Repair the existing validated data-to-site publication handoff | delivery | USCT-002, USCT-006 |
| [USCT-008](USCT-008.md) | Trace one source release through a canonical historical section page | delivery | USCT-002, USCT-005, USCT-006, USCT-007 |
| [USCT-009](USCT-009.md) | Load and query the canonical fixture in the local PostgreSQL workbench | delivery | USCT-008 |
| [USCT-010](USCT-010.md) | Preserve rich USLM structure in readable historical output | delivery | USCT-008 |
| [USCT-011](USCT-011.md) | Follow a provision through citation changes and uncertain continuity | delivery | USCT-008 |
| [USCT-012](USCT-012.md) | Publish per-scope completeness and source freshness beside the text | delivery | USCT-008 |
| [USCT-013](USCT-013.md) | Verify a section amendment against enacted law evidence | delivery | USCT-010 |
| [USCT-014](USCT-014.md) | Promote a regulation candidate only with verified authority evidence | delivery | USCT-003, USCT-008 |
| [USCT-015](USCT-015.md) | Attach a reviewed case proposition to exact opinion evidence | delivery | USCT-004, USCT-011 |
| [USCT-016](USCT-016.md) | Render Federal Register and agency guidance context from static snapshots | delivery | USCT-013 |
| [USCT-017](USCT-017.md) | Expose unresolved evidence and shrinking quality exceptions | delivery | USCT-012, USCT-014, USCT-034 |
| [USCT-034](USCT-034.md) | Query publication, actual knowledge and evidence-backed applicability separately | delivery | USCT-009, USCT-011, USCT-013 |
| [USCT-018](USCT-018.md) | Rebuild safely when content, producer, schema or configuration changes | delivery | USCT-009, USCT-012 |
| [USCT-019](USCT-019.md) | Refresh one external source without rerunning unrelated work | delivery | USCT-014, USCT-015, USCT-016, USCT-035 |
| [USCT-020](USCT-020.md) | Carry an accepted data release into the exact deployed site manifest | delivery | USCT-018, USCT-033 |
| [USCT-021](USCT-021.md) | Explore verified legal relationships in a bounded static reader view | delivery | USCT-014, USCT-015, USCT-016, USCT-018 |
| [USCT-035](USCT-035.md) | Reject stale local task attempts before accepting their artifacts | delivery | USCT-018 |
| [USCT-036](USCT-036.md) | Search a selected historical release using bounded static shards | delivery | USCT-011, USCT-018 |
| [USCT-022](USCT-022.md) | Audit corpus coverage locally with reproducible Parquet and DuckDB queries | delivery | USCT-018 |
| [USCT-023](USCT-023.md) | Search the local workbench lexically with optional vector ranking | delivery | USCT-009, USCT-011 |
| [USCT-024](USCT-024.md) | Optionally draft evidence-bound research notes with local Gemma | optional | USCT-017, USCT-018, USCT-023 |
| [USCT-025](USCT-025.md) | Publish a static topic and change feed backed by verified scope | delivery | USCT-021 |
| [USCT-026](USCT-026.md) | Backfill a representative pilot while preserving current URLs and data | delivery | USCT-017, USCT-018 |
| [USCT-027](USCT-027.md) | Scale historical backfill with complete scope accounting and bounded resources | delivery | USCT-022, USCT-026 |
| [USCT-028](USCT-028.md) | Operate source refreshes and recover from corruption or credential failure | delivery | USCT-019, USCT-020, USCT-023, USCT-026 |
| [USCT-029](USCT-029.md) | Verify the complete static reader and local workbench before cutover | delivery | USCT-025, USCT-027, USCT-028, USCT-036 |
| [USCT-030](USCT-030.md) | Cut over by immutable publication pointer and rehearse reversal | delivery | USCT-029 |
| [USCT-031](USCT-031.md) | Optionally execute a bounded job through an HCK or ACQ adapter | optional | USCT-022, USCT-028 |
| [USCT-032](USCT-032.md) | Optionally export an attributed RuleSpec-compatible evidence slice | optional | USCT-030 |

## Delivery discipline

Each delivery ticket is a narrow capability with a demonstrable user or operator outcome across its required processing and presentation surfaces. Broad identity/schema migrations use expand, migrate, contract so legacy readers and URLs continue to work. A completed parser step is not a completed user feature. Cache, batch and operational tickets are independently verifiable through the public job/report interface.

Validation must compare behavior against curated source fixtures, independent expected sets or held-out reviewed examples. A test that reuses the implementation’s result as its own expected answer is insufficient. Review spec fidelity and repository standards separately, with an additional evidence/temporal correctness review for relevant changes.

## Provenance

Tracker inspection baseline: [`822d2a5f904a874f107bcdf4c99f0e1fda4f5d51`](https://github.com/civic-source/us-code-tracker/commit/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51).

Methods were adapted from the official Matt Pocock skills repository at [`abeeaf95660ba9e8b7c753eb38f441ca707a8823`](https://github.com/mattpocock/skills/commit/abeeaf95660ba9e8b7c753eb38f441ca707a8823): `to-spec`, `to-tickets`, `domain-modeling`, `codebase-design`, `tdd`, `code-review` and `implement-spec`. Current names replace older `write-a-prd` / `prd-to-issues` naming. No skills were installed, modified or invoked to publish external issues.

Prepared November 21, 2026. This backlog describes planned work, not executed implementation or verified current deployment health.
