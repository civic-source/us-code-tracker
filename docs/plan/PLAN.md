# US Code Tracker end-to-end implementation plan

**For William · November 21, 2026 · Proposed, ready for implementation review**

## Recommendation

Turn Tracker into a reproducible, evidence-backed history of federal legal material, with a capable local research workbench and a completely static public website. The highest-value work is making source acquisition, historical identity, and publication trustworthy. Build that foundation before broad enrichment, embeddings, or distributed execution.

This package merges the recovered November 14 legal-platform discussion, its saved Homelab Compute Kit companion plan, the current Tracker implementation, and lessons from The Axiom Foundation. It contains a product specification, architecture, data contracts, migration and operations guidance, independent validation scenarios, an agent handoff, and **36 proposed tickets with explicit dependencies**. Thirty-three tickets are required for the complete proposed release; three are optional. A working, repaired public tracker ships earlier through the M0 path.

## 1. What was recovered and what exists

The earlier conversation, **Open Source Legal Platform**, established the direction of local Linux/container processing, PostgreSQL/DuckDB, local model APIs including Gemma, and static Astro publication. It discussed a temporal legal graph, a separate processing DAG, content-addressed artifacts, graph/vector discovery, and optional additional machines. The saved standalone specification, architecture, and backlog describe **Homelab Compute Kit**, a related generic executor project. They are useful companion designs; they are not evidence that the Tracker migration was implemented.

