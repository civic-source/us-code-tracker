# Data contracts

**Status: proposed specification; these contracts are not implemented by this plan.**

The full local workbench uses containerized PostgreSQL for the accepted catalog, legal records, relationships, review decisions, and transactional publication state. Content-addressed original files and normalized JSONL are portable replay inputs. DuckDB reads versioned Parquet/JSONL exports for analytics; it does not write accepted records. Optional pgvector and local Gemma support discovery and proposed annotations. Neither supplies authoritative legal facts.

Public delivery consists of a pinned static Astro build and its static data files. Local queries, administrative tools, model endpoints, database credentials, and private workbench records are outside that publication boundary. A file-only fixture build is supported without introducing another canonical database backend.

## 1. Shared conventions and trust states

Every record has a schema version and stable identifier. Digests name both the algorithm and canonicalization version; SHA-256 values must be valid hexadecimal, not merely 64 characters long. Legal calendar dates retain their precision and source timezone where relevant. Retrieval and processing timestamps are UTC instants.

Keep these dimensions independent:

| Dimension | Proposed values / meaning |
| --- | --- |
| Extraction state | candidate, verified, rejected: whether the source actually supports the extracted text or relationship |
| Editorial review | unreviewed, accepted, disputed, superseded; reviewer and rationale required for decisions |
| Legal authority | statute, regulation, judicial opinion, agency guidance, editorial material, third-party interpretation; source-specific qualifications retained |
| Applicability | known, conditional, disputed, unknown |
| Collection coverage | complete, partial, failed, not_collected; always relative to a declared scope |

A verified quotation is not a verified interpretation. Editorial acceptance is not a judicial ruling. Hash verification proves artifact identity, not legal correctness. No single confidence score substitutes for these distinctions.

## 2. SourceArtifact, SourceSnapshot, and SourceRelease

**SourceArtifact** identifies immutable bytes: artifact_id, sha256, byte_length, media_type, storage_locator, compression metadata, and license/provenance reference. Preserve a downloaded archive and separately identify extracted members. Do not retain credentials, cookies, or secret-bearing request headers.

**SourceSnapshot** records an acquisition of a source document: snapshot_id, source_registry_id, requested/final URLs, publisher, artifact_id, acquisition_id, retrieved_at, publisher identifiers, published/edition dates with precision and evidence, and relevant observed response metadata. Publisher Last-Modified and ETag values are observations, not trusted legal dates. Repeated retrievals can reference identical bytes.

**SourceRelease** is an immutable manifest of a publisher edition or explicitly defined collection: release_id, publisher_release_label, snapshot_ids, source_scope, coverage_id, manifest_digest, acquisition records, and correction/supersession links. A reused publisher label with changed bytes creates a distinct release identity. Resolve Git tags to commits and preserve both; a tag name is not an immutable identity.

Retain original files even when extraction excludes boilerplate. Each exclusion records its source span, reason, classification, and extractor version. Excluding navigation from a display is permissible; silently dropping statutory notes, table cells, provisos, or effective-date language is not. Unsupported legal structures remain available through a faithful fallback and an explicit fidelity finding.

Raw inputs needed by published releases remain recoverable through documented backup/export retention. Large blobs need not live in ordinary Git. Deleting a local cache must not delete the only recoverable source copy.

## 3. Provision identity, versions, and membership

**Provision** contains provision_id, jurisdiction, document_kind, creation basis, and identity_registry_version. Use a durable identity registry. Do not derive identity from a filename, current citation, or earliest snapshot currently loaded: later backfills must not change established IDs.

**ProvisionVersion** contains provision_version_id, provision_id, normalized_content_hash, normalization_version, structured body, ordered children, source identifiers, notes, tables, source codification status, and evidence references. Preserve meaningful alphanumeric labels and hierarchy. Keep legal text, source credits, editorial notes, and presentation metadata distinguishable without discarding any.

**SnapshotMembership** joins source_release_id to provision_version_id and records source order, hierarchy, and source location. Unchanged content can participate in multiple releases without creating new text versions. A rendering-only change creates a new rendered artifact, not a legislative amendment.

The legal graph may contain cycles, reciprocal citations, and self-references. It is not the processing DAG.

## 4. CitationAssignment and identity transitions

