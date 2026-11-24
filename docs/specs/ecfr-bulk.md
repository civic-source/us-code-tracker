# Reproducible eCFR bulk enrichment

## Problem statement

Initial regulation enrichment currently requires repeated remote searches for each
U.S. Code section. Local data loss must not force a different result from mutable
publisher endpoints, and an existing dataset should support efficient refreshes.

## Solution

Capture dated, bounded source collections into a verified content-addressed cache;
derive an authority index locally; archive complete inputs and manifests offhost;
and expose one operator workflow for acquisition, update, replay, projection,
verification, archival and restoration.

## User stories

1. An operator can capture selected CFR titles or the complete available inventory.
2. An operator can see expected transfer size and required disk headroom before work.
3. An operator can refresh a baseline while reusing verified unchanged inputs.
4. An operator can supply a since date without losing changes known to the baseline.
5. A researcher can distinguish publisher modification, amendment and observation dates.
6. A researcher can inspect exact authority text, hierarchy, scope and retained bytes.
7. An operator can recreate canonical outputs offline from a recorded snapshot.
8. An operator can recover after local dataset loss using a verified GitHub archive.
9. A researcher can distinguish complete selected-source coverage from partial corpus coverage.
10. An operator can project a deterministic U.S. Code cohort without changing reviewed data.
11. An operator can inspect failed/interrupted attempts without losing accepted outputs.
12. A maintainer can trace issues, verification receipts, source snapshots and archives.

## Decisions

- Use separate eCFR manifests; do not manufacture OLRC release-point identifiers.
- Preserve raw XML and derived hashes; snapshot identity is immutable once recorded.
- Record real acquisition observations; replay does not replace them with execution time.
- Stream and bound downloads and XML extraction, using existing Node and Python runtimes.
- Refresh source inventory, verify cached blobs, and use conditional downloads when valid.
- A since date does not request unavailable historical content or justify a missing baseline.
- Keep source-scope coverage separate from the selected U.S. Code target cohort.
- Preserve authority granularity and unresolved citations; machine output remains unreviewed.
- Stage outputs before selecting a snapshot; serialize writers with an explicit local lock.
- Export/import archives are complete and hash-verified; release assets are read back.
- Enforce disk reserve and cache quota on acquisition, export and restoration.
- Do not install dependencies, change CI policies or deploy a new Merlin service.

## Testing decisions

Exercise the public operator/pipeline seam using temporary real files and controlled
HTTP responses. Do not mock internal modules. Verify a clean capture, unchanged and
changed refreshes, parser-version invalidation, partial scope, grouped citations,
review preservation, capacity refusal, malformed inputs and interrupted work.

The recovery acceptance test deletes the entire disposable local dataset, restores
its archive, blocks networking and reproduces canonical output hashes. Missing or
tampered blobs fail without replacing the accepted snapshot.

## Initial qualification

First capture CFR titles 19 and 28 and project 100 recorded U.S. Code Title 18
sections with explicit partial corpus coverage. Then qualify the full current XML
inventory within measured capacity/transfer bounds and repeat archive/restore/replay.
The live source remains separate from static publication and editorial acceptance.

## Out of scope

CourtListener bulk ingestion, historic versions never archived by this installation,
automatic publication or editorial acceptance, model inference, GPU processing,
scheduled execution and repository-wide release-policy changes.
