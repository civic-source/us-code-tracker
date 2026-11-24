# ADR 0001: Retained eCFR bulk snapshots and deterministic derivations

Status: accepted for implementation

## Context

Section-by-section eCFR searches are expensive for initial enrichment. GPO publishes
one current XML file per available CFR title, with machine-readable inventories.
The endpoints expose latest files rather than an immutable history. A URL and hash
alone cannot recover an earlier file after its replacement upstream.

The existing OLRC source-release contract requires a Congress and Public Law.
Those fields cannot faithfully identify an eCFR collection. Existing regulation
sidecar coverage also does not establish which complete CFR corpus was searched.

## Decision

Introduce an eCFR-specific snapshot manifest and a content-addressed local cache.
Retain original XML, canonical authority records, inventory scope, transformation
identity, and source observations. Keep execution receipts separate from derived
content. An accepted snapshot is selected only after all selected source files and
derived artifacts have been verified. A failed attempt leaves that selection intact.

Use current GPO JSON inventories with an explicit JSON Accept header. Fetch only
XML, at bounded concurrency and request frequency, with streamed byte limits and
SHA-256 verification. Publisher modification time is distinct from the amendment
date inside each title volume. A multi-volume title retains amendment date texts
in source order, joined by a newline; it does not select a single latest date.
These dates are distinct from local observation time.

Use Python's standard-library Expat parser for bounded streaming extraction of
AUTH, SECAUTH and PARAUTH records. Reject document type declarations and entity
declarations, retain mixed-text order and exact hierarchy, and fail the partition
on malformed termination or inconsistent title identity. This is separate from
the existing USLM transformer; it does not replace its XML parser. No new library
dependency is required.

An authority record retains its scope and original text. Grouped citations and
ranges remain distinguishable from individual citations. Authority evidence does
not establish subsection-level implementation or editorial acceptance. Candidate
projections stay separate from reviewed content and publication.

Incremental refresh always compares the declared current inventory with a recorded
baseline. A since date defines an inclusive UTC refresh window. Older entries still
receive conditional HTTP validation: minute-resolution listing metadata cannot prove
same-size bytes are unchanged. New or changed entries are acquired regardless of
the cutoff so known gaps are not silently retained.
It is not a historical query. Historical replay uses retained manifests and bytes.
Missing or corrupt replay inputs fail explicitly without fetching latest substitutes.
Extractor/configuration changes invalidate derived caches even when XML is unchanged.

Publish self-contained snapshot archives as content-addressed GitHub release assets,
as selected by the maintainer. Retain the producer revision and independently verify
asset readback. Never overwrite an existing tag/asset with different content. Report
whether server-enforced release immutability is enabled; do not change repository-wide
release policy automatically. The release tag retains the producing code revision.

Check capacity on the actual cache, staging, restore and archive filesystems before
work. Account for old/new generations, the largest staged source, derived output and
archive copies, plus a configurable free-space reserve and cache quota. Do not use
RAM-backed temporary storage for corpus-sized intermediates. Do not silently prune
source artifacts referenced by retained snapshots.

## Consequences

An exact rebuild after host loss depends on the retained offhost archive and pinned
transformation contract, not on mutable publisher URLs. Restore verifies every byte
reference before accepting a snapshot, and a network-disabled rebuild must reproduce
the recorded canonical hashes. Human review is independent data and is not recreated
by XML extraction; reviewed content remains protected and separately versioned.

The CLI is portable CPU/disk work and can run on Merlin when its normal prerequisites
are available. A GPU is not part of this deterministic extraction path.

## Sources

- https://www.govinfo.gov/developers
- https://www.govinfo.gov/bulkdata/ECFR
- https://github.com/usgpo/bulk-data/blob/main/ECFR-XML-User-Guide.md
- https://docs.github.com/en/rest/releases/assets
- https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