The recovered [HCK specification](https://chatgpt.com/library?file_id=libfile_fde3_f-5c0b2a6d314c819185abbf8f6f8b6c23_e191bb2dea608191a8e0a6c3d8b290ad&account_id=personal), [architecture](https://chatgpt.com/library?file_id=libfile_fde3_f-fa33a48100248191835d7caeaa453fe2_e191bb2dea608191a8e0a6c3d8b290ad&account_id=personal), and [tickets](https://chatgpt.com/library?file_id=libfile_fde3_f-4ea31f2bc7a88191b1ae37f0b65571bf_e191bb2dea608191a8e0a6c3d8b290ad&account_id=personal) remain separate source artifacts. The recovered conversation supplies the legal-platform decisions incorporated here. I did not find a separate saved Tracker implementation packet in the scoped recovery.

Tracker's reviewed default branch is [822d2a5](https://github.com/civic-source/us-code-tracker/tree/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51), dated October 28, before that discussion. The review found existing ingestion, Markdown history, diffs, source credits/notes, annotations, Astro browsing, and regulation/history schema groundwork. It did not find the proposed PostgreSQL/DuckDB temporal workbench implemented there. Uninspected local or private work could still exist; the first ticket reconciles current state before editing.

Preserve the existing TypeScript/pnpm/Turborepo/Astro stack and the useful Python citation adapter. Preserve the `us-code` data repository and its history. Detailed code evidence and exact revisions are in [Migration](docs/MIGRATION.md) and [Source reconciliation](docs/SOURCE-RECONCILIATION.md).

## 2. Immediate repairs

Several inspected behaviors can undermine otherwise convincing results. Address them before expanding coverage.

| Finding in inspected code | Required change |
| --- | --- |
| Historical import can advance its shared resume cursor after a later success, skipping an earlier failed release; commits/tags precede the aggregate failure check | Track work by full release and scope; stage and validate before acceptance; keep gaps independently retryable |
| Tag creation can force replacement; some release parsing reduces identity to Congress/law numbers | Freeze historical mappings and use immutable new identities, preserving exclusions and corrections |
| Updating the data repository does not visibly advance the site's separately pinned submodule | Add an explicit accepted data → exact pin → build → deployment verification path immediately |
| Some enrichment errors become empty results | Separate successful empty, partial, failed, absent, and uncollected states; preserve last-good results |
| eCFR text search is treated as regulatory context; case search snippets populate stronger interpretation fields | Label discovery candidates truthfully and promote only evidence-supported relationships |
| API history fallbacks request a single page of tags/commits | Paginate those fallbacks and keep display pagination separate from catalog completeness |
| Diff caches identify endpoints by tag names without the full producer/configuration identity | Key deterministic outputs by resolved input identity and relevant tool/schema/configuration versions |

The publication repair is **USCT-033**, deliberately placed in M0 despite its later ticket number. It does not wait for the database, evidence graph, models, or every source adapter. **USCT-020** later integrates the richer publication-manifest contract.

## 3. Target product and architecture

The public reader should answer four concrete questions: what did this named release contain; what changed; what evidence supports this relationship or date; and what is missing or uncertain? The local workbench should make those answers reproducible and reviewable.

| Component | Role |
| --- | --- |
| Immutable source store | Exact downloaded bytes, source metadata, checksums, extraction mappings, and preserved prior versions |
| Canonical legal model | Stable provisions, textual versions, citation assignments, source membership, evidence, applicability, and review states |
| PostgreSQL | Accepted catalog, identity registry, graph relations, review history, task acceptance, and publication state |
| DuckDB/Parquet | Versioned analytical exports for coverage audits, joins, and research |
| Optional vectors and local Gemma | Candidate retrieval and proposed research annotations with recorded inputs and review status |
| Processing DAG | Versioned input dependencies, affected-work planning, retries, validation, and accepted artifact receipts |
| Static Astro publication | Pinned pages, evidence, diffs, scoped search, coverage, topic feeds, and downloadable manifests |

PostgreSQL is the one accepted catalog. Immutable artifacts plus exported identity/review/acceptance manifests support replay; they do not create a second independently writable catalog. DuckDB and vector indexes are derived projections. A small file-only fixture build remains available for contributors without production infrastructure.

The legal graph and processing DAG have different purposes. Citations can be cyclic; artifact derivation cannot. Keep their identities connected without forcing legal relationships into scheduling semantics. Start with deep domain modules and narrow interfaces inside the existing repository. Separate services require demonstrated operational needs.

The public build consumes one accepted manifest and has no dependency on live CourtListener/eCFR/guidance calls, a local model endpoint, a database, or browser API keys. The workbench can be off while readers inspect the published evidence.

## 4. The domain rules that prevent misleading history

### Three different kinds of historical query

| Query mode | Meaning | Required limitation |
| --- | --- | --- |
| As published | The text and membership of an explicit publisher snapshot | If the snapshot is missing, return unavailable; never substitute current text |
| Legally applicable | Supported applicability at a date and relevant factual context | Return conditional, disputed, or unknown when evidence cannot establish a definite answer |
| Known as of | Records actually observed by this installation by a cutoff | A backfilled old document does not create an old acquisition/knowledge timestamp |

Build reliable as-published history first. Effective dates can differ by subsection and depend on tax years, proceedings, external events, or other facts. A release date, enactment date, retrieval time, or Git commit date cannot stand in for those conditions.

### Stable identities and evidence

A citation is an assignment, not a timeless identity. Preserve source identifiers and aliases, but record transfers, renumbering, splits, mergers, and reused section numbers explicitly. An opinion's date alone does not establish which statutory version it considered. Similar text can suggest a match without proving continuity.

Attach evidence to each important assertion: a source snapshot, a reproducible locator, the quoted span or structured value, extraction version, and review state. Keep five dimensions separate: extraction correctness, editorial review, legal authority, applicability, and collection coverage. A verified quote can still support a disputed interpretation.

Represent disagreements as reviewable records containing the competing readings, precise question, evidence, rationale, disposition, and affected outputs. Avoid a single authoritative-looking confidence score. Editorial acceptance is not a court ruling.

## 5. What the Axiom review adds

The most useful transferable patterns are field-level evidence, explicit conflicts, reverse dependency indexes, immutable releases, and content fidelity gates. Their purpose here is to make a conventional tracker more accountable and easier to update.

Use the [RuleSpec conflict register](https://github.com/TheAxiomFoundation/rulespec-us/blob/25ddba37d0736fea9c9da381dafed208c50bb0a6/known-source-conflicts.yaml) as a structural reference. Use its [reverse-index generator](https://github.com/TheAxiomFoundation/rulespec-us/blob/25ddba37d0736fea9c9da381dafed208c50bb0a6/tests/generate_reverse_index.py) as a starting pattern for impact analysis, with explicit failures instead of silently skipped malformed records. Adapt the corpus project's [named-release publication](https://github.com/TheAxiomFoundation/axiom-corpus/blob/7242a022925fca252e2af87b13e1d2ea3307040c/docs/named-release-publication.md) and [content gates](https://github.com/TheAxiomFoundation/axiom-corpus/blob/7242a022925fca252e2af87b13e1d2ea3307040c/docs/release-gate-policy.md).

Do not assume a source is complete because it hashes correctly or its YAML validates. The reviewed corpus documents historical-query limitations; the reviewed source-staleness workflow reports findings without enforcing them, and the bulk encoding workflow is disabled during migration. Reuse demonstrated ideas and verify operational behavior independently.

RuleSpec-derived encodings, companion tests, parameters, and provenance have attribution obligations under its [NOTICE](https://github.com/TheAxiomFoundation/rulespec-us/blob/25ddba37d0736fea9c9da381dafed208c50bb0a6/NOTICE). Keep them distinct from public-domain/CC0 source exports. Optional RuleSpec interoperability is a bounded later experiment, not the canonical format for all federal law.

## 6. Source rollout

Begin with OLRC text, release metadata, notes, and classification tables. Add GovInfo enacted-law documents and package metadata for verifiable amendment context. Add a bounded regulation slice using actual authority citations and the eCFR Parallel Table of Authorities; a full-text hit is only a candidate, and part-level authority does not establish a subsection-level implementation relation.

Use CourtListener identifiers and actual opinion evidence for a bounded judicial slice. Preserve legacy snippets as retrieval evidence. Test and reconcile the Python and TypeScript adapters before retiring duplicate production paths. The current CAP-named repository searches CourtListener; evaluate real CAP bulk acquisition separately if it becomes useful.

Snapshot Federal Register and selected agency guidance during processing. Preserve whether a document is a rule, proposed rule, notice, statute, regulation, opinion, or guidance. Add Congress metadata and additional topic-specific sources only when a concrete research use case justifies the collection and review cost.

Acquiring additional source data needed for the new schemas is explicitly authorized. Implementers may discover, download, re-fetch, and backfill relevant public sources and already-authorized APIs, including historical editions, start/end dates, applicability conditions, citations, relationships, and provenance. The source list is a starting point, not a closed allowlist; routine in-scope collection does not require another confirmation. Maintain a field-to-source coverage map and distinguish collection completeness from whether the evidence establishes a legal fact. Every adapter declares scope, authoritative source, access method, pagination, expected inventory, rate limits, absence/error behavior, provenance, and licensing. A source catalog can include discovered URLs from Axiom/PolicyEngine, but `discovered_via` must remain separate from publisher authority. Official links and boundaries appear in [Source reconciliation](docs/SOURCE-RECONCILIATION.md). Detailed collection and schema-backfill requirements appear in [Data acquisition](docs/DATA-ACQUISITION.md).

## 7. Delivery roadmap

Milestones group outcomes; real blockers are defined per ticket. Independent work can proceed when its prerequisites pass. Do not serialize every ticket merely because its number is larger.

| Milestone | Tickets | Demonstrable exit |
| --- | --- | --- |
| **M0: Repair current trust and publication failures** | 001–007, 033 | Failed work remains retryable; source states and snippet labels are honest; new release identities are immutable; a data-only correction reaches the exact verified site build |
| **M1: Prove historical fidelity and local catalog** | 008–012 | One frozen source cohort produces canonical records, a PostgreSQL query, rich static history/comparison, stable aliases, and visible coverage |
| **M2: Add evidence-backed context** | 013–017, 034 | A bounded amendment, regulation, and opinion slice has inspectable evidence; static rulemaking/guidance and explicit conflict/unknown states work |
| **M3: Update and publish coherently** | 018–021, 035–036 | Source and producer changes invalidate the right artifacts; independent enrichment refresh works; one manifest binds text, evidence, diffs, search, and deployment |
| **M4: Make the local workbench useful** | 022–025 | DuckDB audit exports, required lexical retrieval, version-aware evidence, and a scoped static change feed; optional vectors/model assistance evaluated separately |
| **M5: Migrate, scale, and operate** | 026–030 | Representative pilot parity, measured cohort backfill, independent acceptance, restore/recovery evidence, compatible cutover, and demonstrated rollback |
| **M6: Optional interoperability** | 031–032 | One existing HCK/ACQ executor integration or one attributed RuleSpec-compatible slice, only if selected and useful |

**Initial ready frontier: USCT-001.** After reconciliation, the independent M0 repair tickets become available. USCT-033 follows the source-failure and immutable-identity repairs; it should be prioritized before optional architecture expansion. Read [backlog/README.md](backlog/README.md) for the full list and [backlog.json](backlog/backlog.json) for exact blockers and suggested ordering.

Three explicit slices close the most important implementation gaps: bounded temporal queries (**034**), fenced task acceptance (**035**), and public static historical search (**036**).

The three optional tickets are local Gemma assistance (**024**), HCK/ACQ execution (**031**), and RuleSpec interoperability (**032**). Optional pgvector ranking is an evaluated branch inside **023**; that ticket and the required release can close with lexical search alone.

Treat the schedule as evidence-driven. As an initial planning allowance, the complete required release is roughly **6–12 focused engineer-weeks**, plus elapsed source review and backfill time. This is a judgment based on scope, not a measured estimate. Re-estimate after the first historical slice and resource benchmark. Deliver the M0 repairs to the existing site early and demonstrate subsequent bounded candidates as separate previews. The primary site's migration cutover follows acceptance of the declared migration scope.

## 8. The validation bar

Independent examples matter more than a high count of shallow tests. Preserve source manifests and manually reviewed expectations. Add synthetic fixtures for conditions difficult to obtain as small official documents, clearly labeled synthetic.

| Scenario | Required result |
| --- | --- |
| R1 succeeds, R2 partly fails, R3 succeeds | R2 remains retryable and is never presented as complete |
| A publisher release has an exclusion or later correction | Each exact content/release identity remains distinct; historical references are not reassigned |
| A law takes effect later and partly applies to earlier tax years | Snapshot history, legal applicability, and system observation remain separate; missing facts remain conditional |
| A provision transfers and its old citation is later reused | Historical links retain the correct identity; ambiguity is not silently resolved |
| HTTP 200 returns valid XML with missing notes/table cells | Fidelity gates catch the missing legal content despite valid hashes and syntax |
| Regulation pagination fails halfway | Coverage is partial/failed, last-good data survives, and no false absence is published |
| A previously missing citation target is added | Negative/collection dependencies invalidate the old unresolved result |
| A parser, schema, or model configuration changes | Affected derived artifacts get new identity; the event is not automatically called a legislative amendment |
| An expired worker returns after a replacement finishes | Fenced acceptance rejects the stale worker's promotion |
| A site candidate has a stale data pin or wrong search index | Publication fails; all accepted artifacts must identify the same complete release |
| A new publication is withdrawn | The complete preceding manifest/build can be restored without rewriting data history |

Also review keyboard/screen-reader behavior, meaningful focus, responsive pages, bounded downloads, and browser network activity on representative built pages. Verify source parsing and rendering boundaries against untrusted input. The core site must work with model/API enrichment unavailable.

These are proposed checks, not tests run during planning. [Validation](docs/VALIDATION.md) defines the detailed gates and [Operations](docs/OPERATIONS.md) defines promotion/restore procedures.

## 9. Migration and release strategy

Use expand–migrate–contract. First inventory the current data pin, historical tags, URLs, source coverage, and actual test path. Add versioned contracts and compatibility readers. Import existing output as legacy-derived where original bytes or producer metadata are unavailable; retain that limitation instead of manufacturing provenance.

Run old and new transformations against the same frozen cohort. Compare meaningful text, hierarchy, notes, tables, identity, source credits, status, citations, and evidence—not just row counts. Classify changes as source edits, formatting, producer corrections, extraction loss, or unresolved differences. Unexplained legal-text loss blocks cohort acceptance.

Stage a bounded complete candidate at a separate preview location while the existing primary site remains available. Verify its deployed manifest and rehearse rollback there. Expand historical coverage by title/release cohorts, with per-scope checkpoints and resource budgets. USCT-027 accounts for the declared migration scope; USCT-029 accepts that scope; USCT-030 performs the primary-site cutover with existing URLs preserved. This does not prevent the independent M0 repair from shipping to the current site earlier. Remove old readers and duplicate producers only after parity and an explicitly chosen observation period. Preserve compatible exports where outside consumers need them.

## 10. Operating model and useful additions

Measure the actual host and corpus before buying hardware or adding workers. The earlier memory/disk figures were suggestions, not observed equipment. Track source bytes, Git history, artifacts, database, vector indexes, and browser bundles separately. Deduplicate by content, but keep published sources recoverable and reserve space for rollback and restore.

Operate source refreshes independently, with bounded retries and overlap where late updates are possible. Show discovered, ingested, accepted, and published progress separately. A failure should identify the affected scope and recovery action. Core source incompleteness blocks publication; optional enrichment may remain visibly stale.

Several additions deserve particular emphasis:

- **An evidence inspector:** one place to see a claim, its source span, legal status, date basis, and review history.
- **A source-change inbox:** a private queue of source changes, fidelity exceptions, unresolved identities, and interpretations needing review, ordered by affected published outputs.
- **An impact preview:** before accepting a source or producer change, show which pages, assertions, search shards, and exports will change.
- **A coverage dashboard:** exact declared scope and last-good state rather than an undifferentiated “up to date” badge.
- **Versioned topic feeds:** bounded static feeds for an explicitly chosen set of provisions, with source/evidence links and no personalized runtime service.
- **Portable research exports:** JSONL/Parquet and a manifest let another researcher reproduce a bounded result without the full website or private workbench.

These features fit the data/evidence contracts already required. They should be delivered as bounded views over those records rather than separate subsystems.

## 11. How to implement the plan with agents

The package applies Matt Pocock's current **to-spec**, **to-tickets**, domain-modeling, codebase-design, TDD, and code-review methods at the [reviewed revision](https://github.com/mattpocock/skills/tree/abeeaf95660ba9e8b7c753eb38f441ca707a8823). Skills were read and applied, not installed.

Each ticket has an observable result, blockers, acceptance criteria, independent validation, a demo, closure evidence, and rollback notes. Work in isolated branches/worktrees, parallelize independent ready slices, and maintain a single owner for overlapping files. Separate specification review, repository standards review, and evidence/time review. None substitutes for the others.

Use [AGENT-START.md](AGENT-START.md) as the reusable handoff. It instructs the implementer to reconcile existing work first, preserve conventions and history, select the actual ready frontier, and retain evidence of what was tested. It carries forward the user's explicit authorization for relevant source discovery, acquisition, re-fetching, and backfill. It does not grant blanket authorization to publish issues, merge changes, deploy, or contact anyone.

## 12. Completion criteria and limits

The complete required release is done when declared source scopes are accounted for; historical and current views have correct identity and evidence; required deterministic outputs can be reproduced; source updates and new targets invalidate affected work; local query/export works without optional models; static publication is internally consistent; and restoration/rollback have been demonstrated. Known limitations remain visible and owned.

This plan does not promise all legal applicability can be computed, all case law is covered, or every interpretation can be formally proved. Full state coverage, a tax/benefits engine, universal citator behavior, a mandatory cluster scheduler, and a public runtime LLM remain outside the core release. The complete package makes those boundaries explicit while preserving clean ways to explore them later.
