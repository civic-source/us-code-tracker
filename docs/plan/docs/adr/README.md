# Architecture decisions

These are proposed implementation decisions. The prior user-supported direction is identified where applicable; new details are recommendations to validate through the first slices. Small routine choices belong in code or ticket notes, not additional ADRs.

## ADR 001: Local workbench with static public releases

**Status:** Prior direction retained; delivery contract proposed.

**Decision:** Run acquisition, graph/analytical processing, review, and optional local models privately. Publish complete, pinned Astro releases.

**Why:** It fits the recovered local-first requirements and preserves inexpensive, inspectable public delivery. A reader's result should not vary with a live enrichment provider.

**Tradeoff:** Publication is an explicit build/promotion process. The public site cannot expose arbitrary live database queries. Ship bounded static indexes and use the local workbench for unrestricted research.

**Revisit when:** A specific public interaction demonstrably requires a service and its operations/privacy budget is accepted.

## ADR 002: One PostgreSQL accepted catalog and portable immutable artifacts

**Status:** PostgreSQL/DuckDB direction retained; authority/replay boundary proposed.

**Decision:** PostgreSQL owns accepted records, identities, review history, and publication state. Immutable sources, canonical exports, and acceptance/registry manifests permit replay and recovery. DuckDB and vectors are projections.

**Why:** Transactional acceptance and coherent temporal/evidence queries need one owner. Portable artifacts avoid tying every build or analysis tool to a running database.

**Tradeoff:** Backups must cover database state and artifacts. Source bytes alone cannot restore stable IDs or editorial choices. Avoid a second production SQLite catalog.

**Revisit when:** Measured operational limits require a different catalog, after the versioned contracts and migration cost are assessed.

## ADR 003: Separate identity, publication time, applicability, and observation

**Status:** Proposed.

**Decision:** Use stable provisions, versioned citation assignments, snapshot membership, and evidence-bearing applicability claims. Support as-published, legally-applicable, and known-as-of queries separately.

**Why:** Citation reuse, transfers, delayed effect, conditional retroactivity, and late backfills make a citation plus one date unreliable.

**Tradeoff:** Some results remain unknown or disputed and the UI must explain that honestly. The first complete capability is snapshot history, not universal applicability reasoning.

**Revisit when:** Source evidence refines a specific mapping or claim; append revisions instead of silently changing historical meaning.

## ADR 004: Incremental processing includes absence and collection dependencies

**Status:** Proposed.

**Decision:** Derivation keys include producer/configuration identity and consulted collection releases, including searches that found no target.

**Why:** A newly added target or changed source coverage can invalidate a previous negative result without changing a previously matched node.

**Tradeoff:** Dependency manifests are larger and some collection changes cause wider recomputation. Correctness takes priority over maximal cache reuse.

**Revisit when:** Measurements support narrower dependency indexes that retain equivalence to a clean build.

## ADR 005: Evidence review is separate from automated extraction and model confidence

**Status:** Proposed.

**Decision:** Preserve distinct extraction, editorial, authority, applicability, and coverage states. Optional models propose work with immutable receipts.

**Why:** A search match, exact quotation, editorial judgment, and legal holding are different claims. A numerical confidence value cannot collapse those distinctions.

**Tradeoff:** Strong interpretations require review effort and some features ship later. Basic source-linked browsing remains useful without them.

**Revisit when:** A bounded task has a validated automated acceptance rule; do not generalize it to legal correctness overall.

## ADR 006: Adopt external execution only after a measured local pilot

**Status:** Proposed; preserves prior interest in portable compute.

**Decision:** Start with finite single-host tasks. Use immutable task/receipt contracts and fenced acceptance for worker expansion. Evaluate HCK or an existing scheduler later.

**Why:** The immediate product risks are source correctness and publication, not cluster placement. Portable contracts preserve future choices without a platform dependency.

**Tradeoff:** Initial throughput is bounded by one host. Benchmarking determines when parallel execution becomes worthwhile.

**Revisit when:** A demonstrated bottleneck, measured expected benefit, and failure/recovery tests justify an additional executor.
