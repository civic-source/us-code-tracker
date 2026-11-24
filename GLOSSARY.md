# Civic Source — Glossary & Ubiquitous Language

Shared domain vocabulary for all `civic-source` repositories (`us-code-tracker`, `us-code`, `cap-citation-pipeline`, `.github`). Use these exact terms in code identifiers, commit messages, issues, ADRs, and agent discussions.

## Domain Terms

**Release point**:
An official U.S. Code snapshot published by the Office of the Law Revision Counsel (OLRC), keyed by the Public Law through which the Code is current (e.g., `pl/119/73` or `PL 119-73`, tagged in `us-code` as `pl-119-73`).
_Avoid_: version snapshot, law release, OLRC checkpoint

**USLM XML**:
United States Legislative Markup (USLM 2.0) XML files distributed inside OLRC title ZIP archives. Parsed with `fast-xml-parser` in `preserveOrder` mode to preserve statutory hierarchy and inline element order.
_Avoid_: raw statute XML, House XML

**Content-data repo (`us-code`)**:
The Git repository (`civic-source/us-code`) holding transformed statutory Markdown files (`statutes/title-<N>/chapter-<N>/section-<N>.md`) and precedent annotations (`annotations/title-<N>/section-<N>.yaml`). Mounted in `us-code-tracker` at `apps/web/content-data`.
_Avoid_: data store, output folder, markdown dump

**Precedent annotation**:
A YAML sidecar file (`annotations/title-<N>/section-<N>.yaml`) mapping a U.S. Code section (`targetSection`, e.g., `18 U.S.C. § 111`) to citing federal judicial opinions from CourtListener (`totalCases`, `cases[]`, `lastSyncedET`).
_Avoid_: case law metadata, citation blob, inline annotation

**HashStore**:
The SHA-256 content-hash cache used by `@civic-source/fetcher` and `.import-state.json` to skip re-downloading or re-transforming unchanged OLRC title archives.
_Avoid_: ETag cache, download cache

**Result<T, E>**:
The discriminated union (`{ ok: true; value: T } | { ok: false; error: E }`) defined in `@civic-source/types` for explicit error handling across pipeline stages without throwing exceptions.

**Issue tracker**:
GitHub Issues on the respective `civic-source/<repo>` repository, accessed via the `gh` CLI.
_Avoid_: backlog, ticket board

**Triage role**:
One of the five canonical state-machine labels applied to an issue: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.

## Relationships

- An OLRC **Release point** contains 54 Title archives of **USLM XML**.
- `@civic-source/transformer` converts **USLM XML** into per-section Markdown inside the **Content-data repo (`us-code`)** and tags the commit with the **Release point** (`pl-<congress>-<law>`).
- `@civic-source/annotator` (and `cap-citation-pipeline`) writes **Precedent annotations** as YAML sidecars in `annotations/` so judicial citation updates never pollute statutory text diffs.
- `@civic-source/web` builds the static Astro v7 site and Pagefind index from the **Content-data repo (`us-code`)** and precomputed release diffs.
# Domain glossary

| Term | Meaning |
| --- | --- |
| Provision | A legally identified unit whose identity can persist across textual revisions and evidenced citation changes. |
| Provision version | One normalized content version of a provision under a specified normalization contract. |
| Citation assignment | An association between a citation and provision for a specified snapshot or evidenced interval. |
| Source artifact | Immutable original or derived bytes identified by a digest. |
| Source snapshot | A recorded acquisition of a particular source document and its provenance. |
| Source release | An immutable manifest describing a publisher edition or explicitly bounded collection. |
| Snapshot membership | The inclusion of a provision version in a particular source release, including source order and location. |
| Evidence span | A precisely located excerpt or value in a particular immutable source representation. |
| Legal assertion | A typed, evidence-bearing proposition about legal material, with separate extraction and review states. |
| Applicability claim | A supported, conditional, disputed, or unknown statement about when and to whom a provision or assertion applies. |
| Observation time | When this installation actually recorded a fact or result. |
| As published | A query for the contents of an explicitly identified publisher snapshot. |
| Legally applicable | A query for supported applicability at a date and relevant factual context. |
| Known as of | A query limited to observations actually recorded by a specified cutoff. |
| Collection coverage | The degree to which a declared source scope was successfully enumerated and collected. |
| Candidate | A possible match or interpretation requiring additional evidence or review. |
| Verified extraction | A result checked against its source; it does not by itself establish interpretive correctness. |
| Editorial decision | A recorded review choice with rationale; it is not an official legal determination. |
| Source conflict | Competing source statements or interpretations whose differences and disposition are retained. |
| Legal graph | The provisions, documents, assertions, and evidence connected by typed legal relationships. |
| Processing DAG | The acyclic dependencies through which source inputs produce validated artifacts. |
| Negative dependency | A searched scope or key whose absence affected an output. |
| Collection dependency | The particular inventory or corpus version consulted while deriving an output. |
| Logical task | Work identified by its intended inputs, producer, and configuration. |
| Attempt | One execution of a logical task, with its own lifecycle and output receipt. |
| Acceptance | The validated, transactional selection of outputs as the current result for a task or scope. |
| Publication | A complete static delivery bundle selected by an immutable manifest. |
| Legacy derived | Historical output whose original input or full production provenance is unavailable. |

### eCFR bulk snapshot

A complete selected set of GPO eCFR title XML blobs, identified by exact SHA-256 and byte length, plus an immutable manifest and deterministic authority index. Its manifest distinguishes the publisher's global title inventory from the titles actually captured. Acquisition time, HTTP modification time and XML amendment text have separate meanings.

### eCFR authority projection

Candidate, unreviewed matches from scoped XML authority notes onto an explicit U.S. Code section cohort. The product retains raw authority evidence, source identity, searched title coverage and unresolved syntax; it does not establish editorial approval or section-level implementation.