**CitationAssignment** contains assignment_id, provision_id, normalized citation, original citation text, publisher identifier, applicable snapshot set or evidenced interval, evidence_ids, and review state. Canonical citation paths are crosswalk keys, not permanent proof of identity.

Keep renumbered_to, transferred_to, split_into, merged_into, repealed_by, and reenacted_by as explicit, sourced transitions. Splits and mergers may be many-to-many. Similar wording suggests a candidate match; it does not establish continuity.

Reusing an old section number can create a new provision identity. Historical references resolve against their cited release or evidenced time context. Without that context, retain ambiguity instead of attaching them to the present occupant. Historical routes must not unconditionally redirect to a current provision when that would change meaning.

Absence from a complete snapshot means not_present_in_snapshot. It does not, by itself, establish repeal. Existing active/repealed/reserved/omitted status fields initially describe the source's codification presentation, with their extraction basis retained.

## 5. EvidenceSpan and LegalAssertion

**EvidenceSpan** contains evidence_id, source_snapshot_id, artifact/representation hash, locator kind and value, excerpt or structured value, excerpt hash, and extraction-map version. Locators can use USLM identifiers, XML paths, PDF pages plus coordinates, or offsets in a hashed extracted representation. Offsets must never refer to an unversioned mutable string.

**LegalAssertion** contains assertion_id, subject, relation_type, object or unresolved target, evidence_ids, extraction method/version, extraction state, editorial review, applicability_claim_ids, and supersession links. Record exact source/version alignment and the distinction between direct source metadata and an inferred proposition.

Start with a small relation vocabulary. Mentions/cites, authority_citation, amends, transfers, and supersedes have different evidentiary requirements. Case citations do not establish holdings, treatment, or invalidation. A case's decision date does not prove which statutory version it analyzed.

