# Data acquisition and schema backfill

## Authorized scope

William explicitly authorized acquiring data from additional sources as needed to populate the new schemas. Implementers may discover, download, re-fetch, and backfill relevant public sources and already-authorized APIs, including historical editions and supporting documents. This covers the legal text, dates, identifiers, relationships, source metadata, and evidence required by the declared Tracker scope. Routine in-scope collection does not require another confirmation.

The existing source list is a starting point, not a closed allowlist. Add a source adapter when it supplies missing evidence or materially improves coverage. Existing Markdown and sidecars are useful migration inputs; they are not the limit of what the new model can contain. Batch size is an operational choice, not a permanent limit on corpus coverage. A complete relevant bulk collection may be more efficient than individual requests.

## Field-to-source coverage map

Before each migration cohort, map required fields to their expected evidence sources. The table below defines acquisition targets, not a guarantee that every source exposes a ready-made field.

| Schema need | Sources to investigate and acquire | Acceptance requirement |
| --- | --- | --- |
| Published text, hierarchy, source credits, statutory notes, source currency | OLRC USLM releases and metadata; appropriate official historical editions | Exact source release, raw bytes, faithful structure, source locations |
| Enactment, effective start/end, repeal, expiration, transition and applicability conditions | Enacted public laws and Statutes at Large through GovInfo; OLRC notes and classification references | Evidence for the particular provision/subsection and boundary; retain conditions and date precision |
| Citation aliases, transfers, renumbering, splits and mergers | Official text, tables, notes and amendment documents | Evidenced identity transitions; unresolved mappings remain explicit |
| Regulation text, authority relationships and temporal context | eCFR/CFR editions and metadata, authority citations, Federal Register documents | Match source version and relationship granularity; retain rule/proposed-rule/notice distinctions |
| Opinion identity, citation evidence, decision dates and supported propositions | CourtListener records and available opinion text; official court sources or suitable bulk collections when useful | Trace exact passages and versions; a decision date or search hit does not establish legal treatment |
| Guidance, parameters and derived interpretations | Relevant official agency publications; qualified third-party datasets where useful | Keep source authority, publisher, version, attribution and editorial status separate |
| Actual acquisition, processing, acceptance and publication | Tracker's own receipts and manifests | Record real events; never fabricate historical observation times |

For each field group, record the source registry entry, publisher/document type, acquisition method, release/date coverage, expected evidence locator, extraction method, review requirement, and fallback/reconciliation rule. Keep collection completeness separate from whether the evidence settles the requested legal fact.

## Acquisition workflow

1. Identify missing or weakly supported fields in the declared cohort. Distinguish not yet collected, unavailable source material, extraction gaps, and unresolved interpretation.
2. Register appropriate sources and verify their current supported access methods. Prefer official bulk downloads and APIs when suitable; use document extraction where necessary.
3. Acquire immutable originals with actual retrieval time, checksums, publisher identifiers, source dates and licensing/provenance metadata. Preserve archives and member identities when relevant.
4. Normalize into schema-versioned records, retaining exact evidence spans and extraction mappings. Preserve unsupported structures for review.
5. Reconcile cross-source assertions by document authority, scope, date, and direct support. Do not assume one publisher always wins for every field or use last-write-wins to settle a disagreement.
6. Validate collection coverage, field support, temporal semantics and identity. Accept supported records transactionally; retain unresolved or conflicting claims explicitly.
7. Refresh affected outputs using the recorded positive, negative, collection and producer dependencies. Emit a coverage report describing acquired data, populated fields and remaining evidence gaps.

A schema expansion may require reprocessing retained originals, fetching a richer representation, or acquiring additional historical documents. Choose the least costly sufficient route and record the producer/schema identity. Repeated collection must remain idempotent and resumable.

## Date and endpoint requirements

Each start/end boundary records its state, value if established, precision, original wording, boundary semantics, conditions and evidence. Distinguish known, expressly open, unknown and conditional boundaries. An expressly open boundary requires a supported claim at a specified scope; a missing end date does not prove continuing applicability. Retain disputed alternatives at the applicability-claim level.

Reconstructing a 2015 legal interval from documents acquired today is allowed. Claiming that Tracker acquired or knew those documents in 2015 is not. Preserve both legal time and actual observation history.

## Scale and source handling

Use per-source rate limits, bounded concurrency, retry budgets, durable checkpoints and measured disk budgets. Preserve last-good accepted data during outages. Prefer deduplicated raw storage so additional metadata extraction does not require repeated downloads of unchanged documents.

Preserve third-party licenses and attribution and use access already available to the project. A source that requires unavailable credentials or a new paid arrangement is recorded as an acquisition dependency while other work continues. Public export eligibility is distinct from permission to acquire a source.

## Ownership

USCT-001 owns the field-to-source inventory. USCT-008 establishes acquisition and replay for the first cohort. USCT-013 through USCT-016 extend evidence adapters. USCT-027 backfills the declared schema and source scope. USCT-034 verifies temporal boundary and query behavior. These requirements are part of the existing 36-ticket backlog.
