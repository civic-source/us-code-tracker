# US Code Tracker implementation plan

**Prepared for William · November 21, 2026 · Proposed work, not implemented features**

This package combines the recovered November 14 Civic Source design discussion, its companion Homelab Compute Kit planning documents, a read-only review of the current Civic Source repositories, and useful patterns from The Axiom Foundation's RuleSpec ecosystem. It is designed for incremental implementation in the existing repositories.

## Start here

1. Read [PLAN.md](PLAN.md) for the complete strategy, sequencing, and delivery gates.
2. Read [SPEC.md](SPEC.md) for observable product behavior and [GLOSSARY.md](GLOSSARY.md) for the domain language.
3. Use [AGENT-START.md](AGENT-START.md) when implementation is authorized. It describes how to reconcile the current repository, select work, and produce reviewable changes.
4. Select tickets from [backlog/README.md](backlog/README.md); [backlog/backlog.json](backlog/backlog.json) is the machine-readable dependency graph. Ticket IDs are proposed planning IDs, not existing GitHub issues.

## Supporting documents

| Document | Purpose |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Local processing, data authority, module boundaries, and static publication |
| [Data contracts](docs/DATA-CONTRACTS.md) | Identity, time, evidence, coverage, artifacts, tasks, and publication |
| [Data acquisition](docs/DATA-ACQUISITION.md) | Authorized source discovery, schema-field coverage, historical acquisition, and metadata backfill |
| [Migration](docs/MIGRATION.md) | Exact repository observations, additive changes, compatibility, cutover, and rollback |
| [Validation](docs/VALIDATION.md) | Independent fixtures, failure scenarios, quality gates, and release acceptance |
| [Traceability](docs/TRACEABILITY.md) | Every specification story and difficult failure scenario mapped to delivery tickets |
| [Operations](docs/OPERATIONS.md) | Local deployment, scheduling, credentials, recovery, budgets, and observability |
| [Source reconciliation](docs/SOURCE-RECONCILIATION.md) | What was recovered, what exists, what is borrowed, and what remains proposed |
| [Architecture decisions](docs/adr/README.md) | Consequential choices and their tradeoffs |

The plan preserves local PostgreSQL/DuckDB processing and static Astro publication. It preserves the TypeScript monorepo and existing historical data. Local models, extra workers, HCK, and RuleSpec interoperability are staged additions. They do not block a trustworthy core tracker.

## Status and evidence limits

The review inspected source, repository history/API metadata, saved planning artifacts, and official source documentation. It did not execute production ingestion, deploy the website, benchmark hardware, run the application's test suites, or implement this backlog. Repository state can change; USCT-001 reconciles this baseline before implementation. Existing local or private work outside the inspected repositories may exist.

The main repository was reviewed at `822d2a5f904a874f107bcdf4c99f0e1fda4f5d51`. Other exact source revisions and links appear in the reconciliation and migration appendices. Proposed requirements and estimated effort are planning judgments, not measured guarantees.
