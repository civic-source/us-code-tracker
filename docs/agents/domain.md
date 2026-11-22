# Domain Docs

How agents and engineering skills consume domain documentation across the `civic-source` workspace.

## Before exploring, read these

- **[`GLOSSARY.md`](../../GLOSSARY.md)** at the workspace root (or repo root): defines ubiquitous language (`Release point`, `USLM XML`, `Content-data repo`, `Precedent annotation`, `HashStore`, `Result<T, E>`).
- **`ARCHITECTURE.md`** and **`docs/SPEC_DEVIATIONS.md`** in `us-code-tracker/`: system topology, package responsibilities, and documented deviations from the initial spec.
- **`docs/decisions/`** (or **`docs/adr/`**): read Architecture Decision Records touching the package or pipeline stage you are modifying.

If a subdirectory or ADR folder does not exist yet, proceed silently and create `docs/decisions/NNNN-title.md` when an ADR trigger condition (AGENTS.md §5.4) is met.

## Use the glossary's vocabulary

When naming types, functions, CLI flags, issues, tests, or commits, use the exact terms in `GLOSSARY.md`. Do not drift to avoided synonyms.

## Flag ADR & spec conflicts

If a proposed change contradicts `ARCHITECTURE.md`, `docs/SPEC_DEVIATIONS.md`, or an existing ADR, surface the conflict explicitly to the user before writing code:

> _Contradicts SPEC_DEVIATIONS §1 / ADR-NNNN, worth reopening because..._
