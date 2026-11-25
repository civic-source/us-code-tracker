# Pinned historical Title 18 source pilot

The source input contract retains the original OLRC ZIPs for `Online@119-73` and `Online@119-142`. `source-pins.json` records the actual bounded acquisitions and exact archive/member identities. `materializations.json`, `qualification.json` and the six independent witnesses qualify **sections 1001, 111, 1114 only in each edition**. Each original member has 1,399 canonical provisions; 3 per edition are independently checked. The six unrelated Git-derived provisions in each retained legacy collection remain explicitly legacy-derived and partial. The search index exposes four distinct collection selectors: two legacy 6-row collections and two genuine 3-row collections. A fresh `olrc-pilot-<digest>` collection identity binds the qualified cohort; `publisherReleaseId` separately identifies its OLRC edition. Old queries/tags are not silently rebased. Raw section-node counts are a different denominator.

The qualification covers the independent oracle's text lanes and list placement, including source credits and editorial notes. Tables, footnotes and unknown structures fail closed. It does not establish full-title fidelity, legal amendments, applicability, enactment or effective dates. Source acquisition/processing times are observation times. Identical selected text across snapshots does not prove that no law changed between them.

The small XML fragments in `scripts/__tests__/fixtures/genuine-olrc/` are **derived test envelopes**, with separate fragment hashes and provenance back to the original member. They are never accepted as the original publisher member. Production replay always opens the original retained ZIP, verifies its original member, compiles the selected sections, and runs the independent oracle against the full member. The checked-in materializations and renderer hashes must match the reviewed pins. Recipe drift refuses publication until requalification and independent real-diff review.

## Restore and replay

Run from the tracker root with the pinned Node/pnpm environment and Python 3.12 (the witness records the Unicode normalization version). Install the existing lockfile and build the workspace packages first. No weights, corpus overwrite, model claims, or bulk backfill is part of these commands.

Restore the exact source closure from its content-addressed GitHub release (the tag is derived from the known two archive pins; no latest-release lookup or repinning):

```sh
pnpm exec tsx scripts/historical-source-cache.ts --action github-restore \
  --repository civic-source/us-code-tracker --cache .workbench/olrc-cache \
  --directory .workbench/NEW-source-readback
pnpm exec tsx scripts/rebuild-historical-pilot.ts --cache .workbench/olrc-cache \
  --output .workbench/NEW-history-replay
```

`--directory` and `--output` must be new. The archive manifest and complete asset closure are checked, downloads are bounded before disk writes, and every original ZIP digest is verified before cache admission. Unknown, missing, oversized, same-size corrupt, symlinked or extra transport entries refuse. Immutable objects are never overwritten. A failed import can retain verified immutable blobs, but it never selects a catalog or accepts an edition. Keep the release receipt alongside the build/publication receipt; GitHub server immutability is reported independently from application-level no-overwrite and digest checks.

Directory export/import uses original bytes without recompression or time-dependent archive metadata:

```sh
pnpm exec tsx scripts/historical-source-cache.ts --action export --cache .workbench/olrc-cache --directory .workbench/NEW-source-export
pnpm exec tsx scripts/historical-source-cache.ts --action import --cache .workbench/NEW-restored-cache --directory .workbench/NEW-source-export
```

The cache checks available storage using the existing minimum-free/quota contract. Default reserve is 2 GiB; the two original archives total 3,940,851 bytes. Export/readback/isolated restore each need another original-byte copy. They are stored in local cache and GitHub release assets, outside Pages.

After the reviewed producer commit is merged, archive its original source inputs with an exact producer revision. Publication first creates a new draft release and content-addressed tag, then verifies download and import, publishes, and repeats readback/import. Existing releases/assets/tags are never clobbered; interrupted publication requires explicit reconciliation.

```sh
pnpm exec tsx scripts/historical-source-cache.ts --action github-publish \
  --repository civic-source/us-code-tracker --producer-revision EXACT_REVIEWED_COMMIT \
  --cache .workbench/olrc-cache --directory .workbench/NEW-source-publication \
  --receipt .workbench/NEW-source-archive-receipt.json
```

## Publication boundary

`build-canonical-slice` rebuilds the canonical catalog, search shards, relationship neighborhoods and neutral topic navigation from reviewed materializations plus separately labelled legacy Git members. Source-qualified records use fresh IDs bound to source/member/section/compiler/rendering identities. The withdrawn constructed records, raw Git objects, old tags and source-correction event remain addressable as history; none is relabelled as an original OLRC snapshot.

The cold `/history/{release}/18/{section}/` pages contain the selected full body without JavaScript or an API. Their statutory article retains the independent oracle's body selector; visible edition/provenance labels identify the historical snapshot. Query-selected legacy views disclose their JavaScript requirement and link to the complete source-checked static reader when one is available. Missing editions and unsupported pinpoints refuse; current text is never silently substituted.

Code-tested, source-qualified historical pilot, current-corpus data acceptance, completed static build and verified live deployment are separate receipts. This historical source pilot does not mutate or promote the current `us-code` corpus.
