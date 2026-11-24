# Reproducible eCFR authority snapshots

This workflow captures the GPO current eCFR XML inventory once and searches it locally. It produces candidate authority evidence, independent of reviewed regulation sidecars and publication. CourtListener bulk ingestion is a separate adapter; this command does not scrape section search APIs.

Requires the repository's Node/pnpm toolchain and Python 3 standard library. GitHub archive/restore additionally requires authenticated `gh`. No GPU is used. The same checkout and commands can run on Merlin when its persistent storage and runtimes are available.

## Capacity and storage

Choose persistent storage, not `/tmp` or a container's disposable layer. All source staging is under the cache directory. Default cache quota is 16 GiB and minimum filesystem free-space reserve is 2 GiB; override explicitly with `--max-cache-gib` and `--min-free-gib`. Planning includes selected raw bytes, largest source staging and bounded index/output allowance, on top of retained cache usage. Checks repeat when writing. Archives and readback need additional coexisting space; retained generations are never automatically pruned.

The November 24, 2026 inventory contained 49 title XML files totaling 824,239,444 bytes, with a largest file of 161,546,683 bytes. These are observations, not fixed limits. Each source is capped at 256 MiB and derived index reads at 64 MiB. `plan` obtains the current inventory and checks the selected workload against the actual cache filesystem.

```bash
export ECFR_CACHE=/persistent/path/ecfr-bulk
pnpm exec tsx scripts/ecfr-bulk.ts --action plan --cache "$ECFR_CACHE" --titles 19,28
pnpm exec tsx scripts/ecfr-bulk.ts --action sync --cache "$ECFR_CACHE" --titles 19,28
pnpm exec tsx scripts/ecfr-bulk.ts --action status --cache "$ECFR_CACHE"
```

Use `--titles all` for the complete current XML inventory. Source requests are spaced at least 1.1 seconds apart; bodies stream to bounded staging files. The root inventory is retained even when only selected titles are captured, so partial coverage stays explicit.

## Incremental updates and offline replay

```bash
pnpm exec tsx scripts/ecfr-bulk.ts --action sync --cache "$ECFR_CACHE" --titles all --since 2026-11-01
pnpm exec tsx scripts/ecfr-bulk.ts --action rebuild --cache "$ECFR_CACHE"
```

`--since` accepts an inclusive UTC date or timestamp and requires a verified baseline. Sources in the requested window are refreshed; older baseline entries still receive conditional HTTP validation, with no body transfer after a valid 304. New sources and changed inventory metadata are acquired regardless of the cutoff. Inventory modification dates have minute precision; HTTP validators retain their exact seconds. The cutoff cannot suppress validation of older entries: minute-resolution listings cannot prove that same-size bytes are unchanged. This is a refresh window, not a claim that the publisher provides historical deltas.

Raw SHA-256 identities and exact lengths determine source content identity. Snapshot manifests retain acquisition and publisher dates separately from the XML amendment date. An unchanged run retains its snapshot identity. Offline replay makes no source requests and compares both the rebuilt index and all registered cohort products to their retained bytes. It fails on missing/corrupt input or a different extractor; use the archived producer revision for exact historical replay. A new extractor requires an explicit new generation.

The cache contains `objects/<sha256>`, immutable `manifests/<snapshotId>.json`, product registries, `staging/`, and an atomic `current.json` pointer. A writer lock prevents concurrent mutations. A failed job can leave valid unreferenced objects; it cannot advance the accepted pointer to a partial snapshot. Investigate a stale lock after verifying no process is active; do not delete another writer's lock.

## Local enrichment

```bash
pnpm exec tsx scripts/ecfr-bulk.ts --action enrich --cache "$ECFR_CACHE" \
  --usc-title 18 --data-repo /path/to/us-code --limit 100
pnpm exec tsx scripts/ecfr-bulk.ts --action enrich --cache "$ECFR_CACHE" \
  --usc-title 28 --sections 509,510,516 --output /persistent/path/authority-evidence.json
```

The explicit cohort and source coverage are recorded with the product, which is included in archives. Authority lists and conservative numeric ranges match locally. Subsection references, open-ended ranges and unsupported syntax are retained as unresolved rather than silently broadened. A part-level authority citation remains part-level evidence; it does not establish that every regulation in that part implements the statute. Products remain candidate/unreviewed and do not modify existing sidecars or imply editorial acceptance. No matches under partial corpus coverage cannot establish a global absence.

## Archive and recover

```bash
pnpm exec tsx scripts/ecfr-bulk.ts --action export --cache "$ECFR_CACHE" --output /persistent/path/snapshot.tar.gz
pnpm exec tsx scripts/ecfr-bulk.ts --action import --cache /persistent/path/restored-cache --input /persistent/path/snapshot.tar.gz
pnpm exec tsx scripts/ecfr-bulk.ts --action rebuild --cache /persistent/path/restored-cache
pnpm exec tsx scripts/ecfr-bulk.ts --action archive --cache "$ECFR_CACHE" --repository civic-source/us-code-tracker
pnpm exec tsx scripts/ecfr-bulk.ts --action restore --cache /persistent/path/restored-cache \
  --repository civic-source/us-code-tracker --tag ecfr-data-SNAPSHOT16-ARCHIVE16
```

Bundles contain the original snapshot, raw XML, deterministic index and registered derived products. Import validates member paths/types, declared sizes, hashes and reference closure before accepting the snapshot. It never executes archived code. GitHub uploads use content-addressed release tags and asset names, never replace existing assets, and independently download and verify the uploaded bytes. The tag includes prefixes of both snapshot and bundle hashes, so adding a new derived product creates a separate archive without replacing an earlier one. Data releases do not become the repository's latest software release. The receipt reports whether GitHub server-side release immutability is enabled; application write-once behavior does not imply that repository policy is enabled.

An exact rebuild after loss depends on retaining the bundle and its producing code revision. GitHub archival refuses an uncommitted producer; after committing the implementation, sync a new generation and regenerate its products before its first archival. Older snapshots can be archived from a clean newer checkout when their recorded producer commit contains the exact extractor; the archive tag still retains that original producer. GPO's latest URL alone cannot recover an overwritten historical title. Keep local cache and GitHub release assets; periodically exercise restore into a disposable directory and compare index/product identities. Published source content and automated extraction are separate from reviewed-data acceptance and deployment.

Source contract: [GPO bulk inventory](https://www.govinfo.gov/bulkdata/ECFR), [GPO XML guide](https://github.com/usgpo/bulk-data/blob/main/ECFR-XML-User-Guide.md). Architecture: [ADR 0001](../decisions/0001-ecfr-bulk-snapshots.md), [specification](../specs/ecfr-bulk.md).
