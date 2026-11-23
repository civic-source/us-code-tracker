# Source reconciliation and design provenance

**Review date: November 21, 2026, America/New_York.** Exact revisions identify the reviewed material; they are not promises that upstream main branches will remain unchanged.

## Recovered earlier work

The prior work was recovered from the November 14 conversation titled **Open Source Legal Platform** and saved companion Homelab Compute Kit (HCK) planning artifacts. The legal-platform direction was present in the conversation; the recovered standalone specification, architecture, and tickets describe the generic compute kit. They should not be mistaken for an already implemented Tracker migration.

Recovered companion files:

- [HCK specification](https://chatgpt.com/library?file_id=libfile_fde3_f-5c0b2a6d314c819185abbf8f6f8b6c23_e191bb2dea608191a8e0a6c3d8b290ad&account_id=personal)
- [HCK architecture](https://chatgpt.com/library?file_id=libfile_fde3_f-fa33a48100248191835d7caeaa453fe2_e191bb2dea608191a8e0a6c3d8b290ad&account_id=personal)
- [HCK tickets](https://chatgpt.com/library?file_id=libfile_fde3_f-4ea31f2bc7a88191b1ae37f0b65571bf_e191bb2dea608191a8e0a6c3d8b290ad&account_id=personal)

| Earlier item | Evidence status | Treatment in the merged plan |
| --- | --- | --- |
| Local Linux/container processing with static Astro publication | User-supported direction in recovered conversation | Retain as architectural boundary |
| PostgreSQL/DuckDB and local model APIs including Gemma | User-supported direction; operational details not measured | Retain; PostgreSQL accepted catalog, DuckDB analytics, models optional |
| Temporal legal graph separate from processing DAG | Earlier assistant design proposal aligned with the requested goals | Adopt as proposed domain contract, with explicit legal/observation-time distinctions |
| Content-addressed artifacts and incremental recomputation | Earlier proposal, reinforced by HCK and Axiom patterns | Adopt; add negative/collection dependencies and producer-sensitive keys |
| Multiple hosts, Slurm, optional cloud | Expansion possibilities rather than a required initial deployment | Gate behind local measurement and executor-contract tests |
| HCK finite tasks, pinned environments, receipts, fenced acceptance | Saved companion specification | Reuse the contract; do not make a separate platform build a prerequisite |
| Graph/vector retrieval and optional formal reasoning | Research possibilities | Lexical graph exploration first, vectors evaluated, formal checks only for bounded demonstrable invariants |
| 32–64 GB RAM / 4 TB disk | Prior assistant recommendations | Do not assume these are the user's actual machines or fixed requirements |

I did not find a separate saved Tracker implementation package in the scoped recovery. The merged package makes the recovered conversation's design concrete and connects it to current code. That finding does not exclude uninspected local branches, private notes, or work elsewhere.

## Reviewed repository revisions

| Repository | Revision |
| --- | --- |
| [civic-source/us-code-tracker](https://github.com/civic-source/us-code-tracker/tree/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51) | `822d2a5f904a874f107bcdf4c99f0e1fda4f5d51` |
| [civic-source/us-code](https://github.com/civic-source/us-code/tree/b61a5431487ab20d9b447516dcac2d01b2d81762) | `b61a5431487ab20d9b447516dcac2d01b2d81762` |
| [civic-source/cap-citation-pipeline](https://github.com/civic-source/cap-citation-pipeline/tree/a23bc150eea35ed3a4d195515467340932aad3db) | `a23bc150eea35ed3a4d195515467340932aad3db` |
| [TheAxiomFoundation/rulespec-us](https://github.com/TheAxiomFoundation/rulespec-us/tree/25ddba37d0736fea9c9da381dafed208c50bb0a6) | `25ddba37d0736fea9c9da381dafed208c50bb0a6` |
| [TheAxiomFoundation/axiom-corpus](https://github.com/TheAxiomFoundation/axiom-corpus/tree/7242a022925fca252e2af87b13e1d2ea3307040c) | `7242a022925fca252e2af87b13e1d2ea3307040c` |
| [TheAxiomFoundation/axiom-scrapers](https://github.com/TheAxiomFoundation/axiom-scrapers/tree/da5d6517ffc948c0a0c34291deb5804aeada5e03) | `da5d6517ffc948c0a0c34291deb5804aeada5e03` |
| [mattpocock/skills](https://github.com/mattpocock/skills/tree/abeeaf95660ba9e8b7c753eb38f441ca707a8823) | `abeeaf95660ba9e8b7c753eb38f441ca707a8823` |

Tracker's inspected default branch predates the recovered November 14 discussion. The inspection did not find the proposed local PostgreSQL/DuckDB workbench or complete temporal/evidence migration there. Useful existing features are already implemented: historical import, content-based change detection, source credits/notes, static browsing, diffs, annotation schemas, and regulation/legislative-history schema groundwork. Reuse these. Detailed code findings and exact migration paths appear in [MIGRATION.md](MIGRATION.md).

## What to borrow from Axiom

| Pattern | Evidence | Application and qualification |
| --- | --- | --- |
| Field-level source support | [Representative SNAP encoding](https://github.com/TheAxiomFoundation/rulespec-us/blob/25ddba37d0736fea9c9da381dafed208c50bb0a6/us/statutes/7/2015/f.yaml) | Attach evidence to individual values and assertions, especially applicability; retain statute/guidance distinctions |
| Reverse source index | [Generator](https://github.com/TheAxiomFoundation/rulespec-us/blob/25ddba37d0736fea9c9da381dafed208c50bb0a6/tests/generate_reverse_index.py) | Generate affected-output indexes; malformed input must fail or quarantine explicitly instead of disappearing |
| Explicit disagreements | [Conflict register](https://github.com/TheAxiomFoundation/rulespec-us/blob/25ddba37d0736fea9c9da381dafed208c50bb0a6/known-source-conflicts.yaml) | Preserve alternatives, scope, rationale, and decisions; editorial disposition is not a legal ruling |
| Immutable named releases | [Corpus publication design](https://github.com/TheAxiomFoundation/axiom-corpus/blob/7242a022925fca252e2af87b13e1d2ea3307040c/docs/named-release-publication.md) | Stage, validate, activate, and retain a reproducible release |
| Content fidelity gates | [Release gate policy](https://github.com/TheAxiomFoundation/axiom-corpus/blob/7242a022925fca252e2af87b13e1d2ea3307040c/docs/release-gate-policy.md) and [coverage proposal](https://github.com/TheAxiomFoundation/axiom-corpus/blob/7242a022925fca252e2af87b13e1d2ea3307040c/docs/source-coverage-check.md) | Check actual legal text and coverage, not just hashes/schema; distinguish implemented gates from proposed metrics |
| Source discovery inventory | [PolicyEngine reference tooling](https://github.com/TheAxiomFoundation/axiom-corpus/blob/7242a022925fca252e2af87b13e1d2ea3307040c/src/axiom_corpus/corpus/policyengine_references.py) | Discover candidate URLs, classify them, then acquire authoritative source documents independently |

Do not treat the ecosystem as a complete replacement. Its [historical-query documentation](https://github.com/TheAxiomFoundation/axiom-corpus/blob/7242a022925fca252e2af87b13e1d2ea3307040c/docs/historical-versioning.md) identifies statute paths that ignore an `as_of` argument. Named release reproducibility therefore does not establish legal applicability or comprehensive historical queries. The reviewed RuleSpec source-staleness workflow is report-only, and its bulk-encode workflow is disabled during migration. Those are design references, not ready production guarantees.

The [RuleSpec NOTICE](https://github.com/TheAxiomFoundation/rulespec-us/blob/25ddba37d0736fea9c9da381dafed208c50bb0a6/NOTICE) distinguishes CC BY 4.0 encodings and related material from Apache-2.0 incidental tooling. Preserve provenance and attribution for imported derivatives. Reusing the approach while independently acquiring official source text is a separate operation.

## Source acquisition priorities

| Priority | Source | Intended use | Boundary |
| --- | --- | --- | --- |
| Core | [OLRC downloads](https://uscode.house.gov/download.html) and [classification tables](https://uscode.house.gov/classification/tables.html) | U.S. Code snapshots, source credits, notes, amendment discovery | Published currency and classifications require their own evidence; a release label is not an effective date |
| Core context | [GovInfo bulk data](https://www.govinfo.gov/bulkdata) and [API](https://github.com/usgpo/api) | Enacted public laws, Statutes at Large and edition/package metadata where available | Version and verify exact documents; do not infer all amendment causality from release ordering |
| Bounded regulation | [eCFR API](https://www.ecfr.gov/developers/documentation/api/v1) and [Parallel Table of Authorities](https://www.ecfr.gov/parallel-table-of-authorities/current) | Regulation text, version metadata, qualified authority citations | Part-level authority does not prove a subsection-level implementation relationship |
| Bounded rulemaking | [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1) | Rules, notices, agency and CFR metadata | Distinguish document type and legal status; retain links to official publication evidence |
| Bounded judicial context | [CourtListener APIs](https://www.courtlistener.com/help/api/) | Opinion identifiers/text and citation discovery | Search snippets are not holdings; provider coverage is not universal legal coverage |
| Later context | [Congress.gov API](https://github.com/LibraryOfCongress/api.congress.gov) | Legislative metadata and source discovery | Bills and reports have different status from enacted law |
| Topic-specific | [IRS](https://www.irs.gov/) and [SSA POMS](https://secure.ssa.gov/apps10/poms.nsf/home) | Tax/benefits guidance when a pilot needs it | Preserve document authority, currency, scope, and interpretation separately |

Additional mirrors or CAP bulk data can be evaluated after access, licensing, scope, and value are verified. The repository named cap-citation-pipeline currently searches CourtListener; its name does not establish a CAP bulk ingestion implementation.

## Planning methods

Applied Matt Pocock's current [to-spec](https://github.com/mattpocock/skills/blob/abeeaf95660ba9e8b7c753eb38f441ca707a8823/skills/engineering/to-spec/SKILL.md), [to-tickets](https://github.com/mattpocock/skills/blob/abeeaf95660ba9e8b7c753eb38f441ca707a8823/skills/engineering/to-tickets/SKILL.md), domain-modeling, codebase-design, TDD, and code-review guidance. The package uses a consolidated specification, a shared glossary, a few consequential decisions, small demonstrable slices, real dependency edges, and separate implementation/specification reviews. Legal-source/evidence review is an additional project-specific gate.

These methods were read and applied, not installed. No GitHub issues were posted. New ticket identifiers and requirements are proposed here. Review current repository instructions and APIs before implementation; do not treat any upstream skill or code comment as authorization to publish, merge, or alter unrelated resources.