The [eCFR Parallel Table of Authorities](https://www.ecfr.gov/parallel-table-of-authorities/current) derives its entries from agency authority citations and includes statutes interpreted or applied. An entry supports a qualified authority relationship at its stated granularity, not proof that every subsection of a CFR part implements every cited statutory subsection.

Disagreements preserve competing readings, evidence, reviewer decisions, and affected scope. Do not label an editorial resolution as a legal ruling. Axiom's [source-conflict register](https://github.com/TheAxiomFoundation/rulespec-us/blob/main/known-source-conflicts.yaml) is a useful structural reference, with that terminology distinction.

## 6. ApplicabilityClaim and historical observations

**ApplicabilityClaim** contains claim_id, target provision version or assertion, applicability state, optional interval, conditions, source language, evidence_ids, review state, and competing/superseding claim IDs.

Known means a supported, sufficiently scoped determination. Conditional retains the predicates and required facts. Disputed retains competing interpretations. Unknown carries a reason. Missing bounds remain missing; they are not silently replaced with enactment, publication, release, or retrieval dates.

Represent start and end boundaries explicitly. Each boundary includes state (known, expressly open, unknown, or conditional), value when established, precision, inclusive/exclusive semantics where established, original source wording, conditions, event/basis, and evidence IDs. Preserve date-only values as dates; do not invent midnight instants or precision absent from the source. An expressly open boundary needs a supported scoped claim. A null end value does not establish that a provision is still applicable. Competing boundaries remain separate disputed claims.

Different subsections may have different effective dates. Retroactivity, tax-year conditions, pending proceedings, delayed commencement, and external triggering events must remain expressible. Do not force every condition into one section-wide date range.

Support three distinct query contracts:

| Query | Required behavior |
| --- | --- |
| As published | Resolve an explicit publisher release/snapshot and return its membership |
| Legally applicable | Require a date and necessary context; return supported, conditional, disputed, or unknown results |
| Known as of | Resolve facts actually recorded by this installation by that observation cutoff |

**HistoricalObservation** records observed_at, recording installation, source event, target record/version, outcome, and any evidenced import provenance. Backfilling a 2015 document today does not create a 2015 observation. A source publication date is not proof of historical system knowledge.

Corrections append records and supersession links. Queries can reproduce earlier observations without presenting superseded conclusions as current. Unavailable historical snapshots produce explicit unavailable results, never current-text fallback. Axiom's [documented historical-query limitation](https://github.com/TheAxiomFoundation/axiom-corpus/blob/main/docs/historical-versioning.md) illustrates the failure to avoid.

## 7. CollectionCoverage

**CollectionCoverage** contains coverage_id, source scope, edition/date window, request filters, expected partitions or enumeration method, completed partitions/pages, counts, missing items, error receipts, overlap/watermark policy, and coverage state.

Complete means the declared collection contract was satisfied, not that all law relevant to a question was discovered. A successful empty collection differs from a failed request. Rate limits, malformed responses, incomplete pagination, and inaccessible documents cannot become empty authoritative datasets.

Preserve previous accepted data when refreshes fail. Required source-scope failure prevents release acceptance. Optional enrichment may remain explicitly stale/partial without claiming that no relationships exist.

Maintain a field-to-source coverage map alongside collection coverage: schema field group, source registry entry, source/release scope, extraction method, evidence locator, review requirement, and unresolved acquisition/extraction gaps. Relevant source acquisition and historical backfill are authorized by [the acquisition plan](DATA-ACQUISITION.md). Keep the collection state separate from the assertion's supported, conditional, disputed, or unknown state; a complete collection can still leave a legal question unresolved.

## 8. DerivedArtifact and dependency identity

**DerivedArtifact** contains artifact_id/hash, artifact kind, schema version, producer identity, ordered input hashes, configuration digest, normalization/resolver versions, validation receipts, license set, and dependency declarations. Output timestamps and run IDs are separate from deterministic content identity.

Dependencies include:

- Positive inputs: source/provision versions actually consumed.
- Collection inputs: the exact resolver/corpus/index release and searched scope.
- Negative inputs: searched collections or keys whose absence influenced a result.
- Versioned policies: identity rules, review decisions, licensing rules, and applicability logic.

Adding a previously missing citation target, completing a partial collection, or changing resolver coverage invalidates affected unresolved results. Watching only previously matched nodes is insufficient.

Persist model output receipts: model identifier and available weights/version digest, runtime/configuration, prompt/template version, exact input versions, output hash, and review disposition. Reusing an accepted output is reproducible; rerunning a stochastic model need not be byte-identical.

Vector search retrieves candidates only. Apply exact version, jurisdiction, snapshot, access, and review filters before supplying evidence to a model or query result. Validate selected identifiers again after retrieval.

## 9. TaskAttempt and transactional acceptance

**TaskAttempt** contains task_id, attempt_id, task generation, input identity, owner, lease expiry, fencing token, state, output references, and validation results. Model the scheduler as at-least-once execution with idempotent acceptance, not exactly-once execution.

Workers write immutable outputs before attempting acceptance. PostgreSQL accepts them transactionally only if the task generation, input identity, and fencing token still match the current task. A compare-and-swap failure leaves inspectable orphan artifacts; it cannot overwrite newer accepted results.

Expired leases allow another attempt. A late worker cannot publish after losing its lease. Repeated successful acceptance of the same identity is a no-op. Processing DAG cycles fail validation. Optional HCK integration may supply execution, but does not change these acceptance invariants or own the canonical legal catalog.

## 10. PublicationManifest

**PublicationManifest** contains publication_id, source release identities, accepted graph/export identities, schema/producer versions, included artifact paths and hashes, required/optional coverage decisions, licenses/attributions, validation receipts, build identity, and predecessor publication.

The manifest describes a complete static release candidate. Build pages and data from the same pinned candidate; do not independently fetch a newer data branch during deployment. Publish versioned assets, verify the candidate, and atomically promote the publication pointer. Retain the prior publication for rollback.

Optional partial enrichment must be visible in both machine-readable metadata and affected UI. A missing required core release blocks promotion. Compiler/schema success does not certify interpretive validity.

## 11. Migration and licensing

Import existing tagged Markdown as legacy derived snapshots with their actual Git identities. If original raw XML is unavailable, record that limitation. Later recovery of an official historical edition adds an acquisition and reconstruction receipt; it does not fabricate prior retrieval dates or rewrite history.

Use compatibility adapters for current routes and sidecars, shadow-build new exports, and compare meaningful text and coverage before cutover. Backfill by release and title with checkpoints.

Keep imported RuleSpec encodings, companion tests, parameters, and provenance under their stated attribution terms. Its [NOTICE](https://github.com/TheAxiomFoundation/rulespec-us/blob/main/NOTICE) assigns these CC BY 4.0 and incidental tooling Apache 2.0. Do not silently fold that enrichment into CC0 statute data. Independently fetched official-source content retains its own documented status. Every publication carries required third-party attribution.
