# Operations and release runbook

**Proposed operating model. Schedules, budgets, and services below are not activated by this plan.**

## Local deployment

Use one Linux host or VM initially, with containerized PostgreSQL, durable artifact storage, and finite ingestion/validation jobs. Configure optional model and vector services separately so their absence cannot block core operation. Pin actual image/tool versions and preserve lockfiles. Keep resource limits and storage locations configurable.

Measure the actual host before choosing concurrency or a model size. Earlier suggestions of 32–64 GB RAM and 4 TB storage were planning suggestions, not verified hardware. Benchmark a small title, a structurally difficult title sample, multiple releases, a bounded case collection, and one static publication. Record elapsed time, peak resident memory, CPU/GPU use if present, source volume, database/index growth, output size, and network cost.

Derive the initial production budget and cohort size from those measurements. Set disk-watermark admission controls so backfills stop before exhausting the host. The budget must reserve space for current data, a candidate publication, rollback artifacts, database backup/restore work, and temporary extraction files. Report estimates separately from measurements.

## Scheduling and recovery

Proposed default: check core publisher release metadata once daily, refresh bounded enrichment independently at an appropriate provider-approved interval, and run historical backfills in a lower-priority resource class. Rate limits, provider terms, source release cadence, and measured cost take precedence. Do not poll an unchanged source aggressively.

Maintain per-source and per-release work ledgers, not a single universal cursor. Each request has a bounded timeout, bounded retries with jitter, and explicit rate-limit handling. Persist retryable failures and next eligibility. One unavailable optional provider must not cancel an otherwise complete core release.

Collection contracts specify pagination, enumeration, date windows, overlap, stable provider identifiers, deduplication, and completion criteria. Distinguish absent, empty, failed, partial, and not collected. Use overlap windows when provider updates can arrive late. Mark all collection receipts with their exact scope.

If a run is interrupted, re-enumerate remaining ledger entries, verify already accepted identities, and retry only eligible work. No worker's output is authoritative until accepted. Multi-worker operation additionally requires fencing tokens and expiry tests. The previous accepted result remains available while a refresh is pending or failing.

## Promotion checklist

1. Identify the candidate manifest and its predecessor; resolve all Git tags to actual commits.
2. Verify required source completeness, fidelity, identity, evidence, license, and schema gates.
3. Export all public data and build pages, diffs, indexes, and coverage from the same manifest.
4. Run the declared static-site checks, including historical links, keyboard navigation, readable status labels, and absence of required enrichment network calls.
5. Stage the complete deployment and record its build receipt.
6. Promote using the supported hosting release mechanism.
7. Fetch the deployed manifest and verify its expected identity and representative routes.
8. Record acceptance and retain the predecessor's complete assets and source references.

The deployment mechanism must be demonstrated in the existing hosting environment. Do not infer a successful deployment solely from a data push or build exit code. Freeze promotion while a required source is incomplete or the site/data versions disagree.

## Rollback and restore

For a bad publication, stop further promotion, preserve diagnostics, select the preceding complete manifest/build, deploy its matching pages and indexes, and verify the public manifest. Do not force-reset the public data repository or reassign tags. Append a withdrawn/superseded publication record explaining the reason.

Database/schema rollout uses additive migrations first. Record schema versions and compatible application versions. Retain encrypted database backups where appropriate and source/artifact manifests with independent recovery copies. Export identity registry and editorial/acceptance records alongside canonical data; source text alone cannot reconstruct those decisions.

Before cutover, restore into a clean isolated environment and reproduce a representative accepted export. Check digests, stable IDs, review history, publication selection, and source availability. A backup command completing successfully is not a restore test. Establish recovery point and recovery time objectives after measuring the actual corpus and host.

## Observability

Expose a private operator summary and a smaller public coverage view. Track independently:

- Last discovered source release, last successful acquisition, last accepted release, and currently published release.
- Expected/completed partitions, missing pages, quarantined artifacts, and retryable failures.
- Source freshness and age of last-good optional enrichment.
- Semantic extraction changes, fidelity exceptions, unresolved references, and evidence-review backlog.
- Task queue age, attempts, expired leases, stale acceptance rejections, and deterministic cache reuse.
- Database, artifact, Git history, index, and publication sizes as separate measurements.
- Build/deploy identity, duration, verification outcome, and rollback availability.

Alerts should name the affected source/scope and concrete recovery action. Keep report-only diagnostics distinct from hard release gates. If a known-gap baseline is necessary, every entry needs a fingerprint, owner, rationale, expiry/review date, and tracked resolution; new failures cannot silently join the baseline.

## Security and provenance

Keep publisher credentials and GitHub write tokens in the runner's secret mechanism. Do not place them in raw acquisition metadata, images, fixtures, model prompts, logs, or exported pages. Use least-privilege tokens and separate read acquisition from publication credentials. Inspect workflow permissions and immutable third-party action/image pins in the touched release path without turning this project into an unrelated repository-hardening exercise.

Treat XML, HTML, PDF, and model input as untrusted data. Disable unsafe external entity processing, constrain archive extraction, bound decompression and parser resources, sanitize displayed markup, and validate externally supplied URLs and output paths. Ingested text must never become executable agent instructions. Evaluate these protections at the relevant boundaries using concrete fixtures.

Record actual producer and environment identities in receipts. A configuration claiming an expected tool pin does not prove that tool ran. Hashes and optional attestations establish provenance and integrity; legal correctness still depends on the evidence and review contracts.

Keep third-party attribution machine readable and visible where required. Axiom-derived encodings and provenance must not inherit CC0 merely because they are exported beside government text. Include only publishable records in the static bundle; private notes remain private.

## Scale decisions

Add workers only after the local benchmark identifies a parallelizable bottleneck and the task acceptance tests pass. Prefer one owner for placement: either the simple local executor or a selected existing scheduler. HCK can supply the task runner contract later. MicroVM isolation is a separate capability from a rootless container and should not be claimed unless the actual runtime provides it.

Before adding a source family, define its bounded value, authoritative documents, legal status, access method, completeness rules, evidence mapping, storage cost, and failure behavior. Before adding a model, define its evaluation set and stop conditions. Before retiring an old producer or reader, demonstrate parity and preserve rollback for the agreed observation period.
